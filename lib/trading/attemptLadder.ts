/**
 * Live desk attempt ladder (per-window 2 / 2 / 2, session cap ≤ 3):
 *
 *   DOW / NASDAQ: Morning (OR30) → IB → Lunch-range
 *   NIKKEI:       Morning (OR30) → US Range (prior NYC) → IB
 *
 * Each window: up to 2 fills @ range-edge risk, BUT the session (day) total
 * is hard-capped at 3 trades regardless of profit/loss or which window still
 * shows spare probes — once 3 fills land, every window locks.
 * Next window unlocks when prior clock ends OR prior attempts exhausted
 * (still subject to the session cap above).
 * Skip-forward: unused earlier window still unlocks later once its clock ends.
 *
 * Storage keeps morning / ib / lunch counters (slot 1 / 2 / 3).
 * On TOKYO, slot 2 = US Range fills, slot 3 = IB fills (labels differ).
 *
 * NY IB entry starts at 10:30 ET (when first-hour IB locks) and stays open
 * until lunch-range entry starts (13:30 ET) — not a tiny 15-minute slice.
 * Tokyo US Range opens at cash open 09:00 JST (prior NYC already shaped);
 * optional OR30 still owns 09:30–09:45 when morning probes remain.
 * Tokyo IB entries unlock at first-hour lock 10:00 JST (= 21:00 Montreal),
 * overlapping the tail of US Range (through 10:45 JST / 21:45 Montreal),
 * and run through cash close (15:00 JST / 02:00 Montreal).
 */

import { parseTimeToSeconds } from '@/lib/utils/timeUtils'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalRangeAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'

export const MAX_MORNING_ATTEMPTS = 2
export const MAX_IB_ATTEMPTS = 2
export const MAX_LUNCH_RANGE_ATTEMPTS = 2
/** Hard session (day) cap — max 3 trades per session, win/loss/breakeven all count. */
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
  /** Explicit bucket recorded at fill time (see rangeBucket column) — preferred
   *  over clock classification once IB/Lunch windows can overlap. */
  rangeBucket?: AttemptBucket | null
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
    /**
     * Slot 2 — IB from first-hour lock (10:30) until lunch-range opens (13:30).
     * midEnd === lateStart so lunch never steals IB before lunch starts.
     */
    midStart: '10:30:00',
    midEnd: '13:30:00',
    /** Slot 3 — Lunch-range */
    lateStart: '13:30:00',
    lateEnd: '15:15:00',
  },
  TOKYO: {
    tz: 'Asia/Tokyo',
    /** Slot 2 — US Range from cash open (prior NYC already shaped) */
    midStart: '09:00:00',
    midEnd: '10:45:00',
    /**
     * Slot 3 — Tokyo IB entries from first-hour lock (10:00 JST = 21:00 Montreal)
     * through cash close (15:00 JST = 02:00 Montreal). Overlaps US Range 10:00–10:45.
     */
    lateStart: '10:00:00',
    lateEnd: '15:00:00',
  },
} as const

/** Optional Nikkei OR30 probe window — owns the morning attempt bucket. */
const TOKYO_OR30_MORNING = { start: '09:30:00', end: '09:45:00' } as const

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

  if (market === 'TOKYO') {
    const or30Start = parseTimeToSeconds(TOKYO_OR30_MORNING.start)
    const or30End = parseTimeToSeconds(TOKYO_OR30_MORNING.end)
    // Optional OR30 probes count as morning even though US Range window overlaps
    if (t >= or30Start && t < or30End) return 'morning'
    if (t >= midStart && t < midEnd) return 'ib'
    if (t >= lateStart && t < lateEnd) return 'lunch_range'
    if (t < midStart) return 'morning'
    return 'other'
  }

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

/** Mid slot released → late slot may take budget.
 *  NY: after IB clock ends (midEnd = lunch-range start) or mid probes exhausted.
 *  Tokyo: after first-hour IB locks (lateStart = 10:00) or US probes exhausted —
 *  so Tokyo IB is tradable from 21:00 Montreal while US Range may still run to 21:45.
 */
export function isMidWindowReleased(args: {
  ibAttempts: number
  now?: Date | null
  instrument?: string | null
}): boolean {
  if (args.ibAttempts >= MAX_IB_ATTEMPTS) return true
  if (!args.now) return args.ibAttempts === 0
  const market = marketFor(args.instrument)
  const c = CLOCK[market]
  const releaseAt =
    market === 'TOKYO'
      ? parseTimeToSeconds(c.lateStart)
      : parseTimeToSeconds(c.midEnd)
  return clockSec(args.now, market) >= releaseAt
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
    // Prefer the bucket recorded at fill time (price-attributed) — clock-only
    // classification breaks once IB's window overlaps lunch-range.
    const bucket: AttemptBucket =
      f.rangeBucket === 'morning' ||
      f.rangeBucket === 'ib' ||
      f.rangeBucket === 'lunch_range' ||
      f.rangeBucket === 'other'
        ? f.rangeBucket
        : classifyAttemptBucket(inst, f.entryTimestamp)
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
    const or30Start = parseTimeToSeconds(TOKYO_OR30_MORNING.start)
    const or30End = parseTimeToSeconds(TOKYO_OR30_MORNING.end)
    // Optional OR30 owns 09:30–09:45 when morning probes remain
    if (
      t >= or30Start &&
      t < or30End &&
      args.ladder.morningEligible
    ) {
      return null
    }
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
    return `Session ${ladder.dayAttempts}/${ladder.maxDayAttempts} · AM ${ladder.morningAttempts}/${ladder.maxMorningAttempts} · US ${ladder.ibAttempts}/${ladder.maxIbAttempts} · IB ${ladder.lunchAttempts}/${ladder.maxLunchAttempts}`
  }
  return `Session ${ladder.dayAttempts}/${ladder.maxDayAttempts} · AM ${ladder.morningAttempts}/${ladder.maxMorningAttempts} · IB ${ladder.ibAttempts}/${ladder.maxIbAttempts} · LN ${ladder.lunchAttempts}/${ladder.maxLunchAttempts}`
}

export function attemptLadderLockReason(
  ladder: AttemptLadder,
  instrument?: string | null
): string | null {
  const tokyo = instrument === 'NIKKEI'
  if (ladder.dayLocked) {
    return `Session attempt cap hit (${ladder.dayAttempts}/${ladder.maxDayAttempts}). Trading switched off.`
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

// ── Explicit-range attribution (click-to-enter) ─────────────────────────────
//
// The functions above resolve a single SEQUENTIAL "active" range for the desk
// clock (morning → IB/US Range → lunch/Tokyo-IB) — used for the default chart
// highlight and SL/TP magnets. That picker intentionally "moves on" once a
// window's clock ends, even if that window's probes were never used.
//
// When the trader explicitly clicks a SPECIFIC painted ±10 band (e.g. IB while
// the picker has already moved on to Lunch-range), the entry must be billed
// against THAT range's own quota/window — never silently re-billed to
// whichever range the sequential picker currently favors. The functions below
// answer "is this NAMED range still open for its OWN probes" independent of
// the single active pick.

/** Storage bucket a painted range label bills against (NY vs TOKYO differ —
 *  see file header: Tokyo slot-2 "US Range" lives in the `ib` counter, and
 *  Tokyo slot-3 "Tokyo IB" lives in the `lunch_range` counter). */
export function bucketForRangeLabel(
  instrument: string | null | undefined,
  label: string | null | undefined
): AttemptBucket | null {
  if (!label) return null
  const tokyo = instrument === 'NIKKEI'
  if (label === 'OR30') return 'morning'
  if (label === 'IB') return tokyo ? null : 'ib'
  if (label === 'Tokyo IB') return tokyo ? 'lunch_range' : null
  if (label === 'US Range') return tokyo ? 'ib' : null
  if (label === 'Lunch-range') return tokyo ? null : 'lunch_range'
  return null
}

/** Trader-facing name for a bucket (NY vs TOKYO labels differ). */
export function bucketDisplayLabel(
  bucket: AttemptBucket,
  instrument?: string | null
): string {
  const tokyo = instrument === 'NIKKEI'
  if (bucket === 'morning') return 'Morning (OR30)'
  if (bucket === 'ib') return tokyo ? 'US Range' : 'IB'
  if (bucket === 'lunch_range') return tokyo ? 'Tokyo IB' : 'Lunch-range'
  return 'range'
}

/**
 * Bucket's own entry-window bounds (desk-local seconds) — independent of the
 * single sequential picker. NY IB runs 10:30 → lunch-range start (13:30 ET)
 * so leftover IB probes stay clickable until lunch opens (not through LN).
 * Tokyo US Range stays 09:00–10:45; Tokyo IB opens at first-hour lock
 * (10:00–15:00) and may overlap US for the last 45 minutes.
 */
export function bucketWindowSec(
  market: DeskMarket,
  bucket: AttemptBucket
): { start: number; end: number } | null {
  const c = CLOCK[market]
  if (bucket === 'ib') {
    return {
      start: parseTimeToSeconds(c.midStart),
      // NY: IB ends when lunch-range starts (midEnd === lateStart).
      end: parseTimeToSeconds(c.midEnd),
    }
  }
  if (bucket === 'lunch_range') {
    return {
      start: parseTimeToSeconds(c.lateStart),
      end: parseTimeToSeconds(c.lateEnd),
    }
  }
  // Morning/OR30's own lock + entry-close window is a short slice inside the
  // first hour (varies NY vs Tokyo) and is already enforced upstream by
  // isOr30MorningEntryWindowOpen / the session-gate FLAT phase — do not
  // duplicate/second-guess that narrower clock here.
  return null
}

export function isBucketWindowOpen(
  market: DeskMarket,
  bucket: AttemptBucket,
  timeSec: number
): boolean {
  if (bucket === 'morning') return true
  const w = bucketWindowSec(market, bucket)
  if (!w) return false
  return timeSec >= w.start && timeSec < w.end
}

function bucketEligible(ladder: AttemptLadder, bucket: AttemptBucket): boolean {
  if (bucket === 'morning') return ladder.morningEligible
  if (bucket === 'ib') return ladder.ibEligible
  if (bucket === 'lunch_range') return ladder.lunchEligible
  return false
}

function bucketCounts(
  ladder: AttemptLadder,
  bucket: AttemptBucket
): { used: number; max: number } {
  if (bucket === 'morning') return { used: ladder.morningAttempts, max: ladder.maxMorningAttempts }
  if (bucket === 'ib') return { used: ladder.ibAttempts, max: ladder.maxIbAttempts }
  return { used: ladder.lunchAttempts, max: ladder.maxLunchAttempts }
}

/** Trader-facing unlock hours for a bucket's own entry window (Montreal times). */
export function bucketWindowUnlockMessage(
  market: DeskMarket,
  bucket: AttemptBucket,
  instrument?: string | null,
  now: Date = new Date()
): string {
  const label = bucketDisplayLabel(bucket, instrument)
  const c = CLOCK[market]
  if (bucket === 'ib') {
    if (market === 'TOKYO') {
      const win = deskLocalRangeAsTraderDisplay(c.midStart, c.midEnd, c.tz, now)
      return `${label} entries unlock ${win} (after Morning/OR30 ends or morning probes are exhausted).`
    }
    const win = deskLocalRangeAsTraderDisplay(c.midStart, c.midEnd, c.tz, now)
    return `${label} entries unlock ${win} — open until lunch-range starts (after Morning/OR30 ends or morning probes are exhausted).`
  }
  if (bucket === 'lunch_range') {
    if (market === 'TOKYO') {
      const win = deskLocalRangeAsTraderDisplay(c.lateStart, c.lateEnd, c.tz, now)
      return `${label} entries unlock ${win} (after first-hour IB locks, or sooner if US Range probes are exhausted).`
    }
    const win = deskLocalRangeAsTraderDisplay(c.lateStart, c.lateEnd, c.tz, now)
    return `${label} entries unlock ${win} (after IB ends or IB probes are exhausted).`
  }
  return `${label} entry window is not open right now (${TRADER_DISPLAY_LABEL}).`
}

/**
 * Explicit-target entry gate: given the SPECIFIC range label the trader
 * clicked, check that range's own attempt budget + window — never the
 * single sequential "active" range. Fixes IB clicks being mis-billed to
 * Lunch (and vice versa) once windows can overlap in the afternoon.
 */
export function assertBucketEntryEligible(args: {
  instrument: string
  market: DeskMarket
  timeSec: number
  ladder: AttemptLadder
  rangeLabel: string | null | undefined
}): { ok: true; bucket: AttemptBucket } | { ok: false; message: string } {
  const bucket = bucketForRangeLabel(args.instrument, args.rangeLabel)
  if (!bucket) {
    return {
      ok: false,
      message: `Unrecognized range "${args.rangeLabel ?? 'unknown'}" for ${args.instrument}.`,
    }
  }
  const label = bucketDisplayLabel(bucket, args.instrument)
  if (args.ladder.dayLocked) {
    return {
      ok: false,
      message: `Session attempt cap hit (${args.ladder.dayAttempts}/${args.ladder.maxDayAttempts}). Trading switched off.`,
    }
  }
  const { used, max } = bucketCounts(args.ladder, bucket)
  // Exhaustion only — never claim "probes used (0/2)" when the bucket is merely
  // locked behind a prior window / outside its own clock.
  if (used >= max) {
    return {
      ok: false,
      message: `${label} probes used (${used}/${max}) — no new entries in this range.`,
    }
  }
  if (!isBucketWindowOpen(args.market, bucket, args.timeSec)) {
    return {
      ok: false,
      message: bucketWindowUnlockMessage(args.market, bucket, args.instrument),
    }
  }
  if (!bucketEligible(args.ladder, bucket)) {
    return {
      ok: false,
      message: `${label} not unlocked yet — wait for the prior range window to end or exhaust its probes.`,
    }
  }
  return { ok: true, bucket }
}

/** Desk-local clock seconds for this instrument's market (NY vs Tokyo). */
export function deskClockSeconds(
  instrument: string | null | undefined,
  now: Date = new Date()
): number {
  return clockSec(now, marketFor(instrument))
}
