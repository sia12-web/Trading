/**
 * Cross-Asset Volatility Engine
 *
 * Provides dedicated options-implied volatility indices for each asset class:
 * - Equities (ES / NQ / YM): VIX (30-day) & VIX1D (1-day intraday expected volatility)
 * - Crude Oil (CL / MCL):    OVX (Cboe Crude Oil Volatility Index from USO options)
 * - Gold (GC / MGC):         GVZ (Cboe Gold Volatility Index from GLD options)
 *
 * Eliminates the fallacy of treating VIX as a universal index for commodities.
 * Live prints come from Yahoo. Nikkei uses 20-day realized volatility from NKD
 * daily closes because the published Nikkei VI is not on that feed.
 */

import { getYahooSymbolCandles } from '@/lib/yahoo/candles'
import { getYahooSymbolQuote } from '@/lib/yahoo/quote'

export type VolatilitySymbol = 'VIX' | 'VIX1D' | 'OVX' | 'GVZ' | 'JNIV'
export type VolatilityAssetClass = 'EQUITIES' | 'CRUDE' | 'GOLD' | 'NIKKEI'
export type VolatilityRegime = 'EXPANDING' | 'ELEVATED' | 'NORMAL' | 'COMPRESSED'

export interface VolatilityQuote {
  symbol: VolatilitySymbol
  name: string
  assetClass: VolatilityAssetClass
  targetMarkets: string[]
  value: number
  previousClose: number
  change: number
  changePct: number
  regime: VolatilityRegime
  isExpanding: boolean
  description: string
  asOfIso: string
}

export interface CrossMarketVolatilityState {
  asOfIso: string
  equities: {
    vix: VolatilityQuote
    vix1d: VolatilityQuote
    activeRegime: VolatilityRegime
    isExpanding: boolean
    bias: 'RISK_OFF' | 'RISK_ON' | 'NEUTRAL'
  }
  nikkei: {
    jniv: VolatilityQuote
    activeRegime: VolatilityRegime
    isExpanding: boolean
    bias: 'VOLATILITY_EXPANSION' | 'COMPRESSED'
  }
  crude: {
    ovx: VolatilityQuote
    activeRegime: VolatilityRegime
    isExpanding: boolean
    bias: 'VOLATILITY_EXPANSION' | 'COMPRESSED'
  }
  gold: {
    gvz: VolatilityQuote
    activeRegime: VolatilityRegime
    isExpanding: boolean
    bias: 'VOLATILITY_EXPANSION' | 'COMPRESSED'
  }
  summary: string
}

/**
 * Maps a futures/CFD instrument to its dedicated Cboe volatility gauge.
 */
export function mapInstrumentToVolatilityGauge(instrument: string): {
  primaryGauge: VolatilitySymbol
  secondaryGauge?: VolatilitySymbol
  assetClass: VolatilityAssetClass
} {
  const norm = instrument.toUpperCase()
  if (norm.includes('NIKKEI') || norm.includes('NKD') || norm.includes('JPN225')) {
    return { primaryGauge: 'JNIV', assetClass: 'NIKKEI' }
  }
  if (norm.includes('OIL') || norm.includes('CRUDE') || norm.includes('CL')) {
    return { primaryGauge: 'OVX', assetClass: 'CRUDE' }
  }
  if (norm.includes('GOLD') || norm.includes('GC') || norm.includes('MGC')) {
    return { primaryGauge: 'GVZ', assetClass: 'GOLD' }
  }
  // Default to Equities (NQ, YM, ES, DOW, NASDAQ, S&P)
  return { primaryGauge: 'VIX1D', secondaryGauge: 'VIX', assetClass: 'EQUITIES' }
}

/**
 * Classifies regime based on index level and change percentage.
 */
export function classifyVolatilityRegime(
  symbol: VolatilitySymbol,
  value: number,
  changePct: number
): { regime: VolatilityRegime; isExpanding: boolean } {
  // Threshold baselines
  const baselines: Record<VolatilitySymbol, { elevated: number; high: number }> = {
    VIX1D: { elevated: 16.0, high: 22.0 },
    VIX: { elevated: 18.0, high: 24.0 },
    OVX: { elevated: 34.0, high: 45.0 },
    GVZ: { elevated: 16.0, high: 21.0 },
    JNIV: { elevated: 20.0, high: 26.0 },
  }

  const { elevated, high } = baselines[symbol] || { elevated: 18.0, high: 24.0 }
  const isSurging = changePct >= 4.0 // >= 4% intraday jump indicates expansion

  if (value >= high || (value >= elevated && isSurging)) {
    return { regime: 'EXPANDING', isExpanding: true }
  }
  if (value >= elevated || isSurging) {
    return { regime: 'ELEVATED', isExpanding: isSurging }
  }
  if (value <= elevated * 0.75 && changePct <= -3.0) {
    return { regime: 'COMPRESSED', isExpanding: false }
  }
  return { regime: 'NORMAL', isExpanding: false }
}

/**
 * Creates default fallback volatility quotes (used when external feeds are loading or off-market).
 */
export function buildDefaultVolatilityQuotes(now: Date = new Date()): Record<VolatilitySymbol, VolatilityQuote> {
  const nowIso = now.toISOString()
  return {
    VIX1D: {
      symbol: 'VIX1D',
      name: 'Cboe 1-Day Volatility Index',
      assetClass: 'EQUITIES',
      targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
      value: 15.2,
      previousClose: 14.8,
      change: 0.4,
      changePct: 2.7,
      regime: 'NORMAL',
      isExpanding: false,
      description: 'Measures expected 1-day equity volatility using 0DTE/1DTE SPX options. Ideal for intraday timing.',
      asOfIso: nowIso,
    },
    VIX: {
      symbol: 'VIX',
      name: 'Cboe Volatility Index',
      assetClass: 'EQUITIES',
      targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
      value: 16.8,
      previousClose: 16.5,
      change: 0.3,
      changePct: 1.82,
      regime: 'NORMAL',
      isExpanding: false,
      description: 'Measures expected 30-day equity volatility. Macro risk-off benchmark.',
      asOfIso: nowIso,
    },
    JNIV: {
      symbol: 'JNIV',
      name: 'Nikkei 225 Volatility Index',
      assetClass: 'NIKKEI',
      targetMarkets: ['NIKKEI'],
      value: 18.5,
      previousClose: 18.2,
      change: 0.3,
      changePct: 1.65,
      regime: 'NORMAL',
      isExpanding: false,
      description: 'Measures expected 30-day Nikkei 225 volatility (Nikkei VI / JNIV).',
      asOfIso: nowIso,
    },
    OVX: {
      symbol: 'OVX',
      name: 'Cboe Crude Oil Volatility Index',
      assetClass: 'CRUDE',
      targetMarkets: ['CRUDE'],
      value: 36.4,
      previousClose: 34.2,
      change: 2.2,
      changePct: 6.43,
      regime: 'EXPANDING',
      isExpanding: true,
      description: 'Measures expected 30-day crude oil volatility derived from USO options pricing.',
      asOfIso: nowIso,
    },
    GVZ: {
      symbol: 'GVZ',
      name: 'Cboe Gold Volatility Index',
      assetClass: 'GOLD',
      targetMarkets: ['GOLD'],
      value: 15.1,
      previousClose: 15.3,
      change: -0.2,
      changePct: -1.31,
      regime: 'NORMAL',
      isExpanding: false,
      description: 'Measures expected 30-day gold volatility derived from GLD options pricing.',
      asOfIso: nowIso,
    },
  }
}

/**
 * Builds the full unified cross-market volatility state.
 */
export function buildCrossMarketVolatilityState(
  quotes: Record<VolatilitySymbol, VolatilityQuote>
): CrossMarketVolatilityState {
  const vix1d = quotes.VIX1D
  const vix = quotes.VIX
  const jniv = quotes.JNIV
  const ovx = quotes.OVX
  const gvz = quotes.GVZ

  const equitiesExpanding = vix1d.isExpanding || vix.isExpanding
  const equitiesRegime = vix1d.regime === 'EXPANDING' || vix.regime === 'EXPANDING'
    ? 'EXPANDING'
    : vix1d.regime === 'ELEVATED' || vix.regime === 'ELEVATED'
    ? 'ELEVATED'
    : vix1d.regime

  const equityBias = equitiesExpanding
    ? 'RISK_OFF'
    : vix1d.regime === 'COMPRESSED'
    ? 'RISK_ON'
    : 'NEUTRAL'

  const activeSurges: string[] = []
  if (vix1d.isExpanding) activeSurges.push('Equities (VIX1D ↑)')
  if (jniv && jniv.isExpanding) activeSurges.push('Nikkei (JNIV ↑)')
  if (ovx.isExpanding) activeSurges.push('Crude Oil (OVX ↑)')
  if (gvz.isExpanding) activeSurges.push('Gold (GVZ ↑)')

  const summary = activeSurges.length > 0
    ? `Active Volatility Expansion detected in: ${activeSurges.join(', ')}.`
    : 'Volatility across all asset classes is balanced/normal. Wait for profile location.'

  return {
    asOfIso: new Date().toISOString(),
    equities: {
      vix,
      vix1d,
      activeRegime: equitiesRegime,
      isExpanding: equitiesExpanding,
      bias: equityBias,
    },
    nikkei: {
      jniv,
      activeRegime: jniv.regime,
      isExpanding: jniv.isExpanding,
      bias: jniv.isExpanding ? 'VOLATILITY_EXPANSION' : 'COMPRESSED',
    },
    crude: {
      ovx,
      activeRegime: ovx.regime,
      isExpanding: ovx.isExpanding,
      bias: ovx.isExpanding ? 'VOLATILITY_EXPANSION' : 'COMPRESSED',
    },
    gold: {
      gvz,
      activeRegime: gvz.regime,
      isExpanding: gvz.isExpanding,
      bias: gvz.isExpanding ? 'VOLATILITY_EXPANSION' : 'COMPRESSED',
    },
    summary,
  }
}

const VOL_INDEX_SYMBOLS: Record<Exclude<VolatilitySymbol, 'JNIV'>, string> = {
  VIX: '^VIX',
  VIX1D: '^VIX1D',
  OVX: '^OVX',
  GVZ: '^GVZ',
}

const VOL_COPY: Record<
  VolatilitySymbol,
  { name: string; assetClass: VolatilityAssetClass; targetMarkets: string[]; description: string }
> = {
  VIX1D: {
    name: 'Cboe 1-Day Volatility Index',
    assetClass: 'EQUITIES',
    targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
    description: 'Yahoo ^VIX1D. Expected 1-day equity volatility from SPX 0DTE/1DTE options.',
  },
  VIX: {
    name: 'Cboe Volatility Index',
    assetClass: 'EQUITIES',
    targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
    description: 'Yahoo ^VIX. Expected 30-day equity volatility.',
  },
  JNIV: {
    name: 'Nikkei 20-day realized volatility',
    assetClass: 'NIKKEI',
    targetMarkets: ['NIKKEI'],
    description:
      'Annualized realized volatility from NKD daily closes. The published Nikkei VI is not on this quote feed.',
  },
  OVX: {
    name: 'Cboe Crude Oil Volatility Index',
    assetClass: 'CRUDE',
    targetMarkets: ['CRUDE'],
    description: 'Yahoo ^OVX. Expected 30-day crude volatility from USO options.',
  },
  GVZ: {
    name: 'Cboe Gold Volatility Index',
    assetClass: 'GOLD',
    targetMarkets: ['GOLD'],
    description: 'Yahoo ^GVZ. Expected 30-day gold volatility from GLD options.',
  },
}

/** Annualized close-to-close realized volatility, in index points (16 = 16%). */
export function annualizedRealizedVol(closes: number[]): number | null {
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!
    const next = closes[i]!
    if (!(prev > 0) || !(next > 0)) continue
    rets.push(Math.log(next / prev))
  }
  if (rets.length < 2) return null
  const mean = rets.reduce((sum, value) => sum + value, 0) / rets.length
  const variance = rets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rets.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) * 100
}

export function volatilityQuoteFromPrint(args: {
  symbol: VolatilitySymbol
  value: number
  previousClose: number
  asOfIso: string
}): VolatilityQuote {
  const copy = VOL_COPY[args.symbol]
  const previous = args.previousClose > 0 ? args.previousClose : args.value
  const change = args.value - previous
  const changePct = previous ? (change / previous) * 100 : 0
  const classified = classifyVolatilityRegime(args.symbol, args.value, changePct)
  return {
    symbol: args.symbol,
    name: copy.name,
    assetClass: copy.assetClass,
    targetMarkets: copy.targetMarkets,
    value: args.value,
    previousClose: previous,
    change,
    changePct,
    regime: classified.regime,
    isExpanding: classified.isExpanding,
    description: copy.description,
    asOfIso: args.asOfIso,
  }
}

function printAsOf(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString()
}

async function fetchLiveVolatilityQuotes(): Promise<Record<VolatilitySymbol, VolatilityQuote>> {
  const [vix, vix1d, ovx, gvz, daily] = await Promise.all([
    getYahooSymbolQuote(VOL_INDEX_SYMBOLS.VIX),
    getYahooSymbolQuote(VOL_INDEX_SYMBOLS.VIX1D),
    getYahooSymbolQuote(VOL_INDEX_SYMBOLS.OVX),
    getYahooSymbolQuote(VOL_INDEX_SYMBOLS.GVZ),
    getYahooSymbolCandles('NKD=F', '1d', '6mo'),
  ])
  if (!vix || !vix1d || !ovx || !gvz) {
    throw new Error('Yahoo volatility quote missing')
  }
  const closes = (daily ?? []).map((bar) => bar.close).filter((close) => close > 0)
  const realized = annualizedRealizedVol(closes.slice(-21))
  const realizedPrev = annualizedRealizedVol(closes.slice(-22, -1))
  if (realized == null || realizedPrev == null) {
    throw new Error('Nikkei realized volatility unavailable')
  }

  return {
    VIX: volatilityQuoteFromPrint({
      symbol: 'VIX',
      value: vix.price,
      previousClose: vix.previous_close,
      asOfIso: printAsOf(vix.timestamp),
    }),
    VIX1D: volatilityQuoteFromPrint({
      symbol: 'VIX1D',
      value: vix1d.price,
      previousClose: vix1d.previous_close,
      asOfIso: printAsOf(vix1d.timestamp),
    }),
    OVX: volatilityQuoteFromPrint({
      symbol: 'OVX',
      value: ovx.price,
      previousClose: ovx.previous_close,
      asOfIso: printAsOf(ovx.timestamp),
    }),
    GVZ: volatilityQuoteFromPrint({
      symbol: 'GVZ',
      value: gvz.price,
      previousClose: gvz.previous_close,
      asOfIso: printAsOf(gvz.timestamp),
    }),
    JNIV: volatilityQuoteFromPrint({
      symbol: 'JNIV',
      value: realized,
      previousClose: realizedPrev,
      asOfIso: new Date().toISOString(),
    }),
  }
}

let cachedVolState: CrossMarketVolatilityState | null = null
let lastVolFetchMs = 0
const VOL_CACHE_TTL_MS = 30_000
const VOL_STALE_OK_MS = 10 * 60_000

/**
 * Live Cboe prints from Yahoo, plus Nikkei realized vol from NKD daily closes.
 * A failed refresh keeps the last live snapshot for up to 10 minutes.
 * Sample quotes are never returned.
 */
export async function getCrossMarketVolatility(): Promise<CrossMarketVolatilityState> {
  const now = Date.now()
  if (cachedVolState && now - lastVolFetchMs < VOL_CACHE_TTL_MS) {
    return cachedVolState
  }

  try {
    const quotes = await fetchLiveVolatilityQuotes()
    cachedVolState = buildCrossMarketVolatilityState(quotes)
    lastVolFetchMs = now
    return cachedVolState
  } catch (err) {
    if (cachedVolState && now - lastVolFetchMs < VOL_STALE_OK_MS) return cachedVolState
    throw err
  }
}
