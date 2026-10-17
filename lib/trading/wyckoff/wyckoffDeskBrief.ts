/**
 * Wyckoff Desk Brief, Deduplicated Alert Engine & Persistent State Store
 *
 * Implements:
 * - Section 9 Monitoring, Alerts & Persistence
 * - Deduplicated alert fingerprinting so unchanged market states never emit duplicate alerts
 * - Persistent storage of detected ranges, lifecycle transitions, and emitted alerts
 *   (`data/wyckoff_auction_state.json` + in-memory cache)
 * - Concise, deterministic multi-timeframe brief formatting for Chart Leo, Notes, and Situations.
 */

import { resolveWyckoffMarketSpec } from './wyckoffSwingStructure'
import {
  evaluateWyckoffMultiTimeframe,
  type MultiTimeframeWyckoffInput,
} from './wyckoffMultiTimeframeContext'
import type {
  WyckoffAuctionAlert,
  WyckoffDetectedRange,
  WyckoffInstrument,
  WyckoffLifecycleTransition,
  WyckoffMultiTimeframeReport,
  WyckoffTimeframeAnalysis,
} from './types'

export interface PersistedWyckoffMarketState {
  instrument: WyckoffInstrument
  updatedAt: string
  rangesByTimeframe: Partial<Record<'1D' | '4H' | '30m' | '5m', WyckoffDetectedRange>>
  lifecycleHistory: WyckoffLifecycleTransition[]
  emittedAlertFingerprints: string[]
  recentAlerts: WyckoffAuctionAlert[]
}

interface WyckoffPersistenceStore {
  version: number
  markets: Partial<Record<WyckoffInstrument, PersistedWyckoffMarketState>>
}

function getFs(): any {
  if (typeof window !== 'undefined') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return eval('require')('fs')
  } catch {
    return null
  }
}

function getPath(): any {
  if (typeof window !== 'undefined') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return eval('require')('path')
  } catch {
    return null
  }
}

const memoryStore: WyckoffPersistenceStore = {
  version: 1,
  markets: {},
}

let diskLoaded = false

function loadStoreFromDisk(): WyckoffPersistenceStore {
  if (diskLoaded) return memoryStore
  diskLoaded = true
  if (typeof window !== 'undefined') return memoryStore
  const fs = getFs()
  const path = getPath()
  if (!fs || !path) return memoryStore

  try {
    const statePath = path.join(process.cwd(), 'data', 'wyckoff_auction_state.json')
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf-8')
      const parsed = JSON.parse(raw) as WyckoffPersistenceStore
      if (parsed && typeof parsed === 'object' && parsed.markets) {
        memoryStore.markets = { ...parsed.markets, ...memoryStore.markets }
      }
    }
  } catch {
    // Non-fatal in read-only or browser environments
  }
  return memoryStore
}

function saveStoreToDisk(): void {
  if (typeof window !== 'undefined') return
  const fs = getFs()
  const path = getPath()
  if (!fs || !path) return

  try {
    const statePath = path.join(process.cwd(), 'data', 'wyckoff_auction_state.json')
    const dir = path.dirname(statePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(
      statePath,
      JSON.stringify(memoryStore, null, 2),
      'utf-8'
    )
  } catch {
    // Non-fatal in serverless/read-only/browser environments
  }
}

export function resetWyckoffAlertDeduplicationCache(instrumentRaw?: string): void {
  loadStoreFromDisk()
  if (instrumentRaw) {
    const spec = resolveWyckoffMarketSpec(instrumentRaw)
    delete memoryStore.markets[spec.instrument]
  } else {
    memoryStore.markets = {}
  }
}

export function getPersistedWyckoffMarketState(
  instrumentRaw: string
): PersistedWyckoffMarketState | null {
  loadStoreFromDisk()
  const spec = resolveWyckoffMarketSpec(instrumentRaw)
  return memoryStore.markets[spec.instrument] ?? null
}

function shortSymbolLabel(instrument: WyckoffInstrument): string {
  switch (instrument) {
    case 'NASDAQ':
      return 'NQ'
    case 'DOW':
      return 'YM'
    case 'GOLD':
      return 'GC'
    case 'SILVER':
      return 'SI'
    case 'CRUDE':
      return 'CL'
    case 'NIKKEI':
      return 'Nikkei'
  }
}

function buildCandidatesForTimeframe(
  tf: WyckoffTimeframeAnalysis,
  isCountertrend5m: boolean,
  m30Bearish: boolean
): Array<Omit<WyckoffAuctionAlert, 'id' | 'timestamp' | 'isoTime'>> {
  const sym = shortSymbolLabel(tf.instrument)
  const out: Array<Omit<WyckoffAuctionAlert, 'id' | 'timestamp' | 'isoTime'>> = []
  const range = tf.detectedRange
  const ev = tf.eventState
  const cvd = tf.cvdVolume

  if (!range) return out

  const rangeKey = `${tf.instrument}:${tf.timeframe}:${range.rangeLow.toFixed(1)}-${range.rangeHigh.toFixed(1)}`

  // 1. Range detected + boundary approaching
  if (ev.lifecycleStage === 'BOUNDARY_APPROACH') {
    const side =
      range.pricePosition === 'LOWER_BOUNDARY_ZONE' ||
      range.pricePosition === 'LOWER_HALF'
        ? 'lower boundary'
        : 'upper boundary'
    out.push({
      fingerprint: `${rangeKey}:BOUNDARY_APPROACH:${side}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus: 'WATCH',
      lifecycleStage: 'BOUNDARY_APPROACH',
      candidateEvent: ev.candidateEvent,
      headline: `${sym}: ${tf.timeframe} range detected; ${side} approaching.`,
      observedCondition: `Price (${tf.currentPrice?.toFixed(2)}) is approaching the ${tf.timeframe} ${side} [${range.rangeLow.toFixed(2)} – ${range.rangeHigh.toFixed(2)}].`,
      evidence: `${range.durationBars}-bar range, overlap ${(range.overlapRatio * 100).toFixed(0)}%, ATR ${tf.atrRegime.currentAtr?.toFixed(2) ?? 'N/A'}.`,
    })
  }

  // 2. Possible absorption (unconfirmed)
  if (
    cvd.condition === 'BULLISH_ABSORPTION_CANDIDATE' &&
    ev.confirmationStatus !== 'CONFIRMED'
  ) {
    out.push({
      fingerprint: `${rangeKey}:BULLISH_ABSORPTION_UNCONFIRMED:${ev.lifecycleStage}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus:
        ev.candidateEvent === 'SPRING' ? 'POSSIBLE_SPRING' : 'WATCH',
      lifecycleStage: ev.lifecycleStage,
      candidateEvent: ev.candidateEvent,
      headline: `${sym}: Aggressive selling increasing but downside progress diminishing. Possible absorption, unconfirmed.`,
      observedCondition: `Aggressive sell volume expanded near ${ tf.timeframe } support (${range.rangeLow.toFixed(2)}) with diminishing downward displacement.`,
      evidence: cvd.effortVsResultSummary,
    })
  } else if (
    cvd.condition === 'BEARISH_ABSORPTION_CANDIDATE' &&
    ev.confirmationStatus !== 'CONFIRMED'
  ) {
    out.push({
      fingerprint: `${rangeKey}:BEARISH_ABSORPTION_UNCONFIRMED:${ev.lifecycleStage}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus:
        ev.candidateEvent === 'UPTHRUST' ? 'POSSIBLE_UPTHRUST' : 'WATCH',
      lifecycleStage: ev.lifecycleStage,
      candidateEvent: ev.candidateEvent,
      headline: `${sym}: Aggressive buying increasing but upside progress diminishing. Possible supply absorption, unconfirmed.`,
      observedCondition: `Aggressive buy volume expanded near ${tf.timeframe} resistance (${range.rangeHigh.toFixed(2)}) with diminishing upward displacement.`,
      evidence: cvd.effortVsResultSummary,
    })
  }

  // 3. Resistance swept & returned inside -> Potential or Confirmed Upthrust
  if (
    ev.candidateEvent === 'UPTHRUST' &&
    (ev.lifecycleStage === 'RETURN_INSIDE' ||
      ev.lifecycleStage === 'RETEST' ||
      ev.lifecycleStage === 'CONFIRMED')
  ) {
    out.push({
      fingerprint: `${rangeKey}:UPTHRUST:${ev.lifecycleStage}:${ev.confirmationStatus}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus:
        ev.confirmationStatus === 'CONFIRMED'
          ? 'CONFIRMED'
          : 'POSSIBLE_UPTHRUST',
      lifecycleStage: ev.lifecycleStage,
      candidateEvent: 'UPTHRUST',
      headline: `${sym}: Resistance swept; price returned below the range. ${
        ev.confirmationStatus === 'CONFIRMED'
          ? 'Confirmed upthrust.'
          : 'Potential upthrust.'
      }`,
      observedCondition: `Upper boundary (${range.rangeHigh.toFixed(2)}) swept to ${ev.sweepExtremePrice?.toFixed(2) ?? 'high'} and closed back inside at ${ev.reclaimPrice?.toFixed(2) ?? tf.currentPrice?.toFixed(2)}.`,
      evidence: ev.eventSummary,
    })
  }

  // 4. Support swept & reclaimed -> Spring (with explicit HTF conflict if 5m vs 30m bearish)
  if (
    ev.candidateEvent === 'SPRING' &&
    (ev.lifecycleStage === 'RECLAIM' ||
      ev.lifecycleStage === 'RETEST' ||
      ev.lifecycleStage === 'CONFIRMED')
  ) {
    const headline =
      tf.timeframe === '5m' && isCountertrend5m && m30Bearish
        ? `${sym}: 5m spring reclaim confirmed, but 30m remains bearish.`
        : `${sym}: ${tf.timeframe} support swept and reclaimed (${ev.lifecycleStage}). ${
            ev.confirmationStatus === 'CONFIRMED'
              ? 'Confirmed spring.'
              : 'Potential spring — awaiting secondary test hold.'
          }`

    out.push({
      fingerprint: `${rangeKey}:SPRING:${ev.lifecycleStage}:${ev.confirmationStatus}:CT_${isCountertrend5m}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus:
        ev.confirmationStatus === 'CONFIRMED' ? 'CONFIRMED' : 'POSSIBLE_SPRING',
      lifecycleStage: ev.lifecycleStage,
      candidateEvent: 'SPRING',
      headline,
      observedCondition: `Lower boundary (${range.rangeLow.toFixed(2)}) swept to ${ev.sweepExtremePrice?.toFixed(2) ?? 'low'} and reclaimed inside range.`,
      evidence: ev.eventSummary,
    })
  }

  // 5. Spring hypothesis invalidated (initiative selling achieving fresh downside lows)
  if (
    (ev.candidateEvent === 'SPRING' &&
      ev.confirmationStatus === 'INVALIDATED') ||
    (ev.candidateEvent === 'SIGN_OF_WEAKNESS' &&
      ev.confirmationStatus === 'INVALIDATED') ||
    (ev.candidateEvent === 'BREAKDOWN_FAILED_RECLAIM' &&
      cvd.condition === 'SUCCESSFUL_BEARISH_INITIATIVE')
  ) {
    out.push({
      fingerprint: `${rangeKey}:SPRING_INVALIDATED:${ev.lifecycleStage}`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus: 'INVALIDATED',
      lifecycleStage: ev.lifecycleStage,
      candidateEvent: ev.candidateEvent,
      headline: `${sym}: Selling pressure is achieving fresh downside lows. Spring hypothesis invalidated.`,
      observedCondition: `Price broke below ${range.rangeLow.toFixed(2)} and continued making lower lows to ${ev.sweepExtremePrice?.toFixed(2) ?? tf.currentPrice?.toFixed(2)} without reclaiming support.`,
      evidence: ev.invalidationReason ?? ev.eventSummary,
    })
  }

  // 6. Breakout + retest confirmed (SOS -> LPS)
  if (
    ev.candidateEvent === 'BREAKOUT_RETEST' &&
    ev.confirmationStatus === 'CONFIRMED'
  ) {
    out.push({
      fingerprint: `${rangeKey}:BREAKOUT_RETEST:CONFIRMED`,
      market: tf.market,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      monitoringStatus: 'CONFIRMED',
      lifecycleStage: 'CONFIRMED',
      candidateEvent: 'BREAKOUT_RETEST',
      headline: `${sym}: ${tf.timeframe} resistance broken and successfully retested as support (SOS -> LPS confirmed).`,
      observedCondition: `Price accepted above ${range.rangeHigh.toFixed(2)} and held ${ev.retestPrice?.toFixed(2) ?? range.rangeHigh.toFixed(2)} on the pullback.`,
      evidence: ev.eventSummary,
    })
  }

  return out
}

export function generateAndPersistWyckoffReport(
  input: MultiTimeframeWyckoffInput,
  options?: { bypassDeduplication?: boolean; persistToDisk?: boolean }
): WyckoffMultiTimeframeReport {
  loadStoreFromDisk()
  const baseReport = evaluateWyckoffMultiTimeframe(input)
  const instrument = baseReport.instrument
  const nowSec =
    input.nowUnixSec ??
    baseReport.m5.latestBarTime ??
    baseReport.m30.latestBarTime ??
    baseReport.daily.latestBarTime ??
    Math.floor(Date.now() / 1000)
  const isoTime = new Date(nowSec * 1000).toISOString()

  const existingState: PersistedWyckoffMarketState = memoryStore.markets[
    instrument
  ] ?? {
    instrument,
    updatedAt: isoTime,
    rangesByTimeframe: {},
    lifecycleHistory: [],
    emittedAlertFingerprints: [],
    recentAlerts: [],
  }

  const m30Bearish =
    baseReport.m30.eventState.directionBias === 'BEARISH' ||
    baseReport.m30.detectedRange?.classification === 'BREAKDOWN' ||
    baseReport.m30.detectedRange?.classification === 'POSSIBLE_DISTRIBUTION' ||
    baseReport.m30.detectedRange?.classification === 'POSSIBLE_REDISTRIBUTION' ||
    baseReport.m30.swingStructure.structuralTrend === 'DOWNTREND'

  const candidateAlerts = [
    ...buildCandidatesForTimeframe(
      baseReport.m5,
      baseReport.hierarchySynthesis.isCountertrend5m,
      m30Bearish
    ),
    ...buildCandidatesForTimeframe(baseReport.m30, false, m30Bearish),
    ...buildCandidatesForTimeframe(baseReport.daily, false, false),
  ]

  const fingerprintSet = new Set(
    options?.bypassDeduplication ? [] : existingState.emittedAlertFingerprints
  )
  const freshAlerts: WyckoffAuctionAlert[] = []

  for (const cand of candidateAlerts) {
    if (fingerprintSet.has(cand.fingerprint)) continue
    fingerprintSet.add(cand.fingerprint)
    freshAlerts.push({
      ...cand,
      id: `wyckoff-alert-${instrument}-${cand.timeframe}-${nowSec}-${freshAlerts.length + 1}`,
      timestamp: nowSec,
      isoTime,
    })
  }

  // Update persisted state
  if (baseReport.daily.detectedRange) {
    existingState.rangesByTimeframe['1D'] = baseReport.daily.detectedRange
  }
  if (baseReport.h4?.detectedRange) {
    existingState.rangesByTimeframe['4H'] = baseReport.h4.detectedRange
  }
  if (baseReport.m30.detectedRange) {
    existingState.rangesByTimeframe['30m'] = baseReport.m30.detectedRange
  }
  if (baseReport.m5.detectedRange) {
    existingState.rangesByTimeframe['5m'] = baseReport.m5.detectedRange
  }

  const newTransitions = [
    ...baseReport.daily.eventState.transitions,
    ...(baseReport.h4 ? baseReport.h4.eventState.transitions : []),
    ...baseReport.m30.eventState.transitions,
    ...baseReport.m5.eventState.transitions,
  ]
  existingState.lifecycleHistory = [
    ...existingState.lifecycleHistory,
    ...newTransitions,
  ].slice(-80)

  existingState.emittedAlertFingerprints = Array.from(fingerprintSet).slice(-120)
  existingState.recentAlerts = [
    ...freshAlerts,
    ...existingState.recentAlerts,
  ].slice(0, 40)
  existingState.updatedAt = isoTime

  memoryStore.markets[instrument] = existingState
  if (options?.persistToDisk !== false) {
    saveStoreToDisk()
  }

  return {
    ...baseReport,
    alerts: freshAlerts,
  }
}

export function formatWyckoffMultiTimeframeBriefForLeo(
  report: WyckoffMultiTimeframeReport
): string {
  const formatTfLine = (tf: WyckoffTimeframeAnalysis) => {
    const r = tf.detectedRange
    const rangeTxt = r
      ? `Range [${r.rangeLow.toFixed(2)} – ${r.rangeHigh.toFixed(2)}] (Mid ${r.rangeMidpoint.toFixed(2)}, POC ${r.poc?.toFixed(2) ?? 'N/A'}, Width ${r.widthAtr?.toFixed(2) ?? 'N/A'} ATR, ${r.classification} / ${r.provisionalPhase})`
      : `No horizontal range (Swing Structure: ${tf.swingStructure.structuralTrend})`

    return [
      `  • [${tf.timeframe}] Status: ${tf.monitoringStatus} | ${rangeTxt}`,
      `    - Event Lifecycle: ${tf.eventState.candidateEvent} @ ${tf.eventState.lifecycleStage} (${tf.eventState.confirmationStatus}) — ${tf.eventState.eventSummary}`,
      `    - ATR & Volatility: ATR=${tf.atrRegime.currentAtr?.toFixed(2) ?? 'UNKNOWN'} (${tf.atrRegime.atrTrend}, P${tf.atrRegime.atrPercentile ?? 'N/A'}) — ${tf.atrRegime.volatilityQuestionAnswer}`,
      `    - CVD & Effort vs Result (${tf.cvdVolume.cvdSource}${tf.cvdVolume.isEstimated ? ', ESTIMATED' : ''}): ${tf.cvdVolume.condition} | RVOL=${tf.cvdVolume.relativeVolume?.toFixed(2) ?? 'N/A'}x — ${tf.cvdVolume.effortVsResultSummary}`,
      `    - Structural Invalidation: ${tf.structuralInvalidation.description} | Next Obstacle: ${tf.nextImportantObstacle.label} (${tf.nextImportantObstacle.price?.toFixed(2) ?? 'N/A'}) | Runway: ${tf.rewardToRiskRunway.verdict}`,
    ].join('\n')
  }

  const advQuestions = report.m5.adversarialCheck.questions
    .map(
      (q) =>
        `    ${q.questionNumber}. [${q.passed ? 'PASS' : 'WARN'}] ${q.question} -> ${q.answer}`
    )
    .join('\n')

  const alertsBlock =
    report.alerts.length > 0
      ? report.alerts.map((a) => `  • [${a.monitoringStatus}] ${a.headline}`).join('\n')
      : '  • No new un-emitted Wyckoff transition alerts on this bar.'

  const volRadarBlock = report.volatilityAndRadarSynthesis
    ? [
        `Volatility Gauge & Cross-Market Radar Wyckoff Synthesis:`,
        `  - Implied Vol Gauge (${report.volatilityAndRadarSynthesis.primaryGaugeSymbol}): ${report.volatilityAndRadarSynthesis.primaryGaugeValue != null ? report.volatilityAndRadarSynthesis.primaryGaugeValue.toFixed(1) : 'UNAVAILABLE'} (${report.volatilityAndRadarSynthesis.primaryGaugeChangePct != null ? `${report.volatilityAndRadarSynthesis.primaryGaugeChangePct >= 0 ? '+' : ''}${report.volatilityAndRadarSynthesis.primaryGaugeChangePct.toFixed(1)}%` : '0.0%'}, Regime: ${report.volatilityAndRadarSynthesis.primaryGaugeRegime}) -> Signal: ${report.volatilityAndRadarSynthesis.volGaugeSignal}`,
        `  - Vol Gauge Read: ${report.volatilityAndRadarSynthesis.volGaugeDiagnosis}`,
        `  - Cross-Market Radar: Grade ${report.volatilityAndRadarSynthesis.radarGrade ?? 'N/A'} (Top Pick: ${report.volatilityAndRadarSynthesis.radarTopPick ?? 'NONE'}) -> Signal: ${report.volatilityAndRadarSynthesis.crossMarketSignal}`,
        `  - Cross-Market Read: ${report.volatilityAndRadarSynthesis.crossMarketDiagnosis}`,
        `  - Combined Vol + Radar Acc/Dist Verdict: ${report.volatilityAndRadarSynthesis.combinedAccDistVerdict} — ${report.volatilityAndRadarSynthesis.actionableSynthesis}`,
      ].join('\n')
    : null

  return [
    `=== WYCKOFF MULTI-TIMEFRAME AUCTION INTELLIGENCE (${report.instrument} / ${report.market}) ===`,
    `Hierarchy Alignment: ${report.hierarchySynthesis.alignmentStatus} | Combined Verdict: ${report.hierarchySynthesis.combinedVerdict}`,
    `Actionable Read: ${report.hierarchySynthesis.actionableSummary}`,
    ...(report.hierarchySynthesis.explicitConflicts.length > 0
      ? [`HTF Conflict Warnings: ${report.hierarchySynthesis.explicitConflicts.join(' | ')}`]
      : []),
    ...(volRadarBlock ? [volRadarBlock] : []),
    `Multi-Timeframe Breakdown (1D -> 4H -> 30m -> 5m):`,
    formatTfLine(report.daily),
    ...(report.h4 ? [formatTfLine(report.h4)] : []),
    formatTfLine(report.m30),
    formatTfLine(report.m5),
    `5m Wyckoffian Mindset Audit (Effort vs Result):`,
    `  - Business Location: ${report.m5.mindsetAudit.whereConductingBusiness}`,
    `  - Aggressor vs Progress: ${report.m5.mindsetAudit.aggressiveSide} ${report.m5.mindsetAudit.isAggressiveMovingPrice}`,
    `  - Trapped Participants: ${report.m5.mindsetAudit.areBreakoutParticipantsTrapped}`,
    `  - Inventory Thought Experiment: ${report.m5.hypothesis.inventoryThoughtExperiment.accumulationWhereAreSellers}`,
    `  - Alternative Hypothesis: ${report.m5.hypothesis.alternativeHypothesis}`,
    `5m Adversarial Checklist (${report.m5.adversarialCheck.direction}):`,
    advQuestions,
    `  - ${report.m5.adversarialCheck.selfChallengeCritique}`,
    `Active Wyckoff Auction Alerts:`,
    alertsBlock,
  ].join('\n')
}

