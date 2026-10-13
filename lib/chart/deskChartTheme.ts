/**
 * Shared lightweight-charts theme for live + sim desk charts.
 * TradingView-style light pane: near-white background, soft gray grid.
 */

import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

/** TradingView dark-chart neutrals: sleek dark pane, subtle grid, high-contrast axes. */
export const DESK_CHART_BG = '#0e1117'
export const DESK_CHART_GRID = '#161b22'
export const DESK_CHART_TEXT = '#8b949e'
export const DESK_CHART_BORDER = '#21262d'
export const DESK_CANDLE_UP = '#089981'
export const DESK_CANDLE_DOWN = '#f23645'
export const DESK_LIGHT_CHART_BG = '#ffffff'
export const DESK_LIGHT_CHART_GRID = '#f0f3f6'
export const DESK_LIGHT_CHART_TEXT = '#131722'
export const DESK_LIGHT_CHART_BORDER = '#e0e3eb'

export function getDeskChartThemeOptions(theme: 'dark' | 'light') {
  const isDark = theme === 'dark'
  const bg = isDark ? DESK_CHART_BG : DESK_LIGHT_CHART_BG
  const grid = isDark ? DESK_CHART_GRID : DESK_LIGHT_CHART_GRID
  const text = isDark ? DESK_CHART_TEXT : DESK_LIGHT_CHART_TEXT
  const border = isDark ? DESK_CHART_BORDER : DESK_LIGHT_CHART_BORDER

  return {
    layout: {
      background: { type: ColorType.Solid, color: bg },
      textColor: text,
    },
    grid: {
      vertLines: { color: grid, style: LineStyle.Solid },
      horzLines: { color: grid, style: LineStyle.Solid },
    },
    rightPriceScale: {
      borderColor: border,
      textColor: text,
    },
    timeScale: {
      borderColor: border,
    },
  }
}

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
      color: '#484f58',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#1f6beb',
    },
    horzLine: {
      color: '#484f58',
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: '#1f6beb',
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
    scaleMargins: { top: 0.08, bottom: 0.24 },
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

/** Minimum tick spread per instrument to guarantee vertical candlestick definition */
export const INSTRUMENT_MIN_TICK_SPREAD: Record<string, number> = {
  NASDAQ: 0.25,
  DOW: 1.0,
  NIKKEI: 10.0,
  GOLD: 0.10,
  CRUDE: 0.01,
  SILVER: 0.005,
}

/**
 * Ensures any candlestick rendered on Lightweight Charts has a non-zero vertical range.
 * When open === high === low === close (zero-range bar, e.g. single trade or flat tick),
 * Lightweight Charts collapses it into a 1px flat horizontal dash.
 * This guarantees a subtle vertical wick definition like TradingView so bars never look like dashes.
 */
export function ensureVisibleCandleRange(
  candle: { open: number; high: number; low: number; close: number },
  instrument?: string | null
): { open: number; high: number; low: number; close: number } {
  let { open, high, low, close } = candle
  if (!Number.isFinite(open) || !Number.isFinite(close) || !(close > 0)) {
    return candle
  }
  high = Math.max(high, open, close)
  low = Math.min(low, open, close)
  const minSpread = instrument ? (INSTRUMENT_MIN_TICK_SPREAD[instrument] ?? 0.05) : 0.05
  if (high - low < minSpread * 0.5) {
    const half = (minSpread * 0.5) / 2
    high = Math.max(open, close) + half
    low = Math.min(open, close) - half
  }
  return { open, high, low, close }
}
