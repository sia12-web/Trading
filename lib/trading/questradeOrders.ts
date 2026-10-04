/**
 * Read-only Questrade order book — pair fills with SL/TP, flag working limits.
 * Stocks and options. Never places or cancels.
 */

import { isTeamTapeSymbol, parseTeamTapeSide, teamTapeTarget1_5R, type TeamTapeSide } from '@/lib/trading/teamTape'
import { getSymbolRealName } from '@/lib/trading/symbolNames'
import { getSymbolMultiplier } from '@/lib/trading/performanceMetrics'

export type QuestradeLevelStatus = 'working' | 'filled' | 'cancelled'

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
  triggerStopPrice?: number | null
  avgExecPrice?: number | null
  updateTime?: string
  timePlaced?: string
  creationTime?: string
  parentId?: number | string | null
  orderGroupId?: number | string | null
  orderClass?: string | null
  chainId?: number | string | null
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
  companyName: string
  realName: string
  underlying: string
  asset: 'stock' | 'option'
  side: TeamTapeSide
  quantity: number
  entry: number
  stop: number | null
  target: number | null
  stopStatus: QuestradeLevelStatus | null
  targetStatus: QuestradeLevelStatus | null
  mark: number | null
  livePnl: number | null
  /** Realized exit price for closed round-trips (never a projected TP). */
  exit?: number | null
  /** Realized P&L for closed round-trips. */
  pnl?: number | null
  /** Exit fill timestamp for closed round-trips. */
  exitAt?: string | null
  status: 'working' | 'filled' | 'closed' | 'cancelled'
  orderType: string
  kind: 'entry_limit' | 'open_position' | 'history' | 'protective'
  notional: number
  stockRiskDollars: number | null
  multiplier: number
  filledAt: string | null
}

export type QuestradeProtectiveLevel = {
  sourceId: string
  symbol: string
  label: string
  companyName: string
  realName: string
  underlying: string
  asset: 'stock' | 'option'
  side: TeamTapeSide
  kind: 'sl' | 'tp'
  price: number
  quantity: number
  status: QuestradeLevelStatus
  orderType: string
  parentId: string | null
  orderGroupId: string | null
  updatedAt: string | null
}

const PROTECTIVE = new Set([
  'STOP',
  'STOPLIMIT',
  'TRAIL',
  'TRAILLIMIT',
  'TRAILSTOPINDOLLAR',
  'TRAILSTOPINPERCENTAGE',
  'TRAILSTOPLIMITINDOLLAR',
  'TRAILSTOPLIMITINPERCENTAGE',
])
const WORKING = new Set([
  'WORKING',
  'ACCEPTED',
  'PENDING',
  'QUEUED',
  'CONTINGENTORDER',
  'ACTIVATED',
  'TRIGGERED',
  'SUSPENDED',
  'CANCELPENDING',
  'REPLACEPENDING',
  'PENDINGRISKREVIEW',
])
const FILLED = new Set(['EXECUTED', 'PARTIAL'])
const DEAD = new Set([
  'CANCELED',
  'CANCELLED',
  'PARTIALCANCELED',
  'REJECTED',
  'EXPIRED',
  'FAILED',
  'REPLACED',
])
const OPTION_RE = /^([A-Z0-9.\-]+)\s+(\d{2}[A-Za-z]{3}\d{2})([CPcp])(\d+(?:\.\d+)?)$/
const OPTION_OCC = /^([A-Z0-9.\-]+)\s+(\d{2})(\d{2})(\d{2})([CPcp])(\d{8})$/
const LEVEL_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000

export function questradeOrderType(raw: QuestradeRawOrder): string {
  return String(raw.orderType || raw.type || '').toUpperCase()
}

export function parseQuestradeSide(raw?: string | null): TeamTapeSide | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
  if (s === 'BUY' || s === 'LONG' || s === 'BTO' || s === 'BTC' || s === 'COV') return 'BUY'
  if (s === 'SELL' || s === 'SHORT' || s === 'STC' || s === 'STO') return 'SELL'
  return parseTeamTapeSide(raw)
}

function orderClass(raw: QuestradeRawOrder): string {
  return String(raw.orderClass || '').trim().toUpperCase()
}

function groupKey(raw: QuestradeRawOrder): string | null {
  const g = raw.orderGroupId
  if (g == null || g === '' || g === 0 || g === '0') return null
  return String(g)
}

function parentKey(raw: QuestradeRawOrder): string | null {
  const p = raw.parentId
  if (p == null || p === '' || p === 0 || p === '0') return null
  return String(p)
}

export function questradeLevelStatus(raw: QuestradeRawOrder): QuestradeLevelStatus | null {
  const state = String(raw.state || '').toUpperCase()
  if (WORKING.has(state)) return 'working'
  if (FILLED.has(state)) return 'filled'
  if (DEAD.has(state)) return 'cancelled'
  return null
}

function levelPrice(raw: QuestradeRawOrder): number | null {
  return (
    posNum(raw.triggerStopPrice) ||
    posNum(raw.stopPrice) ||
    posNum(raw.limitPrice) ||
    posNum(raw.avgExecPrice)
  )
}

function isSlOrder(raw: QuestradeRawOrder): boolean {
  const cls = orderClass(raw)
  if (cls === 'STOPLOSS' || cls === 'LOSS') return true
  if (posNum(raw.stopPrice) != null || posNum(raw.triggerStopPrice) != null) return true
  return PROTECTIVE.has(questradeOrderType(raw))
}

function isBracketTakeProfit(raw: QuestradeRawOrder): boolean {
  const cls = orderClass(raw)
  return cls === 'LIMIT' || cls === 'PROFIT'
}

function isPrimaryEntry(raw: QuestradeRawOrder): boolean {
  return orderClass(raw) === 'PRIMARY'
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
  if (opt && opt[1] && opt[2] && opt[3] && opt[4]) {
    const underlying = opt[1]
    const expiry = opt[2]
    const right = opt[3].toUpperCase() === 'P' ? 'Put' : 'Call'
    const strikeRaw = opt[4]
    const kind = right
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
  const optOcc = key.match(OPTION_OCC)
  if (optOcc && optOcc[1] && optOcc[2] && optOcc[3] && optOcc[4] && optOcc[5] && optOcc[6]) {
    const underlying = optOcc[1]
    const yy = optOcc[2]
    const mm = optOcc[3]
    const dd = optOcc[4]
    const right = optOcc[5].toUpperCase() === 'P' ? 'Put' : 'Call'
    const strikeNum = Number(optOcc[6]) / 1000
    const strike = Number.isFinite(strikeNum)
      ? strikeNum % 1 === 0
        ? String(strikeNum)
        : strikeNum.toFixed(2)
      : String(strikeNum)
    return {
      raw: key,
      key,
      underlying,
      asset: 'option',
      label: `${underlying} ${yy}-${mm}-${dd} $${strike} ${right}`,
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
    multiplier: getSymbolMultiplier(key, 'stock'),
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

function orderPrice(raw?: QuestradeRawOrder | null): number | null {
  if (!raw) return null
  return posNum(raw.avgExecPrice) || posNum(raw.limitPrice) || posNum(raw.stopPrice)
}

function orderStamp(raw?: QuestradeRawOrder | null): string | null {
  if (!raw) return null
  return raw.updateTime || raw.timePlaced || raw.creationTime || null
}

function toProtectiveLevel(
  raw: QuestradeRawOrder,
  kind: 'sl' | 'tp'
): QuestradeProtectiveLevel | null {
  const parsed = parseQuestradeSymbol(raw.symbol)
  const side = parseQuestradeSide(raw.side)
  const price = kind === 'tp' ? posNum(raw.limitPrice) || levelPrice(raw) : levelPrice(raw)
  const status = questradeLevelStatus(raw)
  const qty = Number(raw.totalQuantity || raw.openQuantity || 0)
  if (!parsed || !side || price == null || !status || !(qty > 0)) return null
  const realMeta = getSymbolRealName(parsed.key)
  const companyName = realMeta.name
  const realName = parsed.asset === 'option' ? parsed.label : realMeta.name
  return {
    sourceId: String(raw.id ?? `${parsed.key}-${kind}-${price}`),
    symbol: parsed.key,
    label: parsed.label,
    companyName,
    realName,
    underlying: parsed.underlying,
    asset: parsed.asset,
    side,
    kind,
    price,
    quantity: qty,
    status,
    orderType: questradeOrderType(raw) || (kind === 'sl' ? 'STOP' : 'LIMIT'),
    parentId: parentKey(raw),
    orderGroupId: groupKey(raw),
    updatedAt: orderStamp(raw),
  }
}

function pickLevel(
  levels: QuestradeProtectiveLevel[],
  args: {
    symbol: string
    entrySide: TeamTapeSide
    entryId?: string | null
    groupId?: string | null
    entryPrice?: number | null
    entryQty?: number | null
    entryTime?: string | null
    want: 'sl' | 'tp'
    isEntryLimit?: boolean
    isOpenPosition?: boolean
  }
): QuestradeProtectiveLevel | null {
  const opp = args.entrySide === 'BUY' ? 'SELL' : 'BUY'

  // Working entry limits (unexecuted) only pair with explicitly linked brackets
  if (args.isEntryLimit) {
    const direct = levels.filter(
      (l) =>
        l.kind === args.want &&
        l.symbol === args.symbol &&
        l.side === opp &&
        ((args.entryId && l.parentId === args.entryId) ||
          (args.groupId && l.orderGroupId === args.groupId))
    )
    return direct[0] ?? null
  }

  const entryPx = args.entryPrice
  const entryTs = args.entryTime ? Date.parse(args.entryTime) : 0

  const ranked = levels
    .filter((l) => {
      if (l.kind !== args.want || l.symbol !== args.symbol || l.side !== opp) return false
      // For open positions, only active working orders are protective; never borrow old cancelled/filled orders
      if (args.isOpenPosition && l.status !== 'working') return false
      // For take-profit limit orders, prefer profitable target levels if entry price is known
      if (args.want === 'tp' && entryPx != null && entryPx > 0 && l.price > 0) {
        const isProfitable = args.entrySide === 'BUY' ? l.price >= entryPx : l.price <= entryPx
        // If not strictly profitable and not explicitly linked, filter out
        if (!isProfitable && !l.parentId && !l.orderGroupId) return false
      }
      // Note: Stop Loss orders (kind === 'sl') are protective/trailing orders and should NEVER be discarded
      // just because the trader moved SL to break-even or trailed it into profit!
      return true
    })
    .map((l) => {
      let score = 0
      // Active working orders take highest priority
      if (l.status === 'working') score += 100
      else if (l.status === 'filled') score += 40
      else score += 15

      // Explicit link gets strong boost
      if (args.entryId && l.parentId === args.entryId) score += 50
      if (args.groupId && l.orderGroupId === args.groupId) score += 50

      // Orders placed at or after entry time
      const lTime = l.updatedAt ? Date.parse(l.updatedAt) : 0
      if (Number.isFinite(lTime) && lTime > 0) {
        if (Number.isFinite(entryTs) && entryTs > 0 && lTime >= entryTs) {
          score += 30
        }
        score += Math.min(20, lTime / 1e13)
      }

      // Quantity alignment
      if (args.entryQty != null && args.entryQty > 0) {
        if (l.quantity === args.entryQty) score += 25
        else if (l.quantity <= args.entryQty) score += 10
      }

      return { l, score }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.l ?? null
}

export function pairQuestradeBook(args: {
  orders: QuestradeRawOrder[]
  positions?: QuestradeRawPosition[]
  now?: Date
}): {
  workingLimits: QuestradeBookRow[]
  openPositions: QuestradeBookRow[]
  history: QuestradeBookRow[]
  levels: QuestradeProtectiveLevel[]
} {
  const nowMs = (args.now ?? new Date()).getTime()
  const orders = (args.orders || []).filter((o) => isQuestradeBookSymbol(o.symbol))
  const posBySym = new Map(
    (args.positions || [])
      .filter((p) => isQuestradeBookSymbol(p.symbol) && Number(p.openQuantity) !== 0)
      .map((p) => [normalizeQuestradeSymbol(p.symbol), p])
  )

  const entrySides = new Map<string, TeamTapeSide>()
  for (const [sym, pos] of posBySym) {
    entrySides.set(sym, Number(pos.openQuantity) < 0 ? 'SELL' : 'BUY')
  }
  const entryCandidates = [...orders].sort((a, b) =>
    String(orderStamp(a) || '').localeCompare(String(orderStamp(b) || ''))
  )
  for (const o of entryCandidates) {
    if (isSlOrder(o) || isBracketTakeProfit(o)) continue
    const side = parseQuestradeSide(o.side)
    const key = normalizeQuestradeSymbol(o.symbol)
    if (!side || !key || entrySides.has(key)) continue
    const state = String(o.state || '').toUpperCase()
    const type = questradeOrderType(o)
    const looksLikeEntry =
      isPrimaryEntry(o) ||
      FILLED.has(state) ||
      (WORKING.has(state) && (type === 'LIMIT' || type === 'LIMITONOPEN' || type === 'MARKET'))
    if (!looksLikeEntry) continue
    const posQty = Number(posBySym.get(key)?.openQuantity || 0)
    const oppositePos = (posQty > 0 && side === 'SELL') || (posQty < 0 && side === 'BUY')
    if (!oppositePos) entrySides.set(key, side)
  }

  const levels: QuestradeProtectiveLevel[] = []
  for (const o of orders) {
    if (isSlOrder(o)) {
      const row = toProtectiveLevel(o, 'sl')
      if (row) levels.push(row)
      continue
    }
    if (isBracketTakeProfit(o)) {
      const row = toProtectiveLevel(o, 'tp')
      if (row) levels.push(row)
      continue
    }
    if (isPrimaryEntry(o) || isSlOrder(o)) continue
    const type = questradeOrderType(o)
    if (type !== 'LIMIT' && type !== 'LIMITONCLOSE') continue
    const key = normalizeQuestradeSymbol(o.symbol)
    const side = parseQuestradeSide(o.side)
    const entrySide = entrySides.get(key)
    const linked = parentKey(o) != null || groupKey(o) != null
    const opposite = entrySide != null && side != null && side !== entrySide
    if (opposite || (linked && side != null && entrySide != null && side !== entrySide)) {
      const row = toProtectiveLevel(o, 'tp')
      if (row) levels.push(row)
    }
  }

  const toRow = (
    entry: QuestradeRawOrder,
    kind: QuestradeBookRow['kind'],
    status: QuestradeBookRow['status'],
    pos?: QuestradeRawPosition
  ): QuestradeBookRow | null => {
    const parsed = parseQuestradeSymbol(entry.symbol)
    const side = parseQuestradeSide(entry.side)
    const entryPx =
      kind === 'open_position'
        ? posNum(pos?.averageEntryPrice) ||
          (pos?.totalCost != null && pos?.openQuantity ? posNum(Math.abs(Number(pos.totalCost) / Number(pos.openQuantity))) : null) ||
          orderPrice(entry)
        : orderPrice(entry)
    const qty =
      kind === 'open_position' && pos?.openQuantity
        ? Math.abs(Number(pos.openQuantity))
        : Number(entry.totalQuantity || entry.openQuantity || 0)
    if (!parsed || !side || !entryPx || !(qty > 0)) return null

    const isLimit = kind === 'entry_limit'
    const isOpenPosition = kind === 'open_position'
    const entryTime = orderStamp(entry)

    const sl = pickLevel(levels, {
      symbol: parsed.key,
      entrySide: side,
      entryId: entry.id != null ? String(entry.id) : null,
      groupId: groupKey(entry),
      entryPrice: entryPx,
      entryQty: qty,
      entryTime,
      want: 'sl',
      isEntryLimit: isLimit,
      isOpenPosition,
    })
    const tp = pickLevel(levels, {
      symbol: parsed.key,
      entrySide: side,
      entryId: entry.id != null ? String(entry.id) : null,
      groupId: groupKey(entry),
      entryPrice: entryPx,
      entryQty: qty,
      entryTime,
      want: 'tp',
      isEntryLimit: isLimit,
      isOpenPosition,
    })
    const stop = sl?.price ?? null
    const target =
      tp?.price ??
      (stop != null ? teamTapeTarget1_5R({ side, entry: entryPx, stop }) : null)
    const mark = posNum(pos?.currentPrice)
    const calculatedPnl =
      mark != null
        ? signedNum((mark - entryPx) * qty * (side === 'BUY' ? 1 : -1) * parsed.multiplier)
        : null
    const livePnl =
      pos?.openPnl != null && pos.openPnl !== 0
        ? signedNum(pos.openPnl)
        : calculatedPnl
    const stockRisk =
      stop != null
        ? Math.round(Math.abs(entryPx - stop) * qty * parsed.multiplier * 100) / 100
        : null
    const notional =
      mark != null
        ? Math.round(mark * qty * parsed.multiplier * 100) / 100
        : Math.round(entryPx * qty * parsed.multiplier * 100) / 100

    const realMeta = getSymbolRealName(parsed.key)
    const companyName = realMeta.name
    const realName = parsed.asset === 'option' ? parsed.label : realMeta.name

    return {
      sourceId: String(entry.id),
      symbol: parsed.key,
      label: parsed.label,
      companyName,
      realName,
      underlying: parsed.underlying,
      asset: parsed.asset,
      side,
      quantity: qty,
      entry: entryPx,
      stop,
      target,
      stopStatus: sl?.status ?? null,
      targetStatus: tp?.status ?? null,
      mark,
      livePnl,
      status,
      orderType: questradeOrderType(entry) || 'LIMIT',
      kind,
      notional,
      stockRiskDollars: stockRisk,
      multiplier: parsed.multiplier,
      filledAt: orderStamp(entry),
    }
  }

  const workingLimits: QuestradeBookRow[] = []
  const history: QuestradeBookRow[] = []
  const openPositions: QuestradeBookRow[] = []

  // 1. Build open positions directly from active broker positions
  for (const [sym, pos] of posBySym) {
    const qty = Number(pos.openQuantity)
    if (!qty) continue
    const side: TeamTapeSide = qty < 0 ? 'SELL' : 'BUY'
    const entryPx =
      posNum(pos.averageEntryPrice) ||
      (pos.totalCost != null ? posNum(Math.abs(Number(pos.totalCost) / qty)) : null)
    if (!entryPx) continue

    // Find the latest executed order for this symbol to provide fill timestamp / order ID
    const latestFill = [...orders]
      .filter(
        (o) =>
          normalizeQuestradeSymbol(o.symbol) === sym &&
          FILLED.has(String(o.state || '').toUpperCase())
      )
      .sort((a, b) => String(orderStamp(b) || '').localeCompare(String(orderStamp(a) || '')))[0]

    const posOrder: QuestradeRawOrder = {
      id: latestFill?.id ?? `pos-${sym}`,
      symbol: pos.symbol || sym,
      side,
      orderType: latestFill?.orderType || 'Limit',
      state: 'Executed',
      totalQuantity: Math.abs(qty),
      avgExecPrice: entryPx,
      updateTime: orderStamp(latestFill) || undefined,
      creationTime: latestFill?.creationTime,
    }

    const row = toRow(posOrder, 'open_position', 'filled', pos)
    if (row) {
      openPositions.push(row)
    }
  }

  // 2. Build working entry limits (do not invent "history" from open entry fills)
  for (const o of orders) {
    const state = String(o.state || '').toUpperCase()
    const type = questradeOrderType(o)
    const key = normalizeQuestradeSymbol(o.symbol)
    if (isSlOrder(o) || isBracketTakeProfit(o)) continue
    if (WORKING.has(state) && (type === 'LIMIT' || type === 'LIMITONOPEN' || isPrimaryEntry(o))) {
      const pos = posBySym.get(key)
      const posQty = Number(pos?.openQuantity || 0)
      const side = parseQuestradeSide(o.side)
      const isProtectiveLimit =
        (posQty > 0 && side === 'SELL') || (posQty < 0 && side === 'BUY')
      if (isProtectiveLimit) continue
      const row = toRow(o, 'entry_limit', 'working', pos)
      if (row) workingLimits.push(row)
    }
  }

  // 3. Closed history = FIFO-paired entry/exit fills with realized P&L only
  history.push(...buildClosedTradeHistory(orders, levels))

  const visibleLevels = levels
    .filter((l) => {
      if (l.status === 'working') return true
      const t = l.updatedAt ? Date.parse(l.updatedAt) : NaN
      return Number.isFinite(t) && nowMs - t <= LEVEL_LOOKBACK_MS
    })
    .sort((a, b) => {
      const rank = (s: QuestradeLevelStatus) => (s === 'working' ? 0 : s === 'filled' ? 1 : 2)
      const byStatus = rank(a.status) - rank(b.status)
      if (byStatus !== 0) return byStatus
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })

  history.sort((a, b) =>
    String(b.exitAt || b.filledAt || '').localeCompare(String(a.exitAt || a.filledAt || ''))
  )
  return {
    workingLimits,
    openPositions,
    history,
    levels: visibleLevels,
  }
}

type OpenLot = {
  id: string
  side: TeamTapeSide
  qty: number
  price: number
  time: string | null
  stop: number | null
  target: number | null
  orderType: string
  parsed: NonNullable<ReturnType<typeof parseQuestradeSymbol>>
}

/**
 * Pair filled entry/exit orders (including filled SL/TP) into closed round-trips
 * with realized P&L. Residual unmatched lots stay open and are excluded.
 */
export function buildClosedTradeHistory(
  orders: QuestradeRawOrder[],
  levels: QuestradeProtectiveLevel[] = []
): QuestradeBookRow[] {
  type Fill = {
    id: string
    symbolKey: string
    side: TeamTapeSide
    qty: number
    price: number
    time: string | null
    orderType: string
    parsed: NonNullable<ReturnType<typeof parseQuestradeSymbol>>
    isProtective: boolean
  }

  const fills: Fill[] = []
  for (const o of orders) {
    const state = String(o.state || '').toUpperCase()
    if (!FILLED.has(state)) continue
    const parsed = parseQuestradeSymbol(o.symbol)
    const side = parseQuestradeSide(o.side)
    const price = orderPrice(o)
    const qty = Number(o.totalQuantity || o.openQuantity || 0)
    if (!parsed || !side || !price || !(qty > 0)) continue
    fills.push({
      id: String(o.id ?? `${parsed.key}-${orderStamp(o) || 'fill'}`),
      symbolKey: parsed.key,
      side,
      qty,
      price,
      time: orderStamp(o),
      orderType: questradeOrderType(o) || 'LIMIT',
      parsed,
      isProtective: isSlOrder(o) || isBracketTakeProfit(o),
    })
  }

  fills.sort((a, b) => {
    const ta = a.time || ''
    const tb = b.time || ''
    if (ta !== tb) return ta.localeCompare(tb)
    return a.id.localeCompare(b.id)
  })

  const lotsBySym = new Map<string, OpenLot[]>()
  const closed: QuestradeBookRow[] = []
  let closeSeq = 0

  const levelFor = (symbol: string, entrySide: TeamTapeSide, want: 'sl' | 'tp', entryId: string) =>
    pickLevel(levels, {
      symbol,
      entrySide,
      entryId,
      want,
      isOpenPosition: false,
    })

  for (const fill of fills) {
    const lots = lotsBySym.get(fill.symbolKey) || []
    lotsBySym.set(fill.symbolKey, lots)
    const inventorySide = lots[0]?.side ?? null

    // Same side (or flat) → open / add inventory
    if (!inventorySide || inventorySide === fill.side) {
      if (fill.isProtective && !inventorySide) {
        // Orphan protective fill with no open lot — ignore for closed history
        continue
      }
      const stopLvl = levelFor(fill.symbolKey, fill.side, 'sl', fill.id)
      const tpLvl = levelFor(fill.symbolKey, fill.side, 'tp', fill.id)
      lots.push({
        id: fill.id,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        time: fill.time,
        stop: stopLvl?.price ?? null,
        target:
          tpLvl?.price ??
          (stopLvl
            ? teamTapeTarget1_5R({ side: fill.side, entry: fill.price, stop: stopLvl.price })
            : null),
        orderType: fill.orderType,
        parsed: fill.parsed,
      })
      continue
    }

    // Opposite side → close inventory FIFO
    let remaining = fill.qty
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]!
      const matched = Math.min(remaining, lot.qty)
      const pnlRaw =
        lot.side === 'BUY'
          ? (fill.price - lot.price) * matched * lot.parsed.multiplier
          : (lot.price - fill.price) * matched * lot.parsed.multiplier
      const pnl = Math.round(pnlRaw * 100) / 100
      const realMeta = getSymbolRealName(lot.parsed.key)
      const companyName = realMeta.name
      const realName = lot.parsed.asset === 'option' ? lot.parsed.label : realMeta.name
      closeSeq += 1
      closed.push({
        sourceId: `closed-${lot.id}-${fill.id}-${closeSeq}`,
        symbol: lot.parsed.key,
        label: lot.parsed.label,
        companyName,
        realName,
        underlying: lot.parsed.underlying,
        asset: lot.parsed.asset,
        side: lot.side,
        quantity: matched,
        entry: lot.price,
        stop: lot.stop,
        target: lot.target,
        stopStatus: null,
        targetStatus: null,
        mark: fill.price,
        livePnl: null,
        exit: fill.price,
        pnl,
        exitAt: fill.time,
        status: 'closed',
        orderType: fill.isProtective ? fill.orderType : lot.orderType,
        kind: 'history',
        notional: Math.round(fill.price * matched * lot.parsed.multiplier * 100) / 100,
        stockRiskDollars:
          lot.stop != null
            ? Math.round(Math.abs(lot.price - lot.stop) * matched * lot.parsed.multiplier * 100) / 100
            : null,
        multiplier: lot.parsed.multiplier,
        filledAt: lot.time,
      })
      lot.qty -= matched
      remaining -= matched
      if (lot.qty <= 1e-9) lots.shift()
    }

    // Leftover opposite qty flips / opens short (or long) inventory
    if (remaining > 1e-9) {
      const stopLvl = levelFor(fill.symbolKey, fill.side, 'sl', fill.id)
      const tpLvl = levelFor(fill.symbolKey, fill.side, 'tp', fill.id)
      lots.push({
        id: fill.id,
        side: fill.side,
        qty: remaining,
        price: fill.price,
        time: fill.time,
        stop: stopLvl?.price ?? null,
        target:
          tpLvl?.price ??
          (stopLvl
            ? teamTapeTarget1_5R({ side: fill.side, entry: fill.price, stop: stopLvl.price })
            : null),
        orderType: fill.orderType,
        parsed: fill.parsed,
      })
    }
  }

  return closed
}
