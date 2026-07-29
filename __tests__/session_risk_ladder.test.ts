/**
 * Progressive session risk: 1% → 0.5% → 0.25%
 * Run: npx tsx __tests__/session_risk_ladder.test.ts
 */

import {
  formatSessionRiskChip,
  riskPercentForEntrySource,
  riskPercentForSessionAttempt,
  SESSION_RISK_FIRST_PERCENT,
  SESSION_RISK_SECOND_PERCENT,
  SESSION_RISK_THIRD_PERCENT,
} from '../lib/trading/positionSizing'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(SESSION_RISK_FIRST_PERCENT === 1, 'first = 1%')
assert(SESSION_RISK_SECOND_PERCENT === 0.5, 'second = 0.5%')
assert(SESSION_RISK_THIRD_PERCENT === 0.25, 'third = 0.25%')

assert(riskPercentForSessionAttempt(0) === 1, '0 fills → 1%')
assert(riskPercentForSessionAttempt(1) === 0.5, '1 fill → 0.5%')
assert(riskPercentForSessionAttempt(2) === 0.25, '2 fills → 0.25%')
assert(riskPercentForSessionAttempt(3) === 0.25, '3 fills still 0.25% (session already locked)')
assert(riskPercentForSessionAttempt(null) === 1, 'null → first probe')
assert(riskPercentForSessionAttempt(undefined) === 1, 'undefined → first probe')

assert(riskPercentForEntrySource('manual', 0) === 1, 'manual first')
assert(riskPercentForEntrySource('ai', 1) === 0.5, 'ai second')
assert(riskPercentForEntrySource('structure', 2) === 0.25, 'structure third')
assert(riskPercentForEntrySource('manual') === 1, 'default fills=0 → 1%')

assert(formatSessionRiskChip(0).includes('1%'), 'chip first')
assert(formatSessionRiskChip(0).includes('1/3'), 'chip fill 1/3')
assert(formatSessionRiskChip(1).includes('0.5%'), 'chip second')
assert(formatSessionRiskChip(2).includes('0.25%'), 'chip third')

console.log('session_risk_ladder: all passed')
