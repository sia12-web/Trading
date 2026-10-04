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

console.log('market_intelligence_bus.test.ts: ok')
