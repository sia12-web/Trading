/**
 * GET/POST /api/trading/sim-journal
 * Simulation paper trade history only — never writes to live trades_journal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateUser } from '@/lib/utils/devAuth'

export const dynamic = 'force-dynamic'

const INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI'] as const
const EXIT_REASONS = ['stop_hit', 'take_profit', 'manual'] as const

type Instrument = (typeof INSTRUMENTS)[number]
type ExitReason = (typeof EXIT_REASONS)[number]

function isInstrument(v: unknown): v is Instrument {
  return typeof v === 'string' && (INSTRUMENTS as readonly string[]).includes(v)
}

function isExitReason(v: unknown): v is ExitReason {
  return typeof v === 'string' && (EXIT_REASONS as readonly string[]).includes(v)
}

function marketFor(instrument: string): 'NY' | 'TOKYO' {
  return instrument === 'NIKKEI' ? 'TOKYO' : 'NY'
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

/** GET — list paper closes for the signed-in user */
export async function GET(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') || '30', 10) || 30))
    const instrument = searchParams.get('instrument')
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '80', 10) || 80))

    const supabase = createAdminClient() ?? (await createClient())
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - days)

    let query = supabase
      .from('simulation_trades')
      .select(
        `id, instrument, replay_date, direction, entry_price, exit_price, stop_loss, take_profit,
         position_size, risk_amount, account_size, filled_at_unix, exit_at_unix, exit_reason,
         profit_loss, entry_level, entry_reason, entry_source, level_conviction, created_at, replay_id`
      )
      .eq('user_id', user.id)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    if (instrument && isInstrument(instrument)) {
      query = query.eq('instrument', instrument)
    }

    const { data, error } = await query
    if (error) {
      console.error('[sim-journal GET]', error)
      return NextResponse.json(
        { error: 'Failed to load sim history', detail: error.message },
        { status: 500 }
      )
    }

    const rows = data ?? []
    let wins = 0
    let losses = 0
    let stopOuts = 0
    let takeProfits = 0
    let manuals = 0
    let totalPnl = 0
    let startingAccount = 100000

    const entries = rows.map((r) => {
      const pnl = num(r.profit_loss)
      totalPnl += pnl
      if (pnl > 0) wins += 1
      else if (pnl < 0) losses += 1
      if (r.exit_reason === 'stop_hit') stopOuts += 1
      else if (r.exit_reason === 'take_profit') takeProfits += 1
      else if (r.exit_reason === 'manual') manuals += 1
      const acct = num(r.account_size, 100000)
      if (acct > 0) startingAccount = acct

      const filledUnix = num(r.filled_at_unix)
      const exitUnix = num(r.exit_at_unix)

      return {
        id: r.id as string,
        instrument: r.instrument as string,
        market: marketFor(String(r.instrument)),
        replay_date: r.replay_date as string,
        direction: r.direction as string,
        status: 'closed' as const,
        fill: {
          time_unix: filledUnix,
          price: num(r.entry_price),
          level: r.entry_level != null ? num(r.entry_level) : num(r.entry_price),
          reason: (r.entry_reason as string) || 'Sim level limit fill',
          conviction: r.level_conviction != null ? num(r.level_conviction) : null,
          source: (r.entry_source as string | null) || null,
        },
        risk: {
          stop_loss: num(r.stop_loss),
          take_profit: r.take_profit != null ? num(r.take_profit) : null,
          position_size: num(r.position_size),
          risk_amount: num(r.risk_amount),
          account_size: acct,
        },
        exit: {
          time_unix: exitUnix,
          price: num(r.exit_price),
          reason_code: r.exit_reason as string,
        },
        pnl: {
          dollars: pnl,
          percent: acct > 0 ? Math.round((pnl / acct) * 10000) / 100 : null,
        },
        created_at: r.created_at as string,
      }
    })

    const closed = entries.length
    const winRate = closed > 0 ? Math.round((wins / closed) * 1000) / 10 : null
    totalPnl = Math.round(totalPnl * 100) / 100

    return NextResponse.json({
      success: true,
      summary: {
        trades: closed,
        open: 0,
        closed,
        wins,
        losses,
        stop_outs: stopOuts,
        take_profits: takeProfits,
        manuals,
        win_rate: winRate,
        total_pnl: totalPnl,
        starting_account: startingAccount,
        ending_equity: Math.round((startingAccount + totalPnl) * 100) / 100,
        equity_change: totalPnl,
        days,
      },
      entries,
    })
  } catch (e) {
    console.error('[sim-journal GET]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST — record one paper close from the sim desk */
export async function POST(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const instrument = body.instrument
    const replayDate = body.replay_date
    const direction = body.direction
    const exitReason = body.exit_reason
    const replayId =
      typeof body.replay_id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(body.replay_id)
        ? body.replay_id
        : null

    if (!isInstrument(instrument) || typeof replayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(replayDate)) {
      return NextResponse.json(
        { error: 'instrument and replay_date (YYYY-MM-DD) required' },
        { status: 400 }
      )
    }
    if (direction !== 'LONG' && direction !== 'SHORT') {
      return NextResponse.json({ error: 'direction must be LONG or SHORT' }, { status: 400 })
    }
    if (!isExitReason(exitReason)) {
      return NextResponse.json(
        { error: 'exit_reason must be stop_hit, take_profit, or manual' },
        { status: 400 }
      )
    }

    const entryPrice = num(body.entry_price)
    const exitPrice = num(body.exit_price)
    const stopLoss = num(body.stop_loss)
    const takeProfit = body.take_profit != null ? num(body.take_profit) : null
    const positionSize = num(body.position_size)
    const riskAmount = num(body.risk_amount)
    const accountSize = num(body.account_size, 100000)
    const filledAtUnix = Math.floor(num(body.filled_at_unix))
    const exitAtUnix = Math.floor(num(body.exit_at_unix || body.filled_at_unix))

    if (!(entryPrice > 0) || !(exitPrice > 0) || !(stopLoss > 0) || !(positionSize > 0)) {
      return NextResponse.json({ error: 'Invalid prices or size' }, { status: 400 })
    }
    if (!Number.isFinite(filledAtUnix) || filledAtUnix <= 0) {
      return NextResponse.json({ error: 'filled_at_unix required' }, { status: 400 })
    }

    const isLong = direction === 'LONG'
    const pnlRaw = isLong
      ? (exitPrice - entryPrice) * positionSize
      : (entryPrice - exitPrice) * positionSize
    const profitLoss =
      body.profit_loss != null ? Math.round(num(body.profit_loss) * 100) / 100 : Math.round(pnlRaw * 100) / 100

    const supabase = createAdminClient() ?? (await createClient())

    const { data: session } = await supabase
      .from('simulation_replays')
      .select('id')
      .eq('user_id', user.id)
      .eq('instrument', instrument)
      .eq('replay_date', replayDate)
      .maybeSingle()

    const resolvedReplayId = replayId || (session?.id as string | undefined) || null

    const { data, error } = await supabase
      .from('simulation_trades')
      .insert({
        user_id: user.id,
        replay_id: resolvedReplayId,
        instrument,
        replay_date: replayDate,
        direction,
        entry_price: entryPrice,
        exit_price: exitPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        position_size: positionSize,
        risk_amount: riskAmount,
        account_size: accountSize,
        filled_at_unix: filledAtUnix,
        exit_at_unix: exitAtUnix,
        exit_reason: exitReason,
        profit_loss: profitLoss,
        entry_level: body.entry_level != null ? num(body.entry_level) : entryPrice,
        entry_reason: typeof body.entry_reason === 'string' ? body.entry_reason.slice(0, 2000) : null,
        entry_source:
          body.entry_source === 'ai' ||
          body.entry_source === 'structure' ||
          body.entry_source === 'manual'
            ? body.entry_source
            : null,
        level_conviction: body.level_conviction != null ? num(body.level_conviction) : null,
      })
      .select('id, profit_loss, created_at')
      .single()

    if (error) {
      if (/entry_source/i.test(error.message || '')) {
        const retry = await supabase
          .from('simulation_trades')
          .insert({
            user_id: user.id,
            replay_id: resolvedReplayId,
            instrument,
            replay_date: replayDate,
            direction,
            entry_price: entryPrice,
            exit_price: exitPrice,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            position_size: positionSize,
            risk_amount: riskAmount,
            account_size: accountSize,
            filled_at_unix: filledAtUnix,
            exit_at_unix: exitAtUnix,
            exit_reason: exitReason,
            profit_loss: profitLoss,
            entry_level: body.entry_level != null ? num(body.entry_level) : entryPrice,
            entry_reason:
              typeof body.entry_reason === 'string' ? body.entry_reason.slice(0, 2000) : null,
            level_conviction: body.level_conviction != null ? num(body.level_conviction) : null,
          })
          .select('id, profit_loss, created_at')
          .single()
        if (!retry.error && retry.data) {
          return NextResponse.json({ success: true, trade: retry.data })
        }
      }
      console.error('[sim-journal POST]', error)
      return NextResponse.json(
        { error: 'Failed to save sim trade', detail: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, trade: data })
  } catch (e) {
    console.error('[sim-journal POST]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
