/**
 * Dalton Big Question 2 — is the attempted direction facilitating trade?
 * Table 4.1 collapsed grades. Advise + CALL WAIT after OR30 VA exists.
 * Ticket stays 1.5R. OANDA tick counts are not volume.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import { INDEX_RVOL_FLOOR } from '@/lib/chart/rangeBreakSignals'
import {
  closedControlPeriods,
  computeMarketControl,
  controlPeriodSecsForElapsed,
  type ControlBar,
  type ControlPeriod,
  type MarketControl,
} from '@/lib/trading/marketControl'
import {
  buildTpoValueArea,
  computeYesterdayProfile,
  tpoTickSize,
  type YesterdayBar,
  type YesterdayProfile,
} from '@/lib/trading/yesterdayProfile'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'

export type DeskPerfGrade =
  | 'WAIT'
  | 'VERY_STRONG'
  | 'STRONG'
  | 'SLOWING'
  | 'BALANCING'
  | 'WEAK'
  | 'UNCLEAR'

export type DeskPerfWho = 'buyer' | 'seller' | null

export type DeskPerfPlacement =
  | 'HIGHER'
  | 'LOWER'
  | 'OL_HIGH'
  | 'OL_LOW'
  | 'UNCHANGED'
  | 'INSIDE'
  | 'OUTSIDE'

export type DeskPerfBar = ControlBar & { volume?: number }

export type DeskPerf = {
  instrument: string
  grade: DeskPerfGrade
  who: DeskPerfWho
  placement: DeskPerfPlacement | null
  vaWidth: 'WIDER' | 'AVERAGE' | 'NARROWER' | null
  volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED' | null
  or30VaReady: boolean
  /** WEAK / UNCLEAR after OR30 VA — blocks new hunts */
  vetoCall: boolean
  /** Open book: facilitation failed */
  leaveBook: boolean
  badgeText: string
  playLine: string
}

const EPS = 1e-8
const OR30_VA_ELAPSED_SEC = 20 * 60
const WIDTH_WIDER = 1.1
const WIDTH_NARROW = 0.9
const VOL_UNCHANGED = 0.1

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

function vaFromPeriods(
  periods: ControlPeriod[]
): { vah: number; val: number; width: number } | null {
  if (periods.length < 2) return null
  let yh = -Infinity
  let yl = Infinity
  for (const p of periods) {
    if (p.high > yh) yh = p.high
    if (p.low < yl) yl = p.low
  }
  if (!(yh > yl) || !Number.isFinite(yh) || !Number.isFinite(yl)) return null
  const tick = tpoTickSize((yh + yl) / 2)
  if (!(tick > 0)) return null
  const tpos = new Map<number, number>()
  for (const p of periods) {
    const start = Math.round(p.low / tick) * tick
    const end = Math.round(p.high / tick) * tick
    const steps = Math.max(0, Math.round((end - start) / tick))
    const capped = Math.min(steps, 4000)
    for (let i = 0; i <= capped; i++) {
      const k = Math.round((start + i * tick) / tick) * tick
      tpos.set(k, (tpos.get(k) ?? 0) + 1)
    }
  }
  if (tpos.size < 3) return null
  const rows = Array.from(tpos.entries())
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price)
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (total < 4) return null
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
  const target = total * 0.7
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
  return { vah, val, width: px(vah - val) }
}

export function classifyVaPlacement(
  today: { vah: number; val: number },
  yday: { vah: number; val: number }
): DeskPerfPlacement {
  if (today.val >= yday.vah - EPS) return 'HIGHER'
  if (today.vah <= yday.val + EPS) return 'LOWER'
  if (today.val >= yday.val - EPS && today.vah <= yday.vah + EPS) return 'INSIDE'
  if (today.val <= yday.val + EPS && today.vah >= yday.vah - EPS) return 'OUTSIDE'
  const todayMid = (today.vah + today.val) / 2
  const ydayMid = (yday.vah + yday.val) / 2
  if (Math.abs(todayMid - ydayMid) < (yday.vah - yday.val) * 0.05 + EPS) {
    return 'UNCHANGED'
  }
  return todayMid > ydayMid ? 'OL_HIGH' : 'OL_LOW'
}

function widthRel(
  todayW: number,
  ydayW: number
): 'WIDER' | 'AVERAGE' | 'NARROWER' {
  if (!(ydayW > 0)) return 'AVERAGE'
  const r = todayW / ydayW
  if (r >= WIDTH_WIDER) return 'WIDER'
  if (r <= WIDTH_NARROW) return 'NARROWER'
  return 'AVERAGE'
}

function sumVolume(
  candles: DeskPerfBar[],
  from: number,
  until: number
): number {
  let s = 0
  for (const c of candles) {
    if (c.time >= from && c.time < until) s += Number(c.volume) || 0
  }
  return s
}

function volumeRelElapsed(args: {
  candles: DeskPerfBar[]
  clock: DeskClock
  todayYmd: string
  openU: number
  asOfUnix: number
}): 'HIGHER' | 'LOWER' | 'UNCHANGED' | null {
  const elapsed = Math.max(0, args.asOfUnix - args.openU)
  const todayVol = sumVolume(args.candles, args.openU, args.asOfUnix)
  if (todayVol < INDEX_RVOL_FLOOR) return null

  const ymd = args.todayYmd
  for (let d = 1; d <= 5; d++) {
    const prior = new Date(`${ymd}T12:00:00Z`)
    prior.setUTCDate(prior.getUTCDate() - d)
    const py = prior.toISOString().slice(0, 10)
    if (!isWeekdayYmd(py, args.clock.timeZone)) continue
    const pOpen = cashOpenUnixForYmd(py, args.clock)
    const pUntil = pOpen + elapsed
    const pVol = sumVolume(args.candles, pOpen, pUntil)
    if (pVol < INDEX_RVOL_FLOOR) continue
    const diff = (todayVol - pVol) / pVol
    if (Math.abs(diff) <= VOL_UNCHANGED) return 'UNCHANGED'
    return diff > 0 ? 'HIGHER' : 'LOWER'
  }
  return null
}

export function gradeTable4(args: {
  attempt: 'UP' | 'DOWN' | 'BALANCED'
  volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED' | null
  placement: DeskPerfPlacement
  width: 'WIDER' | 'AVERAGE' | 'NARROWER'
}): DeskPerfGrade {
  const { attempt, placement } = args
  if (attempt === 'BALANCED') return 'BALANCING'
  if (placement === 'INSIDE' || placement === 'OUTSIDE' || placement === 'UNCHANGED') {
    return 'BALANCING'
  }
  const withAttempt =
    (attempt === 'UP' && (placement === 'HIGHER' || placement === 'OL_HIGH')) ||
    (attempt === 'DOWN' && (placement === 'LOWER' || placement === 'OL_LOW'))
  const against =
    (attempt === 'UP' && (placement === 'LOWER' || placement === 'OL_LOW')) ||
    (attempt === 'DOWN' && (placement === 'HIGHER' || placement === 'OL_HIGH'))

  const vol = args.volumeRel
  if (withAttempt) {
    if (vol === 'HIGHER') return 'VERY_STRONG'
    if (vol === 'LOWER') return 'SLOWING'
    if (vol === 'UNCHANGED') return 'STRONG'
    if (args.width === 'WIDER') return 'VERY_STRONG'
    if (args.width === 'NARROWER') return 'SLOWING'
    return 'STRONG'
  }
  if (against) {
    if (vol === 'HIGHER') return 'UNCLEAR'
    return 'WEAK'
  }
  return 'BALANCING'
}

function whoFor(
  attempt: 'UP' | 'DOWN' | 'BALANCED',
  grade: DeskPerfGrade
): DeskPerfWho {
  if (grade === 'WAIT' || grade === 'UNCLEAR' || grade === 'BALANCING') return null
  if (attempt === 'BALANCED') return null
  if (grade === 'WEAK') return attempt === 'UP' ? 'seller' : 'buyer'
  return attempt === 'UP' ? 'buyer' : 'seller'
}

export function deskPerfBadgeText(p: DeskPerf): string {
  if (p.grade === 'WAIT') return 'WAIT'
  const who = p.who ? ` · ${p.who}` : ''
  return `${p.grade.replace(/_/g, ' ')}${who}`
}

/** BALANCING after Open range: first legal hunt only. */
export function firstLegalHuntVeto(args: {
  grade: DeskPerfGrade
  playbookMode?: DeskPlaybookMode | null
  attemptsUsed?: number
}): boolean {
  if (args.grade !== 'BALANCING') return false
  if (args.playbookMode == null || args.playbookMode === 'morning') return false
  return (args.attemptsUsed ?? 0) >= 1
}

function waiting(instrument: string, extra?: Partial<DeskPerf>): DeskPerf {
  const p: DeskPerf = {
    instrument,
    grade: 'WAIT',
    who: null,
    placement: extra?.placement ?? null,
    vaWidth: extra?.vaWidth ?? null,
    volumeRel: extra?.volumeRel ?? null,
    or30VaReady: extra?.or30VaReady ?? false,
    vetoCall: false,
    leaveBook: false,
    badgeText: 'WAIT',
    playLine:
      extra?.playLine ??
      'PERF WAIT — not enough letters for a developing value area. Drive may still CALL. Ticket stays 1.5R.',
  }
  p.badgeText = deskPerfBadgeText(p)
  return p
}

export function computeDeskPerf(args: {
  instrument: string
  candles: DeskPerfBar[]
  asOfUnix: number
  playbookMode?: DeskPlaybookMode | null
  attemptsUsed?: number
  control?: MarketControl | null
  yesterday?: YesterdayProfile | null
}): DeskPerf {
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

  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = cashCloseUnixForYmd(ymd, clock)
  if (args.asOfUnix < openU) return waiting(instrument)

  const control =
    args.control ??
    computeMarketControl({
      instrument,
      candles,
      asOfUnix: args.asOfUnix,
    })
  const yday =
    args.yesterday ??
    computeYesterdayProfile({
      instrument,
      candles: candles as YesterdayBar[],
      asOfUnix: args.asOfUnix,
    })

  const elapsed = Math.max(0, args.asOfUnix - openU)
  const periodSecs = controlPeriodSecsForElapsed(elapsed)
  const primarySec = periodSecs[periodSecs.length - 1] ?? 5 * 60
  const periods = closedControlPeriods(
    candles,
    openU,
    closeU,
    args.asOfUnix,
    primarySec
  )
  const todayVa = vaFromPeriods(periods)
  const or30VaReady =
    elapsed >= OR30_VA_ELAPSED_SEC &&
    control.horizon !== 'or15' &&
    todayVa != null

  if (control.label === 'WAIT' || !todayVa) {
    return waiting(instrument, {
      or30VaReady,
      playLine: !todayVa
        ? 'PERF WAIT — not enough closed letters for developing value.'
        : 'PERF WAIT — Control not scored yet. Drive may still CALL. Ticket stays 1.5R.',
      placement: todayVa && yday ? classifyVaPlacement(todayVa, yday) : null,
    })
  }

  if (control.label === 'TWO-TF') {
    const two: DeskPerf = {
      instrument,
      grade: 'BALANCING',
      who: null,
      placement: yday ? classifyVaPlacement(todayVa, yday) : null,
      vaWidth: yday ? widthRel(todayVa.width, Math.max(0, yday.vah - yday.val)) : null,
      volumeRel: volumeRelElapsed({
        candles,
        clock,
        todayYmd: ymd,
        openU,
        asOfUnix: args.asOfUnix,
      }),
      or30VaReady,
      vetoCall: firstLegalHuntVeto({
        grade: 'BALANCING',
        playbookMode: args.playbookMode,
        attemptsUsed: args.attemptsUsed,
      }),
      leaveBook: false,
      badgeText: '',
      playLine:
        'PERF BALANCING — Control is two-timeframe. First legal hunt only. Ticket stays 1.5R.',
    }
    two.badgeText = deskPerfBadgeText(two)
    return two
  }

  if (!yday) {
    return waiting(instrument, { or30VaReady })
  }

  const placement = classifyVaPlacement(todayVa, yday)
  const yWidth = Math.max(0, yday.vah - yday.val)
  const vaWidth = widthRel(todayVa.width, yWidth)
  const volumeRel = volumeRelElapsed({
    candles,
    clock,
    todayYmd: ymd,
    openU,
    asOfUnix: args.asOfUnix,
  })

  const attempt: 'UP' | 'DOWN' | 'BALANCED' =
    control.label === 'ONE-TF BUY'
      ? 'UP'
      : control.label === 'ONE-TF SELL'
        ? 'DOWN'
        : 'BALANCED'

  let grade = gradeTable4({
    attempt,
    volumeRel,
    placement,
    width: vaWidth,
  })
  if (grade === 'UNCLEAR' && volumeRel !== 'HIGHER') {
    grade = 'WEAK'
  }

  const morningSlot = args.playbookMode === 'morning'
  const facilitationFailed = grade === 'WEAK' || grade === 'UNCLEAR'
  const vetoCall =
    (facilitationFailed && or30VaReady && !morningSlot) ||
    firstLegalHuntVeto({
      grade,
      playbookMode: args.playbookMode,
      attemptsUsed: args.attemptsUsed,
    })
  const who = whoFor(attempt, grade)
  /** Same clock as the hunt veto — do not LEAVE a morning Drive fill before OR30 VA exists. */
  const leaveBook = facilitationFailed && or30VaReady

  const p: DeskPerf = {
    instrument,
    grade,
    who,
    placement,
    vaWidth,
    volumeRel,
    or30VaReady,
    vetoCall,
    leaveBook,
    badgeText: '',
    playLine: '',
  }
  p.badgeText = deskPerfBadgeText(p)
  const conv =
    volumeRel != null
      ? `volume ${volumeRel.toLowerCase()}`
      : `VA width ${vaWidth.toLowerCase()} (no usable cash volume)`
  p.playLine = `PERF ${p.badgeText} — attempt ${attempt.toLowerCase()}, value ${placement.replace(/_/g, ' ').toLowerCase()}, ${conv}. ${
    vetoCall && facilitationFailed
      ? 'CALL WAIT — facilitation failed after OR30 VA.'
      : vetoCall
        ? 'CALL WAIT — first legal hunt already used (BALANCING).'
        : leaveBook
          ? 'LEAVE the trend thesis if filled. Ticket stays 1.5R.'
          : 'Filter-first. Ticket stays 1.5R.'
  }`
  return p
}

/** Prior-session VA width helper for tests (70% TPO of a closed cash day). */
export function priorSessionVaWidth(
  candles: YesterdayBar[],
  openU: number,
  closeU: number
): number | null {
  const va = buildTpoValueArea(candles, openU, closeU)
  if (!va) return null
  return px(va.vah - va.val)
}
