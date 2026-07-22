/**
 * GET /api/trading/journal
 * Live desk trades only — fills, exits, P&L, stop counts, entry/exit reasons.
 * Simulation never writes to trades_journal; this API has no sim path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateUser } from '@/lib/utils/devAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get('days') || '30', 10) || 30))
    const instrument = searchParams.get('instrument')
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))

    const supabase = createAdminClient() ?? (await createClient())

    let query = supabase
      .from('trades_journal')
      .select(
        `id, instrument, trade_date, entry_window, entry_timestamp, entry_price, entry_direction,
         stop_loss_price, stop_loss_hit_at, stop_loss_hit_count, position_size, risk_amount, account_size,
         exit_timestamp, exit_price, exit_reason, profit_loss, profit_loss_percent,
         regime, regime_confidence, best_break_level, best_level_break_confidence,
         entry_reason, entry_source, exit_notes, profit_target_price, created_at, updated_at`
      )
      .eq('user_id', user.id)
      .neq('fill_status', 'cancelled')
      .order('entry_timestamp', { ascending: false })
      .limit(limit)

    if (instrument && ['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      query = query.eq('instrument', instrument)
    }

    const since = new Date()
    since.setUTCDate(since.getUTCDate() - days)
    query = query.gte('entry_timestamp', since.toISOString())

    let trades: Array<Record<string, any>> | null = null
    let error: { message?: string } | null = null

    {
      const res = await query
      trades = res.data as Array<Record<string, any>> | null
      error = res.error
    }

    // Fallback if enrichment columns not migrated yet
    if (error && /entry_reason|exit_notes|profit_target/i.test(error.message || '')) {
      const fallback = await supabase
        .from('trades_journal')
        .select(
          `id, instrument, trade_date, entry_window, entry_timestamp, entry_price, entry_direction,
           stop_loss_price, stop_loss_hit_at, stop_loss_hit_count, position_size, risk_amount, account_size,
           exit_timestamp, exit_price, exit_reason, profit_loss, profit_loss_percent,
           regime, regime_confidence, best_break_level, best_level_break_confidence,
           created_at, updated_at`
        )
        .eq('user_id', user.id)
        .gte('entry_timestamp', since.toISOString())
        .order('entry_timestamp', { ascending: false })
        .limit(limit)
      trades = fallback.data as Array<Record<string, any>> | null
      error = fallback.error
    }

    // If user_id column filter fails (older schema), try without
    if (error && /user_id/i.test(error.message || '')) {
      const noUser = await supabase
        .from('trades_journal')
        .select('*')
        .gte('entry_timestamp', since.toISOString())
        .order('entry_timestamp', { ascending: false })
        .limit(limit)
      trades = noUser.data as Array<Record<string, any>> | null
      error = noUser.error
    }

    if (error) {
      console.error('[journal]', error)
      return NextResponse.json({ error: 'Failed to load journal', detail: error.message }, { status: 500 })
    }

    const rawRows = trades ?? []
    const rows = rawRows.filter(
      (t) =>
        t.fill_status !== 'cancelled' &&
        t.exit_reason !== 'broker_rejected' &&
        !/failed|rejected|insufficient margin/i.test(String(t.notes || ''))
    )
    const ids = rows.map((t) => t.id).filter(Boolean)

    let decisions: Array<Record<string, unknown>> = []
    if (ids.length > 0) {
      const { data: dec } = await supabase
        .from('management_decisions')
        .select('*')
        .in('position_id', ids)
        .order('created_at', { ascending: true })
      decisions = dec ?? []
    }

    const byPosition = new Map<string, Array<Record<string, unknown>>>()
    for (const d of decisions) {
      const pid = String(d.position_id)
      const list = byPosition.get(pid) ?? []
      list.push(d)
      byPosition.set(pid, list)
    }

    const closed = rows.filter((t) => t.exit_timestamp)
    const open = rows.filter((t) => !t.exit_timestamp)
    const wins = closed.filter((t) => Number(t.profit_loss) > 0)
    const losses = closed.filter((t) => Number(t.profit_loss) < 0)
    const stops = closed.filter((t) => t.exit_reason === 'stop_hit')
    const tps = closed.filter((t) => t.exit_reason === 'take_profit')
    const aiExits = closed.filter((t) => t.exit_reason === 'ai_signal')
    const totalPnl = closed.reduce((s, t) => s + (Number(t.profit_loss) || 0), 0)

    // Desk equity trail from ticket account_size + realized P&L (not broker margin)
    const chrono = [...rows].sort((a, b) => {
      const ta = new Date(a.entry_timestamp || a.created_at || 0).getTime()
      const tb = new Date(b.entry_timestamp || b.created_at || 0).getTime()
      return ta - tb
    })
    const startingAccount =
      chrono.find((t) => Number(t.account_size) > 0)?.account_size != null
        ? Number(chrono.find((t) => Number(t.account_size) > 0)!.account_size)
        : 100000
    let running = startingAccount
    const equityAfter = new Map<string, number>()
    const equityBefore = new Map<string, number>()
    for (const t of chrono) {
      equityBefore.set(t.id, Math.round(running * 100) / 100)
      if (t.exit_timestamp && t.profit_loss != null) {
        running += Number(t.profit_loss) || 0
      }
      equityAfter.set(t.id, Math.round(running * 100) / 100)
    }
    const endingEquity = Math.round(running * 100) / 100

    const resolveExitNotes = (
      t: Record<string, any>,
      decs: Array<Record<string, unknown>>
    ): string => {
      if (t.exit_notes && String(t.exit_notes).trim()) return String(t.exit_notes)
      const aiNote = decs
        .map((d) => String(d.notes ?? d.reason ?? ''))
        .find((n) => /AI exit/i.test(n))
      if (aiNote) return aiNote
      if (t.exit_reason === 'stop_hit') return 'Stop loss hit — exit before or at stop'
      if (t.exit_reason === 'take_profit') return 'Take profit hit'
      if (t.exit_reason === 'ai_signal') {
        return 'AI early exit — system closed before take-profit (see management decisions)'
      }
      if (t.exit_reason === 'lunch_close') return 'Lunch flatten — morning desk closed'
      if (t.exit_reason === 'manual') return 'Manual close'
      return t.exit_reason ? String(t.exit_reason) : 'Closed'
    }

    const entries = rows.map((t) => {
      const decs = byPosition.get(t.id) ?? []
      const exitNotes = t.exit_timestamp ? resolveExitNotes(t, decs) : null
      const tp = t.profit_target_price != null ? Number(t.profit_target_price) : null
      const earlyExit =
        t.exit_reason === 'ai_signal' ||
        t.exit_reason === 'manual' ||
        t.exit_reason === 'lunch_close'
      return {
        id: t.id,
        instrument: t.instrument,
        market: t.instrument === 'NIKKEI' ? 'TOKYO' : 'NY',
        trade_date: t.trade_date,
        entry_window: t.entry_window,
        direction: t.entry_direction,
        status: t.exit_timestamp ? 'closed' : 'open',
        fill: {
          time: t.entry_timestamp,
          price: Number(t.entry_price),
          level: t.best_break_level != null ? Number(t.best_break_level) : null,
          reason:
            t.entry_reason ||
            (t.best_break_level != null
              ? `${t.entry_direction} at level ${t.best_break_level}`
              : `${t.entry_direction} entry`),
          source: (t.entry_source as string | null) || null,
        },
        risk: {
          stop_loss: Number(t.stop_loss_price),
          take_profit: tp,
          position_size: Number(t.position_size),
          risk_amount: Number(t.risk_amount),
          account_size: Number(t.account_size),
        },
        equity: {
          before: equityBefore.get(t.id) ?? startingAccount,
          after: equityAfter.get(t.id) ?? startingAccount,
        },
        exit: t.exit_timestamp
          ? {
              time: t.exit_timestamp,
              price: t.exit_price != null ? Number(t.exit_price) : null,
              reason_code: t.exit_reason,
              notes: exitNotes,
              early_exit: earlyExit && t.exit_reason !== 'take_profit',
              tp_hit: t.exit_reason === 'take_profit',
            }
          : null,
        stops: {
          hit_count: Number(t.stop_loss_hit_count) || 0,
          hit_at: t.stop_loss_hit_at,
        },
        pnl: {
          dollars: t.profit_loss != null ? Number(t.profit_loss) : null,
          percent: t.profit_loss_percent != null ? Number(t.profit_loss_percent) : null,
        },
        regime: {
          type: t.regime,
          confidence: t.regime_confidence,
        },
        decisions: decs.map((d) => ({
          type: d.decision_type ?? d.decision ?? null,
          notes: d.notes ?? d.reason ?? null,
          time: d.created_at ?? d.decision_time ?? null,
          price: d.decision_price ?? null,
        })),
      }
    })

    return NextResponse.json({
      success: true,
      summary: {
        trades: rows.length,
        open: open.length,
        closed: closed.length,
        wins: wins.length,
        losses: losses.length,
        stop_outs: stops.length,
        take_profits: tps.length,
        ai_exits: aiExits.length,
        win_rate: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
        total_pnl: Math.round(totalPnl * 100) / 100,
        starting_account: startingAccount,
        ending_equity: endingEquity,
        equity_change: Math.round((endingEquity - startingAccount) * 100) / 100,
        days,
      },
      entries,
    })
  } catch (e) {
    console.error('[journal]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
