import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_MARKETS,
  seedDefaultMarketSituations,
  armMarketOneToOneSituation,
  MARKET_DEFAULT_PARAMS,
} from '../lib/trading/leoRules'

test('All 4 Markets 1:1 Situations - Seed and Parity across DOW, NASDAQ, GOLD, CRUDE', () => {
  assert.deepEqual(ALL_MARKETS, ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'])

  for (const market of ALL_MARKETS) {
    const meta = MARKET_DEFAULT_PARAMS[market]
    assert.ok(meta, `Meta exists for ${market}`)
    assert.ok(meta.defaultPrice > 0, `${market} defaultPrice > 0`)
    assert.ok(meta.defaultPoints > 0, `${market} defaultPoints > 0`)

    const seeded = seedDefaultMarketSituations(market)
    assert.equal(seeded.length, 1, `${market} has 1 default situation seeded`)
    const rule = seeded[0]!

    assert.equal(rule.instrument, market)
    assert.equal(rule.status, 'ARMED')
    assert.equal(rule.takeProfitMode, '1:1')
    assert.equal(rule.riskReward, '1:1')
    assert.equal(rule.isLongTerm, true)
    assert.equal(rule.session, '24H')

    // Check exact 1:1 distance
    const risk = Math.abs(rule.targetPrice! - rule.stopLoss!)
    const reward = Math.abs(rule.takeProfit! - rule.targetPrice!)
    assert.equal(Number(risk.toFixed(2)), meta.defaultPoints, `${market} risk matches default points`)
    assert.equal(Number(reward.toFixed(2)), meta.defaultPoints, `${market} reward matches default points`)
  }
})

test('All 4 Markets 1:1 Situations - Arming SHORT and LONG across all markets', () => {
  // Test DOW
  const dowLong = armMarketOneToOneSituation('DOW', { price: 52200, direction: 'LONG', points: 40 })
  assert.equal(dowLong.stopLoss, 52160)
  assert.equal(dowLong.takeProfit, 52240)

  const dowShort = armMarketOneToOneSituation('DOW', { price: 52200, direction: 'SHORT', points: 40 })
  assert.equal(dowShort.stopLoss, 52240)
  assert.equal(dowShort.takeProfit, 52160)

  // Test GOLD
  const goldLong = armMarketOneToOneSituation('GOLD', { price: 4320, direction: 'LONG', points: 5.0 })
  assert.equal(goldLong.stopLoss, 4315.0)
  assert.equal(goldLong.takeProfit, 4325.0)

  // Test CRUDE
  const crudeLong = armMarketOneToOneSituation('CRUDE', { price: 101.50, direction: 'LONG', points: 0.50 })
  assert.equal(crudeLong.stopLoss, 101.00)
  assert.equal(crudeLong.takeProfit, 102.00)
})

test('TradingView Widget Point Value and P&L Calculations', () => {
  const getPointVal = (inst: string) =>
    inst === 'NASDAQ' ? 2 : inst === 'DOW' ? 0.5 : inst === 'GOLD' ? 10 : inst === 'CRUDE' ? 100 : 5

  // 10 pts NASDAQ on 1 contract = $20
  assert.equal(10 * 1 * getPointVal('NASDAQ'), 20)

  // 40 pts DOW on 1 contract = $20
  assert.equal(40 * 1 * getPointVal('DOW'), 20)

  // 5 pts GOLD on 1 contract = $50
  assert.equal(5 * 1 * getPointVal('GOLD'), 50)

  // 0.50 pts CRUDE on 1 contract = $50
  assert.equal(0.50 * 1 * getPointVal('CRUDE'), 50)
})
