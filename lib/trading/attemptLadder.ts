/**
 * Live desk attempt ladder (1 / 1 / 1 · day ≤ 3):
 *
 *   DOW / NASDAQ: Morning (OR30) → IB → Lunch-range
 *   NIKKEI:       Morning (OR30) → US Range (prior NYC) → IB
 *
 * Skip-forward: unused earlier windows unlock later ones.
 * Any fill locks later windows.
 *
 * Storage keeps morning / ib / lunch counters (slot 1 / 2 / 3).
 * On TOKYO, slot 2 = US Range fills, slot 3 = IB fills (labels differ).
 */

import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export const MAX_MORNING_ATTEMPTS = 1
export const MAX_IB_ATTEMPTS = 1
export const MAX_LUNCH_RANGE_ATTEMPTS = 1
/** Hard day cap across the three range attempts. */
export const MAX_DAY_ATTEMPTS = 3

/** Fill classification by clock (storage buckets). */
export type AttemptBucket = 'morning' | 'ib' | 'lunch_range' | 'other'

/**
 * Live unlock strategy window.
 * NY: ib | lunch_range
 * TOKYO: us_range (slot 2) | ib (slot 3)
 */
export type RangeStrategy = 'ib' | 'lunch_range' | 'us_range' | null

export type AttemptFill = {
  instrument?: string | null
  entryTimestamp?: string | number | Date | null
  exitReason?: string | null
}

export type AttemptLadder = {
  dayAttempts: number
  morningAttempts: number
  ibAttempts: number
  lunchAttempts: number
  morningStopHits: number
  revengeLocked: boolean
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
    /** Slot 2 — IB */
    midStart: '10:15:00',
    midEnd: '10:45:00',
    /** Slot 3 — Lunch-range */
    lateStart: '13:30:00',
    lateEnd: '15:15:00',
  },
  TOKYO: {
    tz: 'Asia/Tokyo',
    /** Slot 2 — US Range (prior NYC) */
    midStart: '10:15:00',
    midEnd: '10:45:00',
    /** Slot 3 — Tokyo IB */
    lateStart: '13:30:00',
    lateEnd: '15:00:00',
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

/** Classify a fill by desk-local entry clock into slot 1 / 2 / 3 storage buckets. */
export function classifyAttemptBucket(
  instrument: string,
  entryTimestamp: string | number | Date | null | undefined
): AttemptBucket {
  const entry = toDate(entryTimestamp)
  if (!entry) return 'morning'
  const market = marketFor(instrument)
  const c = CLOCK[market]
  const t = parseTimeToSeconds(timeInTz(entry, c.tz))
  const midStart = parseTimeToSeconds(c.midStart)
  const midEnd = parseTimeToSeconds(c.midEnd)
  const lateStart = parseTimeToSeconds(c.lateStart)
  const lateEnd = parseTimeToSeconds(c.lateEnd)

  if (t >= midStart && t < midEnd) return 'ib'
  if (t >= lateStart && t < lateEnd) return 'lunch_range'
  if (t < midStart) return 'morning'
  if (t < lateStart) return 'other'
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
  const dayLocked = dayAttempts >= MAX_DAY_ATTEMPTS

  return {
    dayAttempts,
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    morningStopHits,
    revengeLocked: false,
    dayLocked,
    morningEligible: !dayLocked && morningAttempts < MAX_MORNING_ATTEMPTS,
    ibEligible:
      !dayLocked &&
      morningAttempts === 0 &&
      otherAttempts === 0 &&
      ibAttempts < MAX_IB_ATTEMPTS,
    lunchEligible:
      !dayLocked &&
      morningAttempts === 0 &&
      ibAttempts === 0 &&
      otherAttempts === 0 &&
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
  const midStart = parseTimeToSeconds(c.midStart)
  const midEnd = parseTimeToSeconds(c.midEnd)
  const lateStart = parseTimeToSeconds(c.lateStart)
  const lateEnd = parseTimeToSeconds(c.lateEnd)
  const t = args.timeSec

  if (args.market === 'TOKYO') {
    // Slot 2 = US Range · Slot 3 = Tokyo IB
    if (t >= midStart && t < midEnd && args.ladder.ibEligible) return 'us_range'
    if (t >= lateStart && t < lateEnd && args.ladder.lunchEligible) return 'ib'
    return null
  }

  // NY: Slot 2 = IB · Slot 3 = Lunch-range
  if (t >= midStart && t < midEnd && args.ladder.ibEligible) return 'ib'
  if (t >= lateStart && t < lateEnd && args.ladder.lunchEligible) return 'lunch_range'
  return null
}

/** Short ladder chip — labels follow the desk’s three ranges. */
export function formatAttemptLadderShort(
  ladder: AttemptLadder,
  instrument?: string | null
): string {
  if (instrument === 'NIKKEI') {
    return `Day ${ladder.dayAttempts}/${ladder.maxDayAttempts} · AM ${ladder.morningAttempts}/${ladder.maxMorningAttempts} · US ${ladder.ibAttempts}/${ladder.maxIbAttempts} · IB ${ladder.lunchAttempts}/${ladder.maxLunchAttempts}`
  }
  return `Day ${ladder.dayAttempts}/${ladder.maxDayAttempts} · AM ${ladder.morningAttempts}/${ladder.maxMorningAttempts} · IB ${ladder.ibAttempts}/${ladder.maxIbAttempts} · LN ${ladder.lunchAttempts}/${ladder.maxLunchAttempts}`
}

export function attemptLadderLockReason(
  ladder: AttemptLadder,
  instrument?: string | null
): string | null {
  const tokyo = instrument === 'NIKKEI'
  if (ladder.dayLocked) {
    return `Day attempt cap hit (${ladder.dayAttempts}/${ladder.maxDayAttempts}). Trading switched off.`
  }
  if (ladder.morningAttempts > 0) {
    return tokyo
      ? 'Morning (OR30) trade taken — US Range and IB locked for today.'
      : 'Morning (OR30) trade taken — IB and lunch-range locked for today.'
  }
  if (ladder.ibAttempts > 0) {
    return tokyo
      ? 'US Range trade taken — IB locked for today.'
      : 'IB trade taken — lunch-range locked for today.'
  }
  // Gap fill between slot-2 and slot-3 (storage bucket "other")
  if (ladder.dayAttempts > 0 && !ladder.lunchEligible && !ladder.ibEligible) {
    return tokyo
      ? 'Earlier fill used — later ranges locked for today.'
      : 'Earlier fill used — later ranges locked for today.'
  }
  return null
}
