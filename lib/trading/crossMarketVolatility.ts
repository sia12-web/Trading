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
  if (
    norm.includes('GOLD') ||
    norm.includes('GC') ||
    norm.includes('MGC') ||
    norm.includes('SILVER') ||
    norm.includes('SIL') ||
    norm.includes('SI') ||
    norm.includes('XAG')
  ) {
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
      targetMarkets: ['GOLD', 'SILVER'],
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

let cachedVolState: CrossMarketVolatilityState | null = null
let lastVolFetchMs = 0
const VOL_CACHE_TTL_MS = 15_000 // 15 seconds cache

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const latestLiveQuotes: Partial<Record<VolatilitySymbol, VolatilityQuote>> = {}

async function fetchLiveCboeQuote(
  symbol: VolatilitySymbol,
  yahooTicker: string,
  name: string,
  assetClass: VolatilityAssetClass,
  targetMarkets: string[],
  description: string
): Promise<VolatilityQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1m&range=1d`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null

    const value = Number(meta.regularMarketPrice)
    const prevClose = Number(meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose || value)
    const change = Number((value - prevClose).toFixed(3))
    const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0
    const asOfIso = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString()

    const { regime, isExpanding } = classifyVolatilityRegime(symbol, value, changePct)

    return {
      symbol,
      name,
      assetClass,
      targetMarkets,
      value,
      previousClose: prevClose,
      change,
      changePct,
      regime,
      isExpanding,
      description,
      asOfIso,
    }
  } catch {
    return null
  }
}

async function fetchNikkeiRealizedVol(): Promise<VolatilityQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/NKD=F?interval=1d&range=1mo`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: any) => typeof c === 'number') || []
    if (closes.length < 5) return null

    const returns: number[] = []
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i]! / closes[i - 1]!))
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1)
    const stdev = Math.sqrt(variance)
    const annualizedVol = Number((stdev * Math.sqrt(252) * 100).toFixed(1))

    const prevCloses = closes.slice(0, -1)
    const prevReturns: number[] = []
    for (let i = 1; i < prevCloses.length; i++) {
      prevReturns.push(Math.log(prevCloses[i]! / prevCloses[i - 1]!))
    }
    const prevMean = prevReturns.reduce((a, b) => a + b, 0) / prevReturns.length
    const prevVar = prevReturns.reduce((a, b) => a + Math.pow(b - prevMean, 2), 0) / (prevReturns.length - 1)
    const prevAnnualized = Number((Math.sqrt(prevVar) * Math.sqrt(252) * 100).toFixed(1))

    const change = Number((annualizedVol - prevAnnualized).toFixed(2))
    const changePct = prevAnnualized > 0 ? Number(((change / prevAnnualized) * 100).toFixed(2)) : 0
    const asOfIso = meta?.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString()

    const { regime, isExpanding } = classifyVolatilityRegime('JNIV', annualizedVol, changePct)

    return {
      symbol: 'JNIV',
      name: 'Nikkei 225 Volatility (Realized/Implied)',
      assetClass: 'NIKKEI',
      targetMarkets: ['NIKKEI'],
      value: annualizedVol,
      previousClose: prevAnnualized,
      change,
      changePct,
      regime,
      isExpanding,
      description: 'Annualized 20-day volatility calculated directly from live Nikkei 225 futures prints.',
      asOfIso,
    }
  } catch {
    return null
  }
}

/**
 * Fetches or returns cached cross-market volatility from live CBOE and exchange feeds.
 */
export async function getCrossMarketVolatility(): Promise<CrossMarketVolatilityState> {
  const now = Date.now()
  if (cachedVolState && now - lastVolFetchMs < VOL_CACHE_TTL_MS) {
    return cachedVolState
  }

  try {
    const [vixRes, vix1dRes, ovxRes, gvzRes, jnivRes] = await Promise.allSettled([
      fetchLiveCboeQuote('VIX', '^VIX', 'Cboe Volatility Index', 'EQUITIES', ['NASDAQ', 'DOW', 'SP500'], 'Measures expected 30-day equity volatility.'),
      fetchLiveCboeQuote('VIX1D', '^VIX1D', 'Cboe 1-Day Volatility Index', 'EQUITIES', ['NASDAQ', 'DOW', 'SP500'], 'Measures expected 1-day equity volatility using 0DTE/1DTE SPX options.'),
      fetchLiveCboeQuote('OVX', '^OVX', 'Cboe Crude Oil Volatility Index', 'CRUDE', ['CRUDE'], 'Measures expected 30-day crude oil volatility derived from USO options pricing.'),
      fetchLiveCboeQuote('GVZ', '^GVZ', 'Cboe Gold Volatility Index', 'GOLD', ['GOLD', 'SILVER'], 'Measures expected 30-day gold volatility derived from GLD options pricing.'),
      fetchNikkeiRealizedVol(),
    ])

    const defaults = buildDefaultVolatilityQuotes(new Date())

    const vixQuote = vixRes.status === 'fulfilled' && vixRes.value ? vixRes.value : (latestLiveQuotes.VIX ?? defaults.VIX)
    const vix1dQuote = vix1dRes.status === 'fulfilled' && vix1dRes.value ? vix1dRes.value : (latestLiveQuotes.VIX1D ?? defaults.VIX1D)
    const ovxQuote = ovxRes.status === 'fulfilled' && ovxRes.value ? ovxRes.value : (latestLiveQuotes.OVX ?? defaults.OVX)
    const gvzQuote = gvzRes.status === 'fulfilled' && gvzRes.value ? gvzRes.value : (latestLiveQuotes.GVZ ?? defaults.GVZ)
    const jnivQuote = jnivRes.status === 'fulfilled' && jnivRes.value ? jnivRes.value : (latestLiveQuotes.JNIV ?? defaults.JNIV)

    if (vixRes.status === 'fulfilled' && vixRes.value) latestLiveQuotes.VIX = vixRes.value
    if (vix1dRes.status === 'fulfilled' && vix1dRes.value) latestLiveQuotes.VIX1D = vix1dRes.value
    if (ovxRes.status === 'fulfilled' && ovxRes.value) latestLiveQuotes.OVX = ovxRes.value
    if (gvzRes.status === 'fulfilled' && gvzRes.value) latestLiveQuotes.GVZ = gvzRes.value
    if (jnivRes.status === 'fulfilled' && jnivRes.value) latestLiveQuotes.JNIV = jnivRes.value

    const liveQuotes: Record<VolatilitySymbol, VolatilityQuote> = {
      VIX: vixQuote,
      VIX1D: vix1dQuote,
      OVX: ovxQuote,
      GVZ: gvzQuote,
      JNIV: jnivQuote,
    }

    cachedVolState = buildCrossMarketVolatilityState(liveQuotes)
    lastVolFetchMs = now
    return cachedVolState
  } catch {
    if (cachedVolState) return cachedVolState
    const quotes = buildDefaultVolatilityQuotes(new Date())
    return buildCrossMarketVolatilityState(quotes)
  }
}

