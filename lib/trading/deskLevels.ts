/**
 * Single source of truth for trade levels — used by BOTH the live chart and
 * the simulation desk so a level means the same thing everywhere:
 * same AI query, same structure fallback, same reasoning carried through.
 *
 * LIQUIDITY MODEL (non-negotiable):
 * Big money enters WHERE RETAIL PUTS STOPS — not at the obvious buy/sell
 * lines retail uses. Retail buys support → stops sit BELOW it; retail
 * shorts resistance → stops sit ABOVE it. Desks hunt that stop liquidity
 * to fill size. Our levels = those stop pools (just beyond Asia/London/
 * prior-day extremes), never the bait extremes themselves.
 *
 * Next-day memory: only yesterday's range + overnight matter.
 */

import { deskSessionAt, type SessionName } from '@/lib/chart/sessionVwap'

export type LevelSide = 'BUY' | 'SHORT'
/** Overnight / regime lean used to pick the morning focus side */
export type DeskBias = 'bullish' | 'bearish' | 'none'

export interface DeskLevel {
  level: number
  type: string
  conviction: number
  reasoning?: string
  source: 'ai' | 'structure'
  /** Set by buildDeskPlaybook */
  side?: LevelSide
  /** primary = trade first; watch = only if primary fails / late */
  rank?: 'primary' | 'watch'
  /** Market reaction from rule grading (live chart cadence) */
  marketVerdict?: 'respected' | 'contested' | 'broken' | 'untested'
  marketOutcome?: 'held' | 'broke' | 'untested'
  testedCount?: number
  successCount?: number
}

export interface DeskPlaybook {
  focusSide: LevelSide | 'BOTH'
  focusHint: string
  primaryBuy: DeskLevel | null
  primaryShort: DeskLevel | null
  /** Max 4: 1 primary BUY + 1 primary SHORT + up to 1 watch each */
  levels: DeskLevel[]
}

export interface DeskBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Identical AI-history query for live and sim.
 * days=1: only yesterday's session levels matter for the next day —
 * older history is discarded; structure fallback covers prior range + overnight.
 */
export const AI_LEVELS_QUERY = {
  days: 1,
  limit: 6,
  /** Raise floor so weak history levels do not clutter the morning desk */
  minConviction: 7,
} as const

export function levelSide(type: string): LevelSide {
  return String(type).toLowerCase().includes('resist') ? 'SHORT' : 'BUY'
}

/** Conviction 1–10 → 1–5 stars for UI */
export function convictionStars(conviction: number): { stars: number; label: string } {
  const stars = Math.max(1, Math.min(5, Math.round((Number(conviction) || 5) / 2)))
  return { stars, label: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}` }
}

/**
 * Morning desk playbook: pick ONE best BUY and ONE best SHORT (by conviction + bias),
 * plus at most one watch level per side. Do not bet 4–5 levels — trade the primary.
 */
export function buildDeskPlaybook(
  levels: DeskLevel[],
  bias: DeskBias = 'none'
): DeskPlaybook {
  const buys = levels
    .filter((l) => levelSide(l.type) === 'BUY')
    .map((l) => ({
      ...l,
      side: 'BUY' as const,
      score: scoreLevel(l, bias, 'BUY'),
    }))
    .sort((a, b) => b.score - a.score || b.conviction - a.conviction)

  const shorts = levels
    .filter((l) => levelSide(l.type) === 'SHORT')
    .map((l) => ({
      ...l,
      side: 'SHORT' as const,
      score: scoreLevel(l, bias, 'SHORT'),
    }))
    .sort((a, b) => b.score - a.score || b.conviction - a.conviction)

  const primaryBuy = buys[0]
    ? { ...stripScore(buys[0]), side: 'BUY' as const, rank: 'primary' as const }
    : null
  const primaryShort = shorts[0]
    ? { ...stripScore(shorts[0]), side: 'SHORT' as const, rank: 'primary' as const }
    : null
  const watchBuy = buys[1]
    ? { ...stripScore(buys[1]), side: 'BUY' as const, rank: 'watch' as const }
    : null
  const watchShort = shorts[1]
    ? { ...stripScore(shorts[1]), side: 'SHORT' as const, rank: 'watch' as const }
    : null

  let focusSide: LevelSide | 'BOTH' = 'BOTH'
  let focusHint =
    'No overnight lean — pick the higher-star primary that price reaches first.'
  if (bias === 'bullish') {
    focusSide = 'BUY'
    focusHint =
      'Overnight lean LONG — prioritize the PRIMARY BUY. SHORT is only a watch if the bid fails.'
  } else if (bias === 'bearish') {
    focusSide = 'SHORT'
    focusHint =
      'Overnight lean SHORT — prioritize the PRIMARY SHORT. BUY is only a watch if the offer fails.'
  }

  const ordered: DeskLevel[] = []
  if (focusSide === 'BUY') {
    if (primaryBuy) ordered.push(primaryBuy)
    if (primaryShort) ordered.push(primaryShort)
  } else if (focusSide === 'SHORT') {
    if (primaryShort) ordered.push(primaryShort)
    if (primaryBuy) ordered.push(primaryBuy)
  } else {
    // Higher conviction primary first
    const primaries = [primaryBuy, primaryShort].filter(Boolean) as DeskLevel[]
    primaries.sort((a, b) => (b.conviction || 0) - (a.conviction || 0))
    ordered.push(...primaries)
  }
  if (watchBuy) ordered.push(watchBuy)
  if (watchShort) ordered.push(watchShort)

  return {
    focusSide,
    focusHint,
    primaryBuy,
    primaryShort,
    levels: ordered.slice(0, 4),
  }
}

function scoreLevel(l: DeskLevel, bias: DeskBias, side: LevelSide): number {
  let score = (Number(l.conviction) || 5) * 10
  if (bias === 'bullish' && side === 'BUY') score += 20
  if (bias === 'bearish' && side === 'SHORT') score += 20
  if (bias === 'bullish' && side === 'SHORT') score -= 8
  if (bias === 'bearish' && side === 'BUY') score -= 8
  const why = (l.reasoning || '').toLowerCase()
  if (why.includes('london') || why.includes('asia')) score += 8
  if (l.source === 'ai') score += 4
  if (l.rank === 'primary') score += 2
  return score
}

function stripScore<T extends DeskLevel & { score?: number }>(l: T): DeskLevel {
  const { score: _s, ...rest } = l
  return rest
}

/**
 * A level is a ZONE, not a line. Entry executes at the level price (the
 * defended edge — consistent execution), but risk is judged on the zone:
 * the stop sits beyond the far edge so a liquidity sweep through the level
 * doesn't knock you out before the real move.
 */
export const LEVEL_ZONE_PCT = 0.0012
/** Extra buffer past the zone edge for the stop (sweep exhaust room). */
export const ZONE_STOP_BUFFER_PCT = 0.001

/**
 * How far into the retail STOP POOL (past the obvious high/low) we place
 * the institutional entry. Stops cluster just beyond the bait — that is
 * the liquidity desks hunt. Floor ≈ 0.065% of price; also ≥ ~8% of
 * yesterday's range (typical wick-through on indices).
 */
export const LIQUIDITY_OFFSET_PCT = 0.00065
export const LIQUIDITY_RANGE_FRAC = 0.08
/** @deprecated use LIQUIDITY_OFFSET_PCT — kept for any external imports */
export const SWEEP_EXHAUST_PCT = LIQUIDITY_OFFSET_PCT
/** @deprecated use LIQUIDITY_RANGE_FRAC */
export const SWEEP_RANGE_FRAC = LIQUIDITY_RANGE_FRAC
/**
 * Magnet width around a bait extreme. Anything inside this band is treated
 * as "sitting on the obvious London/Asia high/low" (retail ENTRY), not the
 * stop pool beyond it where institutions enter.
 */
export const OBVIOUS_LEVEL_TOL_PCT = 0.0018
/** Merge two bait extremes / levels closer than this fraction of price. */
export const BAIT_DEDUP_PCT = 0.00035

export interface LevelZone {
  low: number
  high: number
  width: number
}

export function levelZone(level: number): LevelZone {
  const half = level * LEVEL_ZONE_PCT
  return { low: level - half, high: level + half, width: half * 2 }
}

/** Index / FX-aware psychological handles (kept local to avoid import cycles). */
function roundNumberSteps(price: number): number[] {
  if (price >= 5000) return [50, 100, 250, 500]
  if (price >= 200) return [1, 5, 10, 25, 50]
  if (price >= 20) return [0.25, 0.5, 1, 5]
  if (price >= 1) return [0.01, 0.05, 0.1, 0.25]
  return [0.0001, 0.0005, 0.001]
}

/**
 * Soft-extend a protective stop so it sits just beyond a nearby psychological
 * round (00 / 50 / big figure). Never pulls the stop tighter.
 */
export function extendStopPastRound(
  stop: number,
  direction: 'LONG' | 'SHORT',
  refPrice: number
): number {
  if (!(stop > 0) || !(refPrice > 0)) return stop
  let best = stop
  const maxExtendPct = 0.0012 // ≤0.12% further past the round
  for (const step of roundNumberSteps(refPrice)) {
    const epsilon = Math.max(step * 0.02, refPrice * 0.00005)
    if (direction === 'LONG') {
      // Park stop just under the round at/below the raw stop
      const magnet = Math.floor(stop / step) * step
      if (magnet <= 0) continue
      const candidate = magnet - epsilon
      if (candidate >= stop) continue
      const extendPct = (stop - candidate) / refPrice
      if (extendPct > 0 && extendPct <= maxExtendPct && candidate < best) best = candidate
    } else {
      // Park stop just above the round at/above the raw stop
      const magnet = Math.ceil(stop / step) * step
      const candidate = magnet + epsilon
      if (candidate <= stop) continue
      const extendPct = (candidate - stop) / refPrice
      if (extendPct > 0 && extendPct <= maxExtendPct && candidate > best) best = candidate
    }
  }
  return best
}

/** Soft-snap a take-profit toward the nearest round without shrinking RR below 1.5R. */
export function snapProfitToRound(
  entry: number,
  stop: number,
  target: number,
  direction: 'LONG' | 'SHORT'
): number {
  if (!(entry > 0) || !(target > 0)) return target
  const risk = Math.abs(entry - stop)
  if (!(risk > 0)) return target
  const minReward = risk * 1.5
  let best = target
  let bestDist = Infinity
  for (const step of roundNumberSteps(entry)) {
    const nearest = Math.round(target / step) * step
    for (const candidate of [nearest, nearest - step, nearest + step]) {
      if (candidate <= 0) continue
      if (direction === 'LONG') {
        if (candidate <= entry) continue
        if (candidate - entry < minReward) continue
      } else {
        if (candidate >= entry) continue
        if (entry - candidate < minReward) continue
      }
      const dist = Math.abs(candidate - target)
      if (dist / entry > 0.0025) continue // only soft-snap within 0.25%
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
  }
  return best
}

export function zoneStopPrice(level: number, direction: 'LONG' | 'SHORT'): number {
  const z = levelZone(level)
  const buffer = level * ZONE_STOP_BUFFER_PCT
  const raw = direction === 'LONG' ? z.low - buffer : z.high + buffer
  return extendStopPastRound(raw, direction, level)
}

export function formatZone(level: number): string {
  const z = levelZone(level)
  const f = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return `${f(z.low)}–${f(z.high)}`
}

export function aiLevelsUrl(instrument: string): string {
  const q = AI_LEVELS_QUERY
  return `/api/levels/history?instrument=${instrument}&days=${q.days}&limit=${q.limit}&min_conviction=${q.minConviction}`
}

export function mapAiLevels(rows: unknown[]): DeskLevel[] {
  const out: DeskLevel[] = []
  for (const raw of rows ?? []) {
    const l = raw as {
      level?: unknown
      type?: unknown
      conviction?: unknown
      reasoning?: unknown
      last_verdict?: unknown
      last_outcome?: unknown
      tested_count?: unknown
      success_count?: unknown
    }
    const price = Number(l.level)
    if (!Number.isFinite(price) || price <= 0) continue
    const verdictRaw = String(l.last_verdict || '')
    const outcomeRaw = String(l.last_outcome || '')
    const marketVerdict =
      verdictRaw === 'respected' ||
      verdictRaw === 'contested' ||
      verdictRaw === 'broken' ||
      verdictRaw === 'untested'
        ? verdictRaw
        : undefined
    const marketOutcome =
      outcomeRaw === 'held' || outcomeRaw === 'broke' || outcomeRaw === 'untested'
        ? outcomeRaw
        : undefined
    out.push({
      level: price,
      type: String(l.type ?? 'support'),
      conviction: Number(l.conviction) || 5,
      reasoning: typeof l.reasoning === 'string' && l.reasoning.trim() ? l.reasoning : undefined,
      source: 'ai',
      marketVerdict,
      marketOutcome,
      testedCount: Number.isFinite(Number(l.tested_count)) ? Number(l.tested_count) : undefined,
      successCount: Number.isFinite(Number(l.success_count)) ? Number(l.success_count) : undefined,
    })
  }
  return out
}

function dateInTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function rangeOf(bars: DeskBar[]): { hi: number; lo: number } | null {
  if (bars.length === 0) return null
  let hi = -Infinity
  let lo = Infinity
  for (const c of bars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return null
  return { hi, lo }
}

/** Distance from bait extreme into the retail stop / liquidity pool. */
function liquidityDepth(price: number, rangeHi: number, rangeLo: number): number {
  const fromPct = price * LIQUIDITY_OFFSET_PCT
  const fromRange = Math.max(0, rangeHi - rangeLo) * LIQUIDITY_RANGE_FRAC
  return Math.max(fromPct, fromRange)
}

function roundPx(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Measure typical wick extension past prior swing in recent bars —
 * used as a floor for sweep depth when available.
 */
function recentSweepWickDepth(bars: DeskBar[]): number {
  if (bars.length < 8) return 0
  const slice = bars.slice(-40)
  const depths: number[] = []
  for (let i = 2; i < slice.length; i++) {
    const a = slice[i - 2]!
    const b = slice[i - 1]!
    const c = slice[i]!
    const priorHi = Math.max(a.high, b.high)
    if (c.high > priorHi && c.close < priorHi) {
      depths.push(c.high - priorHi)
    }
    const priorLo = Math.min(a.low, b.low)
    if (c.low < priorLo && c.close > priorLo) {
      depths.push(priorLo - c.low)
    }
  }
  if (depths.length === 0) return 0
  depths.sort((x, y) => x - y)
  return depths[Math.floor(depths.length * 0.6)] ?? 0
}

/** Which desk session a bar belongs to — same classifier as chart color bands. */
function sessionOfBar(unix: number, instrument?: string | null): SessionName | null {
  return deskSessionAt(unix, instrument)
}

export interface BaitExtreme {
  price: number
  kind: 'high' | 'low'
  label: string
}

function dedupeBaits(baits: BaitExtreme[], refPrice: number): BaitExtreme[] {
  const tol = refPrice * BAIT_DEDUP_PCT
  const sorted = [...baits].sort((a, b) => a.price - b.price)
  const out: BaitExtreme[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.price - b.price) <= tol && last.kind === b.kind) {
      // Keep the more extreme of the two
      if (b.kind === 'high' && b.price > last.price) out[out.length - 1] = b
      if (b.kind === 'low' && b.price < last.price) out[out.length - 1] = b
      continue
    }
    out.push(b)
  }
  return out
}

/**
 * Asia / London / overnight / prior-day highs & lows — retail ENTRY bait.
 * Retail stops sit just beyond these. Desks hunt those stops for liquidity;
 * the bait extremes themselves are NOT our entries.
 */
export function collectBaitExtremes(
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York',
  instrument?: string | null
): { baits: BaitExtreme[]; yRange: { hi: number; lo: number }; depth: number } | null {
  const deskInstrument =
    instrument ?? (timeZone === 'Asia/Tokyo' ? 'NIKKEI' : null)
  const prior = candles.filter((c) => c.time < openUnix)
  if (prior.length < 10) return null

  const openDate = dateInTz(openUnix, timeZone)
  const lastPriorDate = (() => {
    for (let i = prior.length - 1; i >= 0; i--) {
      const d = dateInTz(prior[i]!.time, timeZone)
      if (d !== openDate) return d
    }
    return dateInTz(prior[prior.length - 1]!.time, timeZone)
  })()

  const yesterdayBars = prior.filter((c) => dateInTz(c.time, timeZone) === lastPriorDate)
  const yesterdayLast = yesterdayBars[yesterdayBars.length - 1]?.time ?? 0
  const overnightBars = prior.filter((c) => c.time > yesterdayLast && c.time < openUnix)
  const sessionBars = yesterdayBars.length >= 5 ? yesterdayBars : prior.slice(-78)
  const yRange = rangeOf(sessionBars)
  if (!yRange) return null

  const baits: BaitExtreme[] = []
  const pushRange = (
    bars: DeskBar[],
    label: string,
    kinds: Array<'high' | 'low'> = ['high', 'low']
  ) => {
    const r = rangeOf(bars)
    if (!r) return
    if (kinds.includes('high')) baits.push({ price: r.hi, kind: 'high', label: `${label} high` })
    if (kinds.includes('low')) baits.push({ price: r.lo, kind: 'low', label: `${label} low` })
  }

  pushRange(sessionBars, 'prior day')
  if (overnightBars.length >= 3) pushRange(overnightBars, 'overnight')

  // Session windows — Tokyo clock for NIKKEI, NY clock for DOW/NASDAQ (matches chart bands)
  const lookback = prior.slice(-Math.min(prior.length, 200))
  const bySession = new Map<SessionName, DeskBar[]>()
  for (const c of lookback) {
    const name = sessionOfBar(c.time, deskInstrument)
    if (!name) continue
    const list = bySession.get(name) ?? []
    list.push(c)
    bySession.set(name, list)
  }
  for (const name of ['Asia', 'London'] as SessionName[]) {
    const bars = bySession.get(name)
    if (bars && bars.length >= 3) {
      const label = deskInstrument === 'NIKKEI' && name === 'Asia' ? 'Tokyo' : name
      pushRange(bars, label)
    }
  }

  // Equal highs / equal lows clusters (within ~0.04%) — classic stop magnet
  const eqTol = yRange.hi * 0.0004
  const highs = lookback.map((c) => c.high).sort((a, b) => b - a)
  const lows = lookback.map((c) => c.low).sort((a, b) => a - b)
  for (let i = 0; i < highs.length - 1; i++) {
    if (Math.abs(highs[i]! - highs[i + 1]!) <= eqTol) {
      baits.push({
        price: Math.max(highs[i]!, highs[i + 1]!),
        kind: 'high',
        label: 'equal highs',
      })
      break
    }
  }
  for (let i = 0; i < lows.length - 1; i++) {
    if (Math.abs(lows[i]! - lows[i + 1]!) <= eqTol) {
      baits.push({
        price: Math.min(lows[i]!, lows[i + 1]!),
        kind: 'low',
        label: 'equal lows',
      })
      break
    }
  }

  const depth = Math.max(
    liquidityDepth(yRange.hi, yRange.hi, yRange.lo),
    recentSweepWickDepth(sessionBars)
  )

  return {
    baits: dedupeBaits(baits, yRange.hi),
    yRange,
    depth,
  }
}

function nearestBait(
  price: number,
  baits: BaitExtreme[],
  kind: 'high' | 'low',
  tol: number
): BaitExtreme | null {
  let best: BaitExtreme | null = null
  let bestDist = Infinity
  for (const b of baits) {
    if (b.kind !== kind) continue
    const dist = Math.abs(price - b.price)
    // Resistance: also catch levels sitting just UNDER the bait high (retail short)
    // Support: also catch levels sitting just ABOVE the bait low (retail buy)
    const inMagnet =
      kind === 'high'
        ? price <= b.price + tol * 0.35 && price >= b.price - tol
        : price >= b.price - tol * 0.35 && price <= b.price + tol
    if (!inMagnet) continue
    if (dist < bestDist) {
      bestDist = dist
      best = b
    }
  }
  return best
}

/**
 * Structure levels = retail STOP POOLS (liquidity), not retail entries.
 * Retail shorts at the high → stops ABOVE → institutions sell into that pool.
 * Retail buys at the low → stops BELOW → institutions buy into that pool.
 */
export function structureLevelsFromCandles(
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York'
): DeskLevel[] {
  const ctx = collectBaitExtremes(candles, openUnix, timeZone)
  if (!ctx) return []

  const { baits, yRange, depth } = ctx
  const levels: DeskLevel[] = []
  const used: number[] = []

  const take = (price: number): boolean => {
    const tol = price * BAIT_DEDUP_PCT
    if (used.some((u) => Math.abs(u - price) <= tol)) return false
    used.push(price)
    return true
  }

  // SHORT liquidity: retail stop cluster ABOVE each bait high
  for (const b of baits.filter((x) => x.kind === 'high')) {
    const px = roundPx(b.price + depth)
    if (!take(px)) continue
    levels.push({
      level: px,
      type: 'resistance',
      conviction: b.label.includes('London') || b.label.includes('Asia') ? 9 : 8,
      reasoning: `Liquidity ABOVE ${b.label} ${roundPx(b.price)} — retail shorts park stops here; big money sells into that stop pool (~${roundPx(depth)} past the bait), not at the obvious high.`,
      source: 'structure',
    })
  }

  // LONG liquidity: retail stop cluster BELOW each bait low
  for (const b of baits.filter((x) => x.kind === 'low')) {
    const px = roundPx(b.price - depth)
    if (!take(px)) continue
    levels.push({
      level: px,
      type: 'support',
      conviction: b.label.includes('London') || b.label.includes('Asia') ? 9 : 8,
      reasoning: `Liquidity BELOW ${b.label} ${roundPx(b.price)} — retail longs park stops here; big money buys into that stop pool (~${roundPx(depth)} past the bait), not at the obvious low.`,
      source: 'structure',
    })
  }

  // Cap bait sweeps to strongest 1R + 1S — playbook may keep 1 watch from impulse
  const resists = levels
    .filter((l) => l.type === 'resistance')
    .sort((a, b) => b.conviction - a.conviction || a.level - b.level)
    .slice(0, 1)
  const supports = levels
    .filter((l) => l.type === 'support')
    .sort((a, b) => b.conviction - a.conviction || b.level - a.level)
    .slice(0, 1)
  const trimmed = [...resists, ...supports]
  used.length = 0
  for (const l of trimmed) used.push(l.level)

  // Unmitigated impulse origin (largest up-bar / down-bar in prior session)
  const prior = candles.filter((c) => c.time < openUnix)
  const openDate = dateInTz(openUnix, timeZone)
  let lastPriorDate = openDate
  for (let i = prior.length - 1; i >= 0; i--) {
    const d = dateInTz(prior[i]!.time, timeZone)
    if (d !== openDate) {
      lastPriorDate = d
      break
    }
  }
  const yesterdayBars = prior.filter((c) => dateInTz(c.time, timeZone) === lastPriorDate)
  const sessionBars = yesterdayBars.length >= 5 ? yesterdayBars : prior.slice(-78)

  let bestUp: DeskBar | null = null
  let bestDown: DeskBar | null = null
  let bestUpSize = 0
  let bestDownSize = 0
  for (const c of sessionBars) {
    const up = c.close - c.open
    const down = c.open - c.close
    if (up > bestUpSize) {
      bestUpSize = up
      bestUp = c
    }
    if (down > bestDownSize) {
      bestDownSize = down
      bestDown = c
    }
  }

  const baitHi = Math.max(...baits.filter((b) => b.kind === 'high').map((b) => b.price), yRange.hi)
  const baitLo = Math.min(...baits.filter((b) => b.kind === 'low').map((b) => b.price), yRange.lo)
  const obviousTol = baitHi * OBVIOUS_LEVEL_TOL_PCT

  if (bestUp && bestUpSize > depth * 0.5) {
    const origin = roundPx(bestUp.low)
    if (Math.abs(origin - baitLo) > obviousTol && take(origin)) {
      trimmed.push({
        level: origin,
        type: 'support',
        conviction: 7,
        reasoning: `Unmitigated demand origin of strongest prior impulse — not the session low; resting bids where the move began.`,
        source: 'structure',
      })
    }
  }
  if (bestDown && bestDownSize > depth * 0.5) {
    const origin = roundPx(bestDown.high)
    if (Math.abs(origin - baitHi) > obviousTol && take(origin)) {
      trimmed.push({
        level: origin,
        type: 'resistance',
        conviction: 7,
        reasoning: `Unmitigated supply origin of strongest prior drop — shorts defend the impulse start, not the obvious session high.`,
        source: 'structure',
      })
    }
  }

  return trimmed
}

/**
 * If AI returned a retail ENTRY (on the obvious high/low), move it to the
 * retail STOP POOL beyond that bait — where institutions enter for liquidity.
 */
export function deObviousLevels(
  levels: DeskLevel[],
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York'
): DeskLevel[] {
  const ctx = collectBaitExtremes(candles, openUnix, timeZone)
  if (!ctx || levels.length === 0) return levels

  const { baits, depth } = ctx
  const tol = ctx.yRange.hi * OBVIOUS_LEVEL_TOL_PCT

  return levels.map((l) => {
    const isRes = String(l.type).toLowerCase().includes('resist')
    const bait = nearestBait(l.level, baits, isRes ? 'high' : 'low', tol)
    if (!bait) return l

    if (isRes) {
      const nudged = roundPx(bait.price + depth)
      if (Math.abs(nudged - l.level) < bait.price * BAIT_DEDUP_PCT) return l
      return {
        ...l,
        level: nudged,
        reasoning: `${l.reasoning ? l.reasoning + ' · ' : ''}Moved to stop liquidity ABOVE ${bait.label} ${roundPx(bait.price)} — big money shorts WHERE retail stops sit, not at the obvious high.`,
      }
    }

    const nudged = roundPx(bait.price - depth)
    if (Math.abs(nudged - l.level) < bait.price * BAIT_DEDUP_PCT) return l
    return {
      ...l,
      level: nudged,
      reasoning: `${l.reasoning ? l.reasoning + ' · ' : ''}Moved to stop liquidity BELOW ${bait.label} ${roundPx(bait.price)} — big money buys WHERE retail stops sit, not at the obvious low.`,
    }
  })
}

/** Cash-open reference: last close before open, else first bar at/after open. */
export function referencePriceAtOpen(
  candles: DeskBar[],
  openUnix: number
): number | null {
  if (!openUnix || candles.length === 0) return null
  let lastBefore: DeskBar | null = null
  let firstAtOrAfter: DeskBar | null = null
  for (const c of candles) {
    if (c.time < openUnix) lastBefore = c
    else if (!firstAtOrAfter) firstAtOrAfter = c
  }
  const px = lastBefore?.close ?? firstAtOrAfter?.open ?? firstAtOrAfter?.close
  return px != null && Number.isFinite(px) && px > 0 ? px : null
}

/**
 * Day-trader geometry only (levels may sit on overnight / London / HTF structure
 * anywhere in the provided candle universe):
 * - SHORT (resistance) must be ABOVE cash-open reference
 * - BUY (support) must be BELOW cash-open reference
 * - Reject invented prices outside the candle high/low band (± pad for stop pools)
 *
 * Does NOT force levels near the open — HTF / London / overnight levels are valid.
 */
export function filterReachableMorningLevels(
  levels: DeskLevel[],
  candles: DeskBar[],
  openUnix: number,
  _timeZone: string = 'America/New_York'
): DeskLevel[] {
  const ref = referencePriceAtOpen(candles, openUnix)
  if (ref == null || levels.length === 0) return levels

  let hi = -Infinity
  let lo = Infinity
  for (const c of candles) {
    if (c.time > openUnix + 3600) continue // ignore far post-open lookahead if present
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) {
    hi = ref * 1.05
    lo = ref * 0.95
  }
  const pad = Math.max((hi - lo) * 0.12, ref * 0.003)

  return levels.filter((l) => {
    if (!Number.isFinite(l.level) || l.level <= 0) return false
    // Hallucination guard: must live in (or just beyond) the chart's price universe
    if (l.level > hi + pad || l.level < lo - pad) return false
    const side = levelSide(l.type)
    if (side === 'SHORT') return l.level > ref
    return l.level < ref
  })
}

/**
 * Shared resolution: AI when available (de-obvioused), else structure sweep zones.
 * Final pass ranks into a morning playbook (1 primary BUY + 1 primary SHORT).
 */
export function resolveDeskLevels(
  aiRows: unknown[],
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York',
  bias: DeskBias = 'none'
): { levels: DeskLevel[]; source: 'ai' | 'structure'; playbook: DeskPlaybook } {
  const structure = structureLevelsFromCandles(candles, openUnix, timeZone)
  const ai = mapAiLevels(aiRows)
  let source: 'ai' | 'structure' = 'structure'
  let raw: DeskLevel[]

  if (ai.length > 0) {
    const nudged = deObviousLevels(ai, candles, openUnix, timeZone)
    const cleaned = dropResidualBait(nudged, candles, openUnix, timeZone)
    const reachable = filterReachableMorningLevels(cleaned, candles, openUnix, timeZone)

    if (reachable.length === 0) {
      raw = structure
      source = 'structure'
    } else {
      // Keep reachable AI levels; fill any missing side from structure
      const hasBuy = reachable.some((l) => levelSide(l.type) === 'BUY')
      const hasShort = reachable.some((l) => levelSide(l.type) === 'SHORT')
      raw = [...reachable]
      if (!hasBuy) {
        raw.push(...structure.filter((l) => levelSide(l.type) === 'BUY'))
      }
      if (!hasShort) {
        raw.push(...structure.filter((l) => levelSide(l.type) === 'SHORT'))
      }
      source = 'ai'
    }
  } else {
    raw = structure
  }

  const playbook = buildDeskPlaybook(raw, bias)
  return { levels: playbook.levels, source, playbook }
}

/** First-hour Initial Balance range (cash open → +ibMinutes). */
export type InitialBalanceRange = {
  high: number
  low: number
  openUnix: number
  endUnix: number
  /** First / last bar times used for short chart segments */
  fromTime: number
  toTime: number
}

/**
 * Compute Initial Balance once the first hour has enough bars.
 * Returns null until IB is shaped (session open + ibMinutes, with ≥2 bars).
 */
export function computeInitialBalance(
  candles: DeskBar[],
  openUnix: number,
  nowUnix: number = Math.floor(Date.now() / 1000),
  ibMinutes = 60
): InitialBalanceRange | null {
  if (!openUnix || candles.length === 0) return null
  const endUnix = openUnix + ibMinutes * 60
  // Not shaped yet — wait until the IB window has closed
  if (nowUnix < endUnix) return null

  const ibBars = candles.filter((c) => c.time >= openUnix && c.time < endUnix)
  if (ibBars.length < 2) return null

  let hi = -Infinity
  let lo = Infinity
  for (const c of ibBars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null

  const fromTime = ibBars[0]!.time as number
  const toTime = ibBars[ibBars.length - 1]!.time as number
  if (!(toTime > fromTime)) return null

  return {
    high: Math.round(hi * 100) / 100,
    low: Math.round(lo * 100) / 100,
    openUnix,
    endUnix,
    fromTime,
    toTime,
  }
}

/** First-hour Initial Balance (cash open → +60m) as watch levels for afternoon. */
export function initialBalanceLevelsFromCandles(
  candles: DeskBar[],
  openUnix: number,
  ibMinutes = 60
): DeskLevel[] {
  const ib = computeInitialBalance(
    candles,
    openUnix,
    Math.floor(Date.now() / 1000),
    ibMinutes
  )
  if (!ib) return []
  return [
    {
      level: ib.high,
      type: 'resistance',
      conviction: 8,
      reasoning: `Initial Balance high (first ${ibMinutes}m) — afternoon watch for break/hold`,
      source: 'structure',
      rank: 'watch',
    },
    {
      level: ib.low,
      type: 'support',
      conviction: 8,
      reasoning: `Initial Balance low (first ${ibMinutes}m) — afternoon watch for break/hold`,
      source: 'structure',
      rank: 'watch',
    },
  ]
}

/** Map morning-review afternoon_levels (FLIP / RETEST) onto DeskLevel rows. */
export function mapAfternoonCandidates(rows: unknown[]): DeskLevel[] {
  if (!Array.isArray(rows)) return []
  const out: DeskLevel[] = []
  for (const raw of rows) {
    const r = raw as Record<string, unknown>
    const level = Number(r.level)
    if (!(level > 0)) continue
    const type = String(r.candidate_type || r.original_type || 'support')
    const play = String(r.play || 'WATCH')
    const note = String(r.note || '')
    out.push({
      level: Math.round(level * 100) / 100,
      type,
      conviction: play === 'FLIP' ? 9 : 8,
      reasoning:
        note ||
        (play === 'FLIP'
          ? 'Morning break — flipped for afternoon watch'
          : 'Morning hold — retest candidate into cash close'),
      source: 'ai',
      rank: play === 'FLIP' ? 'primary' : 'watch',
      marketVerdict: play === 'FLIP' ? 'broken' : 'respected',
      marketOutcome: play === 'FLIP' ? 'broke' : 'held',
    })
  }
  return out
}

function nearPrice(a: number, b: number, tolPct = 0.0008): boolean {
  if (!(a > 0) || !(b > 0)) return false
  return Math.abs(a - b) / b < tolPct
}

/**
 * Afternoon watch playbook: morning reaction candidates + IB + refreshed AI,
 * ranked for viewing only (no trading).
 */
export function resolveAfternoonDeskLevels(
  aiRows: unknown[],
  afternoonCandidates: unknown[],
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York',
  tipPrice: number | null = null
): { levels: DeskLevel[]; source: 'ai' | 'structure'; playbook: DeskPlaybook } {
  const fromReview = mapAfternoonCandidates(afternoonCandidates)
  const ai = mapAiLevels(aiRows)
  const structure = structureLevelsFromCandles(candles, openUnix, timeZone)

  const merged: DeskLevel[] = []
  const pushUnique = (l: DeskLevel) => {
    if (merged.some((m) => nearPrice(m.level, l.level))) return
    merged.push(l)
  }
  for (const l of fromReview) pushUnique(l)
  for (const l of ai) pushUnique(l)
  if (merged.length < 2) {
    for (const l of structure) pushUnique(l)
  }

  const tip =
    tipPrice && tipPrice > 0
      ? tipPrice
      : candles.length
        ? candles[candles.length - 1]!.close
        : null
  const banded =
    tip != null
      ? merged.filter((l) => Math.abs(l.level - tip) / tip <= 0.02)
      : merged
  const raw = banded.length >= 2 ? banded : merged

  const playbook = buildDeskPlaybook(raw, 'none')
  const source: 'ai' | 'structure' =
    fromReview.length > 0 || ai.length > 0 ? 'ai' : 'structure'
  return { levels: playbook.levels, source, playbook }
}

/** Remove levels that still sit on a bait extreme after de-obviousing. */
function dropResidualBait(
  levels: DeskLevel[],
  candles: DeskBar[],
  openUnix: number,
  timeZone: string
): DeskLevel[] {
  const ctx = collectBaitExtremes(candles, openUnix, timeZone)
  if (!ctx) return levels
  const tol = ctx.yRange.hi * OBVIOUS_LEVEL_TOL_PCT * 0.55
  return levels.filter((l) => {
    const isRes = String(l.type).toLowerCase().includes('resist')
    const bait = nearestBait(l.level, ctx.baits, isRes ? 'high' : 'low', tol)
    return !bait
  })
}
