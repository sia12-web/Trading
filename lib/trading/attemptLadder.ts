/**
 * Live desk attempt ladder:
 *   Morning playbook ≤2 · IB ≤1 · Lunch-range ≤1 · Day ≤4 total
 *
 * Revenge lock: 2 morning fills that are ALL stop-outs → IB + lunch off.
 * IB unlock: morning fills ≤1 (and not revenge / day-capped).
 * Lunch unlock: no IB fill yet (skipped or unused); IB fill (SL or TP) kills lunch.
 */

import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export const MAX_MORNING_ATTEMPTS = 2
export const MAX_IB_ATTEMPTS = 1
export const MAX_LUNCH_RANGE_ATTEMPTS = 1
/** Hard day cap across morning + IB + lunch-range. */
export const MAX_DAY_ATTEMPTS = 4

export type AttemptBucket = 'morning' | 'ib' | 'lunch_range' | 'other'
export type RangeStrategy = 'ib' | 'lunch_range' | null

export type AttemptFill = {
  instrument?: string | null
  /** Fill / entry time */
  entryTimestamp?: string | number | Date | null
  /** null while still open */
  exitReason?: string | null
}

export type AttemptLadder = {
  dayAttempts: number
  morningAttempts: number
  ibAttempts: number
  lunchAttempts: number
  morningStopHits: number
  /** 2 morning fills, all stop-outs — no IB / lunch (anti-revenge). */
  revengeLocked: boolean
  /** Day hit 4 fills — everything off. */
  dayLocked: boolean
  morningEligible: boolean
  ibEligible: boolean
  lunchEligible: boolean
  maxDayAttempts: number
  maxMorningAttempts: number
  maxIbAttempts: number
  maxLunchAttempts: number
}

type DeskMarket = 'NY' | 'TOKYO'

const CLOCK = {
  NY: {
    tz: 'America/New_York',
    ibStart: '10:15:00',
    ibEnd: '10:45:00',
    lnStart: '13:30:00',
    lnEnd: '15:15:00',
  },
  TOKYO: {
    tz: 'Asia/Tokyo',
    ibStart: '10:15:00',
    ibEnd: '10:45:00',
    lnStart: '13:30:00',
    lnEnd: '15:00:00',
  },
} as const

function marketFor(instrument: string | null | undefined): DeskMarket {
  return instrument === 'NIKKEI' ? 'TOKYO' : 'NY'
}

function timeInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

function toDate(ts: string | number | Date | null | undefined): Date | null {
  if (ts == null) return null
  const d =
    typeof ts === 'number' ? new Date(ts) : ts instanceof Date ? ts : new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Classify a fill by desk-local entry clock into morning / IB / lunch-range. */
export function classifyAttemptBucket(
  instrument: string,
  entryTimestamp: string | number | Date | null | undefined
): AttemptBucket {
  const entry = toDate(entryTimestamp)
  if (!entry) return 'morning' // unknown → morning (safer for caps)
  const market = marketFor(instrument)
  const c = CLOCK[market]
  const t = parseTimeToSeconds(timeInTz(entry, c.tz))
  const ibStart = parseTimeToSeconds(c.ibStart)
  const ibEnd = parseTimeToSeconds(c.ibEnd)
  const lnStart = parseTimeToSeconds(c.lnStart)
  const lnEnd = parseTimeToSeconds(c.lnEnd)

  if (t >= ibStart && t < ibEnd) return 'ib'
  if (t >= lnStart && t < lnEnd) return 'lunch_range'
  if (t < ibStart) return 'morning'
  if (t < lnStart) return 'other'
  return 'other'
}

function finalizeLadder(args: {
  morningAttempts: number
  ibAttempts: number
  lunchAttempts: number
  otherAttempts: number
  morningStopHits: number
}): AttemptLadder {
  const {
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    otherAttempts,
    morningStopHits,
  } = args
  const dayAttempts = morningAttempts + ibAttempts + lunchAttempts + otherAttempts
  const revengeLocked =
    morningAttempts >= MAX_MORNING_ATTEMPTS &&
    morningStopHits >= MAX_MORNING_ATTEMPTS
  const dayLocked = dayAttempts >= MAX_DAY_ATTEMPTS

  return {
    dayAttempts,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    morningStopHits,
    revengeLocked,
    dayLocked,
    morningEligible: !dayLocked && morningAttempts < MAX_MORNING_ATTEMPTS,
    ibEligible:
      !dayLocked &&
      !revengeLocked &&
      morningAttempts <= 1 &&
      ibAttempts < MAX_IB_ATTEMPTS,
    lunchEligible:
      !dayLocked &&
      !revengeLocked &&
      ibAttempts === 0 &&
      lunchAttempts < MAX_LUNCH_RANGE_ATTEMPTS,
    maxDayAttempts: MAX_DAY_ATTEMPTS,
    maxMorningAttempts: MAX_MORNING_ATTEMPTS,
    maxIbAttempts: MAX_IB_ATTEMPTS,
    maxLunchAttempts: MAX_LUNCH_RANGE_ATTEMPTS,
  }
}

export function buildAttemptLadder(
  fills: AttemptFill[],
  fallbackInstrument: string = 'DOW'
): AttemptLadder {
  let morningAttempts = 0
  let ibAttempts = 0
  let lunchAttempts = 0
  let otherAttempts = 0
  let morningStopHits = 0

  for (const f of fills) {
    const inst = f.instrument || fallbackInstrument
    const bucket = classifyAttemptBucket(inst, f.entryTimestamp)
    if (bucket === 'morning') {
      morningAttempts += 1
      if (f.exitReason === 'stop_hit') morningStopHits += 1
    } else if (bucket === 'ib') {
      ibAttempts += 1
    } else if (bucket === 'lunch_range') {
      lunchAttempts += 1
    } else {
      otherAttempts += 1
    }
  }

  return finalizeLadder({
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    otherAttempts,
    morningStopHits,
  })
}

/** For tests / callers that only have aggregate counts. */
export function attemptLadderFromCounts(args: {
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
  morningStopHits?: number
  otherAttempts?: number
}): AttemptLadder {
  return finalizeLadder({
    morningAttempts: Math.max(0, Math.floor(args.morningAttempts || 0)),
    ibAttempts: Math.max(0, Math.floor(args.ibAttempts || 0)),
    lunchAttempts: Math.max(0, Math.floor(args.lunchAttempts || 0)),
    otherAttempts: Math.max(0, Math.floor(args.otherAttempts || 0)),
    morningStopHits: Math.max(0, Math.floor(args.morningStopHits || 0)),
  })
}

/**
 * Backward-compatible helper when only totals are known (no fill timestamps).
 * Treats all fills as morning — conservative for eligibility.
 */
export function attemptLadderFromTotals(args: {
  attemptsUsed: number
  stopHits?: number
}): AttemptLadder {
  const attemptsUsed = Math.max(0, Math.floor(args.attemptsUsed || 0))
  const stopHits = Math.max(0, Math.floor(args.stopHits || 0))
  return attemptLadderFromCounts({
    morningAttempts: attemptsUsed,
    morningStopHits: Math.min(stopHits, attemptsUsed),
  })
}

export function resolveRangeStrategyFromLadder(args: {
  market: DeskMarket
  timeSec: number
  ladder: AttemptLadder
}): RangeStrategy {
  const c = CLOCK[args.market]
  const ibStart = parseTimeToSeconds(c.ibStart)
  const ibEnd = parseTimeToSeconds(c.ibEnd)
  const lnStart = parseTimeToSeconds(c.lnStart)
  const lnEnd = parseTimeToSeconds(c.lnEnd)
  const t = args.timeSec

  if (t >= ibStart && t < ibEnd && args.ladder.ibEligible) return 'ib'
  if (t >= lnStart && t < lnEnd && args.ladder.lunchEligible) return 'lunch_range'
  return null
}

export function formatAttemptLadderShort(ladder: AttemptLadder): string {
  return `Day ${ladder.dayAttempts}/${ladder.maxDayAttempts} · AM ${ladder.morningAttempts}/${ladder.maxMorningAttempts} · IB ${ladder.ibAttempts}/${ladder.maxIbAttempts} · LN ${ladder.lunchAttempts}/${ladder.maxLunchAttempts}`
}

export function attemptLadderLockReason(ladder: AttemptLadder): string | null {
  if (ladder.revengeLocked) {
    return 'Revenge lock — 2 morning stop-outs. IB and lunch-range switched off for today.'
  }
  if (ladder.dayLocked) {
    return `Day attempt cap hit (${ladder.dayAttempts}/${ladder.maxDayAttempts}). Trading switched off.`
  }
  return null
}
