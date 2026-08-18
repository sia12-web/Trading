/**
 * POST /api/trading/positions/auto-manage
 * Automatically manages active trades (including AI Playbook & Chart Level picks)
 * 1. Breakeven: Moves Stop Loss to entry price when trade reaches 50% TP target (+1.0 R)
 * 2. Trailing Stop: Dynamically trails Stop Loss behind price as trade moves further into profit
 * 3. Partial Scale-Out: Locks 50% profit at +1.0 R on high-confidence setups
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { updateOandaTradeStopLoss, partialCloseOandaTrade } from '@/lib/oanda/orders'
import {
  breakEvenStopPrice,
  breakEvenShouldOffer,
  breakEvenTpProgressThreshold,
  stopSafeVersusMarket,
  tradeTpProgress,
} from '@/lib/trading/breakEvenStop'
import type { Instrument } from '@/types/trading'
import type { Instrument as PriceInstrument } from '@/types/price-feed'

interface Body {
  position_id: string
  current_price?: number
  auto_execute?: boolean
  confirm_action?: 'CONFIRM' | 'REJECT'
  action_type?: 'BREAKEVEN' | 'TRAIL_STOP' | 'SCALE_OUT'
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
    const clientPrice =
      typeof body.current_price === 'number' && body.current_price > 0
        ? body.current_price
        : 0
    let marketPrice = clientPrice

    try {
      const oanda = await getOandaPrice(instrument as PriceInstrument)
      if (oanda?.price && oanda.price > 0) {
        marketPrice = oanda.price
      }
    } catch {
      /* fallback to client price */
    }

    // Progress must match the manage →TP bar (desk live). OANDA is only for
    // stop-through-market safety / broker amends — a basis gap must not fake BE.
    const progressPrice = clientPrice > 0 ? clientPrice : marketPrice
    const currentPrice = marketPrice > 0 ? marketPrice : progressPrice

    if (!progressPrice || progressPrice <= 0) {
      return NextResponse.json({ error: 'No valid current price' }, { status: 400 })
    }

    const entry = Number(position.entry_price)
    const tp = Number(position.profit_target_price || (position.entry_direction === 'LONG' ? entry * 1.015 : entry * 0.985))
    const currentSl = Number(position.stop_loss_price || (position.entry_direction === 'LONG' ? entry * 0.99 : entry * 1.01))
    const isLong = position.entry_direction === 'LONG'
    const confidence = Number(position.regime_confidence || 75)
    const oandaTradeId = position.oanda_trade_id ? String(position.oanda_trade_id) : null

    // Skip BE re-prompt if trader already rejected for this position
    const { data: priorDecisions } = await supabase
      .from('management_decisions')
      .select('notes, decision_type')
      .eq('position_id', position.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(12)
    const beRejected = (priorDecisions || []).some(
      (d) =>
        d.decision_type === 'HOLD' &&
        typeof d.notes === 'string' &&
        /rejected.*BREAKEVEN|Breakeven/i.test(d.notes)
    )
    const beConfirmed = (priorDecisions || []).some(
      (d) =>
        d.decision_type === 'ADJUST' &&
        typeof d.notes === 'string' &&
        /Breakeven|BREAKEVEN/i.test(d.notes)
    )

    // Distance metrics — same helper as the manage →TP % bar
    const tpStats = tradeTpProgress({
      entry,
      takeProfit: tp,
      livePrice: progressPrice,
      isLong,
    })
    const currentMoved = tpStats.moved
    const tpProgress = tpStats.progress
    const initialRisk = isLong ? entry - currentSl : currentSl - entry
    const rMultiple =
      initialRisk > 0 && Number.isFinite(currentMoved) ? currentMoved / initialRisk : 0

    const beProgressThreshold = breakEvenTpProgressThreshold(instrument)
    const trailProgressThreshold = instrument === 'NASDAQ' ? 0.60 : instrument === 'NIKKEI' ? 0.45 : 0.30
    const trailPctOffset = instrument === 'NASDAQ' ? 0.50 : instrument === 'NIKKEI' ? 0.40 : 0.30
    const autoExecute = body.auto_execute === true // Default is false: Require Trader Confirmation (CONFIRM/REJECT)
    const confirmAction = body.confirm_action // 'CONFIRM' | 'REJECT'
    const actionType = body.action_type // 'BREAKEVEN' | 'TRAIL_STOP' | 'SCALE_OUT'

    // Handle Trader Manual Confirmation or Rejection
    if (confirmAction === 'REJECT') {
      await supabase.from('management_decisions').insert({
        user_id: user.id,
        position_id: position.id,
        instrument,
        trade_date: position.trade_date,
        decision_type: 'HOLD',
        notes: `Trader rejected ${actionType || 'management'} recommendation — holding position as-is`,
      })
      logger.info('[auto-manage] Trader REJECTED recommendation', { position_id: position.id, actionType })
      return NextResponse.json({
        success: true,
        action_taken: 'REJECTED_BY_TRADER',
        message: 'Recommendation rejected. Position held untouched.',
      })
    }

    let recommendation: {
      action_type: 'BREAKEVEN' | 'TRAIL_STOP' | 'SCALE_OUT'
      proposed_price?: number
      proposed_units?: number
      reason: string
      confidence: number
    } | null = null

    let actionTaken = 'NONE'
    let updatedSlPrice: number | null = null
    let scaledOutUnits = 0

    /** Never place a stop through/into live price — that instantly flat-closes the book. */
    const stopSafeVsMarket = (stop: number): boolean =>
      stopSafeVersusMarket({ stop, currentPrice, isLong, pad: 2 })

    const applyStopLoss = async (stop: number, label: string): Promise<boolean> => {
      if (!stopSafeVsMarket(stop)) {
        logger.warn('[auto-manage] refused stop through market', {
          position_id: position.id,
          label,
          stop,
          currentPrice,
          isLong,
        })
        return false
      }
      if (oandaTradeId) {
        const oanda = await updateOandaTradeStopLoss(oandaTradeId, stop, instrument)
        if (!oanda.ok) {
          logger.warn('[auto-manage] oanda SL update failed', {
            position_id: position.id,
            error: oanda.error,
          })
          return false
        }
      }
      await supabase
        .from('trades_journal')
        .update({
          stop_loss_price: stop,
          updated_at: new Date().toISOString(),
        })
        .eq('id', position.id)
      return true
    }

    // 1. BREAKEVEN — only when live is in profit toward TP (same as →TP bar)
    const beReady = breakEvenShouldOffer({
      instrument,
      entry,
      takeProfit: tp,
      livePrice: progressPrice,
      isLong,
    })
    if (beReady && !beRejected && !beConfirmed) {
      const isSlBelowEntry = isLong ? currentSl < entry : currentSl > entry

      if (isSlBelowEntry) {
        // One tick past fill (never exact entry) — exact entry false-triggers client
        // auto-exit (`price <= stop` while price is still seeded at entry) and can
        // market-flatten a profitable OANDA book.
        const bePrice = breakEvenStopPrice(
          instrument,
          entry,
          isLong ? 'LONG' : 'SHORT'
        )
        const pct = Math.round(tpProgress * 100)
        const beReason = `→TP ${pct}% (need ${Math.round(beProgressThreshold * 100)}%). Lock SL one tick past fill ${entry.toLocaleString()} at ${bePrice.toLocaleString()}?`
        if (autoExecute || (confirmAction === 'CONFIRM' && actionType === 'BREAKEVEN')) {
          if (await applyStopLoss(bePrice, 'BREAKEVEN')) {
            updatedSlPrice = bePrice
            actionTaken = 'MOVED_TO_BREAKEVEN'

            await supabase.from('management_decisions').insert({
              user_id: user.id,
              position_id: position.id,
              instrument,
              trade_date: position.trade_date,
              decision_type: 'ADJUST',
              notes: `Confirmed Auto-Breakeven (${instrument}): Moved Stop Loss to BE $${bePrice} (entry $${entry})`,
            })
          } else {
            return NextResponse.json(
              {
                success: false,
                error:
                  'Break-even stop would hit live price immediately — refused. Wait for more room above/below entry.',
              },
              { status: 409 }
            )
          }
        } else {
          recommendation = {
            action_type: 'BREAKEVEN',
            proposed_price: bePrice,
            reason: beReason,
            confidence: 85,
          }
        }
      }
    }

    // 2. DYNAMIC TRAILING STOP RULE (Instrument 2-Year Empirical Trail threshold reached)
    if (tpProgress >= trailProgressThreshold && !recommendation) {
      const trailOffset = currentMoved * trailPctOffset
      const calculatedTrail = isLong ? entry + trailOffset : entry - trailOffset
      const roundedTrail = Math.round(calculatedTrail * 10) / 10

      const effectiveSl = updatedSlPrice ?? currentSl
      const isTrailTighter = isLong
        ? roundedTrail > effectiveSl && (roundedTrail - effectiveSl) >= 1.5
        : roundedTrail < effectiveSl && (effectiveSl - roundedTrail) >= 1.5

      if (isTrailTighter && stopSafeVsMarket(roundedTrail)) {
        if (autoExecute || (confirmAction === 'CONFIRM' && actionType === 'TRAIL_STOP')) {
          if (await applyStopLoss(roundedTrail, 'TRAIL_STOP')) {
            updatedSlPrice = roundedTrail
            actionTaken =
              actionTaken === 'MOVED_TO_BREAKEVEN' ? 'BREAKEVEN_AND_TRAILED' : 'TRAILED_STOP'
          } else {
            return NextResponse.json(
              {
                success: false,
                error:
                  'Trail stop would hit live price immediately — refused. Position left open.',
              },
              { status: 409 }
            )
          }
        } else {
          recommendation = {
            action_type: 'TRAIL_STOP',
            proposed_price: roundedTrail,
            reason: `Trade in strong profit (${(tpProgress * 100).toFixed(0)}% TP). Trail Stop Loss to $${roundedTrail}?`,
            confidence: 80,
          }
        }
      }
    }

    // 3. PARTIAL SCALE-OUT RULE (Instrument 2-Year Empirical Scale-Out threshold reached)
    const alreadyScaledOut = Boolean(position.scaled_out)
    if (tpProgress >= beProgressThreshold && confidence >= 70 && !alreadyScaledOut && !recommendation) {
      const totalUnits = Math.abs(Number(position.position_size || 1))
      if (totalUnits > 1) {
        const unitsToClose = Math.max(1, Math.floor(totalUnits * 0.50))

        if (autoExecute || (confirmAction === 'CONFIRM' && actionType === 'SCALE_OUT')) {
          scaledOutUnits = unitsToClose
          if (oandaTradeId) {
            await partialCloseOandaTrade(oandaTradeId, unitsToClose)
          }

          const remainingUnits = totalUnits - unitsToClose
          await supabase
            .from('trades_journal')
            .update({
              position_size: remainingUnits,
              scaled_out: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', position.id)

          actionTaken = actionTaken === 'NONE' ? 'PARTIAL_SCALE_OUT' : `${actionTaken}_AND_SCALED_OUT`
        } else {
          recommendation = {
            action_type: 'SCALE_OUT',
            proposed_units: unitsToClose,
            reason: `Target reached ${(beProgressThreshold * 100).toFixed(0)}% TP progress. Lock 50% profit (${unitsToClose} units)?`,
            confidence: 85,
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      position_id: position.id,
      instrument,
      current_price: currentPrice,
      tp_progress: Math.round(tpProgress * 100) / 100,
      r_multiple: Math.round(rMultiple * 100) / 100,
      action_taken: actionTaken,
      updated_stop_loss: updatedSlPrice,
      scaled_out_units: scaledOutUnits,
      recommendation,
    })
  } catch (e) {
    logger.error('[auto-manage] unexpected error', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
