import { liveTipDisagreesWithBook } from '@/lib/chart/liveFormingBar'

export type TapeBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Roll 1m CME bars up to the requested desk resolution. Input is oldest-first. */
export function aggregateLiveBars<T extends TapeBar>(bars: T[], stepSec: number): T[] {
  if (!(stepSec > 0)) return bars.slice()
  const out: T[] = []
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / stepSec) * stepSec
    const cur = out[out.length - 1]
    if (!cur || cur.time !== bucket) {
      out.push({
        ...bar,
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
    } else {
      cur.high = Math.max(cur.high, bar.high)
      cur.low = Math.min(cur.low, bar.low)
      cur.close = bar.close
      cur.volume += bar.volume
    }
  }
  return out
}

/**
 * Union Historical 1m + sidecar live 1m. Live wins on the same timestamp so the
 * forming bar and the last closed minute are never overwritten by a lagged hist print.
 */
export function mergeTapeBars(hist: TapeBar[], live: TapeBar[]): TapeBar[] {
  const byTime = new Map<number, TapeBar>()
  for (const bar of hist) {
    if (Number.isFinite(bar?.time) && Number.isFinite(bar?.close) && bar.close > 0) {
      byTime.set(bar.time, bar)
    }
  }
  for (const bar of live) {
    if (Number.isFinite(bar?.time) && Number.isFinite(bar?.close) && bar.close > 0) {
      byTime.set(bar.time, bar)
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/**
 * True when the sidecar/hist tape still has a hole after the delayed vendor last bar.
 * In that case we must hit Historical 1m — live-only overlay is a single forming bar
 * and fillCandleGaps would paint flats or leave a visible gap.
 */
export function liveTapeHasVendorGap(
  tape1m: TapeBar[] | null | undefined,
  vendorLastSec: number,
  _stepSec: number
): boolean {
  if (!tape1m?.length) return true
  const first = tape1m[0]!.time
  // Forming-only after a sidecar restart is "now", which is still a hole
  // after a delayed Yahoo last. Require coverage from the vendor bucket.
  return first > vendorLastSec + 60
}

/**
 * Splice real CME tape onto a delayed Yahoo/OANDA book.
 *
 * Skip only when an overlapping *same-timestamp* bar is a different contract
 * (e.g. CLV6 ~97 vs CLX6 ~93). Never compare live *now* to a vendor bar from
 * ten minutes ago — a real move across the Yahoo lag window is not a mismatch,
 * and skipping it is what painted delayed bars and holes.
 */
export function overlayVendorWithTape<T extends TapeBar>(
  vendor: T[],
  tape1m: TapeBar[],
  stepSec: number,
  instrument?: string | null
): { candles: T[]; applied: boolean } {
  if (!vendor.length || !tape1m.length) {
    return { candles: vendor, applied: false }
  }
  const merged = aggregateLiveBars(tape1m, stepSec) as T[]
  if (!merged.length) return { candles: vendor, applied: false }

  const overlapVendor = vendor.filter((c) => merged.some((m) => m.time === c.time))
  const check = overlapVendor[overlapVendor.length - 1]
  if (check) {
    const tapeBar = merged.find((m) => m.time === check.time)
    if (tapeBar && liveTipDisagreesWithBook(tapeBar.close, check.close, instrument)) {
      return { candles: vendor, applied: false }
    }
  }

  const firstLive = merged[0]!.time
  const kept = vendor.filter((c) => c.time < firstLive)
  const overlap = vendor.find((c) => c.time === firstLive)
  if (overlap) {
    const live = merged[0]!
    merged[0] = {
      ...live,
      time: live.time,
      open: overlap.open,
      high: Math.max(overlap.high, live.high),
      low: Math.min(overlap.low, live.low),
      close: live.close,
      volume: Math.max(overlap.volume, live.volume),
    }
  }
  return { candles: [...kept, ...merged], applied: true }
}
