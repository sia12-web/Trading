/**
 * Detect missing CME 5m (or other) slots so the desk can reprint from Databento + Yahoo.
 * Session/weekend holes (≥ DESK_SESSION_GAP_SEC) are intentional — not gaps.
 */

import { DESK_LIVE_BAR_SEC, DESK_SESSION_GAP_SEC } from '@/lib/chart/liveFormingBar'

export type TimedBar = { time: number }

/** Missing bar-open unix times between first and last print (skips session halts). */
export function findMissingBarTimes(
  bars: TimedBar[],
  barSec: number = DESK_LIVE_BAR_SEC,
  sessionGapSec: number = DESK_SESSION_GAP_SEC
): number[] {
  if (bars.length < 2 || !(barSec > 0)) return []
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const missing: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.time
    const cur = sorted[i]!.time
    const dt = cur - prev
    if (dt <= barSec) continue
    if (dt >= sessionGapSec) continue
    for (let t = prev + barSec; t < cur; t += barSec) {
      missing.push(t)
    }
  }
  return missing
}

/** Gaps in the last `lookbackBars` prints — what the trader sees at the tip. */
export function countNearTipGaps(
  bars: TimedBar[],
  lookbackBars = 48,
  barSec: number = DESK_LIVE_BAR_SEC
): number {
  if (bars.length < 2) return 0
  const tip = bars.slice(-Math.max(2, lookbackBars))
  return findMissingBarTimes(tip, barSec).length
}

/**
 * True when the held book's typical spacing matches `barSec`.
 * After a timeframe switch the prior TF may still be on screen — do not gap-detect
 * 5m bars with a 1m barSec (invents holes) or 1m with 30m (misses real holes).
 */
export function bookMatchesBarSec(
  bars: TimedBar[],
  barSec: number,
  sample = 12
): boolean {
  if (!(barSec > 0) || bars.length < 2) return false
  const tip = bars.slice(-Math.max(2, sample))
  const diffs: number[] = []
  for (let i = 1; i < tip.length; i++) {
    const dt = tip[i]!.time - tip[i - 1]!.time
    if (dt > 0 && dt < DESK_SESSION_GAP_SEC) diffs.push(dt)
  }
  if (diffs.length === 0) return false
  diffs.sort((a, b) => a - b)
  const median = diffs[Math.floor(diffs.length / 2)]!
  return median >= barSec * 0.75 && median <= barSec * 1.5
}

/** True when wall clock is ahead of the last closed bar by more than one slot. */
export function tipLagSlots(
  lastBarUnix: number,
  wallUnix: number = Math.floor(Date.now() / 1000),
  barSec: number = DESK_LIVE_BAR_SEC
): number {
  if (!(lastBarUnix > 0) || !(barSec > 0)) return 0
  const expectedOpen = Math.floor(wallUnix / barSec) * barSec
  if (expectedOpen <= lastBarUnix) return 0
  return Math.round((expectedOpen - lastBarUnix) / barSec)
}

export function needsCandleReprint(args: {
  bars: TimedBar[]
  wallUnix?: number
  barSec?: number
  nearTipLookback?: number
  maxNearTipGaps?: number
  maxTipLagSlots?: number
}): boolean {
  const barSec = args.barSec ?? DESK_LIVE_BAR_SEC
  const near = countNearTipGaps(args.bars, args.nearTipLookback ?? 48, barSec)
  if (near >= (args.maxNearTipGaps ?? 1)) return true
  const last = args.bars[args.bars.length - 1]
  if (!last) return false
  const lag = tipLagSlots(last.time, args.wallUnix, barSec)
  return lag >= (args.maxTipLagSlots ?? 2)
}
