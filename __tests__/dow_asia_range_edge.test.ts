import assert from 'node:assert'
import { computeDowAsiaRangeEdge, type DowAsiaRangeBar } from '../lib/trading/dowAsiaRangeEdge'

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

console.log('\n🎉 ALL DOW ASIA RANGE EDGE TESTS PASSED SUCCESSFULLY!\n')
