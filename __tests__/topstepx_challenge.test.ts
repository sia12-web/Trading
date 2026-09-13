import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  TOPSTEPX_RULES,
  TOPSTEPX_ORDER_HISTORY,
  TOPSTEPX_OCO_BRACKETS,
  normalizeBracketRatio,
  calculateBracketPrices,
  computeTopstepXChallengeState,
  validateTopstepXOrderRisk,
  getTopstepXJournalRows,
} from '../lib/trading/topstepXChallenge'
import {
  resolveTopstepXPlace,
  parseDeskRiskProfile,
} from '../lib/trading/deskRiskProfile'
import { buildLeoSystemPrompt } from '../lib/ai/leoAssistant'

describe('TopstepX $1,500 Prop Firm Challenge Engine', () => {
  describe('Verified Order History & P&L Calculation', () => {
    it('contains all 18 executed orders with valid tickets and contracts', () => {
      assert.strictEqual(TOPSTEPX_ORDER_HISTORY.length, 18)
      for (const order of TOPSTEPX_ORDER_HISTORY) {
        assert.ok(order.ticketId.length > 5, 'Ticket ID must be valid')
        assert.ok(['MNQU26', 'MYMU26', 'MGCZ26', 'MCLV26'].includes(order.contract))
        assert.ok(['LONG', 'SHORT'].includes(order.direction))
        assert.ok(order.entryPrice > 0)
        assert.ok(order.exitPrice > 0)
        assert.ok(order.totalFees > 0)
        assert.strictEqual(
          Math.round((order.grossPnl - order.totalFees) * 100) / 100,
          Math.round(order.netPnl * 100) / 100
        )
      }
    })

    it('computes exact challenge metrics matching broker statement', () => {
      const state = computeTopstepXChallengeState()
      assert.strictEqual(state.totalTrades, 18)
      assert.strictEqual(state.winningTrades, 5)
      assert.strictEqual(state.losingTrades, 13)
      assert.strictEqual(state.winRate, 27.8)
      assert.strictEqual(state.totalGrossPnl, -241.0)
      assert.strictEqual(state.totalFees, 26.06)
      assert.strictEqual(state.totalNetPnl, -267.06)
      assert.strictEqual(state.profitTarget, 1500)
      assert.strictEqual(state.maxLossFloor, -500)
      assert.strictEqual(state.remainingRoomToBreach, 232.94)
      assert.strictEqual(state.status, 'ACTIVE_WARNING')
      assert.ok(state.riskRecommendation.includes('232.94'))
      assert.ok(state.riskRecommendation.includes('$40–$50'))
    })
  })

  describe('Journal Row Mapping', () => {
    it('maps all 18 orders to standard journal entries with tickets and fees', () => {
      const rows = getTopstepXJournalRows()
      assert.strictEqual(rows.length, 18)
      const first = rows[0]
      assert.strictEqual(first.ticket_id, '3086461113')
      assert.strictEqual(first.contract, 'MNQU26')
      assert.strictEqual(first.instrument, 'NASDAQ')
      assert.strictEqual(first.direction, 'LONG')
      assert.strictEqual(first.pnl.dollars, -47.72)
      assert.strictEqual(first.pnl.gross_dollars, -46.5)
      assert.strictEqual(first.pnl.fees, 1.22)
      assert.strictEqual(first.duration, '00:11:23')
      assert.strictEqual(first.fill.source, 'topstepx_broker')
    })
  })

  describe('Order Risk Validation & Breach Guard', () => {
    it('allows a low-risk trade within recommended parameters', () => {
      const res = validateTopstepXOrderRisk({
        instrument: 'MNQ',
        entryPrice: 29150.0,
        stopLossPrice: 29130.0,
        quantity: 1,
      })
      assert.strictEqual(res.allowed, true)
      assert.ok(res.dollarRisk <= 50)
      assert.ok(!res.warning)
      assert.ok(res.copyCommand.includes('BUY 1 MNQU26 @ 29150.00'))
      assert.ok(res.copyCommand.includes('SL: 29130.00'))
    })

    it('warns on a trade that risks over 30% of remaining cushion', () => {
      const res = validateTopstepXOrderRisk({
        instrument: 'MNQ',
        entryPrice: 29150.0,
        stopLossPrice: 29110.0,
        quantity: 1,
      })
      assert.strictEqual(res.allowed, true)
      assert.ok(res.warning?.includes('HIGH RISK'))
      assert.ok(res.warning?.includes('30%'))
    })

    it('rejects an order that would exceed the remaining $232.94 cushion to -$500 floor', () => {
      const res = validateTopstepXOrderRisk({
        instrument: 'MNQ',
        entryPrice: 29150.0,
        stopLossPrice: 29030.0,
        quantity: 1,
      })
      assert.strictEqual(res.allowed, false)
      assert.ok(res.warning?.includes('REJECTED'))
      assert.ok(res.warning?.includes('-$500 breach floor'))
    })

    it('generates accurate copy commands for Gold, Dow, and Crude', () => {
      const goldCheck = validateTopstepXOrderRisk({
        instrument: 'GOLD',
        entryPrice: 4435.4,
        stopLossPrice: 4432.0,
        quantity: 1,
      })
      assert.ok(goldCheck.copyCommand.includes('MGCZ26'))

      const dowCheck = validateTopstepXOrderRisk({
        instrument: 'DOW',
        entryPrice: 52921.0,
        stopLossPrice: 52850.0,
        quantity: 1,
      })
      assert.ok(dowCheck.copyCommand.includes('MYMU26'))

      const crudeCheck = validateTopstepXOrderRisk({
        instrument: 'CRUDE',
        entryPrice: 93.5,
        stopLossPrice: 93.0,
        quantity: 1,
      })
      assert.ok(crudeCheck.copyCommand.includes('MCLV26'))
    })
  })

  describe('Desk Risk Profile Integration', () => {
    it('defaults risk profile to topstepx_1500', () => {
      assert.strictEqual(parseDeskRiskProfile(null), 'topstepx_1500')
      assert.strictEqual(parseDeskRiskProfile(''), 'topstepx_1500')
      assert.strictEqual(parseDeskRiskProfile('personal_futures'), 'personal_futures')
    })

    it('validates order execution through resolveTopstepXPlace', () => {
      const safe = resolveTopstepXPlace({
        instrument: 'MNQ',
        entryPrice: 29150.0,
        stopLossPrice: 29130.0,
        quantity: 1,
      })
      assert.strictEqual(safe.allowed, true)
      assert.strictEqual(safe.refuseReason, 'ok')
      assert.ok(safe.copyCommand?.includes('MNQU26'))

      const unsafe = resolveTopstepXPlace({
        instrument: 'MNQ',
        entryPrice: 29150.0,
        stopLossPrice: 29000.0,
        quantity: 1,
      })
      assert.strictEqual(unsafe.allowed, false)
      assert.strictEqual(unsafe.refuseReason, 'breach_guard')
    })
  })

  describe('Leo AI Desk Assistant TopstepX Awareness', () => {
    it('injects TopstepX challenge rules, cushion, and copy instructions into prompt', () => {
      const prompt = buildLeoSystemPrompt({
        instrument: 'MNQ',
        currentTimeEt: '10:00 AM ET',
        currentPrice: 29150.0,
        activeExcesses: [],
      })
      assert.ok(prompt.includes('TOPSTEPX AUTO OCO BRACKET PRESETS'))
      assert.ok(prompt.includes('1:2'))
      assert.ok(prompt.includes('1:3'))
      assert.ok(prompt.includes('1:5'))
    })
  })

  describe('Auto OCO Brackets (Preset Risk & Reward Math)', () => {
    it('defines 4 fixed $50 risk Auto OCO brackets (1:1, 1:2, 1:3, 1:5)', () => {
      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:1'].stopLossDollars, 50)
      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:1'].takeProfitDollars, 50)

      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:2'].stopLossDollars, 50)
      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:2'].takeProfitDollars, 100)

      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:3'].stopLossDollars, 50)
      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:3'].takeProfitDollars, 150)

      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:5'].stopLossDollars, 50)
      assert.strictEqual(TOPSTEPX_OCO_BRACKETS['1:5'].takeProfitDollars, 250)
    })

    it('normalizes spoken and typed bracket ratio strings', () => {
      assert.strictEqual(normalizeBracketRatio('1 to 2'), '1:2')
      assert.strictEqual(normalizeBracketRatio('1:2'), '1:2')
      assert.strictEqual(normalizeBracketRatio('50-100'), '1:2')

      assert.strictEqual(normalizeBracketRatio('1 to 3'), '1:3')
      assert.strictEqual(normalizeBracketRatio('1:3'), '1:3')
      assert.strictEqual(normalizeBracketRatio('50-150'), '1:3')

      assert.strictEqual(normalizeBracketRatio('1 to 5'), '1:5')
      assert.strictEqual(normalizeBracketRatio('1:5'), '1:5')

      assert.strictEqual(normalizeBracketRatio('1 to 1'), '1:1')
      assert.strictEqual(normalizeBracketRatio('1:1'), '1:1')
    })

    it('calculates exact SL and TP prices for MNQ, MGC, MYM, and MCL contracts', () => {
      // MNQ (Nasdaq $2/pt) LONG 1:2 -> SL -25pts (29125), TP +50pts (29200)
      const mnq12 = calculateBracketPrices({
        instrument: 'MNQ',
        direction: 'LONG',
        entryPrice: 29150.0,
        bracketRatio: '1:2',
      })
      assert.strictEqual(mnq12.stopLossPrice, 29125.0)
      assert.strictEqual(mnq12.takeProfitPrice, 29200.0)
      assert.strictEqual(mnq12.dollarRisk, 50)
      assert.strictEqual(mnq12.dollarReward, 100)

      // MNQ SHORT 1:3 -> SL +25pts (29175), TP -75pts (29075)
      const mnq13 = calculateBracketPrices({
        instrument: 'MNQ',
        direction: 'SHORT',
        entryPrice: 29150.0,
        bracketRatio: '1:3',
      })
      assert.strictEqual(mnq13.stopLossPrice, 29175.0)
      assert.strictEqual(mnq13.takeProfitPrice, 29075.0)
      assert.strictEqual(mnq13.dollarReward, 150)

      // MGC (Gold $10/pt) LONG 1:5 -> SL -5.0pts (4430), TP +25.0pts (4460)
      const mgc15 = calculateBracketPrices({
        instrument: 'MGC',
        direction: 'LONG',
        entryPrice: 4435.0,
        bracketRatio: '1:5',
      })
      assert.strictEqual(mgc15.stopLossPrice, 4430.0)
      assert.strictEqual(mgc15.takeProfitPrice, 4460.0)
      assert.strictEqual(mgc15.dollarReward, 250)
    })
  })
})
