/**
 * Read-only Questrade order book — pair fills with SL/TP, flag working limits.
 * Stocks and options. Never places or cancels.
 */

import { isTeamTapeSymbol, parseTeamTapeSide, type TeamTapeSide } from '@/lib/trading/teamTape'

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

function orderStamp(raw: QuestradeRawOrder): string | null {
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
  return {
    sourceId: String(raw.id ?? `${parsed.key}-${kind}-${price}`),
    symbol: parsed.key,
    label: parsed.label,
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
    want: 'sl' | 'tp'
  }
): QuestradeProtectiveLevel | null {
  const opp = args.entrySide === 'BUY' ? 'SELL' : 'BUY'
  const ranked = levels
    .filter((l) => l.kind === args.want && l.symbol === args.symbol && l.side === opp)
    .map((l) => {
      let score = 0
      if (l.status === 'working') score += 80
      else if (l.status === 'filled') score += 40
      else score += 15
      if (args.entryId && l.parentId === args.entryId) score += 30
      if (args.groupId && l.orderGroupId === args.groupId) score += 30
      const t = l.updatedAt ? Date.parse(l.updatedAt) : 0
      score += Number.isFinite(t) ? Math.min(10, t / 1e13) : 0
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
    const entryPx = orderPrice(entry)
    const qty = Number(entry.totalQuantity || entry.openQuantity || 0)
    if (!parsed || !side || !entryPx || !(qty > 0)) return null
    const sl = pickLevel(levels, {
      symbol: parsed.key,
      entrySide: side,
      entryId: entry.id != null ? String(entry.id) : null,
      groupId: groupKey(entry),
      want: 'sl',
    })
    const tp = pickLevel(levels, {
      symbol: parsed.key,
      entrySide: side,
      entryId: entry.id != null ? String(entry.id) : null,
      groupId: groupKey(entry),
      want: 'tp',
    })
    const stop = sl?.price ?? null
    const target = tp?.price ?? null
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
  const openFromFills = new Map<string, QuestradeBookRow>()

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

  history.sort((a, b) => String(b.filledAt || '').localeCompare(String(a.filledAt || '')))
  return {
    workingLimits,
    openPositions: [...openFromFills.values()],
    history,
    levels: visibleLevels,
  }
}
