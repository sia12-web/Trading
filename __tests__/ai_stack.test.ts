import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  computeDealerGammaLevels,
  computeCtaRebalancingBands,
  computeBasisArbitrage,
  buildInstitutionalHedgingTelemetry,
  type CandlePricePoint,
} from '../lib/ai/stack/models/institutionalHedgingModel'
import { InstitutionalHedgingAgent } from '../lib/ai/stack/agents/institutionalHedgingAgent'
import { VerifierAgent } from '../lib/ai/stack/agents/verifierAgent'
import { ConsensusOrchestrator } from '../lib/ai/stack/agents/consensusOrchestrator'
import type { SharedMarketState, AgentProposal } from '../lib/ai/stack/types'

describe('Institutional Multi-Agent Stack (AI Stacked)', () => {
  // Mock 25 bars of candles around 20,000
  const mockCandles: CandlePricePoint[] = Array.from({ length: 25 }, (_, i) => {
    const base = 20000 + (i - 12) * 10
    return {
      time: 1700000000 + i * 300,
      open: base,
      high: base + 15,
      low: base - 15,
      close: base + 5,
      volume: 1000 + i * 50,
    }
  })

  describe('Institutional Hedging Model (Pure Quantitative Math)', () => {
    it('computes dealer gamma levels and classifies positive gamma above flip', () => {
      const gamma = computeDealerGammaLevels(20200, mockCandles, 'NQ')
      assert.ok(gamma.zeroGammaLevel > 0)
      assert.ok(gamma.callWallResistance > gamma.zeroGammaLevel)
      assert.ok(gamma.putWallSupport < gamma.zeroGammaLevel)
      assert.strictEqual(gamma.currentRegime, 'POSITIVE_GAMMA')
      assert.strictEqual(gamma.volatilityMultiplier, 0.75)
    })

    it('classifies negative gamma regime below flip with elevated volatility multiplier', () => {
      const gamma = computeDealerGammaLevels(19800, mockCandles, 'NQ')
      assert.strictEqual(gamma.currentRegime, 'NEGATIVE_GAMMA')
      assert.strictEqual(gamma.volatilityMultiplier, 1.65)
    })

    it('computes CTA rebalancing bands and liquidation thresholds', () => {
      const cta = computeCtaRebalancingBands(20100, mockCandles)
      assert.ok(cta.ctaLongTrigger > 0)
      assert.ok(cta.ctaLiquidationTrigger > 0)
      assert.ok(cta.ctaShortFlipTrigger > 0)
      assert.ok(cta.distanceToLiquidationPts >= 0)
    })

    it('evaluates CME basis arbitrage and cash-and-carry pressure', () => {
      // With observedBasis = 30 and fair value = 55, basis is undervalued by 25 pts -> BUY_FUTURES_SELL_SPOT
      const basis = computeBasisArbitrage('NQ', 20000, 30)
      assert.strictEqual(basis.arbitragePressure, 'BUY_FUTURES_SELL_SPOT')
      assert.strictEqual(basis.basisPts, 30)
    })

    it('builds institutional hedging telemetry with sorted placesTheyMustAct', () => {
      const telemetry = buildInstitutionalHedgingTelemetry({
        instrument: 'NQ',
        currentPrice: 20050,
        candles: mockCandles,
      })

      assert.strictEqual(telemetry.instrument, 'NQ')
      assert.ok(telemetry.placesTheyMustAct.length >= 3)
      for (const p of telemetry.placesTheyMustAct) {
        assert.ok(p.price > 0)
        assert.ok(['HIGH', 'MEDIUM', 'EXTREME'].includes(p.urgency))
        assert.ok(p.description.length > 5)
      }
    })
  })

  describe('Specialist Agents & Anti-Hallucination Verifier', () => {
    const hedgingAgent = new InstitutionalHedgingAgent()
    const verifierAgent = new VerifierAgent()

    it('Aegis generates a structured proposal with quoted hedging levels', async () => {
      const state: SharedMarketState = {
        instrument: 'NQ',
        livePrice: 20050,
        candlesCount: mockCandles.length,
        lastBarTime: Date.now(),
      }

      const proposal = await hedgingAgent.evaluate(state)
      assert.strictEqual(proposal.agentId, 'institutional-hedging-agent')
      assert.ok(['BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILE'].includes(proposal.bias))
      assert.ok(proposal.keyLevelsQuoted.length > 0)
      assert.ok(proposal.thesis.includes('Institutional Hedging'))
      assert.ok(proposal.suggestedAction)
    })

    it('Verifier approves proposals with grounded price levels (100% Grounding Score)', async () => {
      const state: SharedMarketState = {
        instrument: 'NQ',
        livePrice: 20050,
        candlesCount: mockCandles.length,
        lastBarTime: Date.now(),
        chartContext: {
          instrument: 'NQ',
          currentPrice: 20050,
          currentTimeEt: '10:00 ET',
          dayType: 'Trend Day',
          openingType: 'Open-Drive',
          longTermMoney: null,
          intermediateMoney: null,
          shortTermMoney: { sessionDate: '2026-09-13', ypoc: 20010, yvah: null, yval: null, yhigh: null, ylow: null, onPoc: null, onHigh: null, onLow: null },
          dataPoints: [{ id: 'poc', label: 'POC', value: 20010, tier: 'ST', category: 'POC' }],
        },
      }

      const validProposal: AgentProposal = {
        agentId: 'test-agent',
        agentName: 'Test Specialist',
        role: 'MICROSTRUCTURE_EXECUTION',
        bias: 'BULLISH',
        confidence: 85,
        keyLevelsQuoted: [20050, 20010],
        thesis: 'Holding above POC at 20010.',
      }

      const audit = await verifierAgent.evaluate({
        ...state,
        proposals: [validProposal],
      })

      assert.strictEqual(audit.isPriceGrounded, true)
      assert.strictEqual(audit.groundingScore, 100)
      assert.strictEqual(audit.hallucinatedLevelsDetected.length, 0)
      assert.strictEqual(audit.passedVerification, true)
    })

    it('Verifier detects and catches hallucinated price levels outside market boundary', async () => {
      const state: SharedMarketState = {
        instrument: 'NQ',
        livePrice: 20050,
        candlesCount: mockCandles.length,
        lastBarTime: Date.now(),
      }

      const hallucinatingProposal: AgentProposal = {
        agentId: 'hallucinating-agent',
        agentName: 'Unreliable Bot',
        role: 'MICROSTRUCTURE_EXECUTION',
        bias: 'BULLISH',
        confidence: 90,
        // 95,000 is far outside NQ range of 20,000
        keyLevelsQuoted: [95000],
        thesis: 'Targeting 95,000.',
      }

      const audit = await verifierAgent.evaluate({
        ...state,
        proposals: [hallucinatingProposal],
      })

      assert.strictEqual(audit.isPriceGrounded, false)
      assert.ok(audit.groundingScore < 50)
      assert.ok(audit.hallucinatedLevelsDetected.includes(95000))
      assert.strictEqual(audit.passedVerification, false)
      assert.ok(audit.contradictionsFound.length > 0)
    })

    it('Verifier detects timing hazard when high-impact event is imminent', async () => {
      const state: SharedMarketState = {
        instrument: 'NQ',
        livePrice: 20050,
        candlesCount: mockCandles.length,
        lastBarTime: Date.now(),
        upcomingEvents: [
          { time: '10:00 ET', event: 'CPI Release', impact: 'high' },
        ],
      }

      const executionProposal: AgentProposal = {
        agentId: 'leo',
        agentName: 'Leo',
        role: 'MICROSTRUCTURE_EXECUTION',
        bias: 'BULLISH',
        confidence: 80,
        keyLevelsQuoted: [20050],
        thesis: 'Bullish bounce',
        suggestedAction: 'Execute long at 20050',
      }

      const audit = await verifierAgent.evaluate({
        ...state,
        proposals: [executionProposal],
      })

      assert.ok(audit.riskConsequences.some((r) => r.includes('High-impact economic event')))
    })
  })

  describe('Consensus Orchestrator (Multi-Agent Teamwork)', () => {
    const orchestrator = new ConsensusOrchestrator()

    it('orchestrates complete multi-agent workflow into a verified consensus report', async () => {
      const state: SharedMarketState = {
        instrument: 'NQ',
        livePrice: 20050,
        candlesCount: mockCandles.length,
        lastBarTime: Date.now(),
        chartContext: {
          instrument: 'NQ',
          currentPrice: 20050,
          currentTimeEt: '10:15 ET',
          dayType: 'Normal Day',
          openingType: 'Open-In-Range',
          longTermMoney: null,
          intermediateMoney: null,
          shortTermMoney: { sessionDate: '2026-09-13', ypoc: 20020, yvah: null, yval: null, yhigh: null, ylow: null, onPoc: null, onHigh: null, onLow: null },
          dataPoints: [
            { id: 'vwap', label: 'VWAP', value: 20030, tier: 'ST', category: 'VWAP' },
            { id: 'poc', label: 'POC', value: 20020, tier: 'ST', category: 'POC' },
          ],
        },
      }

      const report = await orchestrator.runConsensus(state)

      assert.strictEqual(report.instrument, 'NQ')
      assert.strictEqual(report.livePrice, 20050)
      assert.ok(['BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILE'].includes(report.consensusBias))
      assert.ok(report.consensusConfidence >= 50 && report.consensusConfidence <= 100)
      assert.ok(report.executiveVerdict.includes('Executive Team Consensus'))
      assert.ok(report.agentBreakdowns.microstructure)
      assert.ok(report.agentBreakdowns.institutionalHedging)
      assert.ok(report.agentBreakdowns.macroNews)
      assert.ok(report.placesTheyMustAct.length >= 2)
      assert.strictEqual(report.verification.passedVerification, true)
    })
  })
})
