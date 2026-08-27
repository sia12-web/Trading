/**
 * Dalton “Markets to Stay Out Of” (Mind Over Markets pp. 265–267).
 * Per-name CALL WAIT. Does not flatten. Does not paint levels. No telegram.
 *
 * NTREND: squat range vs last 10 cash days + elapsed volume LOWER. Earliest OR30.
 * NCONV: Open-Auction in yesterday VA, Control not ONE-TF, still inside yVA. OR30+.
 * Morning Drive / Test-Drive still hunts. Ticket stays 1.5R.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
import type { OpeningActivityType } from '@/lib/trading/openingActivity'
import type { YesterdayOpenType } from '@/lib/trading/yesterdayProfile'

export type StayOutKind = 'NONE' | 'NTREND' | 'NCONV'

export type StayOutBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type DeskStayOut = {
  kind: StayOutKind
  vetoCall: boolean
  badgeText: string
  playLine: string
}

export const STAY_OUT_LOOKBACK_DAYS = 10
const MIN_RANGE_DAYS = 8
const VOL_UNCHANGED = 0.1

type RthDay = { ymd: string; openU: number; closeU: number }

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

function collectRthDays(candles: StayOutBar[], clock: DeskClock): RthDay[] {
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

function sessionRange(
  candles: StayOutBar[],
  openU: number,
  untilU: number
): number | null {
  let hi = -Infinity
  let lo = Infinity
  for (const c of candles) {
    if (c.time < openU || c.time >= untilU) continue
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return hi - lo
}

function sessionHl(
  candles: StayOutBar[],
  openU: number,
  untilU: number
): { high: number; low: number } | null {
  let hi = -Infinity
  let lo = Infinity
  for (const c of candles) {
    if (c.time < openU || c.time >= untilU) continue
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return { high: hi, low: lo }
}

function percentile25(values: number[]): number | null {
  if (values.length < MIN_RANGE_DAYS) return null
  const s = values.slice().sort((a, b) => a - b)
  const idx = Math.max(0, Math.floor((s.length - 1) * 0.25))
  return s[idx] ?? null
}

function sumVolume(candles: StayOutBar[], from: number, until: number): number {
  let s = 0
  for (const c of candles) {
    if (c.time >= from && c.time < until) s += Number(c.volume) || 0
  }
  return s
}

function volumeLower(args: {
  candles: StayOutBar[]
  clock: DeskClock
  todayYmd: string
  openU: number
  asOfUnix: number
}): boolean {
  const elapsed = Math.max(0, args.asOfUnix - args.openU)
  const todayVol = sumVolume(args.candles, args.openU, args.asOfUnix)
  if (!(todayVol > 0)) return false
  const ymd = args.todayYmd
  for (let d = 1; d <= 5; d++) {
    const prior = new Date(`${ymd}T12:00:00Z`)
    prior.setUTCDate(prior.getUTCDate() - d)
    const py = prior.toISOString().slice(0, 10)
    if (!isWeekdayYmd(py, args.clock.timeZone)) continue
    const pOpen = cashOpenUnixForYmd(py, args.clock)
    const pVol = sumVolume(args.candles, pOpen, pOpen + elapsed)
    if (!(pVol > 0)) continue
    const diff = (todayVol - pVol) / pVol
    if (Math.abs(diff) <= VOL_UNCHANGED) return false
    return diff < 0
  }
  return false
}

function none(extra?: Partial<DeskStayOut>): DeskStayOut {
  return {
    kind: 'NONE',
    vetoCall: false,
    badgeText: extra?.badgeText ?? '—',
    playLine:
      extra?.playLine ??
      'OUT — not a stay-out day. CALL hunts legal ±10. Ticket stays 1.5R.',
  }
}

function isHuntWindow(mode: DeskPlaybookMode | null | undefined): boolean {
  return mode === 'or30' || mode === 'ib'
}

function isOneTf(label: string | null | undefined): boolean {
  return label === 'ONE-TF BUY' || label === 'ONE-TF SELL'
}

export function deskStayOutBadgeText(p: DeskStayOut): string {
  if (p.kind === 'NTREND') return 'OUT · NTREND'
  if (p.kind === 'NCONV') return 'OUT · NCONV'
  return '—'
}

export function computeDeskStayOut(args: {
  instrument: string
  candles: StayOutBar[]
  asOfUnix: number
  playbookMode?: DeskPlaybookMode | null
  openingType?: OpeningActivityType | null
  controlLabel?: string | null
  ydayOpenType?: YesterdayOpenType | null
  ydayVah?: number | null
  ydayVal?: number | null
}): DeskStayOut {
  const instrument = String(args.instrument || '')
  if (!Number.isFinite(args.asOfUnix) || !instrument) return none()
  if (!isHuntWindow(args.playbookMode)) return none()

  const candles = (Array.isArray(args.candles) ? args.candles : []).filter(
    (c) => c && Number.isFinite(c.time) && c.time <= args.asOfUnix
  )
  const clock = deskClockFor(instrument)
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) return none()

  const openU = cashOpenUnixForYmd(ymd, clock)
  if (args.asOfUnix < openU) return none()

  const days = collectRthDays(candles, clock)
  const prior = days.filter((d) => d.openU < openU).slice(-STAY_OUT_LOOKBACK_DAYS)
  const todayRange = sessionRange(candles, openU, args.asOfUnix)
  const priorRanges = prior
    .map((d) => sessionRange(candles, d.openU, d.closeU))
    .filter((n): n is number => n != null && n > 0)
  const p25 = percentile25(priorRanges)
  const volLow = volumeLower({
    candles,
    clock,
    todayYmd: ymd,
    openU,
    asOfUnix: args.asOfUnix,
  })
  const ntrend =
    todayRange != null &&
    p25 != null &&
    todayRange <= p25 + 1e-8 &&
    volLow

  const hl = sessionHl(candles, openU, args.asOfUnix)
  const vah = args.ydayVah
  const val = args.ydayVal
  const insideYva =
    hl != null &&
    vah != null &&
    val != null &&
    vah > val &&
    hl.high <= vah + 1e-8 &&
    hl.low >= val - 1e-8
  const nconv =
    args.openingType === 'OPEN_AUCTION' &&
    args.ydayOpenType === 'IN_VALUE' &&
    !isOneTf(args.controlLabel) &&
    insideYva

  if (ntrend) {
    const p: DeskStayOut = {
      kind: 'NTREND',
      vetoCall: true,
      badgeText: '',
      playLine:
        'OUT NTREND — range and volume are dead vs the last 10 days. No new ticket. Drive already on is left on 1.5R.',
    }
    p.badgeText = deskStayOutBadgeText(p)
    return p
  }
  if (nconv) {
    const p: DeskStayOut = {
      kind: 'NCONV',
      vetoCall: true,
      badgeText: '',
      playLine:
        'OUT NCONV — Open-Auction in value, still inside yesterday VA, no ONE-TF. No new ticket.',
    }
    p.badgeText = deskStayOutBadgeText(p)
    return p
  }
  return none()
}
