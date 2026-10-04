/**
 * Average True Range — exact port of TradingView's built-in "ATR" indicator.
 *
 * Pine source (TradingView built-in):
 *   length    = input.int(14, minval = 1)
 *   smoothing = input.string("RMA", options = ["RMA", "SMA", "EMA", "WMA"])
 *   ma_function(source, length) =>
 *       switch smoothing
 *           "RMA" => ta.rma(source, length)
 *           "SMA" => ta.sma(source, length)
 *           "EMA" => ta.ema(source, length)
 *           => ta.wma(source, length)
 *   plot(ma_function(ta.tr(true), length), title = "ATR", color = color.new(#B71C1C, 0))
 *
 * Notes on Pine semantics reproduced here:
 *   - ta.tr(true): first bar (no previous close) uses high - low.
 *   - ta.rma / ta.ema are seeded with ta.sma(src, length) on the first full window,
 *     so the first plotted value lands on bar index `length - 1`.
 */

export type AtrSmoothing = 'RMA' | 'SMA' | 'EMA' | 'WMA'

export const ATR_SMOOTHING_OPTIONS: readonly AtrSmoothing[] = ['RMA', 'SMA', 'EMA', 'WMA']

export interface AtrSettings {
  length: number
  smoothing: AtrSmoothing
  color: string
  lineWidth: 1 | 2 | 3 | 4
  /** "Labels on price scale" — last value tag on the right axis. */
  showLastValueLabel: boolean
  /** Horizontal price line at the last value (off by default in TradingView). */
  showPriceLine: boolean
  /** Eye toggle in the pane legend. */
  visible: boolean
}

export const DEFAULT_ATR_SETTINGS: AtrSettings = {
  length: 14,
  smoothing: 'RMA',
  color: '#B71C1C',
  lineWidth: 1,
  showLastValueLabel: true,
  showPriceLine: false,
  visible: true,
}

export interface AtrInputBar {
  high: number
  low: number
  close: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** ta.tr(true) — True Range; bars without OHLC (whitespace) yield null. */
export function computeTrueRange(bars: ReadonlyArray<Partial<AtrInputBar> | null | undefined>): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length)
  let prevClose: number | null = null
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    if (!b || !isNum(b.high) || !isNum(b.low) || !isNum(b.close)) {
      out[i] = null
      continue
    }
    const hl = b.high - b.low
    out[i] =
      prevClose == null
        ? hl
        : Math.max(hl, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose))
    prevClose = b.close
  }
  return out
}

/**
 * Smooth a (possibly sparse) series with the Pine moving average of choice.
 * Null entries (whitespace bars) are skipped — they neither advance the
 * window nor produce a value, so output indices stay aligned with input.
 */
export function smoothSeries(
  src: ReadonlyArray<number | null>,
  length: number,
  smoothing: AtrSmoothing
): Array<number | null> {
  const n = Math.max(1, Math.floor(length))
  const out: Array<number | null> = new Array(src.length).fill(null)
  const window: number[] = []
  let windowSum = 0
  let prev: number | null = null

  const rmaAlpha = 1 / n
  const emaAlpha = 2 / (n + 1)
  const wmaDenom = (n * (n + 1)) / 2

  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v == null) continue

    window.push(v)
    windowSum += v
    if (window.length > n) windowSum -= window.shift() as number
    const full = window.length === n

    switch (smoothing) {
      case 'SMA':
        out[i] = full ? windowSum / n : null
        break
      case 'WMA': {
        if (!full) break
        let acc = 0
        for (let k = 0; k < n; k++) acc += (window[k] as number) * (k + 1)
        out[i] = acc / wmaDenom
        break
      }
      case 'EMA':
      case 'RMA':
      default: {
        const alpha = smoothing === 'EMA' ? emaAlpha : rmaAlpha
        if (prev == null) {
          if (full) prev = windowSum / n
        } else {
          prev = alpha * v + (1 - alpha) * prev
        }
        out[i] = prev
        break
      }
    }
  }
  return out
}

/** Full ATR series aligned 1:1 with `bars` (null during warm-up / on whitespace). */
export function computeAtr(
  bars: ReadonlyArray<Partial<AtrInputBar> | null | undefined>,
  length: number = DEFAULT_ATR_SETTINGS.length,
  smoothing: AtrSmoothing = DEFAULT_ATR_SETTINGS.smoothing
): Array<number | null> {
  return smoothSeries(computeTrueRange(bars), length, smoothing)
}

/** Sanitize user / localStorage input into valid settings. */
export function normalizeAtrSettings(raw: unknown): AtrSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AtrSettings>
  const len = Math.floor(Number(r.length))
  const lw = Math.floor(Number(r.lineWidth))
  return {
    length: Number.isFinite(len) && len >= 1 ? Math.min(len, 5000) : DEFAULT_ATR_SETTINGS.length,
    smoothing: ATR_SMOOTHING_OPTIONS.includes(r.smoothing as AtrSmoothing)
      ? (r.smoothing as AtrSmoothing)
      : DEFAULT_ATR_SETTINGS.smoothing,
    color:
      typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color)
        ? r.color
        : DEFAULT_ATR_SETTINGS.color,
    lineWidth: (lw >= 1 && lw <= 4 ? lw : DEFAULT_ATR_SETTINGS.lineWidth) as AtrSettings['lineWidth'],
    showLastValueLabel:
      typeof r.showLastValueLabel === 'boolean' ? r.showLastValueLabel : DEFAULT_ATR_SETTINGS.showLastValueLabel,
    showPriceLine: typeof r.showPriceLine === 'boolean' ? r.showPriceLine : DEFAULT_ATR_SETTINGS.showPriceLine,
    visible: typeof r.visible === 'boolean' ? r.visible : DEFAULT_ATR_SETTINGS.visible,
  }
}
