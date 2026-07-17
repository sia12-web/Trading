/**
 * Simulation-only overnight bias (no news).
 * Live trading keeps its full regime detector (gap + OHLC + news + levels).
 *
 * Score = 50 + gap (−20…+20) + prior-session OHLC (−15…+15)
 *   >60 → bullish · <40 → bearish · else → no bias (choppy)
 */

export type SimBias = 'bullish' | 'bearish' | 'none'

export interface SimCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export interface SimOvernightBias {
  bias: SimBias
  score: number
  gapPercent: number
  priorClose: number
  openPrice: number
  priorSession: { open: number; high: number; low: number; close: number } | null
  label: string
  detail: string
}

function etDateKey(unix: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function gapScore(gapPercent: number): number {
  const absGap = Math.abs(gapPercent)
  if (absGap > 2.0) return gapPercent > 0 ? 20 : -20
  if (absGap > 1.5) return gapPercent > 0 ? 18 : -18
  if (absGap > 1.0) return gapPercent > 0 ? 16 : -16
  if (absGap > 0.5) return gapPercent > 0 ? 12 : -12
  if (absGap > 0.2) return gapPercent > 0 ? 8 : -8
  if (absGap <= 0.2) return 0
  return 0
}

function ohlcScore(ohlc: { open: number; high: number; low: number; close: number }): number {
  if (ohlc.open <= 0 || ohlc.close <= 0 || ohlc.high <= 0 || ohlc.low <= 0) return 0
  if (
    ohlc.high < ohlc.low ||
    ohlc.high < ohlc.open ||
    ohlc.high < ohlc.close ||
    ohlc.low > ohlc.open ||
    ohlc.low > ohlc.close
  ) {
    return 0
  }

  let score = 0
  const bodyStrength = ((ohlc.close - ohlc.open) / ohlc.open) * 100
  if (ohlc.close > ohlc.open) {
    if (bodyStrength > 1.5) score += 12
    else if (bodyStrength > 0.5) score += 6
    else score += 3
  } else if (ohlc.close < ohlc.open) {
    score -= 6
  } else {
    score += 1
  }

  const range = ((ohlc.high - ohlc.low) / ohlc.low) * 100
  if (range > 2.0) score += 3

  return Math.max(-15, Math.min(15, score))
}

/**
 * Build overnight bias for a sim day from 5m candles.
 * Uses prior cash session OHLC + gap into today's 9:30 open. No news.
 */
export function computeSimOvernightBias(
  candles: SimCandle[],
  openUnix: number
): SimOvernightBias | null {
  if (!openUnix || candles.length === 0) return null

  const openBar =
    candles.find((c) => c.time >= openUnix) ??
    candles.filter((c) => c.time <= openUnix).slice(-1)[0]
  if (!openBar) return null

  const priorBars = candles.filter((c) => c.time < openUnix)
  if (priorBars.length < 5) return null

  const priorDate = etDateKey(priorBars[priorBars.length - 1]!.time)
  const priorSessionBars = priorBars.filter((c) => etDateKey(c.time) === priorDate)
  const session = priorSessionBars.length >= 5 ? priorSessionBars : priorBars.slice(-78)

  let open = session[0]!.open
  let high = -Infinity
  let low = Infinity
  let close = session[session.length - 1]!.close
  for (const c of session) {
    if (c.high > high) high = c.high
    if (c.low < low) low = c.low
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null

  const priorClose = close
  const openPrice = openBar.open
  const gapPercent = ((openPrice - priorClose) / priorClose) * 100
  const priorSession = { open, high, low, close }

  const score = Math.max(
    0,
    Math.min(100, 50 + gapScore(gapPercent) + ohlcScore(priorSession))
  )

  let bias: SimBias = 'none'
  if (score > 60) bias = 'bullish'
  else if (score < 40) bias = 'bearish'

  const gapStr = `${gapPercent >= 0 ? '+' : ''}${gapPercent.toFixed(2)}%`
  if (bias === 'bullish') {
    return {
      bias,
      score,
      gapPercent,
      priorClose,
      openPrice,
      priorSession,
      label: 'OVERNIGHT LONG',
      detail: `Gap ${gapStr} · prior session up — prefer longs first 45m`,
    }
  }
  if (bias === 'bearish') {
    return {
      bias,
      score,
      gapPercent,
      priorClose,
      openPrice,
      priorSession,
      label: 'OVERNIGHT SHORT',
      detail: `Gap ${gapStr} · prior session down — prefer shorts first 45m`,
    }
  }
  return {
    bias,
    score,
    gapPercent,
    priorClose,
    openPrice,
    priorSession,
    label: 'NO BIAS',
    detail: `Gap ${gapStr} · weak overnight — trade level reaction only`,
  }
}

/** Suggested side for a level under sim overnight rules. */
export function simSuggestedDirection(
  bias: SimBias,
  levelType: string
): 'LONG' | 'SHORT' {
  if (bias === 'bullish') return 'LONG'
  if (bias === 'bearish') return 'SHORT'
  // No bias → level type
  return String(levelType).toLowerCase().includes('resist') ? 'SHORT' : 'LONG'
}
