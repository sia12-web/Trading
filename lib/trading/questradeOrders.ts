/**
 * Read-only Questrade order book — pair fills with SL/TP, flag working limits.
 * Stocks and options. Never places or cancels.
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

export type QuestradeRawPosition = {
  symbol?: string
  openQuantity?: number
  averageEntryPrice?: number
  currentPrice?: number
  currentMarketValue?: number
  openPnl?: number
  closedPnl?: number
  totalCost?: number
}

export type QuestradeBookRow = {
  sourceId: string
  symbol: string
  label: string
  underlying: string
  asset: 'stock' | 'option'
  side: TeamTapeSide
  quantity: number
  entry: number
  stop: number | null
  target: number | null
  mark: number | null
  livePnl: number | null
  status: 'working' | 'filled' | 'closed' | 'cancelled'
  orderType: string
  kind: 'entry_limit' | 'open_position' | 'history' | 'protective'
  notional: number
  stockRiskDollars: number | null
  multiplier: number
  filledAt: string | null
}

const PROTECTIVE = new Set(['STOP', 'STOPLIMIT', 'TRAIL', 'TRAILLIMIT'])
const WORKING = new Set(['WORKING', 'ACCEPTED', 'PENDING', 'QUEUED'])
const FILLED = new Set(['EXECUTED', 'PARTIAL'])
const DEAD = new Set(['CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'])
const OPTION_RE = /^([A-Z0-9.\-]+)\s+(\d{2}[A-Za-z]{3}\d{2})([CPcp])(\d+(?:\.\d+)?)$/

export function questradeOrderType(raw: QuestradeRawOrder): string {
  return String(raw.orderType || raw.type || '').toUpperCase()
}

export function normalizeQuestradeSymbol(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

export function parseQuestradeSymbol(raw?: string | null): {
  raw: string
  key: string
  underlying: string
  asset: 'stock' | 'option'
  label: string
  multiplier: number
} | null {
  const key = normalizeQuestradeSymbol(raw)
  if (!key) return null
  const opt = key.match(OPTION_RE)
  if (opt) {
    const underlying = opt[1]
    const expiry = opt[2]
    const right = opt[3]
    const strikeRaw = opt[4]
    if (!underlying || !expiry || !right || !strikeRaw) return null
    const kind = right === 'P' ? 'Put' : 'Call'
    const strikeNum = Number(strikeRaw)
    const strike = Number.isFinite(strikeNum)
      ? strikeNum % 1 === 0
        ? String(strikeNum)
        : strikeNum.toFixed(2)
      : strikeRaw
    return {
      raw: key,
      key,
      underlying,
      asset: 'option',
      label: `${underlying} ${expiry} $${strike} ${kind}`,
      multiplier: 100,
    }
  }
  if (!isTeamTapeSymbol(key)) return null
  return {
    raw: key,
    key,
    underlying: key,
    asset: 'stock',
    label: key,
    multiplier: 1,
  }
}

export function isQuestradeBookSymbol(raw?: string | null): boolean {
  return parseQuestradeSymbol(raw) != null
}

export function suggestTradeifyIndex(symbol: string): 'DOW' | 'NASDAQ' {
  const parsed = parseQuestradeSymbol(symbol)
  const s = (parsed?.underlying || String(symbol || '').trim()).toUpperCase()
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

function posNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function signedNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function orderPrice(raw: QuestradeRawOrder): number | null {
  return posNum(raw.avgExecPrice) || posNum(raw.limitPrice) || posNum(raw.stopPrice)
}

export function pairQuestradeBook(args: {
  orders: QuestradeRawOrder[]
  positions?: QuestradeRawPosition[]
}): {
  workingLimits: QuestradeBookRow[]
  openPositions: QuestradeBookRow[]
  history: QuestradeBookRow[]
} {
  const orders = (args.orders || []).filter((o) => isQuestradeBookSymbol(o.symbol))
  const posBySym = new Map(
    (args.positions || [])
      .filter((p) => isQuestradeBookSymbol(p.symbol) && Number(p.openQuantity) !== 0)
      .map((p) => [normalizeQuestradeSymbol(p.symbol), p])
  )

  const usedProtective = new Set<string>()

  const findProtective = (
    entry: QuestradeRawOrder,
    want: 'sl' | 'tp'
  ): QuestradeRawOrder | null => {
    const entryId = String(entry.id)
    const symbol = normalizeQuestradeSymbol(entry.symbol)
    const side = parseTeamTapeSide(entry.side)
    if (!side) return null
    const opp = side === 'BUY' ? 'SELL' : 'BUY'
    const kids = orders.filter((o) => {
      if (normalizeQuestradeSymbol(o.symbol) !== symbol) return false
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
    status: QuestradeBookRow['status'],
    pos?: QuestradeRawPosition
  ): QuestradeBookRow | null => {
    const parsed = parseQuestradeSymbol(entry.symbol)
    const side = parseTeamTapeSide(entry.side)
    const entryPx = orderPrice(entry)
    const qty = Number(entry.totalQuantity || entry.openQuantity || 0)
    if (!parsed || !side || !entryPx || !(qty > 0)) return null
    const sl = findProtective(entry, 'sl')
    const tp = findProtective(entry, 'tp')
    if (sl?.id) usedProtective.add(String(sl.id))
    if (tp?.id) usedProtective.add(String(tp.id))
    const stop = sl ? posNum(sl.stopPrice) || posNum(sl.limitPrice) : null
    const target = tp ? posNum(tp.limitPrice) : null
    const mark = posNum(pos?.currentPrice)
    const livePnl = signedNum(pos?.openPnl)
    const stockRisk =
      stop != null
        ? Math.round(Math.abs(entryPx - stop) * qty * parsed.multiplier * 100) / 100
        : null
    const notional =
      mark != null
        ? Math.round(mark * qty * parsed.multiplier * 100) / 100
        : Math.round(entryPx * qty * parsed.multiplier * 100) / 100
    return {
      sourceId: String(entry.id),
      symbol: parsed.key,
      label: parsed.label,
      underlying: parsed.underlying,
      asset: parsed.asset,
      side,
      quantity: qty,
      entry: entryPx,
      stop,
      target,
      mark,
      livePnl,
      status,
      orderType: questradeOrderType(entry) || 'LIMIT',
      kind,
      notional,
      stockRiskDollars: stockRisk,
      multiplier: parsed.multiplier,
      filledAt: entry.updateTime || entry.timePlaced || null,
    }
  }

  const workingLimits: QuestradeBookRow[] = []
  const history: QuestradeBookRow[] = []
  const openFromFills = new Map<string, QuestradeBookRow>()

  for (const o of orders) {
    const state = String(o.state || '').toUpperCase()
    const type = questradeOrderType(o)
    const key = normalizeQuestradeSymbol(o.symbol)
    if (PROTECTIVE.has(type)) continue
    if (WORKING.has(state) && type === 'LIMIT') {
      const pos = posBySym.get(key)
      const posQty = Number(pos?.openQuantity || 0)
      const side = parseTeamTapeSide(o.side)
      const isProtectiveLimit =
        (posQty > 0 && side === 'SELL') || (posQty < 0 && side === 'BUY')
      if (isProtectiveLimit) continue
      const row = toRow(o, 'entry_limit', 'working', pos)
      if (row) workingLimits.push(row)
      continue
    }
    if (FILLED.has(state)) {
      const row = toRow(o, 'history', 'filled', posBySym.get(key))
      if (!row) continue
      history.push(row)
      const pos = posBySym.get(row.symbol)
      if (pos && !openFromFills.has(row.symbol)) {
        openFromFills.set(row.symbol, {
          ...row,
          kind: 'open_position',
          quantity: Math.abs(Number(pos.openQuantity || row.quantity)),
          entry: posNum(pos.averageEntryPrice) || row.entry,
          mark: posNum(pos.currentPrice) ?? row.mark,
          livePnl: signedNum(pos.openPnl),
          status: 'filled',
        })
      }
    }
  }

  for (const [sym, pos] of posBySym) {
    if (openFromFills.has(sym)) continue
    const qty = Number(pos.openQuantity)
    const side: TeamTapeSide = qty < 0 ? 'SELL' : 'BUY'
    const entry = posNum(pos.averageEntryPrice)
    if (!entry) continue
    const fake: QuestradeRawOrder = {
      id: `pos-${sym}`,
      symbol: pos.symbol || sym,
      side,
      orderType: 'Limit',
      state: 'Executed',
      totalQuantity: Math.abs(qty),
      avgExecPrice: entry,
    }
    const row = toRow(fake, 'open_position', 'filled', pos)
    if (row) openFromFills.set(sym, row)
  }

  history.sort((a, b) => String(b.filledAt || '').localeCompare(String(a.filledAt || '')))
  return {
    workingLimits,
    openPositions: [...openFromFills.values()],
    history,
  }
}
