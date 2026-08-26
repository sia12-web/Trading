import assert from 'node:assert'
import { zonedCivilToUnix } from '../lib/chart/sessionVwap'
import {
    computeDowAsiaRangeEdge,
    createDowAsiaJournalPayload,
    formatDowAsiaTelegramAlert,
    selectDowAsiaSessionBars,
    type DowAsiaRangeBar,
} from '../lib/trading/dowAsiaRangeEdge'

console.log('🧪 TESTING DOW ASIA NARROW RANGE (<80 PTS) EDGE MODULE...\n')

// 1. Narrow Range (<80 pts) Test
const narrowBars: DowAsiaRangeBar[] = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 300,
    open: 38000,
    high: 38030,
    low: 37970, // Range = 60 pts (< 80)
    close: 38010,
}))

const narrowRes = computeDowAsiaRangeEdge(narrowBars)
assert.ok(narrowRes)
assert.strictEqual(narrowRes.activeEdge, true)
assert.strictEqual(narrowRes.asiaRange, 60)
assert.strictEqual(narrowRes.buyStopPrice, 38050) // 38030 + 20
assert.strictEqual(narrowRes.sellStopPrice, 37950) // 37970 - 20
assert.strictEqual(narrowRes.asiaMid, 38000) // Mid of 38030 & 37970
console.log('   ✅ Narrow Range (<80 pts) Edge detection & 20pt buffer calculation passed.')

// 2. Wide Range (>=80 pts) Test
const wideBars: DowAsiaRangeBar[] = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 300,
    open: 38000,
    high: 38100,
    low: 37950, // Range = 150 pts (>= 80)
    close: 38050,
}))

const wideRes = computeDowAsiaRangeEdge(wideBars)
assert.ok(wideRes)
assert.strictEqual(wideRes.activeEdge, false)
assert.strictEqual(wideRes.asiaRange, 150)
console.log('   ✅ Wide Range (>=80 pts) Edge inactive check passed.')

// 3. 20:00–02:00 ET window filter (not first-N bars)
const asiaCash = '2026-08-19'
const asiaStart = zonedCivilToUnix('2026-08-18', 20, 'America/New_York')
const asiaFiltered = selectDowAsiaSessionBars(
    [
        { time: asiaStart - 600, open: 1, high: 1, low: 1, close: 1 },
        { time: asiaStart, open: 2, high: 2, low: 2, close: 2 },
        { time: zonedCivilToUnix('2026-08-19', 1.75, 'America/New_York'), open: 3, high: 3, low: 3, close: 3 },
        { time: zonedCivilToUnix('2026-08-19', 2, 'America/New_York'), open: 4, high: 4, low: 4, close: 4 },
    ],
    asiaCash
)
assert.strictEqual(asiaFiltered.length, 2)
assert.strictEqual(asiaFiltered[0]!.open, 2)
console.log('   ✅ Asia 20:00–02:00 ET bar filter passed.')

// 4. Telegram Alert & Journal Payload Test
const tgAlert = formatDowAsiaTelegramAlert({
    side: 'LONG',
    asiaRange: 60,
    entryPrice: 38050,
    stopLossPrice: 38000,
    takeProfitPrice: 38125,
    riskDollars: 400,
})
assert.ok(tgAlert.includes('DOW ASIA BREAKOUT ENTRY'))
assert.ok(tgAlert.includes('38,050'))
assert.ok(tgAlert.includes('Tradeify $50K Risk: $400'))
console.log('   ✅ Dow Asia Telegram alert formatting passed.')

const journalPayload = createDowAsiaJournalPayload({
    side: 'LONG',
    asiaRange: 60,
    entryPrice: 38050,
    stopLossPrice: 38000,
    takeProfitPrice: 38125,
    riskDollars: 400,
    sessionKey: '2026-08-26',
})
assert.strictEqual(journalPayload.instrument, 'DOW')
assert.strictEqual(journalPayload.setup_name, 'DOW_ASIA_NARROW_RANGE_BREAKOUT')
assert.strictEqual(journalPayload.risk_dollars, 400)
assert.strictEqual(journalPayload.risk_reward_ratio, 1.5)
console.log('   ✅ Dow Asia Trade Journaling payload passed.')

console.log('\n🎉 ALL DOW ASIA RANGE EDGE TESTS PASSED SUCCESSFULLY!\n')
