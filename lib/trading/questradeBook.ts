/**
 * Load the full read-only Questrade book + Tradeify transfer previews.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getTodayAttendance } from '@/lib/trading/deskAttendance'
import { loadTradeifySessionSnapshot } from '@/lib/trading/tradeifySessionState'
import { resolveTradeifyPlace } from '@/lib/trading/tradeifyGrowth50k'
import { buildTeamCopyAdvice } from '@/lib/trading/teamTape'
import { tradeifyAccountName } from '@/lib/trading/tradeifyEnv'
import { questradeGet, type QuestradeAccountSnapshot } from '@/lib/trading/questradeReadOnly'
import { getQuestradeApiCreds, loadQuestradeAccountSnapshot } from '@/lib/trading/questradeSession'
import {
  pairQuestradeBook,
  type QuestradeBookRow,
  type QuestradeProtectiveLevel,
  type QuestradeRawOrder,
} from '@/lib/trading/questradeOrders'
import {
  buildQuestradeTradeifyTransfer,
  type QuestradeTradeifyTransfer,
} from '@/lib/trading/questradeTransfer'
import type { DeskIndex } from '@/lib/trading/tradovateMirror'
import { DEV_USER_ID } from '@/lib/utils/devAuth'

export type QuestradeEquityPoint = { t: string; equity: number }

export type QuestradeBookPayload = {
  ok: true
  account: QuestradeAccountSnapshot | { ok: false; error: string }
  workingLimits: QuestradeBookRow[]
  openPositions: QuestradeBookRow[]
  history: QuestradeBookRow[]
  levels: QuestradeProtectiveLevel[]
  transfers: QuestradeTradeifyTransfer[]
  equityCurve: QuestradeEquityPoint[]
}

function ordersStartIso(days = 180): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

async function recordEquityPoint(
  supabase: SupabaseClient,
  snap: QuestradeAccountSnapshot
): Promise<void> {
  const { data: last } = await supabase
    .from('questrade_equity_points')
    .select('equity, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastEq = Number(last?.equity)
  const lastAt = last?.recorded_at ? new Date(last.recorded_at).getTime() : 0
  const age = Date.now() - lastAt
  if (last && Math.abs(lastEq - snap.equity) < 0.5 && age < 5 * 60 * 1000) return
  await supabase.from('questrade_equity_points').insert({
    equity: snap.equity,
    cash: snap.cash,
    market_value: snap.marketValue,
    currency: snap.currency,
    recorded_at: snap.asOfIso,
  })
}

export async function loadQuestradeBook(
  supabase: SupabaseClient,
  now = new Date()
): Promise<QuestradeBookPayload | { ok: false; error: string }> {
  const creds = await getQuestradeApiCreds(supabase)
  if (!creds.ok) return creds

  const startTime = ordersStartIso()
  const deskId = process.env.DESK_USER_ID?.trim() || DEV_USER_ID
  const [account, ordersRes, positionsRes, snap, attendance, dow, nasdaq] =
    await Promise.all([
      loadQuestradeAccountSnapshot(supabase),
      questradeGet<{ orders?: QuestradeRawOrder[] }>({
        apiServer: creds.apiServer,
        accessToken: creds.accessToken,
        endpoint: `v1/accounts/${creds.account}/orders`,
        params: { startTime, stateFilter: 'All' },
      }),
      questradeGet<{
        positions?: Array<{
          symbol?: string
          openQuantity?: number
          averageEntryPrice?: number
          currentPrice?: number
          currentMarketValue?: number
          openPnl?: number
        }>
      }>({
        apiServer: creds.apiServer,
        accessToken: creds.accessToken,
        endpoint: `v1/accounts/${creds.account}/positions`,
      }),
      loadTradeifySessionSnapshot(supabase, deskId, now),
      getTodayAttendance(supabase, deskId, 'NY', now),
      getOandaPrice('DOW').catch(() => null),
      getOandaPrice('NASDAQ').catch(() => null),
    ])

  if (account.ok) {
    await recordEquityPoint(supabase, account).catch(() => undefined)
  }

  const book = pairQuestradeBook({
    orders: ordersRes.orders || [],
    positions: positionsRes.positions || [],
  })
  const place = resolveTradeifyPlace(snap)
  const advice = buildTeamCopyAdvice({
    place,
    clockedIn: attendance?.status === 'clocked_in',
    now,
  })
  const indexLast: Partial<Record<DeskIndex, number>> = {}
  if (dow?.price) indexLast.DOW = dow.price
  if (nasdaq?.price) indexLast.NASDAQ = nasdaq.price
  const accountName = tradeifyAccountName()
  const transferRows = [...book.workingLimits, ...book.openPositions].filter(
    (row) => row.asset === 'stock'
  )
  const transfers = transferRows.map((row) =>
    buildQuestradeTradeifyTransfer({
      row,
      advice,
      indexLast,
      accountName,
    })
  )

  const { data: points } = await supabase
    .from('questrade_equity_points')
    .select('equity, recorded_at')
    .order('recorded_at', { ascending: true })
    .limit(400)

  const equityCurve: QuestradeEquityPoint[] = (points || []).map((p) => ({
    t: String(p.recorded_at),
    equity: Number(p.equity),
  }))
  const lastPoint = equityCurve[equityCurve.length - 1]
  if (account.ok && (!lastPoint || lastPoint.equity !== account.equity)) {
    equityCurve.push({ t: account.asOfIso, equity: account.equity })
  }

  return {
    ok: true,
    account,
    workingLimits: book.workingLimits,
    openPositions: book.openPositions,
    history: book.history,
    levels: book.levels,
    transfers,
    equityCurve,
  }
}
