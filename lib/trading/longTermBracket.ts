/**
 * Long-term auction region (Dalton bracket vs trend).
 * Advise only. Does not pick CALL side, stretch 1.5R, or auto-flatten.
 *
 * Body = 70% TPO composite of the last 5 completed NY cash days.
 * Location = last print vs that body (high / mid / low).
 * TREND only after today's developing value is fully outside the body.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import { tpoTickSize } from '@/lib/trading/yesterdayProfile'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'

export type RegionMode = 'BRACKET' | 'TREND' | 'WAIT'
export type RegionLocation = 'high' | 'mid' | 'low'
export type RegionAcceptance = 'INSIDE' | 'REJECTED' | 'ACCEPTED'

export type RegionBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type LongTermRegion = {
  instrument: string
  ready: boolean
  mode: RegionMode
  location: RegionLocation | null
  acceptance: RegionAcceptance | null
  /** 70% TPO body high (not the tail) */
  high: number | null
  /** 70% TPO body low (not the tail) */
  low: number | null
  days: number
  firstLegalOnly: boolean
  badgeText: string
  playLine: string
}

export const REGION_COLORS = {
  high: '#71717a',
  low: '#71717a',
} as const

const EPS = 1e-8
const COMPOSITE_DAYS = 5
const MIN_DAYS = 3
const TPO_PERIOD_SEC = 30 * 60
const VALUE_AREA_FRAC = 0.7

function px(n: number): number {
  return Math.round(n * 100) / 100
}

function dayKey(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function cashCloseUnixForYmd(ymd: string, clock: DeskClock): number {
  return zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
}

function waiting(instrument: string, extra?: Partial<LongTermRegion>): LongTermRegion {
  const p: LongTermRegion = {
    instrument,
    ready: false,
    mode: 'WAIT',
    location: extra?.location ?? null,
    acceptance: extra?.acceptance ?? null,
    high: extra?.high ?? null,
    low: extra?.low ?? null,
    days: extra?.days ?? 0,
    firstLegalOnly: false,
    badgeText: 'WAIT',
    playLine:
      extra?.playLine ??
      'REGION WAIT — not enough completed cash days for a 5-day TPO body. CALL unchanged. Ticket stays 1.5R.',
  }
  p.badgeText = deskRegionBadgeText(p)
  return p
}

export function deskRegionBadgeText(p: LongTermRegion): string {
  if (!p.ready || p.mode === 'WAIT') return 'WAIT'
  if (p.mode === 'TREND') return 'TREND · with'
  const loc = p.location ?? 'mid'
  if (p.acceptance === 'REJECTED') return `BRACKET · ${loc}`
  return `BRACKET · ${loc}`
}

type RthDay = { ymd: string; openU: number; closeU: number }

function collectRthDays(candles: RegionBar[], clock: DeskClock): RthDay[] {
  const seen = new Map<string, RthDay>()
  for (const c of candles) {
    const ymd = dayKey(c.time, clock.timeZone)
    if (!isWeekdayYmd(ymd, clock.timeZone)) continue
    if (!seen.has(ymd)) {
      const openU = cashOpenUnixForYmd(ymd, clock)
      const closeU = cashCloseUnixForYmd(ymd, clock)
      if (closeU > openU) seen.set(ymd, { ymd, openU, closeU })
    }
  }
  return Array.from(seen.values())
    .filter((d) => candles.some((c) => c.time >= d.openU && c.time < d.closeU))
    .sort((a, b) => a.openU - b.openU)
}

function bucketPrice(price: number, tick: number): number {
  return Math.round(price / tick) * tick
}

function compositeBody(
  candles: RegionBar[],
  days: RthDay[]
): { vah: number; val: number; yh: number; yl: number } | null {
  let yh = -Infinity
  let yl = Infinity
  const sessionBars: Array<{ day: RthDay; bar: RegionBar }> = []
  for (const d of days) {
    for (const c of candles) {
      if (c.time < d.openU || c.time >= d.closeU) continue
      sessionBars.push({ day: d, bar: c })
      if (c.high > yh) yh = c.high
      if (c.low < yl) yl = c.low
    }
  }
  if (sessionBars.length < 12 || !(yh > yl)) return null
  const tick = tpoTickSize((yh + yl) / 2)
  if (!(tick > 0)) return null

  const tpos = new Map<number, number>()
  for (const d of days) {
    const periods = new Map<number, { high: number; low: number }>()
    for (const c of candles) {
      if (c.time < d.openU || c.time >= d.closeU) continue
      const idx = Math.floor((c.time - d.openU) / TPO_PERIOD_SEC)
      const prev = periods.get(idx)
      if (!prev) periods.set(idx, { high: c.high, low: c.low })
      else {
        prev.high = Math.max(prev.high, c.high)
        prev.low = Math.min(prev.low, c.low)
      }
    }
    for (const p of periods.values()) {
      const start = bucketPrice(p.low, tick)
      const end = bucketPrice(p.high, tick)
      const steps = Math.max(0, Math.round((end - start) / tick))
      const capped = Math.min(steps, 4000)
      for (let i = 0; i <= capped; i++) {
        const k = bucketPrice(start + i * tick, tick)
        tpos.set(k, (tpos.get(k) ?? 0) + 1)
      }
    }
  }
  if (tpos.size < 3) return null
  const rows = Array.from(tpos.entries())
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price)
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (total < 8) return null
  const mid = (yh + yl) / 2
  let pocIdx = 0
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i]!
    const best = rows[pocIdx]!
    if (
      cur.count > best.count ||
      (cur.count === best.count &&
        Math.abs(cur.price - mid) < Math.abs(best.price - mid))
    ) {
      pocIdx = i
    }
  }
  const target = total * VALUE_AREA_FRAC
  let lo = pocIdx
  let hi = pocIdx
  let covered = rows[pocIdx]!.count
  while (covered < target && (lo > 0 || hi < rows.length - 1)) {
    const up = hi < rows.length - 1 ? rows[hi + 1]!.count : -1
    const down = lo > 0 ? rows[lo - 1]!.count : -1
    if (up < 0 && down < 0) break
    if (up >= down) {
      hi += 1
      covered += rows[hi]!.count
    } else {
      lo -= 1
      covered += rows[lo]!.count
    }
  }
  const val = px(rows[lo]!.price)
  const vah = px(rows[hi]!.price)
  if (!(vah > val)) return null
  return { vah, val, yh: px(yh), yl: px(yl) }
}

function todayBody(
  candles: RegionBar[],
  openU: number,
  asOfUnix: number
): { vah: number; val: number } | null {
  if (asOfUnix < openU + 20 * 60) return null
  const day: RthDay = {
    ymd: 'today',
    openU,
    closeU: asOfUnix,
  }
  const va = compositeBody(candles, [day])
  if (!va) return null
  return { vah: va.vah, val: va.val }
}

function locate(
  price: number,
  vah: number,
  val: number
): RegionLocation {
  if (price >= vah - EPS) return 'high'
  if (price <= val + EPS) return 'low'
  return 'mid'
}

export function computeLongTermRegion(args: {
  instrument: string
  candles: RegionBar[]
  asOfUnix: number
  playbookMode?: DeskPlaybookMode | null
  attemptsUsed?: number
  lastPrice?: number | null
}): LongTermRegion {
  const instrument = String(args.instrument || '')
  if (!Number.isFinite(args.asOfUnix) || !instrument) {
    return waiting(instrument)
  }
  const candles = (Array.isArray(args.candles) ? args.candles : []).filter(
    (c) => c && Number.isFinite(c.time) && c.time <= args.asOfUnix
  )
  const clock = deskClockFor(instrument)
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) return waiting(instrument)

  const todayOpen = cashOpenUnixForYmd(ymd, clock)
  const days = collectRthDays(candles, clock).filter((d) => d.openU < todayOpen)
  const last5 = days.slice(-COMPOSITE_DAYS)
  if (last5.length < MIN_DAYS) {
    return waiting(instrument, { days: last5.length })
  }

  const body = compositeBody(candles, last5)
  if (!body) return waiting(instrument, { days: last5.length })

  const tip =
    args.lastPrice != null && Number.isFinite(args.lastPrice)
      ? args.lastPrice
      : (() => {
          const last = candles[candles.length - 1]
          return last?.close ?? (body.vah + body.val) / 2
        })()

  const location = locate(tip, body.vah, body.val)
  const todayVa = todayBody(candles, todayOpen, args.asOfUnix)
  let acceptance: RegionAcceptance = 'INSIDE'
  let mode: RegionMode = 'BRACKET'
  if (todayVa) {
    const acceptedHigh = todayVa.val >= body.vah - EPS
    const acceptedLow = todayVa.vah <= body.val + EPS
    if (acceptedHigh || acceptedLow) {
      acceptance = 'ACCEPTED'
      mode = 'TREND'
    } else if (location !== 'mid') {
      acceptance = 'REJECTED'
    }
  } else if (location !== 'mid') {
    acceptance = 'REJECTED'
  }

  const morning = args.playbookMode === 'morning'
  const firstLegalOnly =
    mode === 'BRACKET' &&
    location === 'mid' &&
    !morning &&
    (args.attemptsUsed ?? 0) >= 1

  const p: LongTermRegion = {
    instrument,
    ready: true,
    mode,
    location,
    acceptance,
    high: body.vah,
    low: body.val,
    days: last5.length,
    firstLegalOnly,
    badgeText: '',
    playLine: '',
  }
  p.badgeText = deskRegionBadgeText(p)
  p.playLine =
    mode === 'TREND'
      ? `REGION TREND — today's value accepted outside the ${last5.length}-day body. CALL side unchanged. Ticket stays 1.5R.`
      : firstLegalOnly
        ? `REGION BRACKET · mid — first legal hunt already used. Do not add. CALL side unchanged. Ticket stays 1.5R.`
        : location === 'mid'
          ? `REGION BRACKET · mid — poor location; first legal hunt only after Open range. CALL side unchanged. Ticket stays 1.5R.`
          : acceptance === 'REJECTED'
            ? `REGION BRACKET · ${location} — poke not accepted (value still inside the body). No reverse ticket. CALL side unchanged. Ticket stays 1.5R.`
            : `REGION BRACKET · ${location} — advise only. CALL hunts legal ±10. Ticket stays 1.5R.`
  return p
}

export function longTermRegionLineSpecs(
  p: LongTermRegion
): Array<{ price: number; color: string; title: string }> {
  if (!p.ready || p.high == null || p.low == null) return []
  return [
    { price: p.high, color: REGION_COLORS.high, title: 'Rg H' },
    { price: p.low, color: REGION_COLORS.low, title: 'Rg L' },
  ]
}

/**
 * Filled book: sell-off (or rally) that still keeps value with the attempt.
 * HOLD — not LEAVE. Does not auto-flatten.
 */
export function disguisedCorrectionHold(args: {
  direction: string
  controlLabel?: string | null
  placement?: string | null
  leaveBook?: boolean
}): boolean {
  if (args.leaveBook) return false
  const d = String(args.direction || '').toUpperCase()
  const place = args.placement || ''
  if (d === 'LONG' || d === 'BUY') {
    if (place !== 'HIGHER' && place !== 'OL_HIGH') return false
    return args.controlLabel !== 'ONE-TF SELL'
  }
  if (d === 'SHORT' || d === 'SELL') {
    if (place !== 'LOWER' && place !== 'OL_LOW') return false
    return args.controlLabel !== 'ONE-TF BUY'
  }
  return false
}
