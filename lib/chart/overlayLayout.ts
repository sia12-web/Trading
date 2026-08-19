/**
 * Imperative placement for chart overlays (entry/SL/TP pills, alert pill,
 * highlight boxes). Positions are written straight to the DOM from a single
 * layout pass so panning never has to go through a React render.
 *
 * Nodes opt in with data attributes; the pass reads every coordinate before it
 * writes any style so the batch costs one layout flush, not one per node.
 */

/** Single price → vertical placement (pane-relative, plus `OV_DY` nudge). */
export const OV_PRICE = 'data-ov-price'
/** Comma-separated prices → vertical span (top = min, height = max − min). */
export const OV_SPAN = 'data-ov-span'
/** "high,low" prices for a 2D box — raw pane coordinates, no host offset. */
export const OV_BOX_PRICE = 'data-ov-box-price'
/** "from,to" chart times for a 2D box. */
export const OV_BOX_TIME = 'data-ov-box-time'
/** Static pixel nudge so a pill centres on its line. */
export const OV_DY = 'data-ov-dy'

export const OVERLAY_NODE_SELECTOR = `[${OV_PRICE}],[${OV_SPAN}],[${OV_BOX_PRICE}]`

/**
 * Parked far above the (clipped) chart frame. Cheaper and less layout-thrashy
 * than toggling `display`, and it never fights React's style diffing.
 */
export const OVERLAY_HIDDEN_TRANSFORM = 'translate3d(0,-99999px,0)'

export function overlayNumbers(raw: string | null): number[] {
  if (!raw) return []
  const out: number[] = []
  for (const part of raw.split(',')) {
    const n = Number(part)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

/**
 * Transform is written unconditionally: the browser re-serialises the value so
 * a read-back comparison is unreliable, and a stale skip would strand an
 * overlay away from its price level.
 */
export function overlayHide(el: HTMLElement): void {
  el.style.transform = OVERLAY_HIDDEN_TRANSFORM
}

export function overlayPlace(
  el: HTMLElement,
  x: number,
  y: number,
  width?: number,
  height?: number
): void {
  el.style.transform = `translate3d(${px(x)},${px(y)},0)`
  if (width != null) {
    const w = px(Math.max(width, 0))
    if (el.style.width !== w) el.style.width = w
  }
  if (height != null) {
    const h = px(Math.max(height, 0))
    if (el.style.height !== h) el.style.height = h
  }
}
