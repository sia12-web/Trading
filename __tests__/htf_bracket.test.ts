import assert from 'node:assert'
import { computeLongTermBracket, type HTFBarInput } from '../lib/trading/htfSpecialist'

function day(ymd: string, open: number, high: number, low: number, close: number, volume = 1000): HTFBarInput {
    const [y, m, d] = ymd.split('-').map(Number)
    return {
        time: Date.UTC(y!, m! - 1, d!, 16, 0, 0) / 1000,
        open,
        high,
        low,
        close,
        volume,
    }
}

/** Five completed sessions, range 100–111, plus a developing session. */
function swing(developing: HTFBarInput): HTFBarInput[] {
    return [
        day('2026-09-28', 104, 110, 100, 106, 1000),
        day('2026-09-29', 106, 108, 101, 103, 1000),
        day('2026-09-30', 103, 109, 102, 107, 1000),
        day('2026-10-01', 107, 107, 100, 102, 1000),
        day('2026-10-02', 102, 111, 103, 109, 1000),
        developing,
    ]
}

console.log('🧪 Bracket location\n')

// Empty feed must not invent a ±20 range and call it chop.
const empty = computeLongTermBracket([], 0)
assert.strictEqual(empty.formed, false)
assert.strictEqual(empty.swing5d.high, 0)
assert.strictEqual(empty.swing5d.low, 0)
assert.ok(empty.directiveSummary.includes('unavailable'))

const oneDay = computeLongTermBracket([day('2026-10-03', 100, 110, 90, 105)], 105)
assert.strictEqual(oneDay.formed, false)

// Prior high 111 / low 100. Developing close must not widen that bracket.
const mid = computeLongTermBracket(swing(day('2026-10-03', 105, 108, 104, 105.5)), 105.5)
assert.strictEqual(mid.formed, true)
assert.strictEqual(mid.swingSessions, 5)
assert.strictEqual(mid.swing5d.high, 111)
assert.strictEqual(mid.swing5d.low, 100)
assert.strictEqual(mid.tradeLocationGrade, 'MID_BRACKET_CHOP')
assert.strictEqual(mid.bracketMode, 'BRACKETED_BALANCE')
assert.strictEqual(mid.locationPct, 50)
assert.ok(mid.directiveSummary.includes('100'))
assert.ok(mid.directiveSummary.includes('111'))

// Lower third of 100–111 ends at 103.666. 102 is responsive long.
const buy = computeLongTermBracket(swing(day('2026-10-03', 104, 104, 101, 102)), 102)
assert.strictEqual(buy.tradeLocationGrade, 'RESPONSIVE_LONG')
assert.strictEqual(buy.bracketMode, 'BRACKETED_BALANCE')

// Upper third starts at 107.333. 109 is responsive short, not chop.
const sell = computeLongTermBracket(swing(day('2026-10-03', 106, 110, 106, 109)), 109)
assert.strictEqual(sell.tradeLocationGrade, 'RESPONSIVE_SHORT')

// Close beyond the prior high is a breakout, not a responsive short.
const upBreak = computeLongTermBracket(swing(day('2026-10-03', 110, 114, 109, 113)), 113)
assert.strictEqual(upBreak.tradeLocationGrade, 'OUT_OF_BRACKET_BREAKOUT')
assert.strictEqual(upBreak.bracketMode, 'INITIATIVE_TREND')
assert.strictEqual(upBreak.auctionFailureDetected, false)

// Close beyond the prior low is a breakout, not a responsive long.
const downBreak = computeLongTermBracket(swing(day('2026-10-03', 101, 102, 96, 97)), 97)
assert.strictEqual(downBreak.tradeLocationGrade, 'OUT_OF_BRACKET_BREAKOUT')
assert.strictEqual(downBreak.bracketMode, 'INITIATIVE_TREND')

// Probe above the bracket that closes back inside is an auction failure.
const failed = computeLongTermBracket(swing(day('2026-10-03', 108, 114, 104, 105.5)), 105.5)
assert.strictEqual(failed.auctionFailureDetected, true)
assert.strictEqual(failed.bracketMode, 'AUCTION_FAILURE_REVERSAL')
assert.strictEqual(failed.swing5d.high, 111)
assert.strictEqual(failed.tradeLocationGrade, 'MID_BRACKET_CHOP')

// Crude-scale range. Old code used a fixed +5 point band, which marked 84 as a long.
// 80–90, lower third ends at 83.333, so 84 is the middle.
const crude = computeLongTermBracket(
    [
        day('2026-09-28', 84, 88, 80, 85),
        day('2026-09-29', 85, 89, 82, 86),
        day('2026-09-30', 86, 90, 83, 87),
        day('2026-10-01', 87, 89, 81, 84),
        day('2026-10-02', 84, 88, 82, 85),
        day('2026-10-03', 85, 86, 83, 84),
    ],
    84
)
assert.strictEqual(crude.swing5d.low, 80)
assert.strictEqual(crude.swing5d.high, 90)
assert.strictEqual(crude.tradeLocationGrade, 'MID_BRACKET_CHOP')

// Index-scale: 6 points through the prior high is a breakout, not "within 5 points so fade it".
const dow = computeLongTermBracket(
    [
        day('2026-09-28', 48400, 48800, 48000, 48600),
        day('2026-09-29', 48600, 48900, 48200, 48700),
        day('2026-09-30', 48700, 49000, 48300, 48800),
        day('2026-10-01', 48800, 48950, 48100, 48400),
        day('2026-10-02', 48400, 48700, 48200, 48500),
        day('2026-10-03', 48900, 49020, 48850, 49006),
    ],
    49006
)
assert.strictEqual(dow.swing5d.high, 49000)
assert.strictEqual(dow.swing5d.low, 48000)
assert.strictEqual(dow.tradeLocationGrade, 'OUT_OF_BRACKET_BREAKOUT')
assert.strictEqual(dow.bracketMode, 'INITIATIVE_TREND')

// Intraday bars on the same New York date are one session, not five days.
const intraday: HTFBarInput[] = []
for (let i = 0; i < 40; i++) {
    intraday.push({
        time: Date.UTC(2026, 9, 3, 14, 0, 0) / 1000 + i * 300,
        open: 105,
        high: 106,
        low: 104,
        close: 105,
        volume: 10,
    })
}
const sameDay = computeLongTermBracket(intraday, 105)
assert.strictEqual(sameDay.formed, false)

// Tests count sessions that tagged the extreme, not every bar near it.
const tagged = computeLongTermBracket(swing(day('2026-10-03', 105, 106, 104, 105)), 105)
assert.ok(tagged.highTestCount >= 1)
assert.ok(tagged.highTestCount <= 5)
assert.ok(tagged.lowTestCount >= 1)
assert.ok(tagged.lowTestCount <= 5)

// Fewer than five completed sessions must not be labeled as a full 5-day bracket.
const shortWindow = computeLongTermBracket(
    [
        day('2026-10-01', 100, 110, 100, 105),
        day('2026-10-02', 105, 112, 101, 108),
        day('2026-10-03', 108, 111, 102, 106),
        day('2026-10-06', 106, 107, 104, 105),
    ],
    105
)
assert.strictEqual(shortWindow.formed, true)
assert.strictEqual(shortWindow.swingSessions, 3)
assert.ok(shortWindow.directiveSummary.includes('3-session'))
assert.ok(!shortWindow.directiveSummary.startsWith('5-day'))

console.log('   ✅ Bracket location cases passed.')
