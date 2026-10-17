import type {
  BoxMarket,
  BoxRegimeAnalysis,
  BoxSubLeg,
} from './boxRangeBacktester'

export interface SavedAccumulationBehavior {
  higherLowBaseRatePct: number
  higherLowBaseCount: number
  springRatePct: number
  springCount: number
  springCvdAbsorptionPct: number
  avgSpringDepthPts: number
  avgMarkupMfePts: number
  winRate1RPct: number
  winRate2RPct: number
  summaryText: string
}

export interface SavedDistributionBehavior {
  lowerHighLpsyRatePct: number
  utadRatePct: number
  utadCount: number
  utadCvdAbsorptionPct: number
  avgUtadDepthPts: number
  avgMarkdownMfePts: number
  summaryText: string
}

export interface SavedPhaseDEExecutionPlan {
  timeAsRegulatorNote: string
  phaseDOpportunityNote: string
  phaseEOpportunityNote: string
}

export interface SavedWyckoffEdge {
  id: string
  market: BoxMarket
  timeframe: '4H'
  label: string
  createdAt: string
  updatedAt: string
  createdDateFormatted: string
  rangeStartDate: string
  rangeEndDate: string
  startTimeUnix: number
  endTimeUnix: number
  durationDays: number
  lowPrice: number
  highPrice: number
  priceSpanPts: number
  poc: number
  vah: number
  val: number
  h4Atr: number
  h4NetCvd: number
  h4CvdBias: 'BULLISH_ABSORPTION' | 'BEARISH_DISTRIBUTION' | 'NEUTRAL'
  totalVolume: number
  dominantRegime: 'ACCUMULATION' | 'DISTRIBUTION' | 'BALANCED'
  confidencePct: number
  accumulationCount: number
  distributionCount: number
  accumulationBehavior: SavedAccumulationBehavior
  distributionBehavior: SavedDistributionBehavior
  subLegs: BoxSubLeg[]
  phaseDEExecutionPlan: SavedPhaseDEExecutionPlan
  traderNotes: string
  isActiveInLeoMemory: boolean
}

export const WYCKOFF_EDGES_STORAGE_KEY = 'trading_desk_wyckoff_4h_edges_v1'
export const WYCKOFF_EDGES_EVENT_NAME = 'wyckoff-edges-updated'

// In-memory store for SSR / Node API routes / unit tests
let memoryEdgesStore: SavedWyckoffEdge[] = []

export function normalizeMarketName(market: string | undefined | null): BoxMarket {
  const m = (market || 'GOLD').toUpperCase().trim()
  if (m === 'NQ' || m === 'MNQ' || m.includes('NAS')) return 'NASDAQ'
  if (m === 'YM' || m === 'MYM' || m.includes('DOW')) return 'DOW'
  if (m === 'GC' || m === 'MGC' || m.includes('GOLD')) return 'GOLD'
  if (m === 'SI' || m === 'SIL' || m.includes('SILVER')) return 'SILVER'
  if (m === 'CL' || m === 'MCL' || m.includes('CRUDE') || m.includes('OIL')) return 'CRUDE'
  if (m === 'NKD' || m.includes('NIKKEI')) return 'NIKKEI'
  return 'GOLD'
}

export function formatEdgeTimestampEt(isoOrMs?: string | number): string {
  try {
    const dt = isoOrMs ? new Date(isoOrMs) : new Date()
    if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    return (
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(dt) + ' ET'
    )
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  }
}

function safeFinite(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Builds a complete, dated SavedWyckoffEdge record from a 4H BoxRegimeAnalysis result.
 */
export function buildWyckoffEdgeFromBoxAnalysis(
  analysis: BoxRegimeAnalysis,
  traderNotes?: string
): SavedWyckoffEdge {
  const market = normalizeMarketName(analysis.market)
  const rawLow = safeFinite(analysis.lowPrice, 0)
  const rawHigh = safeFinite(analysis.highPrice, rawLow)
  const lowPrice = Math.min(rawLow, rawHigh)
  const highPrice = Math.max(rawLow, rawHigh)
  const priceSpanPts = Number(Math.max(0, highPrice - lowPrice).toFixed(2))

  const parsedStartSec = analysis.startTimeStr
    ? Math.floor(new Date(analysis.startTimeStr).getTime() / 1000)
    : 0
  const parsedEndSec = analysis.endTimeStr
    ? Math.floor(new Date(analysis.endTimeStr).getTime() / 1000)
    : 0
  const rawStart = safeFinite(
    parsedStartSec > 0 ? parsedStartSec : undefined,
    Math.floor(Date.now() / 1000) - 86400 * 30
  )
  const rawEnd = safeFinite(
    parsedEndSec > 0 ? parsedEndSec : undefined,
    Math.floor(Date.now() / 1000)
  )
  const startTimeUnix = Math.min(rawStart, rawEnd)
  const endTimeUnix = Math.max(rawStart, rawEnd)

  const nowIso = new Date().toISOString()
  const createdDateFormatted = formatEdgeTimestampEt(nowIso)

  const wb = analysis.wyckoffBacktest
  const accCount = safeFinite(wb?.accumulationCount, 0)
  const distCount = safeFinite(wb?.distributionCount, 0)

  const accHigherLowPct = safeFinite(wb?.higherLowBaseRatePct, 75)
  const accHigherLowCount = safeFinite(wb?.higherLowBaseCount, accCount)
  const accSpringPct = safeFinite(wb?.springRatePct, 25)
  const accSpringCount = safeFinite(wb?.springCount, 0)
  const accCvdAbsPct = safeFinite(wb?.springCvdAbsorptionPct, 90)
  const accAvgSpringDepth = safeFinite(wb?.avgSpringDepthPts, 0)
  const accAvgMarkupMfe = safeFinite(wb?.avgMarkupMfePts, 0)
  const accWin1R = safeFinite(wb?.winRate1RPct, 70)
  const accWin2R = safeFinite(wb?.winRate2RPct, 48)

  const distUtadPct = safeFinite(wb?.utadRatePct, 20)
  const distLpsyPct = Number(Math.max(0, 100 - distUtadPct).toFixed(1))
  const distUtadCount = safeFinite(wb?.utadCount, 0)
  const distCvdAbsPct = safeFinite(wb?.utadCvdAbsorptionPct, 85)
  const distAvgUtadDepth = safeFinite(wb?.avgUtadDepthPts, 0)
  const distAvgMarkdownMfe = safeFinite(wb?.avgMarkdownMfePts, 0)

  const isAccumDominant =
    accCount > distCount ||
    analysis.regime === 'ACCUMULATION_RANGE' ||
    analysis.regime === 'UPTREND' ||
    (accCount === distCount && analysis.endPrice >= analysis.startPrice)

  const dominantRegime: 'ACCUMULATION' | 'DISTRIBUTION' | 'BALANCED' =
    accCount === distCount && analysis.regime === 'BALANCED_RANGE'
      ? 'BALANCED'
      : isAccumDominant
        ? 'ACCUMULATION'
        : 'DISTRIBUTION'

  const totalStructs = Math.max(1, accCount + distCount)
  const majorCount = Math.max(accCount, distCount)
  const computedConfidence = Math.min(
    96,
    Math.max(58, Math.round(55 + (majorCount / totalStructs) * 38))
  )

  const poc = safeFinite(
    analysis.volumeProfile?.poc,
    Number(((lowPrice + highPrice) / 2).toFixed(2))
  )
  const vah = safeFinite(analysis.volumeProfile?.vah, highPrice)
  const val = safeFinite(analysis.volumeProfile?.val, lowPrice)
  const h4Atr = safeFinite(
    analysis.timeframes?.h4?.atr ?? analysis.avgAtr,
    Number(Math.max(1, priceSpanPts * 0.05).toFixed(2))
  )
  const h4NetCvd = safeFinite(
    analysis.timeframes?.h4?.netCvd ?? analysis.volumeProfile?.netDelta,
    0
  )
  const rawCvdBias = analysis.timeframes?.h4?.cvdBias
  const h4CvdBias: 'BULLISH_ABSORPTION' | 'BEARISH_DISTRIBUTION' | 'NEUTRAL' =
    rawCvdBias === 'BULLISH_ACCUMULATION' || h4NetCvd > 0
      ? 'BULLISH_ABSORPTION'
      : rawCvdBias === 'BEARISH_DISTRIBUTION' || h4NetCvd < 0
        ? 'BEARISH_DISTRIBUTION'
        : 'NEUTRAL'

  const totalVolume = safeFinite(
    analysis.timeframes?.h4?.totalVolume ?? analysis.volumeProfile?.totalVolume,
    0
  )

  const accSummary = `In this ${market} 4H range ($${lowPrice.toFixed(2)} – $${highPrice.toFixed(2)}), accumulation forms primarily via ${accHigherLowPct}% ascending Higher-Low LPS bases (${accHigherLowCount} structures) where passive institutional bids step in above support, and ${accSpringPct}% via downward Spring sweeps (${accSpringCount} structures, avg sweep $${accAvgSpringDepth.toFixed(2)} pts). Bullish CVD absorption confirmed on ${accCvdAbsPct}% of Springs, producing an average mark-up expansion of +${accAvgMarkupMfe.toFixed(2)} pts (${accWin1R}% 1R / ${accWin2R}% 2R win rate).`

  const distSummary = `In this ${market} 4H range ($${lowPrice.toFixed(2)} – $${highPrice.toFixed(2)}), distribution forms primarily via ${distLpsyPct}% lower-high LPSY supply roll-overs where buyer demand exhausts below the $${highPrice.toFixed(2)} Ice ceiling, and ${distUtadPct}% via upward UTAD liquidity sweeps (${distUtadCount} structures, avg sweep $${distAvgUtadDepth.toFixed(2)} pts). Bearish CVD absorption confirmed on ${distCvdAbsPct}% of UTADs, producing an average mark-down expansion of -${distAvgMarkdownMfe.toFixed(2)} pts.`

  const timeAsRegulatorNote = `Time acts as a regulator on the 5m timeframe (Last 5 Days of bars): Asia (18:00–03:00 ET) and London (03:00–08:00 ET) build the intraday 5m Cause (accumulation/distribution inventory), while NYC (08:00–16:00 ET) delivers the Phase D & Phase E Mark-Up / Mark-Down Effect with volume confirmation.`

  const phaseDOpportunityNote = `In 5m (aligned with 5D POC, Overnight Inventory & Yesterday NYC), monitor internal 5m ranges for Phase D initiation and stepping-stone re-accumulations/re-distributions (${accHigherLowPct >= accSpringPct ? `expecting ${accHigherLowPct}% Higher-Low LPS bases rather than waiting only for deep Springs` : `watching for ${accSpringPct}% Spring/UTAD liquidity sweeps`}) until Phase D breaks out of the range with BIG VOLUME.`

  const phaseEOpportunityNote = `Once Phase D breaks out of the range with big volume, Phase E is the revisit of the upper range ($${highPrice.toFixed(2)} as Last Point of Support / LPS for mark-up) or lower range ($${lowPrice.toFixed(2)} as Last Point of Supply / LPSY for mark-down) on light pullback volume — providing the second high-probability opportunity.`

  return {
    id: `edge-4h-${market.toLowerCase()}-${Math.round(lowPrice)}-${Math.round(highPrice)}-${startTimeUnix}`,
    market,
    timeframe: '4H',
    label:
      analysis.label ||
      `${market} 4H Range Edge ($${lowPrice.toFixed(1)} – $${highPrice.toFixed(1)})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdDateFormatted,
    rangeStartDate: (analysis.startTimeStr || new Date(startTimeUnix * 1000).toISOString()).slice(0, 10),
    rangeEndDate: (analysis.endTimeStr || new Date(endTimeUnix * 1000).toISOString()).slice(0, 10),
    startTimeUnix,
    endTimeUnix,
    durationDays: safeFinite(analysis.durationDays, 1),
    lowPrice,
    highPrice,
    priceSpanPts,
    poc,
    vah,
    val,
    h4Atr,
    h4NetCvd,
    h4CvdBias,
    totalVolume,
    dominantRegime,
    confidencePct: computedConfidence,
    accumulationCount: accCount,
    distributionCount: distCount,
    accumulationBehavior: {
      higherLowBaseRatePct: accHigherLowPct,
      higherLowBaseCount: accHigherLowCount,
      springRatePct: accSpringPct,
      springCount: accSpringCount,
      springCvdAbsorptionPct: accCvdAbsPct,
      avgSpringDepthPts: accAvgSpringDepth,
      avgMarkupMfePts: accAvgMarkupMfe,
      winRate1RPct: accWin1R,
      winRate2RPct: accWin2R,
      summaryText: accSummary,
    },
    distributionBehavior: {
      lowerHighLpsyRatePct: distLpsyPct,
      utadRatePct: distUtadPct,
      utadCount: distUtadCount,
      utadCvdAbsorptionPct: distCvdAbsPct,
      avgUtadDepthPts: distAvgUtadDepth,
      avgMarkdownMfePts: distAvgMarkdownMfe,
      summaryText: distSummary,
    },
    subLegs: Array.isArray(analysis.subLegs) ? analysis.subLegs : [],
    phaseDEExecutionPlan: {
      timeAsRegulatorNote,
      phaseDOpportunityNote,
      phaseEOpportunityNote,
    },
    traderNotes: traderNotes?.trim() || '',
    isActiveInLeoMemory: true,
  }
}

function readRawEdgesFromStorage(): SavedWyckoffEdge[] {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(WYCKOFF_EDGES_STORAGE_KEY)
      if (!raw) return memoryEdgesStore
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        memoryEdgesStore = parsed
        return parsed
      }
    } catch {
      // Fallback to in-memory store
    }
  }
  return [...memoryEdgesStore]
}

function writeRawEdgesToStorage(edges: SavedWyckoffEdge[]): void {
  memoryEdgesStore = [...edges]
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(WYCKOFF_EDGES_STORAGE_KEY, JSON.stringify(edges))
      window.dispatchEvent(new CustomEvent(WYCKOFF_EDGES_EVENT_NAME, { detail: edges }))
    } catch {
      // Ignore storage quota errors
    }
  }
}

/**
 * Loads all saved 4H Wyckoff Edges sorted newest first.
 */
export function loadWyckoffEdges(): SavedWyckoffEdge[] {
  const list = readRawEdgesFromStorage()
  return [...list].sort((a, b) => {
    const tA = new Date(a.updatedAt || a.createdAt).getTime() || 0
    const tB = new Date(b.updatedAt || b.createdAt).getTime() || 0
    return tB - tA
  })
}

/**
 * Returns all saved 4H Wyckoff Edges for a specific market, newest first.
 */
export function getWyckoffEdgesForMarket(market: string): SavedWyckoffEdge[] {
  const m = normalizeMarketName(market)
  return loadWyckoffEdges().filter((e) => normalizeMarketName(e.market) === m)
}

/**
 * Returns the most recent active 4H Wyckoff Edge in Leo's memory for a given market.
 */
export function getActiveLeoMemoryEdgeForMarket(market: string): SavedWyckoffEdge | null {
  const marketEdges = getWyckoffEdgesForMarket(market)
  const active = marketEdges.find((e) => e.isActiveInLeoMemory)
  return active ?? null
}

/**
 * Saves or updates a 4H Wyckoff Edge in persistent storage & Leo Memory.
 * Deduplicates if an edge for the same market has virtually identical lowPrice/highPrice boundaries.
 */
export function saveWyckoffEdge(edge: SavedWyckoffEdge): SavedWyckoffEdge {
  const current = readRawEdgesFromStorage()
  const market = normalizeMarketName(edge.market)
  const lowPrice = Math.min(safeFinite(edge.lowPrice), safeFinite(edge.highPrice))
  const highPrice = Math.max(safeFinite(edge.lowPrice), safeFinite(edge.highPrice))
  const tolerance = Math.max(0.05, (highPrice - lowPrice) * 0.015)

  const existingIdx = current.findIndex(
    (item) =>
      normalizeMarketName(item.market) === market &&
      (item.id === edge.id ||
        (Math.abs(item.lowPrice - lowPrice) <= tolerance &&
          Math.abs(item.highPrice - highPrice) <= tolerance))
  )

  const nowIso = new Date().toISOString()
  const normalizedEdge: SavedWyckoffEdge = {
    ...edge,
    market,
    lowPrice,
    highPrice,
    priceSpanPts: Number(Math.max(0, highPrice - lowPrice).toFixed(2)),
    updatedAt: nowIso,
    createdDateFormatted: edge.createdDateFormatted || formatEdgeTimestampEt(edge.createdAt || nowIso),
  }

  let updatedList: SavedWyckoffEdge[]
  if (existingIdx >= 0) {
    const existing = current[existingIdx]!
    const merged: SavedWyckoffEdge = {
      ...existing,
      ...normalizedEdge,
      id: existing.id,
      createdAt: existing.createdAt,
      createdDateFormatted: existing.createdDateFormatted || normalizedEdge.createdDateFormatted,
      updatedAt: nowIso,
      traderNotes:
        normalizedEdge.traderNotes && normalizedEdge.traderNotes.trim().length > 0
          ? normalizedEdge.traderNotes
          : existing.traderNotes,
      isActiveInLeoMemory: normalizedEdge.isActiveInLeoMemory ?? true,
    }
    updatedList = [...current]
    updatedList[existingIdx] = merged
    writeRawEdgesToStorage(updatedList)
    return merged
  } else {
    updatedList = [normalizedEdge, ...current].slice(0, 100)
    writeRawEdgesToStorage(updatedList)
    return normalizedEdge
  }
}

/**
 * Builds and saves a 4H Wyckoff Edge directly from a BoxRegimeAnalysis result.
 */
export function saveWyckoffEdgeFromBoxAnalysis(
  analysis: BoxRegimeAnalysis,
  traderNotes?: string
): SavedWyckoffEdge {
  const edge = buildWyckoffEdgeFromBoxAnalysis(analysis, traderNotes)
  return saveWyckoffEdge(edge)
}

/**
 * Updates custom trader notes on a saved 4H Edge.
 */
export function updateWyckoffEdgeNotes(edgeId: string, traderNotes: string): SavedWyckoffEdge | null {
  const current = readRawEdgesFromStorage()
  const idx = current.findIndex((e) => e.id === edgeId)
  if (idx < 0) return null
  const updated: SavedWyckoffEdge = {
    ...current[idx]!,
    traderNotes,
    updatedAt: new Date().toISOString(),
  }
  const next = [...current]
  next[idx] = updated
  writeRawEdgesToStorage(next)
  return updated
}

/**
 * Toggles whether a saved 4H Edge is active in Leo's memory.
 */
export function toggleWyckoffEdgeMemory(edgeId: string, active?: boolean): SavedWyckoffEdge | null {
  const current = readRawEdgesFromStorage()
  const idx = current.findIndex((e) => e.id === edgeId)
  if (idx < 0) return null
  const target = current[idx]!
  const nextActive = active !== undefined ? active : !target.isActiveInLeoMemory
  const updated: SavedWyckoffEdge = {
    ...target,
    isActiveInLeoMemory: nextActive,
    updatedAt: new Date().toISOString(),
  }
  const next = [...current]
  next[idx] = updated
  writeRawEdgesToStorage(next)
  return updated
}

/**
 * Deletes a saved 4H Edge by ID.
 */
export function deleteWyckoffEdge(edgeId: string): boolean {
  const current = readRawEdgesFromStorage()
  const filtered = current.filter((e) => e.id !== edgeId)
  if (filtered.length === current.length) return false
  writeRawEdgesToStorage(filtered)
  return true
}

/**
 * Clears all saved 4H Edges (or only for a specific market if provided).
 */
export function clearWyckoffEdges(market?: string): void {
  if (!market) {
    writeRawEdgesToStorage([])
    return
  }
  const m = normalizeMarketName(market)
  const current = readRawEdgesFromStorage()
  writeRawEdgesToStorage(current.filter((e) => normalizeMarketName(e.market) !== m))
}

/**
 * Subscribes to updates to the Wyckoff Edges store in the browser.
 */
export function subscribeToWyckoffEdges(callback: (edges: SavedWyckoffEdge[]) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => {
    callback(loadWyckoffEdges())
  }
  window.addEventListener(WYCKOFF_EDGES_EVENT_NAME, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(WYCKOFF_EDGES_EVENT_NAME, handler)
    window.removeEventListener('storage', handler)
  }
}

/**
 * Formats active saved 4H Wyckoff Edges for injection into Leo's system prompt & 5m Phase D/E memory.
 */
export function formatSavedEdgesForLeoPrompt(
  market: string,
  providedEdges?: SavedWyckoffEdge[]
): string {
  const m = normalizeMarketName(market)
  const all = Array.isArray(providedEdges) && providedEdges.length > 0 ? providedEdges : loadWyckoffEdges()
  const marketEdges = all.filter(
    (e) => normalizeMarketName(e.market) === m && e.isActiveInLeoMemory !== false
  )

  if (marketEdges.length === 0) {
    return `[LEO 4H WYCKOFF EDGE MEMORY (${m})]: No custom 4H Range Backtest Edge saved in memory yet for ${m}. Use empirical 4H structural backtest defaults when evaluating 5m Phase D & Phase E.`
  }

  const lines: string[] = [
    `[LEO 4H WYCKOFF EDGE MEMORY — SAVED 4H ACCUMULATION & DISTRIBUTION BEHAVIORS FOR ${m}]:`,
    `You have ${marketEdges.length} saved 4H Range Backtest Edge(s) in memory for ${m}. When on the 5-minute (5m) timeframe looking for Phase D & Phase E opportunities, YOU MUST apply these exact 4H accumulation and distribution characteristics:`,
  ]

  for (const edge of marketEdges.slice(0, 3)) {
    lines.push(
      `  • Saved Edge [${edge.createdDateFormatted}] "${edge.label}":`,
      `    - 4H Range Window: ${edge.rangeStartDate} to ${edge.rangeEndDate} (${edge.durationDays}d) | Boundaries: Low (Ice) $${edge.lowPrice.toFixed(2)} – High (Creek) $${edge.highPrice.toFixed(2)} (${edge.priceSpanPts.toFixed(2)} pts) | 4H POC: $${edge.poc.toFixed(2)} | 4H ATR: $${edge.h4Atr.toFixed(2)} | 4H CVD: ${edge.h4CvdBias} (${edge.h4NetCvd >= 0 ? '+' : ''}${Math.round(edge.h4NetCvd).toLocaleString()})`,
      `    - Dominant 4H Macro Regime: ${edge.dominantRegime} (${edge.confidencePct}% confidence | ${edge.accumulationCount} Accumulation vs. ${edge.distributionCount} Distribution sub-ranges)`,
      `    - Written 4H Accumulation Behavior: ${edge.accumulationBehavior.summaryText}`,
      `    - Written 4H Distribution Behavior: ${edge.distributionBehavior.summaryText}`,
      `    - 5m Phase D & Phase E Blueprint: ${edge.phaseDEExecutionPlan.phaseDOpportunityNote} | ${edge.phaseDEExecutionPlan.phaseEOpportunityNote}`
    )
    if (edge.traderNotes) {
      lines.push(`    - Trader Desk Note on Edge: "${edge.traderNotes}"`)
    }
  }

  return lines.join('\n')
}
