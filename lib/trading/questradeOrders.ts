/**
 * Read-only Questrade order book — pair fills with SL/TP, flag working limits.
 * Never places or cancels.
 */

import { isTeamTapeSymbol, parseTeamTapeSide, type TeamTapeSide } from '@/lib/trading/teamTape'

export type QuestradeRawOrder = {
  id?: number | string
  symbol?: string
  side?: string
  orderType?: string
  type?: string
  state?: string
  totalQuantity?: number
  openQuantity?: number
  limitPrice?: number | null
  stopPrice?: number | null
  avgExecPrice?: number | null
  updateTime?: string
  timePlaced?: string
  parentId?: number | string | null
}

export type QuestradeBookRow = {
  sourceId: string
  symbol: string
  side: TeamTapeSide
  quantity: number
  entry: number
  stop: number | null
  target: number | null
  status: 'working' | 'filled' | 'closed' | 'cancelled'
  orderType: string
  kind: 'entry_limit' | 'open_position' | 'history' | 'protective'
  notional: number
  stockRiskDollars: number | null
  filledAt: string | null
}

const PROTECTIVE = new Set(['STOP', 'STOPLIMIT', 'TRAIL', 'TRAILLIMIT'])
const WORKING = new Set(['WORKING', 'ACCEPTED', 'PENDING', 'QUEUED'])
const FILLED = new Set(['EXECUTED', 'PARTIAL'])
const DEAD = new Set(['CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'])

export function questradeOrderType(raw: QuestradeRawOrder): string {
  return String(raw.orderType || raw.type || '').toUpperCase()
}

export function isQuestradeStockSymbol(raw?: string | null): boolean {
  return isTeamTapeSymbol(raw)
}

export function suggestTradeifyIndex(symbol: string): 'DOW' | 'NASDAQ' {
  const s = String(symbol || '').trim().toUpperCase()
  const nasdaq = new Set([
    'AAPL',
    'MSFT',
    'GOOG',
    'GOOGL',
    'AMZN',
    'META',
    'NVDA',
    'TSLA',
    'NFLX',
    'AMD',
    'INTC',
    'AVGO',
    'QCOM',
    'ADBE',
    'CRM',
    'ORCL',
    'CSCO',
    'QQQ',
    'TQQQ',
    'SQQQ',
  ])
  return nasdaq.has(s) ? 'NASDAQ' : 'DOW'
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function orderPrice(raw: QuestradeRawOrder): number | null {
  return num(raw.avgExecPrice) || num(raw.limitPrice) || num(raw.stopPrice)
}

export function pairQuestradeBook(args: {
  orders: QuestradeRawOrder[]
  positions?: Array<{ symbol?: string; openQuantity?: number; averageEntryPrice?: number }>
}): {
  workingLimits: QuestradeBookRow[]
  openPositions: QuestradeBookRow[]
  history: QuestradeBookRow[]
} {
  const orders = (args.orders || []).filter((o) => isQuestradeStockSymbol(o.symbol))
  const byId = new Map(orders.map((o) => [String(o.id), o]))
  const posBySym = new Map(
    (args.positions || [])
      .filter((p) => isQuestradeStockSymbol(p.symbol) && Number(p.openQuantity) !== 0)
      .map((p) => [String(p.symbol).toUpperCase(), p])
  )

  const usedProtective = new Set<string>()

  const findProtective = (
    entry: QuestradeRawOrder,
    want: 'sl' | 'tp'
  ): QuestradeRawOrder | null => {
    const entryId = String(entry.id)
    const symbol = String(entry.symbol || '').toUpperCase()
    const side = parseTeamTapeSide(entry.side)
    if (!side) return null
    const opp = side === 'BUY' ? 'SELL' : 'BUY'
    const kids = orders.filter((o) => {
      if (String(o.symbol || '').toUpperCase() !== symbol) return false
      if (parseTeamTapeSide(o.side) !== opp) return false
      if (DEAD.has(String(o.state || '').toUpperCase())) return false
      return true
    })
    const byParent = kids.filter((o) => String(o.parentId || '') === entryId)
    const pool = byParent.length ? byParent : kids.filter((o) => !o.parentId)
    for (const o of pool) {
      const t = questradeOrderType(o)
      if (want === 'sl' && PROTECTIVE.has(t)) return o
      if (want === 'tp' && t === 'LIMIT') return o
    }
    return null
  }

  const toRow = (
    entry: QuestradeRawOrder,
    kind: QuestradeBookRow['kind'],
    status: QuestradeBookRow['status']
  ): QuestradeBookRow | null => {
    const side = parseTeamTapeSide(entry.side)
    const symbol = String(entry.symbol || '').toUpperCase()
    const entryPx = orderPrice(entry)
    const qty = Number(entry.totalQuantity || entry.openQuantity || 0)
    if (!side || !entryPx || !(qty > 0)) return null
    const sl = findProtective(entry, 'sl')
    const tp = findProtective(entry, 'tp')
    if (sl?.id) usedProtective.add(String(sl.id))
    if (tp?.id) usedProtective.add(String(tp.id))
    const stop = sl ? num(sl.stopPrice) || num(sl.limitPrice) : null
    const target = tp ? num(tp.limitPrice) : null
    const stockRisk =
      stop != null ? Math.round(Math.abs(entryPx - stop) * qty * 100) / 100 : null
    return {
      sourceId: String(entry.id),
      symbol,
      side,
      quantity: qty,
      entry: entryPx,
      stop,
      target,
      status,
      orderType: questradeOrderType(entry) || 'LIMIT',
      kind,
      notional: Math.round(entryPx * qty * 100) / 100,
      stockRiskDollars: stockRisk,
      filledAt: entry.updateTime || entry.timePlaced || null,
    }
  }

  const workingLimits: QuestradeBookRow[] = []
  const history: QuestradeBookRow[] = []
  const openFromFills = new Map<string, QuestradeBookRow>()

  for (const o of orders) {
    const state = String(o.state || '').toUpperCase()
    const type = questradeOrderType(o)
    if (PROTECTIVE.has(type)) continue
    if (WORKING.has(state) && type === 'LIMIT') {
      const pos = posBySym.get(String(o.symbol || '').toUpperCase())
      const posQty = Number(pos?.openQuantity || 0)
      const side = parseTeamTapeSide(o.side)
      const isProtectiveLimit =
        (posQty > 0 && side === 'SELL') || (posQty < 0 && side === 'BUY')
      if (isProtectiveLimit) continue
      const row = toRow(o, 'entry_limit', 'working')
      if (row) workingLimits.push(row)
      continue
    }
    if (FILLED.has(state)) {
      if (PROTECTIVE.has(type)) continue
      const row = toRow(o, 'history', 'filled')
      if (!row) continue
      history.push(row)
      const pos = posBySym.get(row.symbol)
      if (pos && !openFromFills.has(row.symbol)) {
        openFromFills.set(row.symbol, {
          ...row,
          kind: 'open_position',
          quantity: Math.abs(Number(pos.openQuantity || row.quantity)),
          entry: num(pos.averageEntryPrice) || row.entry,
          status: 'filled',
        })
      }
    }
  }

  for (const [sym, pos] of posBySym) {
    if (openFromFills.has(sym)) continue
    const qty = Number(pos.openQuantity)
    const side: TeamTapeSide = qty < 0 ? 'SELL' : 'BUY'
    const entry = num(pos.averageEntryPrice)
    if (!entry) continue
    const fake: QuestradeRawOrder = {
      id: `pos-${sym}`,
      symbol: sym,
      side,
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: Math.abs(qty),
      avgExecPrice: entry,
    }
    const row = toRow(fake, 'open_position', 'filled')
    if (row) openFromFills.set(sym, row)
  }

  history.sort((a, b) => String(b.filledAt || '').localeCompare(String(a.filledAt || '')))
  void byId
  return {
    workingLimits,
    openPositions: [...openFromFills.values()],
    history,
  }
}
