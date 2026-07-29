/**
 * Per-range ATR advice — Wilder ATR(14) on 5m bars + range height.
 * Advise-only: does not rewrite SL/TP; guides pad / trail distance.
 */

export const RANGE_ATR_LENGTH = 14
export const RANGE_ATR_MIN_STOP_PAD_POINTS = 10
/** Floor multiple of ATR for stop pad beyond the hunt edge */
export const RANGE_ATR_STOP_PAD_MULT = 0.35
/** Default trail step as a fraction of ATR */
export const RANGE_ATR_TRAIL_MULT = 0.25
/** Aggressive trail when range height / ATR is wide */
export const RANGE_ATR_TRAIL_AGGRESSIVE_MULT = 0.5
/** Height/ATR above this → use aggressive trail suggestion */
export const RANGE_ATR_WIDE_RATIO = 2

export type AtrBar = {
  high: number
  low: number
  close: number
}

export type RangeAtrSnapshot = {
  /** Active / locked range label */
  rangeLabel: string
  high: number
  low: number
  /** H − L */
  height: number
  /** Wilder ATR(length) in index points; null if not enough bars */
  atr: number | null
  atrLength: number
  /** height / atr when atr > 0 */
  heightOverAtr: number | null
  /** Suggested stop pad beyond edge (points) */
  stopPad: number
  /** Suggested trail step (points) */
  trailStep: number
  /** true when height/ATR is wide */
  wide: boolean
}

function roundPts(n: number): number {
  if (!Number.isFinite(n)) return 0
  // Keep one decimal for index futures-style points
  return Math.round(n * 10) / 10
}

export function trueRange(bar: AtrBar, prevClose: number | null): number {
  const high = Number(bar.high)
  const low = Number(bar.low)
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high >= low)) return 0
  const hl = high - low
  if (prevClose == null || !Number.isFinite(prevClose)) return hl
  return Math.max(hl, Math.abs(high - prevClose), Math.abs(low - prevClose))
}

/**
 * Wilder ATR: first ATR = SMA of first `length` true ranges,
 * then ATR = (prevATR * (length - 1) + TR) / length.
 */
export function computeAtrWilder(
  bars: AtrBar[],
  length: number = RANGE_ATR_LENGTH
): number | null {
  const n = Math.max(1, Math.floor(length))
  if (!Array.isArray(bars) || bars.length < n + 1) return null

  const trs: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const prevClose = i > 0 ? Number(bars[i - 1]!.close) : null
    trs.push(trueRange(bars[i]!, prevClose))
  }

  // Need `n` TRs starting from index 1 (first bar has no prior close — still usable,
  // but Wilder conventionally seeds after first bar). Use last n complete TRs from i>=1.
  if (trs.length < n + 1) return null
  let atr = 0
  for (let i = 1; i <= n; i++) atr += trs[i]!
  atr /= n
  for (let i = n + 1; i < trs.length; i++) {
    atr = (atr * (n - 1) + trs[i]!) / n
  }
  return atr > 0 && Number.isFinite(atr) ? atr : null
}

export function suggestStopPadPoints(atr: number | null): number {
  if (atr == null || !(atr > 0)) return RANGE_ATR_MIN_STOP_PAD_POINTS
  return roundPts(Math.max(RANGE_ATR_MIN_STOP_PAD_POINTS, atr * RANGE_ATR_STOP_PAD_MULT))
}

export function suggestTrailStepPoints(
  atr: number | null,
  heightOverAtr: number | null
): { trailStep: number; wide: boolean } {
  const wide = heightOverAtr != null && heightOverAtr >= RANGE_ATR_WIDE_RATIO
  if (atr == null || !(atr > 0)) {
    return { trailStep: RANGE_ATR_MIN_STOP_PAD_POINTS, wide }
  }
  const mult = wide ? RANGE_ATR_TRAIL_AGGRESSIVE_MULT : RANGE_ATR_TRAIL_MULT
  return { trailStep: roundPts(Math.max(RANGE_ATR_MIN_STOP_PAD_POINTS * 0.5, atr * mult)), wide }
}

export function buildRangeAtrSnapshot(args: {
  rangeLabel: string
  high: number
  low: number
  bars: AtrBar[]
  atrLength?: number
}): RangeAtrSnapshot | null {
  const high = Number(args.high)
  const low = Number(args.low)
  if (!Number.isFinite(high) || !Number.isFinite(low) || !(high > low)) return null
  const height = roundPts(high - low)
  const atrLength = args.atrLength ?? RANGE_ATR_LENGTH
  const atrRaw = computeAtrWilder(args.bars, atrLength)
  const atr = atrRaw != null ? roundPts(atrRaw) : null
  const heightOverAtr =
    atr != null && atr > 0 ? Math.round((height / atr) * 100) / 100 : null
  const stopPad = suggestStopPadPoints(atr)
  const { trailStep, wide } = suggestTrailStepPoints(atr, heightOverAtr)
  return {
    rangeLabel: args.rangeLabel,
    high,
    low,
    height,
    atr,
    atrLength,
    heightOverAtr,
    stopPad,
    trailStep,
    wide,
  }
}

/** Compact chart chip: `OR30 · Hgt 120 · ATR 48 · 2.5×` */
export function formatRangeAtrChip(s: RangeAtrSnapshot): string {
  const atrTxt = s.atr != null ? `ATR ${s.atr}` : 'ATR —'
  const ratioTxt = s.heightOverAtr != null ? `${s.heightOverAtr}×` : '—×'
  return `${s.rangeLabel} · Hgt ${s.height} · ${atrTxt} · ${ratioTxt}`
}

/** One-liner for Telegram / Leo */
export function formatRangeAtrAdviceLine(s: RangeAtrSnapshot): string {
  const atrTxt = s.atr != null ? `${s.atr} pts (ATR${s.atrLength} 5m)` : 'ATR n/a (need more bars)'
  const ratio =
    s.heightOverAtr != null
      ? ` · height ${s.heightOverAtr}× ATR${s.wide ? ' (wide)' : ''}`
      : ''
  return `Volatility: height ${s.height} pts · ${atrTxt}${ratio} · suggest stop pad ~${s.stopPad} · trail ~${s.trailStep} pts (advise only).`
}
