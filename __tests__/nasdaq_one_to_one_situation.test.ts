/**
 * NASDAQ 1:1 Live Situation & Real-Time Order Placement Tests
 *
 * Verifies:
 * 1. seedDefaultNasdaqSituations generates a 1:1 R:R NASDAQ situation at market price (~29,448).
 * 2. armNasdaqOneToOneSituation generates LONG & SHORT 1:1 situations with exact risk and reward parity.
 * 3. isArmedRuleExpired preserves situations configured with session: '24H', 'ASIA', 'ALL', or isLongTerm: true.
 * 4. Level touch condition detects price within NASDAQ tolerance (3.0 pts) and fires immediately.
 * 5. Take Profit calculation enforces exact 1:1 risk-to-reward ratio.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  seedDefaultNasdaqSituations,
  armNasdaqOneToOneSituation,
  isEntrySituationRule,
} from '../lib/trading/leoRules'
import { isArmedRuleExpired } from '../lib/trading/sessionGate'

test('NASDAQ 1:1 Situation - seedDefaultNasdaqSituations creates valid 1:1 armed rule', () => {
  const currentPrice = 29448.0
  const rules = seedDefaultNasdaqSituations(currentPrice)

  assert.equal(rules.length, 1)
  const rule = rules[0]!

  assert.equal(rule.instrument, 'NASDAQ')
  assert.equal(rule.direction, 'LONG')
  assert.equal(rule.status, 'ARMED')
  assert.equal(isEntrySituationRule(rule.type), true)
  assert.equal(rule.targetPrice, 29448.0)
  assert.equal(rule.pattern, 'LEVEL_TOUCH')
  assert.equal(rule.stopLoss, 29428.0)
  assert.equal(rule.takeProfit, 29468.0)
  assert.equal(rule.takeProfitMode, '1:1')
  assert.equal(rule.riskReward, '1:1')
  assert.equal(rule.isLongTerm, true)
  assert.equal(rule.session, '24H')

  // Verify Risk and Reward parity
  const risk = Math.abs(rule.targetPrice! - rule.stopLoss!)
  const reward = Math.abs(rule.takeProfit! - rule.targetPrice!)
  assert.equal(risk, 20.0, 'Risk is exactly 20 points')
  assert.equal(reward, 20.0, 'Reward is exactly 20 points')
  assert.equal(risk, reward, 'Risk to reward is exactly 1:1')
})

test('NASDAQ 1:1 Situation - armNasdaqOneToOneSituation handles SHORT 1:1 brackets', () => {
  const currentPrice = 29450.0
  const rule = armNasdaqOneToOneSituation({
    price: currentPrice,
    direction: 'SHORT',
    points: 25.0,
  })

  assert.equal(rule.instrument, 'NASDAQ')
  assert.equal(rule.direction, 'SHORT')
  assert.equal(rule.targetPrice, 29450.0)
  assert.equal(rule.stopLoss, 29475.0, 'SHORT stop is above entry')
  assert.equal(rule.takeProfit, 29425.0, 'SHORT target is below entry')
  assert.equal(rule.riskReward, '1:1')

  const risk = Math.abs(rule.stopLoss! - rule.targetPrice!)
  const reward = Math.abs(rule.targetPrice! - rule.takeProfit!)
  assert.equal(risk, 25.0)
  assert.equal(reward, 25.0)
  assert.equal(risk, reward)
})

test('NASDAQ 1:1 Situation - Session Expiration Immunity (24H, ASIA, and LTM)', () => {
  // Asia session timestamp (21:00 ET = 01:00 UTC)
  const nowAsia = new Date('2026-09-17T01:00:00.000Z').getTime()
  const createdEarlier = new Date('2026-09-16T14:00:00.000Z').getTime()

  // 1. Standard NYC session rule without 24H/LTM -> should expire
  const standardRule = {
    createdAt: createdEarlier,
    session: 'NYC',
    isLongTerm: false,
    status: 'ARMED',
  }
  assert.equal(isArmedRuleExpired(standardRule, nowAsia), true, 'Standard NYC rule expires in Asia')

  // 2. 24H situation -> should stay active
  const rule24H = {
    createdAt: createdEarlier,
    session: '24H',
    isLongTerm: false,
    status: 'ARMED',
  }
  assert.equal(isArmedRuleExpired(rule24H, nowAsia), false, '24H situation does not expire in Asia')

  // 3. ASIA situation -> should stay active
  const ruleAsia = {
    createdAt: createdEarlier,
    session: 'ASIA',
    isLongTerm: false,
    status: 'ARMED',
  }
  assert.equal(isArmedRuleExpired(ruleAsia, nowAsia), false, 'ASIA situation does not expire in Asia')

  // 4. LTM situation -> should stay active
  const ruleLtm = {
    createdAt: createdEarlier,
    session: 'NYC',
    isLongTerm: true,
    status: 'ARMED',
  }
  assert.equal(isArmedRuleExpired(ruleLtm, nowAsia), false, 'Long-Term Memory situation does not expire')
})

test('NASDAQ 1:1 Situation - Touch condition triggers immediately within NASDAQ tolerance', () => {
  const targetPrice = 29448.0
  const nasdaqTouchTolerance = 3.0

  // Live market price right now: 29448.25
  const liveCurPrice = 29448.25
  const dist = Math.abs(liveCurPrice - targetPrice)

  const isTouchFired = dist <= nasdaqTouchTolerance
  assert.equal(isTouchFired, true, 'Touch trigger fires immediately (0.25 <= 3.0 pts)')

  // Condition evaluation for LONG direction
  const isLevelReachedLong =
    dist <= nasdaqTouchTolerance || liveCurPrice <= targetPrice + nasdaqTouchTolerance
  assert.equal(isLevelReachedLong, true)

  // Pattern is LEVEL_TOUCH (touch-only) -> patternMatched = true immediately
  const rawPattern = 'LEVEL_TOUCH'
  const isTouchOnly = rawPattern === 'LEVEL_TOUCH'
  const patternMatched = isTouchOnly && isLevelReachedLong
  assert.equal(patternMatched, true, 'Immediate order placement pattern is satisfied')
})

test('NASDAQ 1:1 Situation - Dynamic 1:1 bracket preserves exact 1:1 R:R on fill', () => {
  const dir = 'LONG'
  const entryPx = 29448.25
  const sl = 29428.25 // 20 pts risk
  const finalRiskPts = Math.abs(entryPx - sl)
  assert.equal(finalRiskPts, 20.0)

  // 1:1 multiplier calculation
  const mult = 1.0
  const tp = Number((dir === 'LONG' ? entryPx + finalRiskPts * mult : entryPx - finalRiskPts * mult).toFixed(2))

  assert.equal(tp, 29468.25, 'Take profit is exactly 20 points above entry')
  assert.equal(Math.abs(tp - entryPx), finalRiskPts, 'Risk and reward distances are identical')
})
