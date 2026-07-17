/**
 * Single source of truth for trade levels — used by BOTH the live chart and
 * the simulation desk so a level means the same thing everywhere:
 * same AI query, same structure fallback, same reasoning carried through.
 *
 * Next-day memory rule: only yesterday's range + overnight matter.
 * Levels are NEVER the obvious session high/low — those are retail bait
 * that big money sweeps. We place at sweep-exhaustion beyond them.
 */

import { hourInTz, SESSION_WINDOWS, type SessionName } from '@/lib/chart/sessionVwap'

export interface DeskLevel {
  level: number
  type: string
  conviction: number
  reasoning?: string
  source: 'ai' | 'structure'
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
  limit: 12,
  minConviction: 5,
} as const

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
 * How far BEYOND an obvious high/low we place the institutional level.
 * Floor = 0.10% of price; also at least ~15% of yesterday's range so
 * London/Asia range extremes get swept before our zone.
 */
export const SWEEP_EXHAUST_PCT = 0.001
export const SWEEP_RANGE_FRAC = 0.15
/**
 * Magnet width around a bait extreme. Anything inside this band is treated
 * as "sitting on the obvious London/Asia high/low" — including retail shorts
 * just under the high and buys just above the low.
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

export function zoneStopPrice(level: number, direction: 'LONG' | 'SHORT'): number {
  const z = levelZone(level)
  const buffer = level * ZONE_STOP_BUFFER_PCT
  return direction === 'LONG' ? z.low - buffer : z.high + buffer
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
    const l = raw as { level?: unknown; type?: unknown; conviction?: unknown; reasoning?: unknown }
    const price = Number(l.level)
    if (!Number.isFinite(price) || price <= 0) continue
    out.push({
      level: price,
      type: String(l.type ?? 'support'),
      conviction: Number(l.conviction) || 5,
      reasoning: typeof l.reasoning === 'string' && l.reasoning.trim() ? l.reasoning : undefined,
      source: 'ai',
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

function sweepDepth(price: number, rangeHi: number, rangeLo: number): number {
  const fromPct = price * SWEEP_EXHAUST_PCT
  const fromRange = Math.max(0, rangeHi - rangeLo) * SWEEP_RANGE_FRAC
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

/** Which desk session a bar belongs to (NY clock — same as chart boxes). */
function sessionOfBar(unix: number): SessionName | null {
  const h = hourInTz(unix, SESSION_WINDOWS.Asia.tz)
  const asia = SESSION_WINDOWS.Asia
  const lon = SESSION_WINDOWS.London
  const ny = SESSION_WINDOWS['New York']
  // Asia crosses midnight: 18 → 24 and 0 → 3
  if (h >= asia.start || h < asia.end) return 'Asia'
  if (h >= lon.start && h < lon.end) return 'London'
  if (h >= ny.start && h < ny.end) return 'New York'
  return null
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
 * Asia / London / overnight / prior-day highs & lows — the stop clusters
 * desks intentionally run. These are BAIT, not trade entries.
 */
export function collectBaitExtremes(
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York'
): { baits: BaitExtreme[]; yRange: { hi: number; lo: number }; depth: number } | null {
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

  // Session windows on the NY clock (matches chart Asia / London boxes)
  const lookback = prior.slice(-Math.min(prior.length, 200))
  const bySession = new Map<SessionName, DeskBar[]>()
  for (const c of lookback) {
    const name = sessionOfBar(c.time)
    if (!name) continue
    const list = bySession.get(name) ?? []
    list.push(c)
    bySession.set(name, list)
  }
  for (const name of ['Asia', 'London'] as SessionName[]) {
    const bars = bySession.get(name)
    if (bars && bars.length >= 3) pushRange(bars, name)
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
    sweepDepth(yRange.hi, yRange.hi, yRange.lo),
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
 * Structure levels: NEVER the naked session high/low (Asia/London/NY range
 * extremes are where retail stops cluster — big money runs those on purpose).
 * Place at sweep-exhaustion BEYOND those bait levels + impulse origins.
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

  // One sweep-exhaustion short zone ABOVE each distinct bait high
  for (const b of baits.filter((x) => x.kind === 'high')) {
    const px = roundPx(b.price + depth)
    if (!take(px)) continue
    levels.push({
      level: px,
      type: 'resistance',
      conviction: b.label.includes('London') || b.label.includes('Asia') ? 9 : 8,
      reasoning: `Sweep-exhaustion ABOVE ${b.label} ${roundPx(b.price)} — stops above get run on purpose; real supply sits ~${roundPx(depth)} beyond the bait.`,
      source: 'structure',
    })
  }

  // One sweep-exhaustion long zone BELOW each distinct bait low
  for (const b of baits.filter((x) => x.kind === 'low')) {
    const px = roundPx(b.price - depth)
    if (!take(px)) continue
    levels.push({
      level: px,
      type: 'support',
      conviction: b.label.includes('London') || b.label.includes('Asia') ? 9 : 8,
      reasoning: `Sweep-exhaustion BELOW ${b.label} ${roundPx(b.price)} — liquidity grab under the range then reverse; demand sits ~${roundPx(depth)} beyond.`,
      source: 'structure',
    })
  }

  // Cap to strongest 2R + 2S from bait sweeps (avoid chart clutter)
  const resists = levels
    .filter((l) => l.type === 'resistance')
    .sort((a, b) => b.conviction - a.conviction || a.level - b.level)
    .slice(0, 2)
  const supports = levels
    .filter((l) => l.type === 'support')
    .sort((a, b) => b.conviction - a.conviction || b.level - a.level)
    .slice(0, 2)
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
 * If AI returned a level glued to an obvious Asia/London/prior high/low,
 * nudge it to sweep exhaustion beyond that bait — same rule as structure.
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
        reasoning: `${l.reasoning ? l.reasoning + ' · ' : ''}Nudged ABOVE ${bait.label} ${roundPx(bait.price)} — shorts AFTER the stop-run, not at the obvious session high.`,
      }
    }

    const nudged = roundPx(bait.price - depth)
    if (Math.abs(nudged - l.level) < bait.price * BAIT_DEDUP_PCT) return l
    return {
      ...l,
      level: nudged,
      reasoning: `${l.reasoning ? l.reasoning + ' · ' : ''}Nudged BELOW ${bait.label} ${roundPx(bait.price)} — longs AFTER the liquidity grab, not at the obvious range low.`,
    }
  })
}

/**
 * Shared resolution: AI when available (de-obvioused), else structure sweep zones.
 * Final pass drops anything still glued to bait after nudge (wrong type / edge case).
 */
export function resolveDeskLevels(
  aiRows: unknown[],
  candles: DeskBar[],
  openUnix: number,
  timeZone: string = 'America/New_York'
): { levels: DeskLevel[]; source: 'ai' | 'structure' } {
  const ai = mapAiLevels(aiRows)
  if (ai.length > 0) {
    const nudged = deObviousLevels(ai, candles, openUnix, timeZone)
    return {
      levels: dropResidualBait(nudged, candles, openUnix, timeZone),
      source: 'ai',
    }
  }
  return {
    levels: structureLevelsFromCandles(candles, openUnix, timeZone),
    source: 'structure',
  }
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
