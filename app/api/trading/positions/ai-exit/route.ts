/**
 * POST /api/trading/positions/ai-exit
 * While MANAGE: score pullback vs reversal using news + price + RVOL + options flow.
 * Never liquidates — trader must CONFIRM an exit (or hit SL/TP / manual close).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { logger } from '@/lib/utils/logger'
import {
  fetchManageOptionsFlow,
  fetchManageRvol,
  fetchManageStructure,
} from '@/lib/trading/manageMarketData'
import { scoreManageVerdict } from '@/lib/trading/manageSignals'
import type { Instrument } from '@/types/trading'
import type { Instrument as PriceInstrument } from '@/types/price-feed'

interface Body {
  position_id: string
  current_price?: number
}

const EXIT_CONFIDENCE_FLOOR = 70

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as Body
    if (!body.position_id) {
      return NextResponse.json({ error: 'position_id required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: position, error } = await supabase
      .from('trades_journal')
      .select('*')
      .eq('id', body.position_id)
      .eq('user_id', user.id)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .maybeSingle()

    if (error || !position) {
      return NextResponse.json({ error: 'Open filled position not found' }, { status: 404 })
    }

    const instrument = position.instrument as Instrument
    let newsScore = 0
    let headlines: string[] = []
    try {
      const finnhub = getFinnhubClient()
      const news = await finnhub.getNews(instrument)
      if (news?.length) {
        newsScore = news.reduce((s, h) => s + (h.sentiment || 0), 0)
        headlines = news.slice(0, 3).map((h) => h.headline || '')
      }
    } catch {
      /* news optional */
    }

    // Prefer live OANDA mid (same as desk tip), then Yahoo, then client
    let px = typeof body.current_price === 'number' ? body.current_price : 0
    try {
      const oanda = await getOandaPrice(instrument as PriceInstrument)
      if (oanda?.price && oanda.price > 0) px = oanda.price
      else {
        const q = await getYahooQuote(instrument as PriceInstrument)
        if (q?.price && q.price > 0) px = q.price
      }
    } catch {
      try {
        const q = await getYahooQuote(instrument as PriceInstrument)
        if (q?.price && q.price > 0) px = q.price
      } catch {
        /* keep client price fallback */
      }
    }
    if (!px || px <= 0) {
      return NextResponse.json({ error: 'No reliable price for AI exit' }, { status: 503 })
    }

    const entry = Number(position.entry_price)
    const dir = String(position.entry_direction || '').toUpperCase() as 'LONG' | 'SHORT'
    const movePct = dir === 'LONG' ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100

    const deskInstrument = instrument as 'DOW' | 'NASDAQ' | 'NIKKEI'
    const bookDir = dir === 'SHORT' ? 'SHORT' : 'LONG'
    const [rvolSnap, optionsFlow, structure] = await Promise.all([
      fetchManageRvol(deskInstrument),
      fetchManageOptionsFlow(deskInstrument),
      fetchManageStructure({
        instrument: deskInstrument,
        tip: px,
        direction: bookDir,
      }),
    ])

    const scored = scoreManageVerdict({
      movePct,
      newsScore,
      rvol: rvolSnap.rvol,
      optionsBias: optionsFlow?.bias ?? null,
      direction: bookDir,
      structure,
    })

    const { verdict, confidence, reason, factors } = scored
    const requiresConfirmation =
      verdict === 'reversal' && confidence >= EXIT_CONFIDENCE_FLOOR

    logger.info('ai-exit.verdict', {
      position_id: position.id,
      instrument,
      direction: dir,
      verdict,
      confidence,
      reason,
      move_pct: Math.round(movePct * 100) / 100,
      rvol: rvolSnap.rvol,
      rvol_source: rvolSnap.source,
      options_bias: optionsFlow?.bias ?? null,
      range_state: structure?.rangeState ?? null,
      requires_confirmation: requiresConfirmation,
      will_close: false,
    })

    return NextResponse.json({
      success: true,
      verdict,
      confidence,
      reason,
      factors,
      news_score: newsScore,
      headlines,
      move_pct: movePct,
      rvol: rvolSnap.rvol,
      rvol_source: rvolSnap.source,
      options: optionsFlow
        ? {
            proxy: optionsFlow.proxySymbol,
            put_call_volume: optionsFlow.putCallVolume,
            put_call_oi: optionsFlow.putCallOi,
            call_volume: optionsFlow.callVolume,
            put_volume: optionsFlow.putVolume,
            bias: optionsFlow.bias,
            source: optionsFlow.source,
          }
        : null,
      range_state: structure?.rangeState ?? null,
      range_label: structure?.rangeLabel ?? null,
      range_high: structure?.rangeHigh ?? null,
      range_low: structure?.rangeLow ?? null,
      /** Strong reversal — UI must ask trader to CONFIRM before closing */
      requires_confirmation: requiresConfirmation,
      /** Always false: AI never auto-liquidates */
      closed: false,
    })
  } catch (e) {
    logger.error('[ai-exit]', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
