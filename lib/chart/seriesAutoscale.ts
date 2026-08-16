/**
 * Price-scale helpers for live + sim desk charts.
 *
 * Lightweight Charts merges every series on the right scale. VWAP σ / IB / OR
 * lines must report the *candle* window. Sharing the candle autoscale provider
 * means a missed skip cannot reopen the full σ range and pin bars to the top.
 *
 * Vertical window follows the *current* desk session so that session sits in
 * the middle of the pane — TradingView-style, not overnight+σ stretching the axis.
 */

import type { AutoscaleInfoProvider } from 'lightweight-charts'
import { deskSessionAt } from './sessionVwap'

export function lockToCandleAutoscale(provider: AutoscaleInfoProvider): {
  autoscaleInfoProvider: AutoscaleInfoProvider
} {
  return { autoscaleInfoProvider: provider }
}

export type SessionScaleBar = {
  time: number
  high: number
  low: number
}

const MIN_FOCUS_BARS = 6
/** If the live session is only a sliver of the window (5-day zoom-out), fit all visible bars. */
const SESSION_FOCUS_SHARE = 0.35

/** High/low of the session on the last bar; falls back to all visible bars when zoomed out. */
export function sessionFocusHighLow(
  bars: SessionScaleBar[],
  instrument?: string | null
): { min: number; max: number } | null {
  if (bars.length === 0) return null
  const last = bars[bars.length - 1]
  if (!last) return null
  const focus = deskSessionAt(last.time, instrument)
  const focused =
    focus != null
      ? bars.filter((b) => deskSessionAt(b.time, instrument) === focus)
      : bars
  const use =
    focused.length >= MIN_FOCUS_BARS &&
    focused.length >= bars.length * SESSION_FOCUS_SHARE
      ? focused
      : bars
  let min = Infinity
  let max = -Infinity
  for (const b of use) {
    if (Number.isFinite(b.low) && b.low > 0) min = Math.min(min, b.low)
    if (Number.isFinite(b.high) && b.high > 0) max = Math.max(max, b.high)
  }
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

export function paddedCandlePriceRange(
  minValue: number,
  maxValue: number,
  extraPrices: number[] = []
): { priceRange: { minValue: number; maxValue: number } } | null {
  let min = minValue
  let max = maxValue
  for (const price of extraPrices) {
    if (Number.isFinite(price) && price > 0) {
      min = Math.min(min, price)
      max = Math.max(max, price)
    }
  }
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return null
  const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.0004)
  return {
    priceRange: {
      minValue: min - pad,
      maxValue: max + pad,
    },
  }
}
