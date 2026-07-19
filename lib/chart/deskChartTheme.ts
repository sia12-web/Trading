/**
 * Shared lightweight-charts theme for live + sim desk charts.
 * TradingView-style light pane: near-white background, soft gray grid.
 */

import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

export const DESK_CHART_BG = '#fafafa'
export const DESK_CHART_GRID = '#e5e7eb'
export const DESK_CHART_TEXT = '#4b5563'
export const DESK_CHART_BORDER = '#d1d5db'

export const DESK_CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: DESK_CHART_BG },
    textColor: DESK_CHART_TEXT,
    fontFamily: 'Inter, JetBrains Mono, system-ui',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: DESK_CHART_GRID, style: LineStyle.Solid },
    horzLines: { color: DESK_CHART_GRID, style: LineStyle.Solid },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: '#9ca3af',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#374151',
    },
    horzLine: {
      color: '#9ca3af',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#374151',
    },
  },
  rightPriceScale: {
    borderColor: DESK_CHART_BORDER,
    textColor: DESK_CHART_TEXT,
  },
  timeScale: {
    borderColor: DESK_CHART_BORDER,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 12,
    barSpacing: 8,
    fixLeftEdge: false,
    fixRightEdge: false,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: { time: true, price: true },
    mouseWheel: true,
    pinch: true,
  },
  kineticScroll: {
    mouse: true,
    touch: true,
  },
} as const
