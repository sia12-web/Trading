/**
 * Automatic Level Finder prep — runs from market-open / Tokyo prep cron.
 * Fetches real Yahoo multi-TF candles, runs Claude, archives to level_history
 * so the live chart can load AI levels with no manual UI.
 */

import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getLevelFinderAgent } from '@/lib/services/levelFinderAgent'
import { validateLevelsAgainstMarket } from '@/lib/services/levelValidation'
import { isDeskHoursNow } from '@/lib/trading/sessionGate'
import type { Candle } from '@/lib/services/levelFinderAgent/types'
import type { Instrument } from '@/types/price-feed'

const SYMBOL: Record<string, string> = {
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NIKKEI: '^N225',
}

function toAgentCandles(
  bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
): Candle[] {
  return bars.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    // Index feeds often report 0 volume — agent validation requires > 0
    volume: Math.max(1, c.volume || 0),
    timestamp: new Date(c.time * 1000).toISOString(),
  }))
}

async function ensureDeskSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  instrument: Instrument
): Promise<string | null> {
  // Reuse today's open session for this instrument if present
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('index_recommendation', instrument)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      index_recommendation: instrument,
    })
    .select('id')
    .single()

  if (error || !created?.id) {
    console.error('[AutoLevelPrep] Failed to create session:', error)
    return null
  }
  return created.id as string
}

export type AutoLevelPrepResult = {
  ok: boolean
  instrument: Instrument
  levels: number
  error?: string
}

/**
 * Run Level Finder for one instrument and archive results for the chart.
 * Safe to call from cron; non-fatal for the caller.
 */
export async function runAutoLevelPrep(
  instrument: Instrument,
  opts: { force?: boolean } = {}
): Promise<AutoLevelPrepResult> {
  try {
    if (!opts.force) {
      const desk = isDeskHoursNow(new Date(), instrument)
      if (!desk.open) {
        return { ok: false, instrument, levels: 0, error: desk.reason }
      }
    }

    const user = await getOrCreateUser()
    if (!user) {
      return {
        ok: false,
        instrument,
        levels: 0,
        error: 'No desk user — set DESK_MODE=single or configure Supabase Auth',
      }
    }

    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient() ?? (await createClient())
    const sessionId = await ensureDeskSession(supabase, user.id, instrument)
    if (!sessionId) {
      return { ok: false, instrument, levels: 0, error: 'Could not create desk session' }
    }

    const [daily, h1, h4, quote] = await Promise.all([
      getYahooCandles(instrument, 'D', 30),
      getYahooCandles(instrument, '60', 10),
      getYahooCandles(instrument, '240', 15),
      getYahooQuote(instrument),
    ])

    const candles_daily = toAgentCandles(daily?.candles ?? []).slice(-15)
    const candles_h1 = toAgentCandles(h1?.candles ?? []).slice(-40)
    const candles_4h = toAgentCandles(h4?.candles ?? []).slice(-30)

    if (candles_daily.length < 6 || candles_h1.length < 6 || candles_4h.length < 20) {
      return {
        ok: false,
        instrument,
        levels: 0,
        error: `Insufficient candles (D=${candles_daily.length} H1=${candles_h1.length} 4H=${candles_4h.length})`,
      }
    }

    const current_price =
      quote?.price ?? candles_h1[candles_h1.length - 1]?.close ?? candles_daily[candles_daily.length - 1]!.close

    // Refresh market memory before Claude sees history
    try {
      await validateLevelsAgainstMarket(supabase, user.id, instrument, 2)
    } catch {
      /* non-fatal */
    }

    const agent = await getLevelFinderAgent()
    // Morning cron always uses live (Opus) — never the cheap sim tier
    const analysis = await agent.analyzePriceAction({
      session_id: sessionId,
      symbol: SYMBOL[instrument] || instrument,
      index: instrument,
      current_price,
      candles_4h,
      candles_daily,
      candles_h1,
      llm_tier: 'live',
    })

    const validated = await agent.validateLevels(analysis.levels, sessionId)
    const stored = await agent.storeLevels(validated, sessionId)

    console.log(
      `[AutoLevelPrep] ${instrument}: ${stored.length} levels archived for chart (session ${sessionId})`
    )

    return { ok: true, instrument, levels: stored.length }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[AutoLevelPrep] ${instrument} failed:`, msg)
    return { ok: false, instrument, levels: 0, error: msg }
  }
}
