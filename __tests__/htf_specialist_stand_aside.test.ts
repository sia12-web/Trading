import assert from 'node:assert'
import {
    evaluateNewsSentiment,
    computeMarketStandAsideState,
    computeSpecialSituations,
    computeHTFContextState,
    type HTFBarInput,
    type HTFBracketDetails,
    type HTFMacroContextState,
} from '../lib/trading/htfSpecialist'

console.log('🧪 SENTINEL: Running HTF Specialist Stand-Aside & Special Situations Test Suite...\n')

const sampleBars: HTFBarInput[] = Array.from({ length: 40 }, (_, i) => ({
    time: 1700000000 + i * 300,
    open: 5000 + (i % 2 === 0 ? 1 : -1),
    high: 5005 + (i % 3),
    low: 4995 - (i % 3),
    close: 5002,
    volume: 1000 + i * 10,
}))

const sampleBracket: HTFBracketDetails = {
    bracketMode: 'BRACKETED_BALANCE',
    tradeLocationGrade: 'MID_BRACKET_CHOP',
    swing5d: { high: 5050, low: 4950, vah: 5030, val: 4970, poc: 5000 },
    macro20d: { high: 5100, low: 4900, vah: 5080, val: 4920, poc: 5000 },
    highTestCount: 2,
    lowTestCount: 1,
    target1Poc: 5000,
    target2OppositeExtreme: 4950,
    auctionFailureDetected: false,
    trendAgingDivergence: false,
    directiveSummary: '5-Day Balance (5050 - 4950). Mid-bracket chop zone.',
}

const sampleMacroContext: HTFMacroContextState = {
    gaps: [],
    islandDays: [],
    rotationFactor: { score: 0, trend: 'BALANCED', summary: 'Net rotation factor 0' },
    opportunityWindow: { isOpen: false, score: 50, direction: 'NEUTRAL', reason: 'Normal session' },
}

// 1. News Sentiment Matrix (Page 274 Table)
console.log('1. Testing News Sentiment Matrix (Page 274)...')
assert.strictEqual(evaluateNewsSentiment('UP', 'BEARISH', 'UP'), 'VERY_STRONG')
assert.strictEqual(evaluateNewsSentiment('UP', 'BEARISH', 'DOWN'), 'NEUTRAL_EXPECTED')
assert.strictEqual(evaluateNewsSentiment('UP', 'BULLISH', 'UP'), 'STRONG')
assert.strictEqual(evaluateNewsSentiment('UP', 'BULLISH', 'DOWN'), 'VERY_WEAK')
assert.strictEqual(evaluateNewsSentiment('DOWN', 'BULLISH', 'DOWN'), 'VERY_WEAK')
console.log('   ✅ Passed 5/5 News Sentiment Matrix scenarios.')

// 2. Stand-Aside Engine
console.log('\n2. Testing Stand-Aside Engine...')
// Clean market
const cleanBracket: HTFBracketDetails = {
    ...sampleBracket,
    bracketMode: 'INITIATIVE_TREND',
    tradeLocationGrade: 'OUT_OF_BRACKET_BREAKOUT',
}
const wideBars: HTFBarInput[] = sampleBars.map((b, idx) => ({
    ...b,
    high: 5000 + idx * 3,
    low: 4990 + idx * 3,
    close: 4995 + idx * 3,
}))
const cleanRes = computeMarketStandAsideState(wideBars, cleanBracket, sampleMacroContext)
assert.strictEqual(cleanRes.isStandAside, false)
assert.strictEqual(cleanRes.reason, 'NONE')
console.log('   ✅ Clean market check passed.')

// Nontrend day
const tightBars: HTFBarInput[] = sampleBars.map((b) => ({
    ...b,
    high: 5001,
    low: 4999,
    close: 5000,
}))
const nontrendRes = computeMarketStandAsideState(tightBars, sampleBracket, sampleMacroContext)
assert.strictEqual(nontrendRes.isStandAside, true)
assert.strictEqual(nontrendRes.reason, 'NONTREND_DAY')
assert.strictEqual(nontrendRes.severity, 'HIGH')
console.log('   ✅ Nontrend Day detection passed.')

// Nonconviction day
const insideBars: HTFBarInput[] = sampleBars.map((b) => ({
    ...b,
    open: 5000,
    high: 5015,
    low: 4985,
    close: 5000,
}))
const nonconvRes = computeMarketStandAsideState(insideBars, sampleBracket, sampleMacroContext)
assert.strictEqual(nonconvRes.isStandAside, true)
assert.strictEqual(nonconvRes.reason, 'NONCONVICTION_DAY')
console.log('   ✅ Nonconviction Day detection passed.')

// News Stand-Aside
const newsMacro: HTFMacroContextState = {
    ...sampleMacroContext,
    opportunityWindow: {
        isOpen: false,
        score: 20,
        direction: 'NEUTRAL',
        reason: 'Major Economic News Event pending (CPI)',
    },
}
const newsRes = computeMarketStandAsideState(wideBars, cleanBracket, newsMacro)
assert.strictEqual(newsRes.isStandAside, true)
assert.strictEqual(newsRes.reason, 'PRE_NEWS_STAND_ASIDE')
assert.ok(newsRes.newsSentimentRating)
console.log('   ✅ News Stand-Aside detection passed.')

// 3. Special Situations
console.log('\n3. Testing Special Situations...')
const shortBracket: HTFBracketDetails = { ...sampleBracket, lowTestCount: 2, tradeLocationGrade: 'RESPONSIVE_SHORT' }
const specShort = computeSpecialSituations(sampleBars, 'LOWER', shortBracket)
assert.strictEqual(specShort.activeSituation, 'THREE_TO_ONE_SELLING')
assert.strictEqual(specShort.continuationProbabilityPct, 94)

const longBracket: HTFBracketDetails = { ...sampleBracket, highTestCount: 2, tradeLocationGrade: 'RESPONSIVE_LONG' }
const specLong = computeSpecialSituations(sampleBars, 'HIGHER', longBracket)
assert.strictEqual(specLong.activeSituation, 'THREE_TO_ONE_BUYING')
assert.strictEqual(specLong.continuationProbabilityPct, 94)
console.log('   ✅ Special Situations 3-to-1 Days passed.')

// 4. Full Context Integration
console.log('\n4. Testing Full HTFContextState Integration...')
const fullState = computeHTFContextState({
    instrument: 'NQ',
    asOfUnix: 1700000000,
    candles5m: sampleBars,
})
assert.strictEqual(fullState.instrument, 'NQ')
assert.ok(fullState.standAside)
assert.ok(fullState.summaryText)
assert.ok(fullState.leoPromptBlock.includes('DAY TIMEFRAME & LONG-TERM SPECIALIST'))
console.log('   ✅ Full HTFContextState integration passed.')

console.log('\n🎉 ALL SENTINEL VERIFICATION TESTS PASSED SUCCESSFULLY!\n')
