/**
 * Shared lightweight-charts theme for live + sim desk charts.
 * TradingView-style light pane: near-white background, soft gray grid.
 */

import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

/** TradingView light-chart neutrals: pure pane, cool grid, high-contrast axes. */
export const DESK_CHART_BG = '#ffffff'
export const DESK_CHART_GRID = '#f0f3fa'
export const DESK_CHART_TEXT = '#434651'
export const DESK_CHART_BORDER = '#d1d4dc'
export const DESK_CANDLE_UP = '#089981'
export const DESK_CANDLE_DOWN = '#f23645'

/** 14px slot produces the dense 8–10px solid body used by TradingView. */
export const DESK_BAR_SPACING = 14
export const DESK_COMPACT_BAR_SPACING = 11
export const DESK_DAILY_BAR_SPACING = 12
export const DESK_30M_BAR_SPACING = 16
/** Wheel zoom-out floor — allows smooth TradingView-style deep zoom-out without snapping. */
export const DESK_MIN_BAR_SPACING = 0.5

export const DESK_CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: DESK_CHART_BG },
    textColor: DESK_CHART_TEXT,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
    fontSize: 12,
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: DESK_CHART_GRID, style: LineStyle.Solid },
    horzLines: { color: DESK_CHART_GRID, style: LineStyle.Solid },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: '#758696',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#2962ff',
    },
    horzLine: {
      color: '#758696',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#2962ff',
    },
  },
  rightPriceScale: {
    borderColor: DESK_CHART_BORDER,
    textColor: DESK_CHART_TEXT,
    autoScale: true,
    alignLabels: true,
    entireTextOnly: true,
    ticksVisible: true,
    minimumWidth: 82,
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
  timeScale: {
    borderColor: DESK_CHART_BORDER,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 8,
    barSpacing: DESK_BAR_SPACING,
    minBarSpacing: DESK_MIN_BAR_SPACING,
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: false,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: { time: true, price: true },
    axisDoubleClickReset: { time: true, price: true },
    mouseWheel: true,
    pinch: true,
  },
  kineticScroll: {
    mouse: true,
    touch: true,
  },
} as const
