/**
 * Desk Consensus Orchestrator
 *
 * Coordinates the multi-agent ensemble:
 * 1. Invokes Domain Specialists (Leo Microstructure, News Macro, Aegis Institutional Hedging).
 * 2. Routes outputs to the Verifier & Consequence Critic.
 * 3. Synthesizes a unified, verified Institutional Consensus Matrix.
 */

import type { SharedMarketState, TeamConsensusReport, AgentProposal } from '../types'
import type { LeoDataPoint } from '@/lib/ai/leoAssistant'
import { InstitutionalHedgingAgent } from './institutionalHedgingAgent'
import { VerifierAgent } from './verifierAgent'
import { buildInstitutionalHedgingTelemetry } from '../models/institutionalHedgingModel'

export class ConsensusOrchestrator {
  private hedgingAgent = new InstitutionalHedgingAgent()
  private verifierAgent = new VerifierAgent()

  public async runConsensus(state: SharedMarketState): Promise<TeamConsensusReport> {
    const { instrument, livePrice, chartContext, newsHeadlines = [] } = state

    // Resolve or build institutional hedging telemetry
    const dataPoints: LeoDataPoint[] = chartContext?.dataPoints || chartContext?.selectedDataPoints || []
    const candles = dataPoints
      .filter((p: LeoDataPoint) => p.category === 'POC' || p.category === 'VWAP' || p.category === 'EXTREME')
      .map((p: LeoDataPoint, idx: number) => {
        const val = typeof p.value === 'number' ? p.value : parseFloat(String(p.value)) || livePrice
        return {
          time: Math.floor(Date.now() / 1000) - (20 - idx) * 300,
          open: val,
          high: val * 1.002,
          low: val * 0.998,
          close: val,
          volume: typeof p.volume === 'number' ? p.volume : 500,
        }
      })

    const hedgingTelemetry =
      state.hedgingTelemetry ||
      buildInstitutionalHedgingTelemetry({
        instrument,
        currentPrice: livePrice,
        candles,
        observedBasis: state.observedBasis,
      })

    const stateWithTelemetry: SharedMarketState = {
      ...state,
      hedgingTelemetry,
    }

    // 1. Evaluate Institutional Hedging Specialist
    const hedgingProposal = await this.hedgingAgent.evaluate(stateWithTelemetry)

    // 2. Synthesize Microstructure Specialist (Leo) Proposal from chart context
    const lastPoc = dataPoints.find((p: LeoDataPoint) => p.category === 'POC')?.value
    const vwapPoint = dataPoints.find((p: LeoDataPoint) => p.category === 'VWAP')?.value
    const pocVal = typeof lastPoc === 'number' ? lastPoc : livePrice
    const vwapVal = typeof vwapPoint === 'number' ? vwapPoint : livePrice

    const microBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE' =
      livePrice >= vwapVal && livePrice >= pocVal
        ? 'BULLISH'
        : livePrice < vwapVal && livePrice < pocVal
        ? 'BEARISH'
        : 'NEUTRAL'

    const microstructureProposal: AgentProposal = {
      agentId: 'leo-microstructure-agent',
      agentName: 'Leo (Microstructure & Order Flow)',
      role: 'MICROSTRUCTURE_EXECUTION',
      bias: microBias,
      confidence: 80,
      keyLevelsQuoted: [pocVal, vwapVal],
      thesis: `Order flow shows price trading ${livePrice >= vwapVal ? 'ABOVE' : 'BELOW'} Anchored VWAP (${vwapVal}) with POC anchored at ${pocVal}. ${
        chartContext?.trappedTraders ? `Active ${chartContext.trappedTraders} detected.` : 'No trapped trader exhaustion.'
      }`,
      suggestedAction:
        microBias === 'BULLISH'
          ? `Look for pullback tests to hold VWAP (${vwapVal}) for long continuation.`
          : microBias === 'BEARISH'
          ? `Look for rejection at POC (${pocVal}) for short rotation.`
          : 'Await market development inside the value area.',
    }

    // 3. Synthesize Macro / News Specialist Proposal
    const hasDovishNews = newsHeadlines.some((h) => /rate.?cut|dovish|soft.?landing|cooling.?inflation/i.test(h))
    const hasHawkishNews = newsHeadlines.some((h) => /rate.?hike|hawkish|inflation.?spike|war|tariff/i.test(h))

    const macroBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE' =
      hasDovishNews && !hasHawkishNews
        ? 'BULLISH'
        : hasHawkishNews && !hasDovishNews
        ? 'BEARISH'
        : 'NEUTRAL'

    const macroProposal: AgentProposal = {
      agentId: 'news-macro-agent',
      agentName: 'News AI (Macro & Economic Catalysts)',
      role: 'MACRO_NEWS',
      bias: macroBias,
      confidence: 75,
      keyLevelsQuoted: [],
      thesis: `Macro news sentiment across recent headlines is currently net ${macroBias.toLowerCase()}. Key catalyst watch on central bank expectations and commodity cost curves.`,
    }

    const proposals = [microstructureProposal, macroProposal, hedgingProposal]

    // 4. Run through Verifier & Consequence Critic
    const verification = await this.verifierAgent.evaluate({
      ...stateWithTelemetry,
      proposals,
    })

    // 5. Compute Team Consensus Bias & Confidence
    let bullishScore = 0
    let bearishScore = 0
    let totalWeight = 0

    for (const p of proposals) {
      const weight = p.confidence / 100
      totalWeight += weight
      if (p.bias === 'BULLISH') bullishScore += weight
      if (p.bias === 'BEARISH') bearishScore += weight
    }

    let consensusBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE' = 'NEUTRAL'
    if (bullishScore > bearishScore * 1.3) consensusBias = 'BULLISH'
    else if (bearishScore > bullishScore * 1.3) consensusBias = 'BEARISH'
    else if (hedgingProposal.bias === 'VOLATILE' || !verification.passedVerification) consensusBias = 'VOLATILE'

    // Adjust confidence by Verifier's grounding score
    const rawConfidence = Math.round(((Math.max(bullishScore, bearishScore) / (totalWeight || 1)) * 100) || 70)
    const consensusConfidence = Math.round((rawConfidence * 0.7) + (verification.groundingScore * 0.3))

    const placesTheyMustAct = (hedgingTelemetry.placesTheyMustAct || []).map((p) => ({
      price: p.price,
      type: p.type,
      urgency: p.urgency,
      description: p.description,
    }))

    const executiveVerdict = `### 🏛️ Executive Team Consensus: **${consensusBias}** (${consensusConfidence}% Conviction)
- **Microstructure (Leo)**: **${microstructureProposal.bias}** — ${microstructureProposal.suggestedAction}
- **Institutional Hedging (Aegis)**: **${hedgingProposal.bias}** — ${hedgingProposal.suggestedAction}
- **Macro Sentiment (News AI)**: **${macroProposal.bias}**
- **Verification Audit**: ${verification.auditSummary}`

    return {
      timestamp: Date.now(),
      instrument,
      livePrice,
      consensusBias,
      consensusConfidence,
      executiveVerdict,
      agentBreakdowns: {
        microstructure: microstructureProposal,
        macroNews: macroProposal,
        institutionalHedging: hedgingProposal,
      },
      placesTheyMustAct,
      verification,
    }
  }
}

export const consensusOrchestrator = new ConsensusOrchestrator()
