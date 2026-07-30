/**
 * Reject absurdly tight stops (e.g. entry±1 after bad limit clamp / snap).
 */

import { instrumentTick, snapStopToTick } from '@/lib/trading/instrumentTicks'

/** Minimum protective distance in ticks (NIKKEI tick=1 → 10 pts). */
export const MIN_STOP_DISTANCE_TICKS = 10

export function minStopDistancePoints(instrument: string): number {
  return instrumentTick(instrument) * MIN_STOP_DISTANCE_TICKS
}

export type ProtectiveStopResult =
  | { ok: true; stop: number; distance: number }
  | { ok: false; message: string }

/** Validate stop is on the protective side with minimum distance from entry/limit. */
export function assertProtectiveStop(args: {
  instrument: string
  entry: number
  stop: number
  direction: 'LONG' | 'SHORT'
  /** Planned stop before tick snap — used to detect silent corruption */
  plannedStop?: number
}): ProtectiveStopResult {
  const entry = Number(args.entry)
  const planned = Number(args.plannedStop ?? args.stop)
  const direction = args.direction

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(planned) || planned <= 0) {
    return { ok: false, message: 'Invalid entry or stop loss' }
  }

  const tick = instrumentTick(args.instrument)
  const minDist = minStopDistancePoints(args.instrument)

  if (direction === 'LONG' && planned >= entry) {
    return {
      ok: false,
      message: `LONG stop must be below limit ${entry.toLocaleString()} — planned ${planned.toLocaleString()}`,
    }
  }
  if (direction === 'SHORT' && planned <= entry) {
    return {
      ok: false,
      message: `SHORT stop must be above limit ${entry.toLocaleString()} — planned ${planned.toLocaleString()}`,
    }
  }

  const snapped = snapStopToTick(args.instrument, entry, planned, direction)
  const distance = Math.abs(entry - snapped)

  if (distance < minDist) {
    return {
      ok: false,
      message: `Stop ${snapped.toLocaleString()} is only ${distance} pts from limit ${entry.toLocaleString()} — minimum ${minDist} pts. Check limit price and stop (planned ${planned.toLocaleString()}).`,
    }
  }

  // Snap collapsed a valid planned stop onto entry±1 (clampPriceToRangeEdgeBands bug pattern)
  if (
    Number.isFinite(planned) &&
    Math.abs(planned - snapped) > minDist &&
    distance <= tick * 2
  ) {
    return {
      ok: false,
      message: `Stop snapped to ${snapped.toLocaleString()} (only ${distance} pts from limit ${entry.toLocaleString()}) — planned ${planned.toLocaleString()}. Limit price may have been moved — re-place at your structure level.`,
    }
  }

  return { ok: true, stop: snapped, distance }
}
