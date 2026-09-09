/**
 * Context 5-5 overlay geometry — sticky FRVP histograms + on-pane level lines.
 * 5-day FRVP is computed from the last 5 sessions but must paint on the
 * *visible* pane (default zoom is ~90 bars, so the 5-day anchor is off-screen).
 */

import type { VolumeProfileBin } from './context55'

export const CONTEXT55_FRVP_LEFT = 6
export const CONTEXT55_FRVP_5D_W = 92
export const CONTEXT55_FRVP_YDAY_W = 68
export const CONTEXT55_FRVP_ON_W = 68
export const CONTEXT55_FRVP_GAP = 4

const SLOT_WIDTHS = [
  CONTEXT55_FRVP_5D_W,
  CONTEXT55_FRVP_YDAY_W,
  CONTEXT55_FRVP_ON_W,
] as const

/** Left-edge X for sticky profile slot 0=5D, 1=yesterday, 2=overnight. */
export function stickyLeftX(slot: 0 | 1 | 2): number {
  let x = CONTEXT55_FRVP_LEFT
  for (let i = 0; i < slot; i++) x += SLOT_WIDTHS[i]! + CONTEXT55_FRVP_GAP
  return x
}

/**
 * Use the session's time-axis X when that session is on screen; otherwise park
 * the histogram in a sticky left slot so the profile never disappears.
 */
export function profileXOnPaneOrSticky(
  timeX: number | null | undefined,
  paneW: number,
  histW: number,
  stickyX: number
): number {
  if (timeX == null || !Number.isFinite(timeX)) return stickyX
  if (timeX + histW < 0 || timeX > paneW) return stickyX
  return timeX
}

export function paintVolumeProfileBins(
  ctx: CanvasRenderingContext2D,
  args: {
    bins: VolumeProfileBin[]
    bucketSize: number
    x: number
    maxW: number
    paneH: number
    priceToY: (price: number) => number | null
    buyFillVa: string
    buyFill: string
    sellFillVa: string
    sellFill: string
  }
): void {
  const { bins, bucketSize, x, maxW, paneH, priceToY } = args
  if (bins.length === 0 || maxW < 2) return
  const halfBucket = (bucketSize || 1) * 0.5
  const maxBinVol = Math.max(...bins.map((b) => b.volume), 1)

  for (const bin of bins) {
    const yTop = priceToY(bin.price + halfBucket)
    const yBottom = priceToY(bin.price - halfBucket)
    if (yTop == null || yBottom == null) continue

    const barY = Math.min(yTop, yBottom)
    const barH = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5)
    if (barY + barH < 0 || barY > paneH) continue

    const totalBarW = (bin.volume / maxBinVol) * maxW
    if (totalBarW < 1) continue

    const buyVol = bin.buyVolume ?? bin.volume * 0.5
    const buyRatio = bin.volume > 0 ? Math.max(0, Math.min(1, buyVol / bin.volume)) : 0.5
    const buyW = totalBarW * buyRatio
    const sellW = totalBarW - buyW

    ctx.fillStyle = bin.inValueArea ? args.buyFillVa : args.buyFill
    ctx.fillRect(x, barY, buyW, barH)
    ctx.fillStyle = bin.inValueArea ? args.sellFillVa : args.sellFill
    ctx.fillRect(x + buyW, barY, sellW, barH)
  }
}

export function paintLevelLine(
  ctx: CanvasRenderingContext2D,
  y: number | null,
  paneW: number,
  paneH: number,
  color: string,
  label: string,
  x0 = 0,
  x1 = paneW,
  dashed = false,
  labelAlign: 'left' | 'right' = 'left'
): void {
  if (y == null || !Number.isFinite(y) || y < 0 || y > paneH) return
  const yPix = Math.round(y) + 0.5
  const start = Math.max(0, Math.min(x0, x1))
  const end = Math.min(paneW, Math.max(x0, x1, start + 8))
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = dashed ? 1 : 2
  if (dashed) ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(start, yPix)
  ctx.lineTo(end, yPix)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace'
  ctx.fillStyle = color
  ctx.textAlign = labelAlign
  ctx.fillText(
    label,
    labelAlign === 'right' ? Math.max(end - 8, 80) : Math.min(start + 6, paneW - 80),
    y - 4
  )
  ctx.restore()
}
