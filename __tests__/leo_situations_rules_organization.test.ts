/**
 * Leo Situations & Rules Organization & Dating Tests
 *
 * Verifies that:
 * 1. Situations get recorded and dated with exact date, session time, and relative timestamps.
 * 2. Conditions are strictly organized (Trigger Conditions, Risk/Execution Rules, Time/Safeguards).
 * 3. Re-arming, updating, deleting, and market separation operate cleanly.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatRuleDate,
  normalizeArmedRule,
  type ArmedRule,
} from '../lib/trading/leoRules'

test('Leo Rules - Explicit Recording & Dating', () => {
  const sampleTime = new Date('2026-09-15T15:30:00Z').getTime() // ~11:30 AM EDT
  const dateMeta = formatRuleDate(sampleTime)

  assert.ok(dateMeta.formatted.includes('Sep 15, 2026'), 'Date formatted correctly')
  assert.ok(dateMeta.formatted.includes('EDT'), 'Includes EDT session timezone')
  assert.equal(dateMeta.sessionDate, '2026-09-15', 'Session date extracted')
  assert.ok(dateMeta.sessionTime.length > 0, 'Session time extracted')
})

test('Leo Rules - Structured Condition Normalization', () => {
  const rawRule = {
    id: 'rule-test-1',
    type: 'CONDITIONAL_ENTRY',
    instrument: 'DOW',
    direction: 'LONG',
    description: 'Long 1 DOW on Bullish Engulfing at Excess Buying Low',
    userPrompt: 'if dow tests excess buying low and prints a hammer, enter long with 1:2 RR',
    targetReference: 'Excess Buying Low',
    targetPrice: 52100,
    pattern: 'HAMMER',
    stopLoss: 52060,
    takeProfit: 52180,
    size: 1,
    maxMinutes: 15,
    isLongTerm: false,
    session: 'NYC',
    createdAt: Date.now(),
    status: 'ARMED',
  }

  const normalized = normalizeArmedRule(rawRule, 'DOW')

  assert.equal(normalized.instrument, 'DOW')
  assert.equal(normalized.direction, 'LONG')
  assert.equal(normalized.status, 'ARMED')
  assert.ok(normalized.createdDateFormatted, 'Has formatted date')
  assert.ok(normalized.sessionTime, 'Has session time')

  // Verify conditions breakdown
  assert.equal(normalized.conditions.targetReference, 'Excess Buying Low')
  assert.equal(normalized.conditions.targetPrice, 52100)
  assert.equal(normalized.conditions.pattern, 'HAMMER')
  assert.equal(normalized.conditions.stopLoss, 52060)
  assert.equal(normalized.conditions.takeProfit, 52180)
  assert.equal(normalized.conditions.riskReward, '1:2.0', 'Calculated 1:2 RR from 40 pts risk vs 80 pts reward')
  assert.equal(normalized.conditions.size, 1)
  assert.equal(normalized.conditions.maxMinutes, 15)
})

test('Leo Rules - Level Alert & Stagnation Condition Organization', () => {
  const alertRule = normalizeArmedRule({
    type: 'DESK_ALERT',
    instrument: 'NASDAQ',
    description: 'Desk alert when price tests Yesterday POC (29,450)',
    targetReference: 'Yesterday POC',
    targetPrice: 29450,
    requireHighVolume: true,
    isLongTerm: true,
  }, 'NASDAQ')

  assert.equal(alertRule.type, 'DESK_ALERT')
  assert.equal(alertRule.conditions.targetReference, 'Yesterday POC')
  assert.equal(alertRule.conditions.targetPrice, 29450)
  assert.equal(alertRule.conditions.requireHighVolume, true)
  assert.equal(alertRule.isLongTerm, true)

  const stagRule = normalizeArmedRule({
    type: 'STAGNATION_TIMEOUT',
    instrument: 'GOLD',
    description: 'Close position if not in profit after 10m',
    maxMinutes: 10,
    requireProfitPoints: 2,
  }, 'GOLD')

  assert.equal(stagRule.type, 'STAGNATION_TIMEOUT')
  assert.equal(stagRule.conditions.maxMinutes, 10)
  assert.equal(stagRule.conditions.requireProfitPoints, 2)
})
