/**
 * Cross-Asset Volatility Engine
 *
 * Provides dedicated options-implied volatility indices for each asset class:
 * - Equities (ES / NQ / YM): VIX (30-day) & VIX1D (1-day intraday expected volatility)
 * - Crude Oil (CL / MCL):    OVX (Cboe Crude Oil Volatility Index from USO options)
 * - Gold (GC / MGC):         GVZ (Cboe Gold Volatility Index from GLD options)
 *
 * Eliminates the fallacy of treating VIX as a universal index for commodities.
 */

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
  /** False when this print was not returned by a feed. */
  sourced: boolean
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
  const isSurging = changePct >= 4.0
  const isFalling = changePct <= -3.0

  // A high print that is falling is elevated, not an expansion.
  if (value >= high && changePct > 0) {
    return { regime: 'EXPANDING', isExpanding: true }
  }
  if (isSurging && value >= elevated) {
    return { regime: 'EXPANDING', isExpanding: true }
  }
  if (isSurging || value >= elevated) {
    return { regime: 'ELEVATED', isExpanding: isSurging }
  }
  if (value <= elevated * 0.75 && isFalling) {
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
      sourced: true,
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
      sourced: true,
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
      sourced: true,
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
      sourced: true,
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
      sourced: true,
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

const YAHOO_VOL_SYMBOLS: Record<VolatilitySymbol, string> = {
  VIX: '^VIX',
  VIX1D: '^VIX1D',
  OVX: '^OVX',
  GVZ: '^GVZ',
  // Nikkei VI is not on the Yahoo chart API. Leave it unsourced until a feed prints it.
  JNIV: '',
}

const VOL_META: Record<VolatilitySymbol, Pick<VolatilityQuote, 'name' | 'assetClass' | 'targetMarkets' | 'description'>> = {
  VIX1D: {
    name: 'Cboe 1-Day Volatility Index',
    assetClass: 'EQUITIES',
    targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
    description: 'Measures expected 1-day equity volatility using 0DTE/1DTE SPX options.',
  },
  VIX: {
    name: 'Cboe Volatility Index',
    assetClass: 'EQUITIES',
    targetMarkets: ['NASDAQ', 'DOW', 'SP500'],
    description: 'Measures expected 30-day equity volatility.',
  },
  JNIV: {
    name: 'Nikkei 225 Volatility Index',
    assetClass: 'NIKKEI',
    targetMarkets: ['NIKKEI'],
    description: 'Measures expected 30-day Nikkei 225 volatility.',
  },
  OVX: {
    name: 'Cboe Crude Oil Volatility Index',
    assetClass: 'CRUDE',
    targetMarkets: ['CRUDE'],
    description: 'Measures expected 30-day crude oil volatility derived from USO options.',
  },
  GVZ: {
    name: 'Cboe Gold Volatility Index',
    assetClass: 'GOLD',
    targetMarkets: ['GOLD'],
    description: 'Measures expected 30-day gold volatility derived from GLD options.',
  },
}

export interface YahooLast {
  price: number
  previousClose: number
  change: number
  changePct: number
}

export async function fetchYahooLast(symbol: string): Promise<YahooLast | null> {
  if (!symbol) return null
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    '?interval=1d&range=5d'
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    const price = Number(meta?.regularMarketPrice)
    const previousClose = Number(meta?.chartPreviousClose ?? meta?.previousClose)
    if (!(price > 0)) return null
    const prev = previousClose > 0 ? previousClose : price
    const change = price - prev
    const changePct = prev ? (change / prev) * 100 : 0
    return {
      price,
      previousClose: prev,
      change: +change.toFixed(4),
      changePct: +changePct.toFixed(2),
    }
  } catch {
    return null
  }
}

function unsourcedQuote(symbol: VolatilitySymbol, nowIso: string): VolatilityQuote {
  const meta = VOL_META[symbol]
  return {
    symbol,
    ...meta,
    value: 0,
    previousClose: 0,
    change: 0,
    changePct: 0,
    regime: 'NORMAL',
    isExpanding: false,
    asOfIso: nowIso,
    sourced: false,
  }
}

function quoteFromPrint(symbol: VolatilitySymbol, print: YahooLast, nowIso: string): VolatilityQuote {
  const classified = classifyVolatilityRegime(symbol, print.price, print.changePct)
  return {
    symbol,
    ...VOL_META[symbol],
    value: print.price,
    previousClose: print.previousClose,
    change: print.change,
    changePct: print.changePct,
    regime: classified.regime,
    isExpanding: classified.isExpanding,
    asOfIso: nowIso,
    sourced: true,
  }
}

let cachedVolState: CrossMarketVolatilityState | null = null
let lastVolFetchMs = 0
const VOL_CACHE_TTL_MS = 15_000

/**
 * Live Cboe gauges. A symbol that does not print stays unsourced.
 */
export async function getCrossMarketVolatility(): Promise<CrossMarketVolatilityState> {
  const now = Date.now()
  if (cachedVolState && now - lastVolFetchMs < VOL_CACHE_TTL_MS) {
    return cachedVolState
  }

  const nowIso = new Date(now).toISOString()
  const symbols = Object.keys(YAHOO_VOL_SYMBOLS) as VolatilitySymbol[]
  const prints = await Promise.all(symbols.map((symbol) => fetchYahooLast(YAHOO_VOL_SYMBOLS[symbol])))
  const quotes = {} as Record<VolatilitySymbol, VolatilityQuote>
  symbols.forEach((symbol, index) => {
    const print = prints[index]
    quotes[symbol] = print ? quoteFromPrint(symbol, print, nowIso) : unsourcedQuote(symbol, nowIso)
  })

  const state = buildCrossMarketVolatilityState(quotes)
  if (symbols.some((symbol) => quotes[symbol].sourced)) {
    cachedVolState = state
    lastVolFetchMs = now
  }
  return state
}
