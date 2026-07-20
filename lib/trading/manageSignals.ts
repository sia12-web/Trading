/**
 * Live MANAGE scoring — pullback vs reversal using price, news, RVOL, options flow.
 * Pure helpers (no I/O) so unit tests stay deterministic.
 */

export const MANAGE_RVOL_PERIOD = 20
/** Initiative volume vs recent average */
export const MANAGE_RVOL_HIGH = 1.5
export const MANAGE_RVOL_SPIKE = 2.0

export type ManageVerdict = 'pullback' | 'reversal' | 'hold'

export type ManageScoreInput = {
  /** Signed % for the trade: + means in favor, − adverse */
  movePct: number
  newsScore: number
  rvol: number | null
  /**
   * Options bias in market terms: +1 call-heavy (bullish), −1 put-heavy (bearish), 0 neutral.
   * Flipped internally for SHORT books.
   */
  optionsBias: number | null
  direction: 'LONG' | 'SHORT'
}

export type ManageScoreResult = {
  verdict: ManageVerdict
  confidence: number
  reason: string
  factors: string[]
}

/** RVOL = last *completed* bar volume / mean of prior `period` bars.
 * Skips trailing zero-volume bars (common on the in-progress 5m candle). */
export function computeRvol(
  volumes: number[],
  period = MANAGE_RVOL_PERIOD
): number | null {
  if (!Array.isArray(volumes) || volumes.length < period + 1) return null

  let end = volumes.length - 1
  while (end >= 0 && !(Number(volumes[end]) > 0)) end -= 1
  if (end < period) return null

  const last = Number(volumes[end])
  const prior = volumes.slice(end - period, end).map(Number)
  if (!(last > 0) || !Number.isFinite(last)) return null
  const mean =
    prior.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0) /
    prior.length
  if (!(mean > 0)) return null
  return last / mean
}

export type OptionContractLite = {
  volume?: number | null
  openInterest?: number | null
}

export type OptionsFlowSummary = {
  putCallVolume: number | null
  putCallOi: number | null
  callVolume: number
  putVolume: number
  /** +1 bullish (calls), −1 bearish (puts), 0 neutral */
  bias: number
  proxySymbol: string
  source: string
}

/** Put/call from nearest-expiry chain volumes / OI. */
export function summarizeOptionsFlow(
  calls: OptionContractLite[],
  puts: OptionContractLite[],
  proxySymbol: string,
  source: string
): OptionsFlowSummary {
  const sum = (rows: OptionContractLite[], key: 'volume' | 'openInterest') =>
    rows.reduce((a, r) => a + (Number(r[key]) > 0 ? Number(r[key]) : 0), 0)

  const callVolume = sum(calls, 'volume')
  const putVolume = sum(puts, 'volume')
  const callOi = sum(calls, 'openInterest')
  const putOi = sum(puts, 'openInterest')

  const putCallVolume =
    callVolume > 0 ? putVolume / callVolume : putVolume > 0 ? 99 : null
  const putCallOi = callOi > 0 ? putOi / callOi : putOi > 0 ? 99 : null

  const ratio = putCallVolume ?? putCallOi
  let bias = 0
  if (ratio != null) {
    if (ratio >= 1.2) bias = -1
    else if (ratio <= 0.8) bias = 1
  }

  return {
    putCallVolume,
    putCallOi,
    callVolume,
    putVolume,
    bias,
    proxySymbol,
    source,
  }
}

/**
 * Score manage state. Options bias is market-directional; we align it to the book.
 */
export function scoreManageVerdict(input: ManageScoreInput): ManageScoreResult {
  const { movePct, newsScore, rvol, direction } = input
  const factors: string[] = []
  factors.push(`move ${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%`)
  factors.push(`news ${newsScore}`)

  const bookOptions =
    input.optionsBias == null
      ? null
      : direction === 'LONG'
        ? input.optionsBias
        : -input.optionsBias
  // bookOptions > 0 supports the trade; < 0 opposes it

  if (rvol != null && Number.isFinite(rvol)) {
    factors.push(`RVOL ${rvol.toFixed(2)}×`)
  } else {
    factors.push('RVOL n/a')
  }

  if (bookOptions != null) {
    factors.push(
      bookOptions > 0
        ? 'options supportive'
        : bookOptions < 0
          ? 'options opposing'
          : 'options neutral'
    )
  } else {
    factors.push('options n/a')
  }

  const highRvol = rvol != null && rvol >= MANAGE_RVOL_HIGH
  const spikeRvol = rvol != null && rvol >= MANAGE_RVOL_SPIKE
  const quietRvol = rvol != null && rvol < 1.0
  const optionsOppose = bookOptions != null && bookOptions < 0
  const optionsSupport = bookOptions != null && bookOptions > 0
  const newsBad = newsScore <= 0
  const newsGood = newsScore > 0

  // Trade in favor
  if (movePct > 0.2) {
    let confidence = 70
    if (optionsSupport) confidence += 5
    if (quietRvol || (rvol != null && rvol < MANAGE_RVOL_HIGH)) confidence += 3
    if (optionsOppose && highRvol) {
      return {
        verdict: 'hold',
        confidence: 55,
        reason: `In favor (+${movePct.toFixed(2)}%) but options/RVOL warn — stay alert`,
        factors,
      }
    }
    return {
      verdict: 'hold',
      confidence: Math.min(90, confidence),
      reason: `Trade in favor (+${movePct.toFixed(2)}%) — hold`,
      factors,
    }
  }

  // Sharp adverse + initiative volume or opposing flow → reversal
  if (movePct < -0.5 && (spikeRvol || optionsOppose || newsBad)) {
    return {
      verdict: 'reversal',
      confidence: Math.min(95, 78 + Math.abs(movePct) * 6 + (spikeRvol ? 5 : 0)),
      reason: `Sharp adverse ${movePct.toFixed(2)}%${spikeRvol ? ' on high RVOL' : ''}${optionsOppose ? ' with opposing options' : ''} — exit bias`,
      factors,
    }
  }

  if (movePct < -0.35 && (highRvol || optionsOppose) && newsBad) {
    return {
      verdict: 'reversal',
      confidence: Math.min(92, 68 + Math.abs(movePct) * 8),
      reason: `Adverse ${movePct.toFixed(2)}% + elevated RVOL/options vs you — likely reversal`,
      factors,
    }
  }

  if (movePct < -0.35 && newsBad) {
    return {
      verdict: 'reversal',
      confidence: Math.min(90, 60 + Math.abs(movePct) * 10),
      reason: `Adverse move ${movePct.toFixed(2)}% with non-supportive news (score ${newsScore})`,
      factors,
    }
  }

  // Mild adverse + supportive tape/news + not exploding volume → pullback
  if (
    movePct < -0.12 &&
    movePct >= -0.4 &&
    (newsGood || optionsSupport || quietRvol) &&
    !spikeRvol &&
    !optionsOppose
  ) {
    return {
      verdict: 'pullback',
      confidence: newsGood || optionsSupport ? 72 : 62,
      reason: `Mild adverse ${movePct.toFixed(2)}% with supportive news/options${quietRvol ? ' and quiet RVOL' : ''} — treat as pullback`,
      factors,
    }
  }

  if (movePct < -0.5) {
    return {
      verdict: 'reversal',
      confidence: 80,
      reason: `Sharp adverse move ${movePct.toFixed(2)}% — likely reversal`,
      factors,
    }
  }

  if (movePct < -0.2 && highRvol && optionsOppose) {
    return {
      verdict: 'reversal',
      confidence: 74,
      reason: `Adverse ${movePct.toFixed(2)}% with high RVOL and opposing options flow`,
      factors,
    }
  }

  return {
    verdict: 'hold',
    confidence: 50,
    reason: 'No strong manage signal — watch price, RVOL, and options',
    factors,
  }
}

/** ETF proxies for index options (cash indices have no liquid listed chains here). */
export function optionsProxySymbol(
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
): string {
  if (instrument === 'NASDAQ') return 'QQQ'
  if (instrument === 'NIKKEI') return 'EWJ'
  return 'DIA'
}
