/**
 * Progressive session risk: 2% → 1% → 0.5%
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

assert(SESSION_RISK_FIRST_PERCENT === 2, 'first = 2%')
assert(SESSION_RISK_SECOND_PERCENT === 1, 'second = 1%')
assert(SESSION_RISK_THIRD_PERCENT === 0.5, 'third = 0.5%')

assert(riskPercentForSessionAttempt(0) === 2, '0 fills → 2%')
assert(riskPercentForSessionAttempt(1) === 1, '1 fill → 1%')
assert(riskPercentForSessionAttempt(2) === 0.5, '2 fills → 0.5%')
assert(riskPercentForSessionAttempt(3) === 0.5, '3 fills still 0.5% (session already locked)')
assert(riskPercentForSessionAttempt(null) === 2, 'null → first probe')
assert(riskPercentForSessionAttempt(undefined) === 2, 'undefined → first probe')

assert(riskPercentForEntrySource('manual', 0) === 2, 'manual first')
assert(riskPercentForEntrySource('ai', 1) === 1, 'ai second')
assert(riskPercentForEntrySource('structure', 2) === 0.5, 'structure third')
assert(riskPercentForEntrySource('manual') === 2, 'default fills=0 → 2%')

assert(formatSessionRiskChip(0).includes('2%'), 'chip first')
assert(formatSessionRiskChip(0).includes('1/3'), 'chip fill 1/3')
assert(formatSessionRiskChip(1).includes('1%'), 'chip second')
assert(formatSessionRiskChip(2).includes('0.5%'), 'chip third')

console.log('session_risk_ladder: all passed')
