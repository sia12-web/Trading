/**
 * Context 5-5 overlay geometry — compact FRVP histograms at each range start.
 * Profiles scroll with the time axis (TradingView-style). Zoom/pan left to
 * the 5-day / yesterday / overnight open to see them; they are not glued to
 * the visible left edge or stretched across the session.
 */

import type { VolumeProfileBin } from './context55'

export const CONTEXT55_FRVP_5D_W = 56
export const CONTEXT55_FRVP_YDAY_W = 44
export const CONTEXT55_FRVP_ON_W = 44

/** True when any part of a compact histogram at `x` is on the pane. */
export function profileIntersectsPane(
  x: number | null | undefined,
  histW: number,
  paneW: number
): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x + histW > 0 && x < paneW
}

/**
 * Histogram width at the range open. Never stretch across the session —
 * keep a thin TradingView-style column, shrinking further when zoomed out.
 */
export function compactProfileWidth(
  rangePx: number | null | undefined,
  cap: number
): number {
  const floor = Math.min(28, cap)
  if (rangePx == null || !Number.isFinite(rangePx) || rangePx <= 0) return cap
  return Math.max(floor, Math.min(cap, rangePx * 0.12))
}

/**
 * POC line spans the profiled range (open → close), not just the thin histogram.
 * Returns null when the entire range is off-pane.
 */
export function rangePocLineX(
  startX: number | null | undefined,
  endX: number | null | undefined,
  paneW: number
): { x0: number; x1: number } | null {
  const a = typeof startX === 'number' && Number.isFinite(startX) ? startX : null
  const b = typeof endX === 'number' && Number.isFinite(endX) ? endX : null
  if (a == null && b == null) return null
  const x0 = a ?? 0
  const x1 = b ?? paneW
  const lo = Math.min(x0, x1)
  const hi = Math.max(x0, x1)
  if (hi <= 0 || lo >= paneW) return null
  return { x0, x1 }
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

/** TradingView Background #1 — fill between ±1σ. Off-pane σ still tints the visible slice. */
export function paintAnchoredVwapSigmaFill(
  ctx: CanvasRenderingContext2D,
  args: {
    upper: { time: number; value: number }[]
    lower: { time: number; value: number }[]
    paneW: number
    paneH: number
    timeToX: (time: number) => number | null
    priceToY: (price: number) => number | null
    fill: string
  }
): void {
  const { upper, lower, paneW, paneH, timeToX, priceToY, fill } = args
  if (upper.length < 2 || lower.length < 2) return
  const top: Array<{ x: number; y: number }> = []
  const bot: Array<{ x: number; y: number }> = []
  for (const p of upper) {
    const x = timeToX(p.time)
    const y = priceToY(p.value)
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    top.push({ x, y })
  }
  for (const p of lower) {
    const x = timeToX(p.time)
    const y = priceToY(p.value)
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    bot.push({ x, y })
  }
  if (top.length < 2 || bot.length < 2) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, paneW, paneH)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(top[0]!.x, top[0]!.y)
  for (let i = 1; i < top.length; i++) ctx.lineTo(top[i]!.x, top[i]!.y)
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i]!.x, bot[i]!.y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}
