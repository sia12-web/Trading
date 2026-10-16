/**
 * Canonical market ids + market intelligence bus desk brief.
 * Run: npx tsx __tests__/market_intelligence_bus.test.ts
 */

import assert from 'node:assert/strict'
import { resolveCanonicalMarketId } from '../lib/ai/canonicalMarkets'
import {
  clearMarketIntelligenceBusForTests,
  confidenceLabel,
  formatDeskBriefForInstrument,
  normalizeConfidence,
  publishMarketSnapshot,
  readMarketSnapshotHistory,
  type MarketIntelligenceSnapshot,
} from '../lib/ai/marketIntelligenceBus'
import { buildLeoSystemPrompt, type LeoChatContext } from '../lib/ai/leoAssistant'

assert.equal(resolveCanonicalMarketId('DOW'), 'YM')
assert.equal(resolveCanonicalMarketId('NASDAQ'), 'NQ')
assert.equal(resolveCanonicalMarketId('GOLD'), 'GC')
assert.equal(resolveCanonicalMarketId('CRUDE'), 'CL')
assert.equal(resolveCanonicalMarketId('NIKKEI'), 'NK225')
assert.equal(resolveCanonicalMarketId('NKD'), 'NK225')
assert.equal(resolveCanonicalMarketId('nq'), 'NQ')
assert.equal(normalizeConfidence(84), 0.84)
assert.equal(confidenceLabel(0.84), 'HIGH')
assert.equal(confidenceLabel(0.6), 'MEDIUM')

clearMarketIntelligenceBusForTests()

const empty = formatDeskBriefForInstrument('NASDAQ')
assert.match(empty, /DESK BRIEF — NASDAQ \/ NQ/)
assert.match(empty, /No evaluated fundamental snapshot/)
assert.match(empty, /Do not invent a fundamental regime/)

const evaluated: MarketIntelligenceSnapshot = {
  market: 'NQ',
  timestamp: '2026-10-04T14:00:00.000Z',
  source: 'evaluated',
  fundamental: {
    intraday: 'BEARISH',
    shortTerm: 'NEUTRAL',
    mediumTerm: 'NEUTRAL',
    confidence: 0.81,
    confidenceLabel: 'HIGH',
  },
  primaryDriver: 'RATES',
  catalyst: { type: 'CPI', surprise: 'HOT', magnitude: 'HIGH' },
  marketConfirmation: { status: 'REJECTED' },
  abnormalBehavior: { detected: true, type: 'BULLISH_RELATIVE_STRENGTH' },
  upcoming: '10:00 ISM',
  whatChanged: 'Hot CPI, NQ rejected the impulse',
  invalidation: 'Acceptance below prior day VAL',
  stateAgeSec: 120,
}

publishMarketSnapshot(evaluated)
publishMarketSnapshot({ ...evaluated, timestamp: '2026-10-04T14:05:00.000Z' })
assert.equal(readMarketSnapshotHistory('NASDAQ').length, 1, 'unchanged brief must not append history')

publishMarketSnapshot({
  ...evaluated,
  timestamp: '2026-10-04T14:10:00.000Z',
  fundamental: { ...evaluated.fundamental, intraday: 'MIXED', confidence: 0.62, confidenceLabel: 'MEDIUM' },
})
assert.equal(readMarketSnapshotHistory('NQ').length, 2)

const brief = formatDeskBriefForInstrument('NASDAQ')
assert.match(brief, /INTRADAY MIXED/)
assert.match(brief, /Primary driver: RATES/)
assert.match(brief, /CPI/)
assert.match(brief, /BULLISH_RELATIVE_STRENGTH/)
assert.match(brief, /Do not infer trade direction/)
assert.doesNotMatch(brief, /No evaluated fundamental snapshot/)

import { formatAllMarketsDeskBriefSummary, syncFundamentalBusFromStores } from '../lib/ai/fundamentalBusSync'
import { recordEvaluatedGoldEvent, resetGoldFundamentalState } from '../lib/fundamentals/goldStateStore'
import { recordEvaluatedNikkeiEvent, resetNikkeiFundamentalState } from '../lib/fundamentals/nikkeiStateStore'
import { readMarketSnapshot } from '../lib/ai/marketIntelligenceBus'

const ctx: LeoChatContext = {
  instrument: 'NASDAQ',
  currentPrice: 20150,
  currentTimeEt: '10:15 ET',
  dayType: null,
  openingType: null,
  longTermMoney: null,
  intermediateMoney: null,
  shortTermMoney: null,
  activeExcesses: [],
}
const prompt = buildLeoSystemPrompt(ctx)
assert.match(prompt, /You are Leo/)
assert.match(prompt, /DESK BRIEF — NASDAQ \/ NQ/)
assert.match(prompt, /Do not infer trade direction/)
assert.match(prompt, /22-Rule Wyckoff/)

// ---------------------------------------------------------------------------
// Multi-Agent Cooperation Test: All 5 Specialist Stores -> Bus -> Leo & News AI
// ---------------------------------------------------------------------------
clearMarketIntelligenceBusForTests()
resetGoldFundamentalState()
resetNikkeiFundamentalState()

syncFundamentalBusFromStores(new Date('2026-10-15T14:30:00.000Z'))

for (const mkt of ['CL', 'GC', 'NQ', 'YM', 'NK225'] as const) {
  const snap = readMarketSnapshot(mkt)
  assert.ok(snap, `Expected snapshot on bus for ${mkt}`)
  assert.equal(snap.source, 'store_default')
  assert.ok(snap.fundamental.confidence !== null && snap.fundamental.confidence > 0, `Expected non-null confidence for ${mkt}`)
  assert.equal(snap.fundamental.confidenceLabel, 'HIGH', `Expected HIGH confidence label for ${mkt}`)
  assert.ok(snap.primaryDriver && snap.primaryDriver.length > 0, `Expected primaryDriver for ${mkt}`)
}

// Simulate GOLD_AGENT evaluating a Hot US CPI shock with negative CVD absorption
recordEvaluatedGoldEvent({
  id: 'gc-test-cpi-1',
  timestamp: '2026-10-15T12:30:00.000Z',
  event: 'US CPI YoY 2.8% vs 2.5% Expected — Sovereign Central Bank Absorption at $4,190',
  rawText: 'US CPI YoY 2.8% vs 2.5% Expected; Gold holds $4,190 POC on heavy passive bid absorption.',
  structuredOutput: {
    market: 'GC',
    timestamp: '2026-10-15T12:30:00.000Z',
    event: 'US CPI YoY 2.8% vs 2.5% Expected — Sovereign Central Bank Absorption at $4,190',
    source: 'BLS / CME',
    verification_status: 'VERIFIED',
    importance: 'HIGH',
    event_analysis: {
      category: 'INFLATION',
      surprise_type: 'HOTTER_THAN_EXPECTED',
      surprise_magnitude: 'MEDIUM',
      revision_impact: 'NONE',
      standardized_surprise: 1.4,
      affected_gold_drivers: ['REAL_INTEREST_RATES', 'INFLATION_EXPECTATIONS', 'CENTRAL_BANK_DEMAND'],
    },
    fundamental_state: {
      intraday: 'BULLISH',
      short_term: 'BULLISH',
      medium_term: 'BULLISH',
    },
    transmission: {
      nominal_rates: 'UP',
      inflation_expectations: 'UP',
      real_rates: 'FLAT',
      usd: 'UP',
      central_bank_reserve_demand: 'SUPPORTIVE',
      safe_haven_demand: 'SUPPORTIVE',
    },
    market_response: {
      initial_reaction: 'REJECTED',
      follow_through: 'REVERSED',
      volume_confirmation: 'STRONG',
      abnormal_behavior: 'BULLISH_FAILURE_TO_DROP',
      key_level_status: 'HELD',
    },
    confidence: 0.91,
    summary: 'Gold rejected the initial hot-CPI knee-jerk dip and reclaimed $4,200 on passive limit absorption.',
    key_drivers: ['10Y Breakevens expanding faster than nominal yields', 'Sovereign bid defending $4,187 POC'],
    key_risks: ['10Y TIPS real yield breaking above 3.05%'],
    what_to_watch_next: ['COMEX 13:30 ET settlement', '4,218 VAH breakout'],
  },
  safeguards: {
    noInventedData: true,
    correlationNotCausation: true,
    noHeadlineOnlyTrade: true,
    sourcesConflictReported: false,
    comexNotTradeSignal: false,
  },
})

// Simulate NIKKEI_AGENT evaluating a BoJ Policy Board hawkish hold
recordEvaluatedNikkeiEvent({
  id: 'nk-test-boj-1',
  timestamp: '2026-10-15T04:00:00.000Z',
  event: 'BoJ Signals Faster JGB Tapering — USD/JPY Dips to 150.20',
  rawText: 'BoJ signals faster JGB tapering; USD/JPY dips to 150.20.',
  structuredOutput: {
    market: 'NK225',
    timestamp: '2026-10-15T04:00:00.000Z',
    event: 'BoJ Signals Faster JGB Tapering — USD/JPY Dips to 150.20',
    source: 'Bank of Japan',
    verification_status: 'VERIFIED',
    importance: 'HIGH',
    event_analysis: {
      category: 'BOJ_MONETARY_POLICY',
      surprise_type: 'HAWKISH',
      surprise_magnitude: 'MEDIUM',
      revision_impact: 'NONE',
      affected_drivers: ['BOJ_MONETARY_POLICY', 'YEN_FX_REGIME'],
    },
    market_stance: {
      intraday: 'BEARISH',
      short_term: 'NEUTRAL',
      medium_term: 'BULLISH',
    },
    transmission: {
      boj_policy_rate: 'HAWKISH_SHIFT',
      jgb_10y_yield: 'UP',
      usdjpy_fx: 'YEN_STRENGTHENING',
      exporter_earnings: 'HEADWIND',
      financials_nim: 'TAILWIND',
      semis_capex: 'NEUTRAL',
    },
    market_confirmation: {
      initial_reaction: 'CONFIRMED',
      follow_through: 'MODERATE',
      abnormal_behavior: 'NONE',
    },
    confidence: 0.86,
    summary: 'Hawkish BoJ tapering signal pressures exporters via Yen strength while supporting TOPIX banks.',
    key_drivers: ['10Y JGB yield testing 1.02%', 'USD/JPY pullback toward 150.00'],
    key_risks: ['Further Yen squeeze below 149.50'],
    what_to_watch_next: ['Governor Ueda press conference'],
  },
})

syncFundamentalBusFromStores(new Date('2026-10-15T14:35:00.000Z'))

const gcSnap = readMarketSnapshot('GOLD')
assert.ok(gcSnap)
assert.equal(gcSnap.source, 'evaluated')
assert.equal(gcSnap.fundamental.intraday, 'BULLISH')
assert.equal(gcSnap.fundamental.confidence, 0.91)
assert.equal(gcSnap.fundamental.confidenceLabel, 'HIGH')
assert.equal(gcSnap.catalyst.type, 'INFLATION')
assert.equal(gcSnap.catalyst.surprise, 'HOTTER_THAN_EXPECTED')
assert.equal(gcSnap.marketConfirmation.status, 'REJECTED')
assert.equal(gcSnap.abnormalBehavior.detected, true)
assert.equal(gcSnap.abnormalBehavior.type, 'BULLISH_FAILURE_TO_DROP')

const nkSnap = readMarketSnapshot('NIKKEI')
assert.ok(nkSnap)
assert.equal(nkSnap.source, 'evaluated')
assert.equal(nkSnap.fundamental.intraday, 'BEARISH')
assert.equal(nkSnap.fundamental.confidence, 0.86)
assert.equal(nkSnap.catalyst.type, 'BOJ_MONETARY_POLICY')
assert.equal(nkSnap.catalyst.surprise, 'HAWKISH')
assert.equal(nkSnap.marketConfirmation.status, 'CONFIRMED')

const gcBrief = formatDeskBriefForInstrument('GOLD')
assert.match(gcBrief, /DESK BRIEF — GOLD \/ GC/)
assert.match(gcBrief, /INTRADAY BULLISH/)
assert.match(gcBrief, /INFLATION \/ HOTTER_THAN_EXPECTED/)
assert.match(gcBrief, /Market confirmation: REJECTED/)
assert.match(gcBrief, /BULLISH_FAILURE_TO_DROP/)

const allMarketsBrief = formatAllMarketsDeskBriefSummary()
assert.match(allMarketsBrief, /GC \(EVALUATED\): INTRADAY BULLISH/)
assert.match(allMarketsBrief, /NK225 \(EVALUATED\): INTRADAY BEARISH/)

resetGoldFundamentalState()
resetNikkeiFundamentalState()

console.log('market_intelligence_bus.test.ts: ok')

