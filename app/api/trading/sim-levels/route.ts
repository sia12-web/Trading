/**
 * POST /api/trading/sim-levels
 *
 * Same Level Finder prompts as live (buildSystemPrompt + buildAnalysisPrompt),
 * but:
 *   - llm_tier=sim → cheap Haiku (not Opus)
 *   - candles cut strictly before cash open (as-of 9:30 ET / 9:00 JST) — no
 *     morning/afternoon lookahead into the replay day
 *   - NO Finnhub/news (past session — news is irrelevant for dated practice)
 *   - does NOT archive into live level_history
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getYahooCandlesRange } from '@/lib/yahoo/candles'
import { getLevelFinderAgent } from '@/lib/services/levelFinderAgent'
import { fetchLevelHistoricalContext } from '@/lib/services/levelFinderAgent/historicalContext'
import { sessionFor } from '@/lib/trading/sessionGate'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Candle } from '@/lib/services/levelFinderAgent/types'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYMBOL: Record<string, string> = {
  DOW: '^DJI',
  NASDAQ: '^IXIC',
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
    volume: Math.max(1, c.volume || 0),
    timestamp: new Date(c.time * 1000).toISOString(),
  }))
}

/** Aggregate unix-second bars into fixed buckets (as-of cut already applied). */
function aggregateBars(
  bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  bucketSec: number
) {
  if (bars.length === 0) return []
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const out: typeof bars = []
  let cur: (typeof bars)[0] | null = null
  let bucketStart = -1
  for (const c of sorted) {
    const start = Math.floor(c.time / bucketSec) * bucketSec
    if (!cur || start !== bucketStart) {
      if (cur) out.push(cur)
      bucketStart = start
      cur = {
        time: start,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }
    } else {
      cur.high = Math.max(cur.high, c.high)
      cur.low = Math.min(cur.low, c.low)
      cur.close = c.close
      cur.volume += c.volume
    }
  }
  if (cur) out.push(cur)
  return out
}

export async function POST(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: {
      instrument?: string
      date?: string
      /** Optional 5m bars already on the desk (used if Yahoo multi-TF is thin) */
      candles_5m?: Array<{
        time: number
        open: number
        high: number
        low: number
        close: number
        volume?: number
      }>
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const instrument = (body.instrument || '').toUpperCase() as Instrument
    const date = body.date || ''
    if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      return NextResponse.json({ error: 'instrument must be DOW, NASDAQ, or NIKKEI' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    }

    const sess = sessionFor(instrument)
    const toUnix = instrument === 'NIKKEI' ? tokyoDateTimeToUnix : nyDateTimeToUnix
    const [oh, om] = sess.marketOpen.split(':').map(Number)
    const openUnix = toUnix(date, oh!, om || 0)
    // Strictly before cash open — AI must not see the morning/afternoon being replayed
    const cut = openUnix - 1

    const [dailyPack, h1Pack, h4Pack] = await Promise.all([
      getYahooCandlesRange(instrument, 'D', cut - 45 * 86400, cut),
      getYahooCandlesRange(instrument, '60', cut - 14 * 86400, cut),
      getYahooCandlesRange(instrument, '240', cut - 25 * 86400, cut),
    ])

    let candles_daily = toAgentCandles((dailyPack?.candles ?? []).filter((c) => c.time <= cut)).slice(-15)
    let candles_h1 = toAgentCandles((h1Pack?.candles ?? []).filter((c) => c.time <= cut)).slice(-40)
    let candles_4h = toAgentCandles((h4Pack?.candles ?? []).filter((c) => c.time <= cut)).slice(-30)

    // Fallback: aggregate desk 5m history when Yahoo multi-TF is thin
    const raw5m = (body.candles_5m ?? [])
      .filter((c) => Number.isFinite(c.time) && c.time <= cut)
      .map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }))

    if (raw5m.length >= 20) {
      if (candles_h1.length < 6) {
        candles_h1 = toAgentCandles(aggregateBars(raw5m, 3600)).slice(-40)
      }
      if (candles_4h.length < 12) {
        candles_4h = toAgentCandles(aggregateBars(raw5m, 4 * 3600)).slice(-30)
      }
      if (candles_daily.length < 6) {
        candles_daily = toAgentCandles(aggregateBars(raw5m, 86400)).slice(-15)
      }
    }

    // Sim thresholds slightly softer than live cron (historical feeds can be sparse)
    if (candles_daily.length < 5 || candles_h1.length < 6 || candles_4h.length < 10) {
      return NextResponse.json(
        {
          error: 'Insufficient as-of-open candles for AI levels',
          counts: {
            daily: candles_daily.length,
            h1: candles_h1.length,
            h4: candles_4h.length,
          },
          source: 'structure_fallback',
        },
        { status: 422 }
      )
    }

    const current_price =
      candles_h1[candles_h1.length - 1]?.close ??
      candles_4h[candles_4h.length - 1]?.close ??
      candles_daily[candles_daily.length - 1]!.close

    // Same memory section as live prompt — but only grades created before this open
    // (no future leakage). Never fetches Finnhub/news for dated sim.
    const supabase = await createClient()
    const historicalContext = await fetchLevelHistoricalContext(
      supabase,
      user.id,
      instrument,
      {
        days: 30,
        limit: 20,
        asOfIso: new Date(openUnix * 1000).toISOString(),
      }
    )

    const agent = await getLevelFinderAgent()
    const sessionId = `sim-${instrument}-${date}`
    const analysis = await agent.analyzePriceAction({
      session_id: sessionId,
      symbol: SYMBOL[instrument] || instrument,
      index: instrument,
      current_price,
      candles_4h,
      candles_daily,
      candles_h1,
      llm_tier: 'sim',
      historicalContext: historicalContext || undefined,
    })

    const levels = analysis.levels.map((l) => ({
      level: l.level,
      type: l.type,
      conviction: l.conviction,
      reasoning: l.reasoning,
      timeframe: l.timeframe,
      source: 'ai' as const,
    }))

    return NextResponse.json({
      levels,
      instrument,
      date,
      as_of: openUnix,
      llm_tier: 'sim',
      model: analysis.usage.model ?? null,
      usage: analysis.usage,
      source: 'ai',
      news: false,
      prompt: 'same_as_live',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Sim levels failed'
    console.error('[sim-levels]', msg)
    return NextResponse.json({ error: msg, source: 'structure_fallback' }, { status: 500 })
  }
}
