/**
 * Shared lightweight-charts theme for live + sim desk charts.
 * TradingView-style light pane: near-white background, soft gray grid.
 */

import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

export const DESK_CHART_BG = '#fafafa'
export const DESK_CHART_GRID = '#edf0f3'
export const DESK_CHART_TEXT = '#4b5563'
export const DESK_CHART_BORDER = '#d1d5db'
export const DESK_CANDLE_UP = '#089981'
export const DESK_CANDLE_DOWN = '#f23645'

/** Pixel width of one candle slot — keeps bodies readable like TradingView. */
export const DESK_BAR_SPACING = 12
/** Wheel zoom-out floor — ~5 days of 5m bars on a desktop pane. Default stays 12px. */
export const DESK_MIN_BAR_SPACING = 0.5

export const DESK_CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: DESK_CHART_BG },
    textColor: DESK_CHART_TEXT,
    fontFamily: 'Inter, JetBrains Mono, system-ui',
    fontSize: 12,
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
    autoScale: true,
    alignLabels: true,
    entireTextOnly: true,
    ticksVisible: true,
    scaleMargins: { top: 0.12, bottom: 0.12 },
  },
  timeScale: {
    borderColor: DESK_CHART_BORDER,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 10,
    barSpacing: DESK_BAR_SPACING,
    minBarSpacing: DESK_MIN_BAR_SPACING,
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
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
