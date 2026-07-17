/**
 * POST /api/trading/positions/ai-exit
 * While MANAGE: score pullback vs reversal using news + recent price move; liquidate on reversal.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/trading'
import type { Instrument as PriceInstrument } from '@/types/price-feed'

interface Body {
  position_id: string
  current_price?: number
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser()
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
      .is('exit_timestamp', null)
      .maybeSingle()

    if (error || !position) {
      return NextResponse.json({ error: 'Open position not found' }, { status: 404 })
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

    // Prefer server-side Yahoo index quote — never trust client livePrice alone
    let px = typeof body.current_price === 'number' ? body.current_price : 0
    try {
      const q = await getYahooQuote(instrument as PriceInstrument)
      if (q?.price && q.price > 0) px = q.price
    } catch {
      /* keep client price fallback */
    }
    if (!px || px <= 0) {
      return NextResponse.json({ error: 'No reliable price for AI exit' }, { status: 503 })
    }

    const entry = Number(position.entry_price)
    const dir = String(position.entry_direction || '').toUpperCase() as 'LONG' | 'SHORT'
    const movePct = dir === 'LONG' ? ((px - entry) / entry) * 100 : ((entry - px) / entry) * 100

    // Rules hybrid: adverse move + opposing news ⇒ reversal; mild dip with supportive news ⇒ pullback
    let verdict: 'pullback' | 'reversal' | 'hold' = 'hold'
    let confidence = 50
    let reason = 'No strong signal'

    if (movePct < -0.35 && newsScore <= 0) {
      verdict = 'reversal'
      confidence = Math.min(95, 60 + Math.abs(movePct) * 10)
      reason = `Adverse move ${movePct.toFixed(2)}% with non-supportive news (score ${newsScore})`
    } else if (movePct < -0.15 && movePct >= -0.35 && newsScore > 0) {
      verdict = 'pullback'
      confidence = 65
      reason = `Mild adverse move ${movePct.toFixed(2)}% but news supportive (${newsScore}) — treat as pullback`
    } else if (movePct < -0.5) {
      verdict = 'reversal'
      confidence = 80
      reason = `Sharp adverse move ${movePct.toFixed(2)}% — likely reversal`
    } else if (movePct > 0.2) {
      verdict = 'hold'
      confidence = 70
      reason = `Trade in favor (+${movePct.toFixed(2)}%) — hold`
    }

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

      const { error: closeErr } = await supabase
        .from('trades_journal')
        .update({
          exit_timestamp: new Date().toISOString(),
          exit_price: px,
          exit_reason: 'ai_signal',
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
      news_score: newsScore,
      headlines,
      move_pct: movePct,
      closed,
    })
  } catch (e) {
    logger.error('[ai-exit]', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
