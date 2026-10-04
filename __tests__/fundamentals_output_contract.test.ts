import assert from 'node:assert/strict'
import {
  adaptLegacyFundamentalJson,
  candidateIsMaterial,
  confidenceToLabel,
  formatSignedDollars,
  FUNDAMENTAL_EVENT_OUTPUT_RULES,
} from '../lib/fundamentals/outputContract'
import {
  OIL_ANALYST_CHAT_PROMPT,
  OIL_ANALYST_EVENT_PROMPT,
} from '../lib/fundamentals/oilAnalystConfig'
import {
  GOLD_ANALYST_CHAT_PROMPT,
  GOLD_ANALYST_EVENT_PROMPT,
} from '../lib/fundamentals/goldAnalystConfig'
import {
  NASDAQ_ANALYST_CHAT_PROMPT,
  NASDAQ_ANALYST_EVENT_PROMPT,
} from '../lib/fundamentals/nasdaqAnalystConfig'
import {
  DOW_ANALYST_CHAT_PROMPT,
  DOW_ANALYST_EVENT_PROMPT,
} from '../lib/fundamentals/dowAnalystConfig'
import {
  NIKKEI_ANALYST_CHAT_PROMPT,
  NIKKEI_ANALYST_EVENT_PROMPT,
} from '../lib/fundamentals/nikkeiAnalystConfig'

const events = [
  OIL_ANALYST_EVENT_PROMPT,
  GOLD_ANALYST_EVENT_PROMPT,
  NASDAQ_ANALYST_EVENT_PROMPT,
  DOW_ANALYST_EVENT_PROMPT,
  NIKKEI_ANALYST_EVENT_PROMPT,
]
const chats = [
  OIL_ANALYST_CHAT_PROMPT,
  GOLD_ANALYST_CHAT_PROMPT,
  NASDAQ_ANALYST_CHAT_PROMPT,
  DOW_ANALYST_CHAT_PROMPT,
  NIKKEI_ANALYST_CHAT_PROMPT,
]

for (const prompt of events) {
  assert.match(prompt, /schema_version/)
  assert.match(prompt, /"specialist"/)
  assert.match(prompt, /confidence is HIGH, MEDIUM, LOW, or UNKNOWN/)
  assert.match(prompt, /MARKET_REACTION/)
  assert.doesNotMatch(prompt, /Always format your analysis as strictly valid machine-readable JSON/)
}

for (const prompt of chats) {
  assert.match(prompt, /Answer the human in concise prose/)
  assert.match(prompt, /Do not emit the event JSON envelope/)
  assert.doesNotMatch(prompt, /Return one JSON object and nothing else/)
}

assert.match(OIL_ANALYST_EVENT_PROMPT, /PIPELINE_DISRUPTION/)
assert.match(OIL_ANALYST_EVENT_PROMPT, /REFINERY_UTILIZATION/)
assert.match(GOLD_ANALYST_EVENT_PROMPT, /evidence\.facts/)
assert.doesNotMatch(GOLD_ANALYST_EVENT_PROMPT, /CVD absorption/)
assert.match(NASDAQ_ANALYST_EVENT_PROMPT, /UNAVAILABLE/)
assert.match(DOW_ANALYST_EVENT_PROMPT, /not a law/)
assert.match(DOW_ANALYST_EVENT_PROMPT, /dow_point_impact/)
assert.match(NIKKEI_ANALYST_EVENT_PROMPT, /Do not use a fixed 155-160 zone/)
assert.doesNotMatch(NIKKEI_ANALYST_EVENT_PROMPT, /conducts surprise physical interventions/)
assert.doesNotMatch(NIKKEI_ANALYST_EVENT_PROMPT, /confidence": number \(0-100\)/)
assert.match(NIKKEI_ANALYST_EVENT_PROMPT, /desk_context/)
assert.doesNotMatch(NIKKEI_ANALYST_CHAT_PROMPT, /actionable takeaways/)

assert.equal(formatSignedDollars(-0.24), '-$0.24')
assert.equal(formatSignedDollars(0.38), '+$0.38')
assert.equal(formatSignedDollars(0), '$0.00')

const adapted = adaptLegacyFundamentalJson({
  schema_version: '1.0',
  market: 'NQ',
  event_type: 'US_CPI',
  confidence: 'HIGH',
  state: { intraday: 'BEARISH', short_term: 'NEUTRAL', medium_term: 'BULLISH' },
  specialist: { desk_context: 'Watch real yields.' },
})
assert.equal(adapted.fundamental_state.intraday, 'BEARISH')
assert.equal(adapted.market_stance.intraday, 'BEARISH')
assert.equal(adapted.confidence, 0.8)
assert.equal(adapted.event, 'US_CPI')
assert.equal(adapted.actionable_takeaway, 'Watch real yields.')

assert.equal(confidenceToLabel(92), 'HIGH')
assert.equal(confidenceToLabel(0.4), 'LOW')
assert.equal(candidateIsMaterial('LOW', 'HIGH'), false)
assert.equal(candidateIsMaterial('HIGH', 'LOW'), false)
assert.equal(candidateIsMaterial('HIGH', 0.8), true)
assert.match(FUNDAMENTAL_EVENT_OUTPUT_RULES, /schema_version/)

console.log('fundamentals_output_contract.test.ts: ok')
