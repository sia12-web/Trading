/**
 * Live desk attempt ladder (Option B: 2 / 2 / 2 · day ≤ 6):
 *
 *   DOW / NASDAQ: Morning (OR30) → IB → Lunch-range
 *   NIKKEI:       Morning (OR30) → US Range (prior NYC) → IB
 *
 * Each window: up to 2 fills @ range-edge risk.
 * Next window unlocks when prior clock ends OR prior attempts exhausted.
 * Skip-forward: unused earlier window still unlocks later once its clock ends.
 *
 * Storage keeps morning / ib / lunch counters (slot 1 / 2 / 3).
 * On TOKYO, slot 2 = US Range fills, slot 3 = IB fills (labels differ).
 *
 * NY IB entry starts at 10:30 ET (when first-hour IB locks), not 10:15.
 * Tokyo US Range stays 10:15 JST (prior NYC already shaped).
 */

import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export const MAX_MORNING_ATTEMPTS = 2
export const MAX_IB_ATTEMPTS = 2
export const MAX_LUNCH_RANGE_ATTEMPTS = 2
/** Hard day cap across the three range windows (2×3). */
export const MAX_DAY_ATTEMPTS = 6

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
    /** Slot 2 — IB (aligns with first-hour lock at 10:30) */
    midStart: '10:30:00',
    midEnd: '10:45:00',
    /** Slot 3 — Lunch-range */
    lateStart: '13:30:00',
    lateEnd: '15:15:00',
  },
  TOKYO: {
    tz: 'Asia/Tokyo',
    /** Slot 2 — US Range (prior NYC — already shaped) */
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
  return 'other'
}

function clockSec(now: Date, market: DeskMarket): number {
  return parseTimeToSeconds(timeInTz(now, CLOCK[market].tz))
}

/** Morning slot released → mid slot may take budget. */
export function isMorningWindowReleased(args: {
  morningAttempts: number
  now?: Date | null
  instrument?: string | null
}): boolean {
  if (args.morningAttempts >= MAX_MORNING_ATTEMPTS) return true
  // Without clock: unused morning = skip-forward unlock for later eligibility flags
  if (!args.now) return args.morningAttempts === 0
  const market = marketFor(args.instrument)
  const midStart = parseTimeToSeconds(CLOCK[market].midStart)
  return clockSec(args.now, market) >= midStart
}

/** Mid slot released → late slot may take budget (after mid clock ends or mid exhausted). */
export function isMidWindowReleased(args: {
  ibAttempts: number
  now?: Date | null
  instrument?: string | null
}): boolean {
  if (args.ibAttempts >= MAX_IB_ATTEMPTS) return true
  if (!args.now) return args.ibAttempts === 0
  const market = marketFor(args.instrument)
  const midEnd = parseTimeToSeconds(CLOCK[market].midEnd)
  return clockSec(args.now, market) >= midEnd
}

function finalizeLadder(args: {
  morningAttempts: number
  ibAttempts: number
  lunchAttempts: number
  otherAttempts: number
  morningStopHits: number
  now?: Date | null
  instrument?: string | null
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
  const morningReleased = isMorningWindowReleased({
    morningAttempts,
    now: args.now,
    instrument: args.instrument,
  })
  const midReleased = isMidWindowReleased({
    ibAttempts,
    now: args.now,
    instrument: args.instrument,
  })

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
      !dayLocked && morningReleased && ibAttempts < MAX_IB_ATTEMPTS,
    lunchEligible:
      !dayLocked &&
      morningReleased &&
      midReleased &&
      lunchAttempts < MAX_LUNCH_RANGE_ATTEMPTS,
    maxDayAttempts: MAX_DAY_ATTEMPTS,
    maxMorningAttempts: MAX_MORNING_ATTEMPTS,
    maxIbAttempts: MAX_IB_ATTEMPTS,
    maxLunchAttempts: MAX_LUNCH_RANGE_ATTEMPTS,
  }
}

export function buildAttemptLadder(
  fills: AttemptFill[],
  fallbackInstrument: string = 'DOW',
  now: Date | null = null
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
    now,
    instrument: fallbackInstrument,
  })
}

export function attemptLadderFromCounts(args: {
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
  otherAttempts?: number
  morningStopHits?: number
  now?: Date | null
  instrument?: string | null
}): AttemptLadder {
  return finalizeLadder({
    morningAttempts: Math.max(0, Math.floor(args.morningAttempts ?? 0)),
    ibAttempts: Math.max(0, Math.floor(args.ibAttempts ?? 0)),
    lunchAttempts: Math.max(0, Math.floor(args.lunchAttempts ?? 0)),
    otherAttempts: Math.max(0, Math.floor(args.otherAttempts ?? 0)),
    morningStopHits: Math.max(0, Math.floor(args.morningStopHits ?? 0)),
    now: args.now,
    instrument: args.instrument,
  })
}

export function attemptLadderFromTotals(args: {
  attemptsUsed?: number
  stopHits?: number
  now?: Date | null
  instrument?: string | null
}): AttemptLadder {
  const used = Math.max(0, Math.floor(args.attemptsUsed ?? 0))
  const stops = Math.max(0, Math.floor(args.stopHits ?? 0))
  return finalizeLadder({
    morningAttempts: Math.min(used, MAX_MORNING_ATTEMPTS),
    ibAttempts: Math.min(
      Math.max(0, used - MAX_MORNING_ATTEMPTS),
      MAX_IB_ATTEMPTS
    ),
    lunchAttempts: Math.min(
      Math.max(0, used - MAX_MORNING_ATTEMPTS - MAX_IB_ATTEMPTS),
      MAX_LUNCH_RANGE_ATTEMPTS
    ),
    otherAttempts: Math.max(
      0,
      used - MAX_MORNING_ATTEMPTS - MAX_IB_ATTEMPTS - MAX_LUNCH_RANGE_ATTEMPTS
    ),
    morningStopHits: Math.min(stops, MAX_MORNING_ATTEMPTS),
    now: args.now,
    instrument: args.instrument,
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
    if (t >= midStart && t < midEnd && args.ladder.ibEligible) return 'us_range'
    if (t >= lateStart && t < lateEnd && args.ladder.lunchEligible) return 'ib'
    return null
  }

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
  if (
    ladder.morningAttempts >= ladder.maxMorningAttempts &&
    !ladder.ibEligible &&
    !ladder.lunchEligible
  ) {
    return tokyo
      ? 'Morning (OR30) probes used (2/2) — wait for US Range / Tokyo IB window.'
      : 'Morning (OR30) probes used (2/2) — wait for IB / lunch-range window.'
  }
  if (ladder.ibAttempts >= ladder.maxIbAttempts && !ladder.lunchEligible) {
    return tokyo
      ? 'US Range probes used (2/2) — wait for Tokyo IB window.'
      : 'IB probes used (2/2) — wait for lunch-range window.'
  }
  if (ladder.lunchAttempts >= ladder.maxLunchAttempts) {
    return tokyo
      ? 'Tokyo IB probes used (2/2) — no new entries.'
      : 'Lunch-range probes used (2/2) — no new entries.'
  }
  return null
}
