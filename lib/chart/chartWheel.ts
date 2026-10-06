/**
 * Wheel ownership for the live desk chart.
 *
 * Lightweight Charts already zooms time and scales price when the pointer is
 * over the plot, the time axis, or the price axis. A second zoom on that same
 * event stretches the bars and time-zooms a price-axis scroll.
 */

/** True when this wheel landed on the chart Lightweight Charts owns. */
export function chartOwnsWheel(target: Node | null, chartRoot: Node | null): boolean {
  if (!target || !chartRoot) return false
  return chartRoot.contains(target)
}

/**
 * Quiet tape keeps badge state on the latency cadence. A burst — the cash
 * open, when dozens of prints arrive each second — stretches React commits
 * so the candle canvas keeps the frame. The header ticker is a separate store.
 */
export function livePriceStateGapMs(
  ticksInWindow: number,
  quietMs: number,
  burstMs: number
): number {
  if (!(quietMs > 0)) return burstMs
  return ticksInWindow > 12 ? Math.max(quietMs, burstMs) : quietMs
}
