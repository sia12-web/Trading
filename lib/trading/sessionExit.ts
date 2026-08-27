/**
 * Open-book session STAY / EXIT — advise only, never auto-flatten.
 * Clock starts at fill. R vs stop distance. Closed 5m bars + live tip.
 */

import { NY_DESK_CLOCK, zonedCivilToUnix } from '@/lib/chart/sessionVwap'
import { isAsiaDeskChartWindow } from '@/lib/trading/asiaDesk'
import { ASIA_FLAT_MINS, ASIA_TZ, montrealCivil } from '@/lib/trading/asiaRangeSignals'

export const SESSION_EXIT_ARM_SEC = 30 * 60
export const SESSION_EXIT_STALL_SEC = 15 * 60
export const SESSION_EXIT_STALL_MAX_R = 0.3
export const SESSION_EXIT_LUNCH_MIN_R = 0.5
export const SESSION_EXIT_LAST_WINDOW_SEC = 20 * 60
export const SESSION_EXIT_LAST_MIN_R = 0.8
export const SESSION_EXIT_STOP_OWNS_R = -0.7
export const SESSION_EXIT_BAR_SEC = 5 * 60
export const SESSION_EXIT_NY_LUNCH_HOUR = 11.5
export const SESSION_EXIT_NY_FLAT_HOUR = 16

export type SessionExitMarket = 'NY' | 'ASIA'
export type SessionExitWord = 'STAY' | 'EXIT'
export type SessionExitReason =
  | 'no_fill'
  | 'unarmed'
  | 'expanding'
  | 'stalled'
  | 'red_clock'
  | 'lunch'
  | 'last_window'
  | 'perf'
  | 'stop_owns'
  | 'sticky'
  | 'hold'

export type SessionExitBar = { time: number; close: number }

export type SessionExitRead = {
  word: SessionExitWord
  reason: SessionExitReason
  line: string
  hover: string
  currentR: number
  mfe: number
  mae: number
  redSec: number
  greenSec: number
  fillAgeSec: number
  armed: boolean
  armedInSec: number
  market: SessionExitMarket
}

const YMD_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY_DESK_CLOCK.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function parseFillUnix(
  ts: string | number | Date | null | undefined
): number | null {
  if (ts == null) return null
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
  }
  if (ts instanceof Date) {
    const ms = ts.getTime()
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  const ms = Date.parse(String(ts))
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

export function sessionExitMarketAt(fillUnix: number): SessionExitMarket {
  return isAsiaDeskChartWindow(new Date(fillUnix * 1000)) ? 'ASIA' : 'NY'
}

export function sessionExitWalls(args: {
  fillUnix: number
  market?: SessionExitMarket
}): { lunchUnix: number | null; flattenUnix: number } {
  const market = args.market ?? sessionExitMarketAt(args.fillUnix)
  if (market === 'ASIA') {
    const { ymd } = montrealCivil(args.fillUnix)
    return {
      lunchUnix: null,
      flattenUnix: zonedCivilToUnix(ymd, ASIA_FLAT_MINS / 60, ASIA_TZ),
    }
  }
  const ymd = YMD_FMT.format(new Date(args.fillUnix * 1000))
  return {
    lunchUnix: zonedCivilToUnix(
      ymd,
      SESSION_EXIT_NY_LUNCH_HOUR,
      NY_DESK_CLOCK.timeZone
    ),
    flattenUnix: zonedCivilToUnix(
      ymd,
      SESSION_EXIT_NY_FLAT_HOUR,
      NY_DESK_CLOCK.timeZone
    ),
  }
}

function isLongSide(direction: string): boolean {
  const d = String(direction || '').toUpperCase()
  return d === 'LONG' || d === 'BUY'
}

export function rAtPrice(args: {
  direction: string
  entry: number
  stop: number
  price: number
}): number {
  const risk = Math.abs(Number(args.entry) - Number(args.stop))
  const price = Number(args.price)
  if (!(risk > 0) || !Number.isFinite(price) || !Number.isFinite(risk)) return 0
  const signed = isLongSide(args.direction)
    ? price - Number(args.entry)
    : Number(args.entry) - price
  return signed / risk
}

function fmtR(r: number): string {
  const n = Math.round(r * 10) / 10
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}R`
}

function mins(sec: number): number {
  return Math.max(0, Math.round(sec / 60))
}

export function formatSessionExitLine(read: {
  word: SessionExitWord
  reason: SessionExitReason
  currentR: number
  mfe: number
  redSec: number
  greenSec: number
  fillAgeSec: number
  armed: boolean
  armedInSec: number
  stallSec?: number
}): string {
  if (read.word === 'EXIT') {
    if (read.reason === 'stalled') {
      const stallM = mins(read.stallSec ?? SESSION_EXIT_STALL_SEC)
      return `EXIT · stalled ${stallM}m · MFE ${fmtR(read.mfe)}`
    }
    if (read.reason === 'red_clock') {
      return `EXIT · red ${mins(read.redSec)}m / green ${mins(read.greenSec)}m`
    }
    if (read.reason === 'lunch') return `EXIT · lunch · ${fmtR(read.currentR)}`
    if (read.reason === 'last_window') {
      return `EXIT · last 20m · ${fmtR(read.currentR)}`
    }
    if (read.reason === 'perf') return 'EXIT · Perf'
    return `EXIT · ${fmtR(read.currentR)}`
  }
  if (read.reason === 'stop_owns') {
    return `STAY · stop owns · ${fmtR(read.currentR)}`
  }
  if (!read.armed && read.reason === 'unarmed') {
    if (read.fillAgeSec >= SESSION_EXIT_ARM_SEC) return 'STAY · waiting OR30'
    return `STAY · arms in ${Math.max(1, Math.ceil(read.armedInSec / 60))}m`
  }
  if (read.reason === 'no_fill') return 'STAY · waiting fill time'
  return `STAY · ${mins(read.fillAgeSec)}m · MFE ${fmtR(read.mfe)} · red ${mins(read.redSec)}m / green ${mins(read.greenSec)}m`
}

function formatHover(read: SessionExitRead): string {
  return [
    `${read.word} · ${read.reason} · now ${fmtR(read.currentR)} · MFE ${fmtR(read.mfe)} · MAE ${fmtR(read.mae)}`,
    `red ${mins(read.redSec)}m / green ${mins(read.greenSec)}m · ${read.market}`,
    'Advise only — you confirm. Ticket stays 1.5R. Stop / cash-close flatten unchanged.',
  ].join(' · ')
}

function decideAt(args: {
  armed: boolean
  nowUnix: number
  currentR: number
  mfeUnix: number
  redSec: number
  greenSec: number
  expanding: boolean
  lunchUnix: number | null
  flattenUnix: number
  perfLeave: boolean
}): { word: SessionExitWord; reason: SessionExitReason } {
  if (args.currentR <= SESSION_EXIT_STOP_OWNS_R) {
    if (args.perfLeave) return { word: 'EXIT', reason: 'perf' }
    return { word: 'STAY', reason: 'stop_owns' }
  }
  const lastWindow =
    args.flattenUnix > 0 &&
    args.nowUnix >= args.flattenUnix - SESSION_EXIT_LAST_WINDOW_SEC &&
    args.currentR < SESSION_EXIT_LAST_MIN_R
  if (lastWindow) return { word: 'EXIT', reason: 'last_window' }

  if (args.lunchUnix != null && args.nowUnix >= args.lunchUnix) {
    if (args.currentR < SESSION_EXIT_LUNCH_MIN_R) {
      return { word: 'EXIT', reason: 'lunch' }
    }
    if (args.expanding && args.currentR > 0) {
      return { word: 'STAY', reason: 'expanding' }
    }
    return { word: 'EXIT', reason: 'lunch' }
  }

  if (args.expanding && args.currentR > 0) {
    return { word: 'STAY', reason: 'expanding' }
  }

  const redClock =
    args.armed && args.redSec > args.greenSec && args.currentR < 0
  if (redClock) return { word: 'EXIT', reason: 'red_clock' }

  const stalled =
    args.armed &&
    args.nowUnix - args.mfeUnix >= SESSION_EXIT_STALL_SEC &&
    args.currentR <= SESSION_EXIT_STALL_MAX_R
  if (stalled) return { word: 'EXIT', reason: 'stalled' }

  if (args.perfLeave) return { word: 'EXIT', reason: 'perf' }
  if (!args.armed) return { word: 'STAY', reason: 'unarmed' }
  return { word: 'STAY', reason: 'hold' }
}

export function computeSessionExit(args: {
  direction: string
  entry: number
  stop: number
  fillUnix: number | null
  nowUnix: number
  bars: SessionExitBar[]
  livePrice?: number | null
  or30Locked: boolean
  market?: SessionExitMarket
  perfLeave?: boolean
  lunchUnix?: number | null
  flattenUnix?: number | null
}): SessionExitRead {
  const market =
    args.market ??
    (args.fillUnix != null ? sessionExitMarketAt(args.fillUnix) : 'NY')
  const walls =
    args.fillUnix != null
      ? sessionExitWalls({ fillUnix: args.fillUnix, market })
      : { lunchUnix: null, flattenUnix: 0 }
  const lunchUnix =
    args.lunchUnix !== undefined ? args.lunchUnix : walls.lunchUnix
  const flattenUnix =
    args.flattenUnix != null && args.flattenUnix > 0
      ? args.flattenUnix
      : walls.flattenUnix

  const empty = (reason: SessionExitReason, extra?: Partial<SessionExitRead>): SessionExitRead => {
    const read: SessionExitRead = {
      word: 'STAY',
      reason,
      line: '',
      hover: '',
      currentR: 0,
      mfe: 0,
      mae: 0,
      redSec: 0,
      greenSec: 0,
      fillAgeSec: 0,
      armed: false,
      armedInSec: SESSION_EXIT_ARM_SEC,
      market,
      ...extra,
    }
    read.line = formatSessionExitLine(read)
    read.hover = formatHover(read)
    return read
  }

  const fillUnix = args.fillUnix
  const entry = Number(args.entry)
  const stop = Number(args.stop)
  if (
    fillUnix == null ||
    !(fillUnix > 0) ||
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    Math.abs(entry - stop) <= 0
  ) {
    return empty('no_fill')
  }

  const nowUnix = Math.max(args.nowUnix, fillUnix)
  const fillAgeSec = Math.max(0, nowUnix - fillUnix)
  const needsOr30 = market === 'NY'
  const or30Ok = !needsOr30 || args.or30Locked === true
  const armed = fillAgeSec >= SESSION_EXIT_ARM_SEC && or30Ok
  const armedInSec = !or30Ok
    ? SESSION_EXIT_ARM_SEC
    : Math.max(0, SESSION_EXIT_ARM_SEC - fillAgeSec)

  const rOf = (price: number) =>
    rAtPrice({
      direction: args.direction,
      entry,
      stop,
      price,
    })

  const closed = args.bars
    .filter((b) => b.time >= fillUnix && b.time <= nowUnix && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time)

  let mfe = 0
  let mae = 0
  let mfeUnix = fillUnix
  let redSec = 0
  let greenSec = 0
  let sticky = false
  let unstuckOnce = false
  let firstExitReason: SessionExitReason | null = null
  let mfeAtFirstExit = 0

  const applySample = (unix: number, price: number, dtSec: number) => {
    const r = rOf(price)
    if (r > mfe + 1e-12) {
      mfe = r
      mfeUnix = unix
    }
    if (r < mae - 1e-12) mae = r
    if (dtSec > 0) {
      if (r < 0) redSec += dtSec
      else if (r > 0) greenSec += dtSec
    }
    return r
  }

  let prevUnix = fillUnix
  let lastPrice = entry
  for (const bar of closed) {
    const dt = Math.min(
      SESSION_EXIT_BAR_SEC * 2,
      Math.max(0, bar.time - prevUnix)
    )
    const r = applySample(bar.time, bar.close, dt || SESSION_EXIT_BAR_SEC)
    lastPrice = bar.close
    const age = bar.time - fillUnix
    const barArmed = age >= SESSION_EXIT_ARM_SEC && or30Ok
    const expanding = r > 0 && r >= mfe - 1e-12 && mfeUnix === bar.time
    const dec = decideAt({
      armed: barArmed,
      nowUnix: bar.time,
      currentR: r,
      mfeUnix,
      redSec,
      greenSec,
      expanding,
      lunchUnix,
      flattenUnix,
      perfLeave: args.perfLeave === true,
    })
    if (dec.word === 'EXIT') {
      if (!sticky) {
        sticky = true
        firstExitReason = dec.reason
        mfeAtFirstExit = mfe
      }
    } else if (
      sticky &&
      !unstuckOnce &&
      expanding &&
      mfe > mfeAtFirstExit + 1e-12
    ) {
      sticky = false
      unstuckOnce = true
      firstExitReason = null
    }
    prevUnix = bar.time
  }

  const live =
    args.livePrice != null && Number.isFinite(args.livePrice)
      ? Number(args.livePrice)
      : lastPrice
  const tail = Math.min(SESSION_EXIT_BAR_SEC * 2, Math.max(0, nowUnix - prevUnix))
  const currentR = applySample(nowUnix, live, closed.length ? tail : 0)
  if (!closed.length) {
    applySample(nowUnix, live, 0)
  }
  const expandingNow = currentR > 0 && mfeUnix === nowUnix
  const dec = decideAt({
    armed,
    nowUnix,
    currentR,
    mfeUnix,
    redSec,
    greenSec,
    expanding: expandingNow,
    lunchUnix,
    flattenUnix,
    perfLeave: args.perfLeave === true,
  })

  let word = dec.word
  let reason = dec.reason
  if (
    sticky &&
    !unstuckOnce &&
    expandingNow &&
    mfe > mfeAtFirstExit + 1e-12
  ) {
    sticky = false
    unstuckOnce = true
    firstExitReason = null
    word = 'STAY'
    reason = 'expanding'
  } else if (sticky && word === 'STAY' && reason !== 'expanding' && reason !== 'stop_owns') {
    word = 'EXIT'
    reason = firstExitReason ?? 'sticky'
  } else if (word === 'EXIT' && !sticky) {
    sticky = true
    firstExitReason = reason
  }

  const stallSec = Math.max(0, nowUnix - mfeUnix)
  const read: SessionExitRead = {
    word,
    reason,
    line: '',
    hover: '',
    currentR,
    mfe,
    mae,
    redSec,
    greenSec,
    fillAgeSec,
    armed,
    armedInSec,
    market,
  }
  read.line = formatSessionExitLine({ ...read, stallSec })
  read.hover = formatHover(read)
  return read
}
