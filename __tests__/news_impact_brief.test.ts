/**
 * Haiku news impact brief parsers + Korea flag.
 * Run: npx tsx __tests__/news_impact_brief.test.ts
 */

import assert from 'node:assert/strict'
import {
  isKoreaRelevantHeadline,
  parseOneBrief,
  parseTop5Digest,
} from '../lib/trading/newsImpactBrief'

assert.equal(
  isKoreaRelevantHeadline('Samsung chip export curbs hit Seoul'),
  true,
  'korea flag'
)
assert.equal(
  isKoreaRelevantHeadline('Fed holds rates steady'),
  false,
  'no korea'
)

const one = parseOneBrief(
  'h1',
  JSON.stringify({
    plainEnglish: 'Samsung export limits tighten chip supply.',
    deskImpacts: [
      { desk: 'NASDAQ', bias: 'bearish', note: 'Semis risk-off' },
      { desk: 'DOW', bias: 'mixed', note: 'Broad risk' },
      { desk: 'NIKKEI', bias: 'noise', note: 'Secondary' },
    ],
    why: 'Korea megacap semis feed US tech risk.',
    horizon: 'session',
    koreaTransmission: 'NASDAQ first via semis; DOW secondary risk appetite.',
  }),
  'claude-haiku-4-5-20251001'
)
assert.ok(one)
assert.match(one!.plainEnglish, /Samsung/)
assert.equal(one!.deskImpacts.length, 3)
assert.ok(one!.koreaTransmission)

const digest = parseTop5Digest(
  'NASDAQ',
  JSON.stringify({
    sessionBias: 'Tech risk-off into the open.',
    ranked: [
      { headlineId: 'a', bias: 'bearish', oneLiner: 'Korea semis hit' },
      { headlineId: 'b', bias: 'noise', oneLiner: 'Unrelated retail' },
    ],
    koreaNote: 'Transmission via NASDAQ semis.',
  }),
  'test-model'
)
assert.ok(digest)
assert.equal(digest!.ranked.length, 2)
assert.ok(digest!.koreaNote)

const oneDup = parseOneBrief(
  'h2',
  JSON.stringify({
    plainEnglish: 'Dup desks.',
    deskImpacts: [
      { desk: 'DOW', bias: 'bullish', note: 'a' },
      { desk: 'DOW', bias: 'bearish', note: 'b' },
      { desk: 'NASDAQ', bias: 'noise', note: 'c' },
    ],
    why: 'test',
    horizon: 'minutes',
    koreaTransmission: null,
  }),
  'test'
)
assert.ok(oneDup)
assert.equal(oneDup!.deskImpacts.length, 3, 'deduped + filled NIKKEI')
assert.equal(oneDup!.deskImpacts[0]!.desk, 'DOW')
assert.equal(oneDup!.deskImpacts[0]!.bias, 'bullish', 'keep first DOW')
assert.equal(oneDup!.deskImpacts[2]!.desk, 'NIKKEI')

console.log('news_impact_brief: all passed')
