import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  evaluatePriceQuestioning,
  type PriceCritiqueEvaluation,
} from '../lib/trading/priceQuestioning'
import { buildLeoSystemPrompt, type LeoChatContext } from '../lib/ai/leoAssistant'
import { buildDeskFallbackResponse } from '../app/api/trading/leo/chat/route'

describe('Auction Price Critique & "Questioning" Engine', () => {
  it('1. should classify EXTREME_PREMIUM when price trades far above Yesterday and Overnight POCs', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2090.0,
      instrument: 'GOLD',
      currentTimeEt: '09:35:00 ET',
      yesterday: { poc: 2050.0, vah: 2060.0, val: 2040.0 },
      overnight: {
        overnight: { poc: 2052.0, high: 2065.0, low: 2045.0 },
        asia: { poc: 2048.0 },
        london: { poc: 2053.0 },
        biasLabel: 'NET_LONG',
        pctLong: 80,
        pctShort: 20,
      },
      frvp5d: { poc: 2050.0, vah: 2065.0, val: 2035.0 },
      avwap5m: { vwap: 2040.0, sigma1Upper: 2055.0, sigma1Lower: 2025.0 },
    })

    assert.strictEqual(result.valuationState, 'EXTREME_PREMIUM')
    assert.ok(result.valuationScore >= 50, `Expected score >= 50, got ${result.valuationScore}`)
    assert.ok(result.inventoryCritique.critiqueSummary.includes('Retail Premium Overhang'))
    assert.ok(result.inventoryCritique.critiqueSummary.includes('London'))
    assert.ok(result.inventoryCritique.critiqueSummary.includes('Overnight inventory is 80% Net Long'))
  })

  it('2. should classify DEEP_DISCOUNT when price trades far below multi-session wholesale POCs', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2010.0,
      instrument: 'GOLD',
      currentTimeEt: '09:35:00 ET',
      yesterday: { poc: 2050.0, vah: 2060.0, val: 2040.0 },
      overnight: {
        overnight: { poc: 2048.0, high: 2055.0, low: 2042.0 },
        asia: { poc: 2052.0 },
        london: { poc: 2046.0 },
        biasLabel: 'NET_SHORT',
        pctLong: 15,
        pctShort: 85,
      },
      frvp5d: { poc: 2050.0, vah: 2065.0, val: 2035.0 },
      avwap5m: { vwap: 2045.0 },
    })

    assert.strictEqual(result.valuationState, 'DEEP_DISCOUNT')
    assert.ok(result.valuationScore <= -50, `Expected score <= -50, got ${result.valuationScore}`)
    assert.ok(result.inventoryCritique.critiqueSummary.includes('Deep Discount / Trap Short'))
    assert.ok(result.inventoryCritique.critiqueSummary.includes('85% Net Short'))
  })

  it('3. should detect Single-Candle FOMO Trap when large bullish candle spikes into Extreme Premium', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2095.0,
      instrument: 'GOLD',
      currentTimeEt: '09:40:00 ET',
      yesterday: { poc: 2050.0 },
      overnight: {
        overnight: { poc: 2050.0 },
        pctLong: 75,
        pctShort: 25,
      },
      frvp5d: { poc: 2050.0 },
      lastCandle: {
        open: 2085.0,
        high: 2095.5,
        low: 2084.5,
        close: 2095.0,
        volume: 500,
        isBullish: true,
      },
    })

    assert.strictEqual(result.weakHandTrap.isTrapRisk, true)
    assert.strictEqual(result.weakHandTrap.trapType, 'SINGLE_CANDLE_FOMO')
    assert.strictEqual(result.suitabilityVerdict, 'WEAK_HAND_TRAP_RISK')
    assert.ok(result.weakHandTrap.warning.includes('Bullish Candle FOMO Trap'))

    // Verify Q1 in 6-question audit is flagged as DANGER
    const q1 = result.sixQuestionAudit.find((q) => q.id === 'q1-single-candle')
    assert.ok(q1)
    assert.strictEqual(q1?.status, 'DANGER')
    assert.ok(q1?.headline.includes('Emotional Candle Chase Warning'))
  })

  it('4. should detect Psychological Round Number Magnet near century/half-century handle', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2100.0, // Century round handle on Gold
      instrument: 'GOLD',
      currentTimeEt: '10:15:00 ET',
      yesterday: { poc: 2075.0 },
      overnight: {
        overnight: { poc: 2078.0 },
        pctLong: 60,
        pctShort: 40,
      },
      frvp5d: { poc: 2070.0 },
      lastCandle: {
        open: 2098.0,
        high: 2100.2,
        low: 2097.8,
        close: 2100.0,
        volume: 300,
        isBullish: true,
      },
    })

    assert.strictEqual(result.weakHandTrap.isTrapRisk, true)
    assert.strictEqual(result.weakHandTrap.trapType, 'ROUND_NUMBER_MAGNET')
    assert.ok(result.weakHandTrap.warning.includes('Round Number Magnet'))

    const q2 = result.sixQuestionAudit.find((q) => q.id === 'q2-round-number')
    assert.ok(q2)
    assert.strictEqual(q2?.status, 'WARNING')
  })

  it('5. should detect Thin Liquidity / Low Volume Push trap', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2112.3, // Non-round number to isolate thin volume
      instrument: 'GOLD',
      currentTimeEt: '10:45:00 ET',
      yesterday: { poc: 2060.0 },
      overnight: { overnight: { poc: 2065.0 } },
      frvp5d: { poc: 2060.0 },
      averageVolume: 1000,
      lastCandle: {
        open: 2110.0,
        high: 2113.0,
        low: 2109.5,
        close: 2112.3,
        volume: 250, // Low volume (< 60% of 1000)
        isBullish: true,
      },
    })

    assert.strictEqual(result.weakHandTrap.isTrapRisk, true)
    assert.strictEqual(result.weakHandTrap.trapType, 'THIN_LIQUIDITY_VACUUM')
    assert.ok(result.weakHandTrap.warning.includes('Thin Liquidity Vacuum'))

    const q3 = result.sixQuestionAudit.find((q) => q.id === 'q3-low-volume')
    assert.ok(q3)
    assert.strictEqual(q3?.status, 'DANGER')
  })

  it('6. should detect Lunch Doldrums time regulation failure (11:30–13:30 ET)', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2050.0,
      instrument: 'GOLD',
      currentTimeEt: '12:15:30 ET',
      yesterday: { poc: 2050.0 },
      overnight: { overnight: { poc: 2050.0 } },
      frvp5d: { poc: 2050.0 },
    })

    assert.strictEqual(result.weakHandTrap.isTrapRisk, true)
    assert.strictEqual(result.weakHandTrap.trapType, 'LUNCH_DOLDRUMS_CHOP')
    assert.ok(result.weakHandTrap.warning.includes('Lunch Doldrums'))

    const q4 = result.sixQuestionAudit.find((q) => q.id === 'q4-time-regulation')
    assert.ok(q4)
    assert.strictEqual(q4?.status, 'WARNING')
  })

  it('7. should provide advantageous wholesale buy guidance in DISCOUNT without traps', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2049.0, // Favorable moderate discount below 2055
      instrument: 'GOLD',
      currentTimeEt: '10:05:00 ET',
      yesterday: { poc: 2055.0, vah: 2065.0, val: 2045.0 },
      overnight: {
        overnight: { poc: 2053.0, high: 2060.0, low: 2045.0 },
        biasLabel: 'BALANCED',
        pctLong: 50,
        pctShort: 50,
      },
      frvp5d: { poc: 2053.0, vah: 2065.0, val: 2045.0 },
      lastCandle: {
        open: 2051.0,
        high: 2051.5,
        low: 2048.5,
        close: 2049.0,
        volume: 800,
        isBullish: false,
      },
    })

    assert.strictEqual(result.valuationState, 'DISCOUNT')
    assert.strictEqual(result.suitabilityVerdict, 'SUITABLE_DISCOUNT_BUY')
    assert.ok(result.deskGuidance.includes('ADVANTAGEOUS WHOLESALE BUY'))
  })

  it('8. should generate all 6 questions in sixQuestionAudit checklist with complete coverage', () => {
    const result = evaluatePriceQuestioning({
      currentPrice: 2050.0,
      instrument: 'GOLD',
      currentTimeEt: '09:45:00 ET',
      yesterday: { poc: 2050.0 },
      overnight: { overnight: { poc: 2050.0 } },
      frvp5d: { poc: 2050.0 },
    })

    assert.strictEqual(result.sixQuestionAudit.length, 6)
    const ids = result.sixQuestionAudit.map((q) => q.id)
    assert.deepStrictEqual(ids, [
      'q1-single-candle',
      'q2-round-number',
      'q3-low-volume',
      'q4-time-regulation',
      'q5-session-inventory',
      'q6-wholesale-value',
    ])
  })

  it('9. should integrate Section 5f and AUCTION PRICE CRITIQUE TELEMETRY into buildLeoSystemPrompt', () => {
    const critique: PriceCritiqueEvaluation = evaluatePriceQuestioning({
      currentPrice: 2090.0,
      instrument: 'GOLD',
      currentTimeEt: '09:35:00 ET',
      yesterday: { poc: 2050.0 },
      overnight: {
        overnight: { poc: 2050.0 },
        london: { poc: 2052.0 },
        pctLong: 80,
        pctShort: 20,
      },
      frvp5d: { poc: 2050.0 },
    })

    const ctx: LeoChatContext = {
      instrument: 'GOLD',
      currentPrice: 2090.0,
      currentTimeEt: '09:35:00 ET',
      dayType: 'Trend Day',
      openingType: 'Open Drive',
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      activeExcesses: [],
      priceQuestioning: critique,
    }

    const prompt = buildLeoSystemPrompt(ctx)

    // Verify Section 5f is present
    assert.ok(prompt.includes('5f. AUCTION PRICE CRITIQUE & "QUESTIONING" DESK PROTOCOL'))
    assert.ok(prompt.includes('The Market is a Place to Do Business (Auction Market Theory)'))
    assert.ok(prompt.includes('Why the hell should we buy at 9:30 AM NYC Open when London and Asian participants accumulated 30 points lower'))
    assert.ok(prompt.includes('The 6-Point Questioning Pre-Trade Self-Audit'))

    // Verify live telemetry block is populated
    assert.ok(prompt.includes('[AUCTION PRICE CRITIQUE & "QUESTIONING" TELEMETRY]'))
    assert.ok(prompt.includes('Valuation State: EXTREME PREMIUM'))
    assert.ok(prompt.includes('Overnight & Session Inventory Reality'))
    assert.ok(prompt.includes('Pre-Trade 6-Question Self-Audit'))
  })

  it('10. should produce comprehensive Auction Price Critique response when Auto-Prompt or dossier is submitted', () => {
    const critique: PriceCritiqueEvaluation = evaluatePriceQuestioning({
      currentPrice: 2090.0,
      instrument: 'GOLD',
      currentTimeEt: '09:35:00 ET',
      yesterday: { poc: 2050.0 },
      overnight: {
        overnight: { poc: 2052.0 },
        pctLong: 80,
        pctShort: 20,
      },
      frvp5d: { poc: 2050.0 },
    })

    const ctx: LeoChatContext = {
      instrument: 'GOLD',
      currentPrice: 2090.0,
      currentTimeEt: '09:35:00 ET',
      priceQuestioning: critique,
      selectedDataPoints: [
        {
          id: 'price-critique-dossier',
          label: `Price Critique: ${critique.valuationState}`,
          value: '+80 / 100',
          tier: 'CONTEXT',
          category: 'INVENTORY',
          description: 'Test dossier',
        },
      ],
    }

    const autoPrompt =
      'Leo, critique the current market price and auction structure based on overnight inventory, yesterday and 5-day POCs, and 5-month AVWAP.'

    const response = buildDeskFallbackResponse(
      [{ role: 'user', content: autoPrompt }],
      ctx
    )

    // Verify response contains Leo Auction Price Critique & Questioning Desk
    assert.ok(response.includes('Leo Auction Price Critique & Questioning Desk (GOLD @ 2090.00)'))
    assert.ok(response.includes('Valuation & Location Read'))
    assert.ok(response.includes('Overnight & Global Session Inventory Reality'))
    assert.ok(response.includes('The 6-Question Pre-Trade Self-Audit'))
    assert.ok(response.includes('Overnight POC:** 2052'))
  })
})
