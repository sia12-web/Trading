/**
 * POST /api/trading/positions/ai-exit
 * While MANAGE: score pullback vs reversal using news + price + RVOL + options flow;
 * liquidate on strong reversal.
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
} from '@/lib/trading/manageMarketData'
import { scoreManageVerdict } from '@/lib/trading/manageSignals'
import type { Instrument } from '@/types/trading'
import type { Instrument as PriceInstrument } from '@/types/price-feed'

interface Body {
  position_id: string
  current_price?: number
}

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
    const [rvolSnap, optionsFlow] = await Promise.all([
      fetchManageRvol(deskInstrument),
      fetchManageOptionsFlow(deskInstrument),
    ])

    const scored = scoreManageVerdict({
      movePct,
      newsScore,
      rvol: rvolSnap.rvol,
      optionsBias: optionsFlow?.bias ?? null,
      direction: dir === 'SHORT' ? 'SHORT' : 'LONG',
    })

    const { verdict, confidence, reason, factors } = scored

    let closed = false
    if (verdict === 'reversal' && confidence >= 70) {
      let profitLoss: number
      if (dir === 'LONG') {
        profitLoss = (px - entry) * Number(position.position_size)
      } else {
        profitLoss = (entry - px) * Number(position.position_size)
      }
      profitLoss = Math.round(profitLoss * 100) / 100
      const plPct = Math.round((profitLoss / Number(position.risk_amount)) * 10000) / 100

      const exitNotes = `AI early exit (TP not hit): ${reason}`
      const { error: closeErr } = await supabase
        .from('trades_journal')
        .update({
          exit_timestamp: new Date().toISOString(),
          exit_price: px,
          exit_reason: 'ai_signal',
          exit_notes: exitNotes,
          profit_loss: profitLoss,
          profit_loss_percent: plPct,
          updated_at: new Date().toISOString(),
        })
        .eq('id', position.id)

      if (!closeErr) {
        closed = true
        try {
          await supabase.from('management_decisions').insert({
            user_id: user.id,
            position_id: position.id,
            instrument,
            trade_date: position.trade_date,
            decision_type: 'TAKE_PROFIT',
            notes: `AI exit: ${reason}`,
          })
        } catch {
          /* audit optional */
        }
      } else {
        logger.error('[ai-exit] close failed', { error: closeErr })
      }
    }

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
      closed,
    })
  } catch (e) {
    logger.error('[ai-exit]', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
