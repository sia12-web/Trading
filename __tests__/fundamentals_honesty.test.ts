import assert from 'node:assert/strict'
import {
  confidencePercent,
  connectedFeedCount,
  scrubSummary,
  showNumber,
  sourcedImpact,
  tokyoCashPhase,
} from '../lib/fundamentals/honesty'

assert.equal(confidencePercent(0.8), 80)
assert.equal(confidencePercent(86), 86)
assert.equal(confidencePercent(0), 0)
assert.equal(showNumber(false, 4.88, 2, '%'), 'Unavailable')
assert.equal(showNumber(true, 4.12, 2, '%'), '4.12%')
assert.equal(sourcedImpact('the index fell 350 points', -350), -350)
assert.equal(sourcedImpact('bank of japan hiked', -350), null)
assert.match(scrubSummary('no figures here', 'Cushing drew 4.15 million'), /does not include a sourced print/)
assert.equal(connectedFeedCount([{ status: 'ONLINE' }, { status: 'UNAVAILABLE' }]).connected, 1)
assert.ok(['PREP', 'MORNING_CASH', 'LUNCH_BREAK', 'AFTERNOON_CASH', 'CLOSED'].includes(tokyoCashPhase()))

console.log('fundamentals honesty ok')
