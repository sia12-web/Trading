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

/**
 * Context 5-5 levels that may join the candle Y-axis.
 *
 * Never put 5-month ±σ on this list: NASDAQ 5M σ is ~1,300 pts, so ±2σ
 * (~5,000 pt span) flattens session candles into a hairline. VWAP itself is
 * nearby-only so a drifted 5-month mean cannot yank the scale either.
 */
export function context55ScalePrices(args: {
  vwap?: number | null
  poc5d?: number | null
  vah5d?: number | null
  val5d?: number | null
  yPoc?: number | null
  yHigh?: number | null
  yLow?: number | null
  onPoc?: number | null
}): { always: number[]; nearby: number[] } {
  const take = (price: number | null | undefined): number[] =>
    typeof price === 'number' && Number.isFinite(price) && price > 0 ? [price] : []
  return {
    always: [...take(args.poc5d), ...take(args.yPoc), ...take(args.onPoc)],
    nearby: [
      ...take(args.vwap),
      ...take(args.vah5d),
      ...take(args.val5d),
      ...take(args.yHigh),
      ...take(args.yLow),
    ],
  }
}

/**
 * Keep FRVP POCs on the pane. Pull in 5M VWAP / VA only when they sit near
 * the session so a 5-month mean or σ (~thousands of NASDAQ points) cannot
 * flatten candles.
 */
export function overlayPricesForVisibleScale(
  sessionMin: number,
  sessionMax: number,
  overlay: { always?: number[]; nearby?: number[] } | number[],
  maxSessionMultiples = 4
): number[] {
  const always = Array.isArray(overlay) ? overlay : overlay.always ?? []
  const nearby = Array.isArray(overlay) ? [] : overlay.nearby ?? []
  const span = Math.max(sessionMax - sessionMin, Math.abs(sessionMax) * 0.0008)
  const lo = sessionMin - span * maxSessionMultiples
  const hi = sessionMax + span * maxSessionMultiples
  const out: number[] = []
  const add = (p: number) => {
    if (Number.isFinite(p) && p > 0 && !out.includes(p)) out.push(p)
  }
  for (const p of always) add(p)
  for (const p of nearby) {
    if (p >= lo && p <= hi) add(p)
  }
  return out
}
