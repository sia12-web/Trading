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
    let currentPrice = typeof body.current_price === 'number' ? body.current_price : 0

    try {
      const oanda = await getOandaPrice(instrument as PriceInstrument)
      if (oanda?.price && oanda.price > 0) {
        currentPrice = oanda.price
      }
    } catch {
      /* fallback to client price */
    }

    if (!currentPrice || currentPrice <= 0) {
      return NextResponse.json({ error: 'No valid current price' }, { status: 400 })
    }

    const entry = Number(position.entry_price)
    const tp = Number(position.profit_target_price || (position.entry_direction === 'LONG' ? entry * 1.015 : entry * 0.985))
    const currentSl = Number(position.stop_loss_price || (position.entry_direction === 'LONG' ? entry * 0.99 : entry * 1.01))
    const isLong = position.entry_direction === 'LONG'
    const confidence = Number(position.regime_confidence || 75)
    const oandaTradeId = position.oanda_trade_id ? String(position.oanda_trade_id) : null

    // Distance metrics
    const totalTpDistance = isLong ? tp - entry : entry - tp
    const currentMoved = isLong ? currentPrice - entry : entry - currentPrice
    const tpProgress = totalTpDistance > 0 ? currentMoved / totalTpDistance : 0

    let actionTaken = 'NONE'
    let updatedSlPrice: number | null = null
    let scaledOutUnits = 0

    // 1. BREAKEVEN RULE (+1.0 R / 50% TP distance reached)
    if (tpProgress >= 0.50) {
      const isSlBelowEntry = isLong ? currentSl < entry : currentSl > entry

      if (isSlBelowEntry) {
        // Move Stop Loss to Breakeven (Entry Price)
        const bePrice = Math.round(entry * 10) / 10
        updatedSlPrice = bePrice
        actionTaken = 'MOVED_TO_BREAKEVEN'

        // Update OANDA Stop Loss
        if (oandaTradeId) {
          await updateOandaTradeStopLoss(oandaTradeId, bePrice, instrument)
        }

        // Update Database
        await supabase
          .from('trades_journal')
          .update({
            stop_loss_price: bePrice,
            updated_at: new Date().toISOString(),
          })
          .eq('id', position.id)

        // Record Decision
        await supabase.from('management_decisions').insert({
          user_id: user.id,
          position_id: position.id,
          instrument,
          trade_date: position.trade_date,
          decision_type: 'ADJUST',
          notes: `Auto-Breakeven: Moved Stop Loss to entry $${bePrice} at 50% TP progress`,
        })

        logger.info('[auto-manage] Move SL to Breakeven', { position_id: position.id, bePrice, tpProgress })
      }
    }

    // 2. DYNAMIC TRAILING STOP RULE (60%+ TP distance reached)
    if (tpProgress >= 0.60) {
      // Trail stop at 50% of peak gains gained above entry
      const trailOffset = currentMoved * 0.50
      const calculatedTrail = isLong ? entry + trailOffset : entry - trailOffset
      const roundedTrail = Math.round(calculatedTrail * 10) / 10

      const effectiveSl = updatedSlPrice ?? currentSl
      const isTrailTighter = isLong ? roundedTrail > effectiveSl : roundedTrail < effectiveSl

      if (isTrailTighter) {
        updatedSlPrice = roundedTrail
        actionTaken = actionTaken === 'MOVED_TO_BREAKEVEN' ? 'BREAKEVEN_AND_TRAILED' : 'TRAILED_STOP'

        // Update OANDA Stop Loss
        if (oandaTradeId) {
          await updateOandaTradeStopLoss(oandaTradeId, roundedTrail, instrument)
        }

        // Update Database
        await supabase
          .from('trades_journal')
          .update({
            stop_loss_price: roundedTrail,
            updated_at: new Date().toISOString(),
          })
          .eq('id', position.id)

        logger.info('[auto-manage] Trailed SL', { position_id: position.id, roundedTrail, tpProgress })
      }
    }

    // 3. PARTIAL SCALE-OUT RULE (50% profit lock at +1.0 R for high confidence setups)
    const alreadyScaledOut = Boolean(position.scaled_out)
    if (tpProgress >= 0.50 && confidence >= 75 && !alreadyScaledOut) {
      const totalUnits = Math.abs(Number(position.position_size || 1))
      if (totalUnits > 1) {
        const unitsToClose = Math.max(1, Math.floor(totalUnits * 0.50))
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

        logger.info('[auto-manage] Partial Scale-Out', { position_id: position.id, unitsToClose, remainingUnits })
      }
    }

    return NextResponse.json({
      success: true,
      position_id: position.id,
      instrument,
      current_price: currentPrice,
      tp_progress: Math.round(tpProgress * 100) / 100,
      action_taken: actionTaken,
      updated_stop_loss: updatedSlPrice,
      scaled_out_units: scaledOutUnits,
    })
  } catch (e) {
    logger.error('[auto-manage] unexpected error', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
