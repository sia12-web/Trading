/**
 * GET /api/trading/journal
 * Live desk trades only — fills, exits, P&L, stop counts, entry/exit reasons.
 * Simulation never writes to trades_journal; this API has no sim path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  isLiveJournalInstrument,
  isVisibleLiveJournalRow,
  journalTicketEquity,
} from '@/lib/trading/journalHistory'
import {
  getTopstepXJournalRows,
  computeTopstepXChallengeState,
} from '@/lib/trading/topstepXChallenge'

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
         entry_reason, entry_source, exit_notes, profit_target_price, fill_status, notes,
         created_at, updated_at`
      )
      .eq('user_id', user.id)
      .not('fill_status', 'in', '(cancelled,working)')
      .order('entry_timestamp', { ascending: false })
      .limit(limit)

    if (instrument && isLiveJournalInstrument(instrument)) {
      query = query.eq('instrument', instrument.toUpperCase())
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
      console.warn('[journal] DB query notice (serving resilient journal):', error.message)
      trades = []
    }

    const rawRows = trades ?? []
    const rows = rawRows.filter(isVisibleLiveJournalRow)
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

    const aiExits = rows.filter((t) => t.exit_reason === 'ai_signal')
    const equity = journalTicketEquity(rows)
    const { startingAccount, equityBefore, equityAfter } = equity

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
        return 'AI early exit — trader confirmed before take-profit (see management decisions)'
      }
      if (t.exit_reason === 'lunch_close') return 'Lunch flatten — morning desk closed'
      if (t.exit_reason === 'cash_close')
        return 'Cash-close flatten — lunch-range / leftover book closed at session end'
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
        t.exit_reason === 'lunch_close' ||
        t.exit_reason === 'cash_close'
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

    const topstepxRows = getTopstepXJournalRows()
    const normInst = instrument ? instrument.toUpperCase() : null

    const filteredTopstepx = topstepxRows.filter((tx) => {
      if (normInst) {
        if (normInst === 'MNQ' && tx.instrument !== 'NASDAQ') return false
        if (normInst === 'MYM' && tx.instrument !== 'DOW') return false
        if (normInst === 'MGC' && tx.instrument !== 'GOLD') return false
        if (normInst === 'MCL' && tx.instrument !== 'CRUDE') return false
        if (
          normInst !== 'MNQ' &&
          normInst !== 'MYM' &&
          normInst !== 'MGC' &&
          normInst !== 'MCL' &&
          tx.instrument !== normInst
        ) {
          return false
        }
      }
      const txDate = new Date(tx.fill.time)
      if (txDate.getTime() < since.getTime()) return false
      return true
    })

    const seenIds = new Set<string>(entries.map((e) => e.id))
    const mergedEntries = [...entries]

    for (const tx of filteredTopstepx) {
      if (!seenIds.has(tx.id)) {
        seenIds.add(tx.id)
        mergedEntries.push(tx as any)
      }
    }

    // Sort descending by fill time
    mergedEntries.sort(
      (a, b) => new Date(b.fill.time).getTime() - new Date(a.fill.time).getTime()
    )

    // TopstepX $1,500 Challenge Engine state
    const topstepxChallenge = computeTopstepXChallengeState()

    const allClosed = mergedEntries.filter((t) => t.status === 'closed')
    const allOpen = mergedEntries.filter((t) => t.status === 'open')
    const allWins = allClosed.filter((t) => (t.pnl?.dollars ?? 0) > 0)
    const allLosses = allClosed.filter((t) => (t.pnl?.dollars ?? 0) < 0)
    const allStops = allClosed.filter(
      (t) => t.exit?.reason_code === 'stop_hit' || (t.stops?.hit_count ?? 0) > 0
    )
    const allTps = allClosed.filter(
      (t) => t.exit?.reason_code === 'take_profit' || t.exit?.tp_hit
    )
    const allTotalPnl = allClosed.reduce((s, t) => s + (t.pnl?.dollars ?? 0), 0)

    const baseAccount = startingAccount || 50000
    const roundedTotalPnl = Math.round(allTotalPnl * 100) / 100

    return NextResponse.json({
      success: true,
      topstepx_challenge: topstepxChallenge,
      summary: {
        trades: mergedEntries.length,
        open: allOpen.length,
        closed: allClosed.length,
        wins: allWins.length,
        losses: allLosses.length,
        stop_outs: allStops.length,
        take_profits: allTps.length,
        ai_exits: aiExits.length,
        win_rate: allClosed.length ? Math.round((allWins.length / allClosed.length) * 100) : null,
        total_pnl: roundedTotalPnl,
        starting_account: baseAccount,
        ending_equity: Math.round((baseAccount + roundedTotalPnl) * 100) / 100,
        equity_change: roundedTotalPnl,
        equity_source: equity.equitySource || 'topstepx_broker',
        days,
      },
      entries: mergedEntries,
    })
  } catch (e) {
    console.error('[journal]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
