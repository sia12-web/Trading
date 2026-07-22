/**
 * POST /api/trading/positions/open
 * Open a new trading position within entry window
 * Triggered automatically when deep entry detected
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { getWindowManager } from '@/lib/trading/windowManager'
import {
  getPositionSizer,
  normalizeEntrySource,
  riskPercentForEntrySource,
  resolveDeskAccountSize,
} from '@/lib/trading/positionSizing'
import { getESTDateString } from '@/lib/utils/timeUtils'
import {
  resolveSessionGate,
  assertCanOpenPosition,
  deskMarketFor,
  instrumentsForDeskMarket,
} from '@/lib/trading/sessionGate'
import { getTodayAttendance, tradeDateForInstrument } from '@/lib/trading/deskAttendance'
import { shouldExecuteOandaOrders } from '@/lib/oanda/config'
import { placeOandaMarketOrder, closeOandaTrade } from '@/lib/oanda/orders'
import type { PositionOpenResponse } from '@/types/trading'

interface OpenPositionRequest {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  entry_price: number
  entry_direction: 'LONG' | 'SHORT'
  entry_window: 1 | 2 | 3
  account_size: number
  regime: 'bullish' | 'bearish' | 'choppy'
  regime_confidence: number
  best_level_break_confidence?: number | null
  best_break_level?: number | null
  /**
   * How the limit was chosen.
   * ai | structure | manual (preferred); chart_level → ai; auto_deep → ai
   */
  entry_source?: 'ai' | 'structure' | 'manual' | 'chart_level' | 'auto_deep'
  /** Ignored — risk is always derived from entry_source on the server */
  risk_percent?: number
  /** Zone-based stop (beyond the level's zone edge); omit for default ±5% */
  stop_loss_price?: number
  /** Planned take-profit at fill */
  profit_target_price?: number
  /** Why we entered (liquidity thesis / level reasoning) — journaled */
  entry_reason?: string
}

export async function POST(request: Request): Promise<NextResponse<PositionOpenResponse>> {
  try {
    const body = (await request.json()) as OpenPositionRequest
    const supabase = await createClient()

    // Auth: Supabase session, or DESK_MODE=single / DESK_SECRET (never invent user in locked prod)
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()
    let user = authUser as { id: string } | null
    if (!user) {
      const { resolveDeskUser } = await import('@/lib/utils/devAuth')
      user = await resolveDeskUser(request)
    }

    if (!user) {
      logger.error('POST /api/trading/positions/open: Unauthorized', { error: authError })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument || 'DOW',
          entry_price: body.entry_price || 0,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction || 'LONG',
          entry_window: body.entry_window || 1,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    // Validate required fields
    if (!body.instrument || !body.entry_price || !body.entry_direction || !body.entry_window) {
      logger.error('POST /api/trading/positions/open: Missing required fields', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Missing required fields',
        },
        { status: 400 }
      )
    }

    // Desk: DOW / NASDAQ / NIKKEI + session gate
    if (
      body.instrument !== 'DOW' &&
      body.instrument !== 'NASDAQ' &&
      body.instrument !== 'NIKKEI'
    ) {
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Desk only allows DOW, NASDAQ, or NIKKEI',
        },
        { status: 400 }
      )
    }

    const tradeDate = tradeDateForInstrument(body.instrument)
    const nyRecDate = getESTDateString()

    // Locked instrument from today's recommendation (NY) or Tokyo morning (NIKKEI)
    let lockedInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' | null = null
    const { data: rec } = await supabase
      .from('market_recommendations')
      .select('recommended_instrument')
      .eq('date', nyRecDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (rec?.recommended_instrument === 'DOW' || rec?.recommended_instrument === 'NASDAQ') {
      lockedInstrument = rec.recommended_instrument
    } else {
      const { data: regimes } = await supabase
        .from('regime_cache')
        .select('instrument, recommendation_confidence')
        .eq('date', nyRecDate)
        .in('instrument', ['DOW', 'NASDAQ'])
        .order('recommendation_confidence', { ascending: false })
        .limit(1)
      if (regimes?.[0]?.instrument === 'DOW' || regimes?.[0]?.instrument === 'NASDAQ') {
        lockedInstrument = regimes[0].instrument
      }
    }
    if (body.instrument === 'NIKKEI') {
      lockedInstrument = 'NIKKEI'
    }

    // Filled trades only — working/cancelled limits must not count as attempts.
    // Scope to this desk market so NY and Tokyo do not share the attempt book.
    const market = deskMarketFor(body.instrument)
    const marketInstruments = instrumentsForDeskMarket(market)

    const [filledRes, openRes, attendance] = await Promise.all([
      supabase
        .from('trades_journal')
        .select('id, exit_timestamp, exit_reason, stop_loss_hit_count')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled'),
      supabase
        .from('trades_journal')
        .select('id, stop_loss_hit_count')
        .eq('user_id', user.id)
        .eq('trade_date', tradeDate)
        .in('instrument', marketInstruments)
        .eq('fill_status', 'filled')
        .is('exit_timestamp', null)
        .maybeSingle(),
      getTodayAttendance(supabase, user.id, market),
    ])

    const filledToday = filledRes.data
    const openNy = openRes.data

    const filledRows = filledToday ?? []
    const attemptsUsed = filledRows.length
    const stopHits = filledRows.filter((t) => t.exit_reason === 'stop_hit').length
    const clockedIn = attendance?.status === 'clocked_in'
    const attendedToday = !!attendance

    const gate = resolveSessionGate({
      lockedInstrument,
      hasOpenPosition: !!openNy,
      attemptsUsed,
      stopLossHitCount: stopHits,
      viewingInstrument: body.instrument,
      clockedIn,
      attendedToday,
    })

    const gateCheck = assertCanOpenPosition(body.instrument, gate)
    if (!gateCheck.ok) {
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: gateCheck.message,
        },
        { status: gateCheck.status }
      )
    }

    // Skip ultra-tight deep extreme check when entry is from chart level click
    const deskEntrySource = normalizeEntrySource(body.entry_source)
    const fromChartLevel =
      body.entry_source === 'chart_level' ||
      body.entry_source === 'ai' ||
      body.entry_source === 'structure' ||
      body.entry_source === 'manual'

    // Validate entry price
    if (body.entry_price <= 0) {
      logger.error('POST /api/trading/positions/open: Invalid entry price', {
        price: body.entry_price,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Invalid entry price',
        },
        { status: 400 }
      )
    }

    // Prefer DESK_ACCOUNT_SIZE when set; otherwise clamp client $5k–$1M
    const accountSize = resolveDeskAccountSize(body.account_size)
    if (accountSize == null) {
      logger.error('POST /api/trading/positions/open: Invalid account size', {
        size: body.account_size,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Account size must be between $5000 and $1000000 (or set DESK_ACCOUNT_SIZE)',
        },
        { status: 400 }
      )
    }
    body.account_size = accountSize

    const windowManager = getWindowManager()
    const positionSizer = getPositionSizer()

    // Chart-level / morning-desk orders: session gate already enforced open→lunch.
    // Legacy auto-deep still requires a strict 15-min NY entry window.
    const now = new Date()
    if (!fromChartLevel && !windowManager.validateEntryTiming(now, body.entry_window)) {
      logger.error('POST /api/trading/positions/open: Entry outside window boundaries', {
        time: now.toISOString(),
        window: body.entry_window,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Entry time outside window boundaries',
        },
        { status: 400 }
      )
    }

    // IMPORTANT FIX: Validate entry price is within 0.001% of window extreme (deep entry requirement)
    // Chart level clicks skip this — the clicked level IS the intended limit price.
    const { data: cacheData } = await supabase
      .from('entry_discipline_cache')
      .select('highest_price_in_window, lowest_price_in_window')
      .eq('user_id', user.id)
      .eq('instrument', body.instrument)
      .eq('trade_date', tradeDate)
      .maybeSingle()

    const ENTRY_TOLERANCE = 0.00001 // 0.001% tolerance
    const entryPriceIsDeep = (() => {
      if (fromChartLevel) return true
      if (!cacheData) return true // Cache not yet populated, allow entry on first trade

      if (body.entry_direction === 'LONG' && cacheData.highest_price_in_window) {
        // For LONG: price must be within 0.001% of highest
        return body.entry_price >= cacheData.highest_price_in_window * (1 - ENTRY_TOLERANCE)
      } else if (body.entry_direction === 'SHORT' && cacheData.lowest_price_in_window) {
        // For SHORT: price must be within 0.001% of lowest
        return body.entry_price <= cacheData.lowest_price_in_window * (1 + ENTRY_TOLERANCE)
      }
      return true
    })()

    if (!entryPriceIsDeep) {
      logger.error('POST /api/trading/positions/open: Entry price not deep enough (not within 0.001% of extreme)', {
        entry_price: body.entry_price,
        direction: body.entry_direction,
        highest: cacheData?.highest_price_in_window,
        lowest: cacheData?.lowest_price_in_window,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Entry price not deep enough - must be within 0.001% of window extreme',
        },
        { status: 400 }
      )
    }

    // Calculate position sizing — risk is server-derived only (manual = 1%, else desk 5%)
    const riskPct = riskPercentForEntrySource(deskEntrySource)
    const sizing = positionSizer.calculatePosition(
      body.entry_price,
      body.account_size,
      body.entry_direction,
      body.stop_loss_price,
      riskPct
    )
    if (!sizing) {
      logger.error('POST /api/trading/positions/open: Position sizing failed', { body })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Position sizing calculation failed',
        },
        { status: 400 }
      )
    }

    // Validate the stop: zone stops just need to be on the correct side with
    // real distance; default stops must still be exactly ±5%
    const STOP_LOSS_PERCENT = 0.05
    const usingZoneStop =
      body.stop_loss_price != null &&
      body.stop_loss_price > 0 &&
      (body.entry_direction === 'LONG'
        ? body.stop_loss_price < body.entry_price
        : body.stop_loss_price > body.entry_price)

    const expectedStopLoss = usingZoneStop
      ? body.stop_loss_price!
      : body.entry_direction === 'LONG'
        ? body.entry_price * (1 - STOP_LOSS_PERCENT)
        : body.entry_price * (1 + STOP_LOSS_PERCENT)

    const stopLossPrecisionTolerance = body.entry_price * 0.001 // 0.1% tolerance for rounding
    const stopLossError = Math.abs(sizing.stop_loss_price - expectedStopLoss)

    if (stopLossError > stopLossPrecisionTolerance) {
      logger.error('POST /api/trading/positions/open: Stop loss precision error', {
        calculated: sizing.stop_loss_price,
        expected: expectedStopLoss,
        error: stopLossError,
        tolerance: stopLossPrecisionTolerance,
      })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: sizing.stop_loss_price,
          position_size: sizing.position_size,
          risk_amount: sizing.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Stop loss calculation precision error - contact support',
        },
        { status: 500 }
      )
    }

    // Existing FILLED open + WORKING upgrade candidate in parallel
    const [existingRes, workingRes] = await Promise.all([
      supabase
        .from('trades_journal')
        .select('id, entry_price, stop_loss_price, position_size, risk_amount, fill_status')
        .eq('user_id', user.id)
        .eq('instrument', body.instrument)
        .eq('trade_date', tradeDate)
        .eq('fill_status', 'filled')
        .is('exit_timestamp', null)
        .maybeSingle(),
      supabase
        .from('trades_journal')
        .select('id')
        .eq('user_id', user.id)
        .eq('instrument', body.instrument)
        .eq('trade_date', tradeDate)
        .eq('fill_status', 'working')
        .is('exit_timestamp', null)
        .maybeSingle(),
    ])

    const existingPosition = existingRes.data
    const queryError = existingRes.error
    const workingRow = workingRes.data

    if (queryError) {
      logger.error('POST /api/trading/positions/open: Database query error', { error: queryError })
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: 0,
          position_size: 0,
          risk_amount: 0,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Database error',
        },
        { status: 500 }
      )
    }

    // If filled position exists, return it (idempotent)
    if (existingPosition) {
      logger.log('POST /api/trading/positions/open: Position already exists (idempotent)', {
        instrument: body.instrument,
        position_id: existingPosition.id,
      })
      return NextResponse.json(
        {
          success: true,
          position_id: existingPosition.id,
          instrument: body.instrument,
          entry_price: existingPosition.entry_price,
          stop_loss_price: existingPosition.stop_loss_price,
          position_size: existingPosition.position_size,
          risk_amount: existingPosition.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: 'Position already open for this instrument today',
        },
        { status: 200 }
      )
    }

    // CRITICAL FIX: Always use authenticated user's ID, never trust request body
    // Broker fill first (practice/live) — do not journal a phantom if OANDA rejects
    let oandaTradeId: string | null = null
    let oandaOrderId: string | null = null
    let brokerFillPrice: number | null = null
    let fillPrice = body.entry_price

    if (shouldExecuteOandaOrders()) {
      const broker = await placeOandaMarketOrder({
        instrument: body.instrument,
        direction: body.entry_direction,
        units: sizing.position_size,
        stopLossPrice: sizing.stop_loss_price,
        takeProfitPrice: body.profit_target_price ?? null,
      })

      if (!broker.ok) {
        logger.error('POST /api/trading/positions/open: OANDA order rejected', {
          error: broker.error,
          status: broker.status,
          instrument: body.instrument,
        })
        if (workingRow?.id) {
          await supabase
            .from('trades_journal')
            .update({
              fill_status: 'cancelled',
              exit_timestamp: new Date().toISOString(),
              exit_price: body.entry_price,
              exit_reason: 'broker_rejected',
              profit_loss: 0,
              profit_loss_percent: 0,
              notes: `OANDA order failed: ${broker.error}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', workingRow.id)
            .eq('user_id', user.id)
        }
        return NextResponse.json(
          {
            success: false,
            position_id: '',
            instrument: body.instrument,
            entry_price: body.entry_price,
            stop_loss_price: sizing.stop_loss_price,
            position_size: sizing.position_size,
            risk_amount: sizing.risk_amount,
            entry_direction: body.entry_direction,
            entry_window: body.entry_window,
            message: `OANDA order failed: ${broker.error}`,
          },
          { status: 502 }
        )
      }

      oandaTradeId = broker.tradeId
      oandaOrderId = broker.orderId
      brokerFillPrice = broker.fillPrice > 0 ? broker.fillPrice : null
      if (broker.fillPrice > 0) fillPrice = broker.fillPrice
      logger.info('POST /api/trading/positions/open: OANDA filled', {
        tradeId: oandaTradeId,
        orderId: oandaOrderId,
        fillPrice,
        units: broker.units,
      })
    }

    const entryReason =
      typeof body.entry_reason === 'string' && body.entry_reason.trim()
        ? body.entry_reason.trim().slice(0, 2000)
        : `Chart ${body.entry_direction} at level ${body.best_break_level ?? body.entry_price}`

    const tradePosition = {
      user_id: user.id,
      instrument: body.instrument,
      trade_date: tradeDate,
      entry_window: body.entry_window,
      entry_timestamp: now.toISOString(),
      entry_price: fillPrice,
      entry_direction: body.entry_direction,
      stop_loss_price: sizing.stop_loss_price,
      stop_loss_hit_at: null as null,
      stop_loss_hit_count: 0,
      position_size: sizing.position_size,
      risk_amount: sizing.risk_amount,
      account_size: body.account_size,
      exit_timestamp: null as null,
      exit_price: null as null,
      exit_reason: null as null,
      profit_loss: null as null,
      profit_loss_percent: null as null,
      regime: body.regime,
      regime_confidence: body.regime_confidence,
      best_level_break_confidence: body.best_level_break_confidence || null,
      best_break_level: body.best_break_level || null,
      profit_target_price: body.profit_target_price ?? null,
      entry_reason: entryReason,
      entry_source: deskEntrySource,
      oanda_trade_id: oandaTradeId,
      oanda_order_id: oandaOrderId,
      broker_fill_price: brokerFillPrice,
      fill_status: 'filled' as const,
      notes: null as null,
      updated_at: now.toISOString(),
    }

    let newPosition: { id: string } | null = null
    let insertError: { message?: string } | null = null

    if (workingRow?.id) {
      const upgraded = await supabase
        .from('trades_journal')
        .update(tradePosition)
        .eq('id', workingRow.id)
        .eq('user_id', user.id)
        .eq('fill_status', 'working')
        .select('id')
        .single()
      newPosition = upgraded.data
      insertError = upgraded.error
    } else {
      const inserted = await supabase
        .from('trades_journal')
        .insert(tradePosition)
        .select('id')
        .single()
      newPosition = inserted.data
      insertError = inserted.error
    }

    // If enrichment columns missing (migration not applied), retry without them
    if (
      insertError &&
      /entry_reason|entry_source|profit_target_price|oanda_trade_id|oanda_order_id|broker_fill_price|fill_status/i.test(
        insertError.message || ''
      )
    ) {
      const {
        profit_target_price: _pt,
        entry_reason: _er,
        entry_source: _es,
        oanda_trade_id: _ot,
        oanda_order_id: _oo,
        broker_fill_price: _bf,
        fill_status: _fs,
        notes: _n,
        updated_at: _u,
        ...baseRow
      } = tradePosition
      const retry = workingRow?.id
        ? await supabase
            .from('trades_journal')
            .update(baseRow)
            .eq('id', workingRow.id)
            .select('id')
            .single()
        : await supabase.from('trades_journal').insert(baseRow).select('id').single()
      if (!retry.error && retry.data) {
        return NextResponse.json(
          {
            success: true,
            position_id: retry.data.id,
            instrument: body.instrument,
            entry_price: fillPrice,
            stop_loss_price: sizing.stop_loss_price,
            position_size: sizing.position_size,
            risk_amount: sizing.risk_amount,
            entry_direction: body.entry_direction,
            entry_window: body.entry_window,
            message: `Position opened at $${fillPrice}. Stop Loss: $${sizing.stop_loss_price}${
              oandaTradeId ? ` (OANDA trade ${oandaTradeId})` : ''
            }`,
          },
          { status: 201 }
        )
      }
    }

    if (insertError || !newPosition) {
      logger.error('POST /api/trading/positions/open: Insert failed', { error: insertError })
      // Broker already filled — flatten so we do not leave an orphan OANDA position
      if (oandaTradeId) {
        try {
          const closed = await closeOandaTrade(oandaTradeId)
          if (!closed.ok) {
            logger.error('POST /api/trading/positions/open: OANDA compensate close failed', {
              tradeId: oandaTradeId,
              error: closed.error,
            })
          } else {
            logger.info('POST /api/trading/positions/open: OANDA compensate close ok', {
              tradeId: oandaTradeId,
            })
          }
        } catch (compensateErr) {
          logger.error('POST /api/trading/positions/open: OANDA compensate threw', {
            tradeId: oandaTradeId,
            error: compensateErr,
          })
        }
      }
      return NextResponse.json(
        {
          success: false,
          position_id: '',
          instrument: body.instrument,
          entry_price: body.entry_price,
          stop_loss_price: sizing.stop_loss_price,
          position_size: sizing.position_size,
          risk_amount: sizing.risk_amount,
          entry_direction: body.entry_direction,
          entry_window: body.entry_window,
          message: oandaTradeId
            ? 'Failed to journal position — broker fill was closed to avoid orphan'
            : 'Failed to insert position',
        },
        { status: 500 }
      )
    }

    logger.log('POST /api/trading/positions/open: Position opened successfully', {
      position_id: newPosition.id,
      instrument: body.instrument,
      entry_price: fillPrice,
      stop_loss_price: sizing.stop_loss_price,
      position_size: sizing.position_size,
      oanda_trade_id: oandaTradeId,
    })

    return NextResponse.json(
      {
        success: true,
        position_id: newPosition.id,
        instrument: body.instrument,
        entry_price: fillPrice,
        stop_loss_price: sizing.stop_loss_price,
        position_size: sizing.position_size,
        risk_amount: sizing.risk_amount,
        entry_direction: body.entry_direction,
        entry_window: body.entry_window,
        message: `Position opened at $${fillPrice}. Stop Loss: $${sizing.stop_loss_price}${
          oandaTradeId ? ` (OANDA trade ${oandaTradeId})` : ''
        }`,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('POST /api/trading/positions/open: Unexpected error', { error })
    return NextResponse.json(
      {
        success: false,
        position_id: '',
        instrument: 'DOW',
        entry_price: 0,
        stop_loss_price: 0,
        position_size: 0,
        risk_amount: 0,
        entry_direction: 'LONG',
        entry_window: 1,
        message: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
