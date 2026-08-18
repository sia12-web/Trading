/**
 * Map pointer / overlay Y through the lightweight-charts pane.
 * series.priceToCoordinate / coordinateToPrice are pane-relative — not the
 * outer chart box (time axis, price axis, fullscreen / zoom chrome).
 */

import type { ISeriesApi } from 'lightweight-charts'

export function chartPaneElement(container: HTMLElement | null): HTMLElement | null {
  if (!container) return null
  const cell = container.querySelector('table tr td')
  if (cell instanceof HTMLElement) return cell
  const canvases = Array.from(container.querySelectorAll('canvas'))
  let best: HTMLCanvasElement | null = null
  let bestArea = 0
  for (const c of canvases) {
    const area = c.clientWidth * c.clientHeight
    if (area > bestArea) {
      best = c
      bestArea = area
    }
  }
  return best
}

export function clampClientYToPane(paneTop: number, paneHeight: number, clientY: number): number {
  if (!(paneHeight > 0) || !Number.isFinite(paneTop) || !Number.isFinite(clientY)) {
    return 0
  }
  return Math.min(Math.max(clientY - paneTop, 0), paneHeight)
}

export function overlayYOffset(paneTop: number, overlayTop: number): number {
  if (!Number.isFinite(paneTop) || !Number.isFinite(overlayTop)) return 0
  return paneTop - overlayTop
}

export function paneYFromClientY(container: HTMLElement | null, clientY: number): number | null {
  if (!container || !Number.isFinite(clientY)) return null
  const pane = chartPaneElement(container) ?? container
  const rect = pane.getBoundingClientRect()
  if (!(rect.height > 0)) return null
  return clampClientYToPane(rect.top, rect.height, clientY)
}

export function priceFromClientY(
  container: HTMLElement | null,
  series: { coordinateToPrice: (y: number) => number | null } | null,
  clientY: number
): number | null {
  if (!container || !series) return null
  const y = paneYFromClientY(container, clientY)
  if (y == null) return null
  const raw = series.coordinateToPrice(y)
  if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return null
  return Number(raw)
}

/** True when the pointer is on (or just inside) the right price scale. */
export function clickIsOnPriceScale(container: HTMLElement | null, clientX: number): boolean {
  if (!container || !Number.isFinite(clientX)) return false
  const tds = container.querySelectorAll('table tr td')
  const axis = tds.length >= 2 ? tds[tds.length - 1] : null
  if (axis instanceof HTMLElement) {
    const r = axis.getBoundingClientRect()
    if (r.width > 0) return clientX >= r.left - 8
  }
  const pane = chartPaneElement(container)
  const paneRight = pane?.getBoundingClientRect().right ?? 0
  return paneRight > 0 && clientX >= paneRight - 12
}

export function overlayTopFromPrice(
  series: { priceToCoordinate: (price: number) => number | null } | null,
  price: number,
  overlayEl: HTMLElement | null,
  container: HTMLElement | null
): number | null {
  if (!series || !(price > 0)) return null
  const paneY = series.priceToCoordinate(price)
  if (paneY == null || !Number.isFinite(paneY)) return null
  const pane = container ? chartPaneElement(container) : null
  if (!overlayEl || !pane) return paneY
  const overlayRect = overlayEl.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  return paneY + overlayYOffset(paneRect.top, overlayRect.top)
}

export function riskBoxDollarPreview(args: {
  entry: number
  stop: number
  target: number
  riskDollars: number
}): { size: number; profitDollars: number; lossDollars: number } {
  const slPts = Math.abs(args.entry - args.stop)
  const tpPts = Math.abs(args.target - args.entry)
  const size = slPts > 0 && Number.isFinite(args.riskDollars) ? args.riskDollars / slPts : 0
  return {
    size,
    profitDollars: size > 0 ? size * tpPts : 0,
    lossDollars: size > 0 ? size * slPts : 0,
  }
}

/** Sentinel key for layout watches — 0.5px so zoom/fullscreen re-stick pills. */
export function seriesLayoutKey(
  series: ISeriesApi<'Candlestick'> | { priceToCoordinate: (p: number) => number | null },
  prices: number[]
): string {
  return prices
    .map((p) => {
      if (!(p > 0)) return 'x'
      const y = series.priceToCoordinate(p)
      return y == null || !Number.isFinite(y) ? 'x' : (Math.round(y * 2) / 2).toString()
    })
    .join('|')
}
