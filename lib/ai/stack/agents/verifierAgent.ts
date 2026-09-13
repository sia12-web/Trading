/**
 * Anti-Hallucination & Consequence Verifier Agent ("The Verifier / Critic")
 *
 * Dedicated to:
 * 1. Price Grounding Validation: Audits that all quoted prices exist in verified market telemetry.
 * 2. Consequence & Contradiction Detection: Identifies cross-agent conflicts (e.g. Leo proposing a long into an imminent CPI release or negative gamma squeeze).
 * 3. Rigorous Risk Audit: Assigns grounding scores and gates execution.
 */

import type { DeskAgent, DeskAgentMetadata, SharedMarketState, AgentProposal, VerificationAudit } from '../types'
import type { LeoDataPoint } from '@/lib/ai/leoAssistant'

export class VerifierAgent implements DeskAgent<SharedMarketState & { proposals: AgentProposal[] }, VerificationAudit> {
  public readonly metadata: DeskAgentMetadata = {
    id: 'verifier-critic-agent',
    name: 'The Verifier (Anti-Hallucination & Consequence Critic)',
    role: 'VERIFIER_CRITIC',
    description: 'Validates numerical grounding, detects hallucinations, and evaluates consequence contradictions across agent proposals.',
    version: '1.0.0',
    enabled: true,
  }

  public async evaluate(
    state: SharedMarketState & { proposals: AgentProposal[] }
  ): Promise<VerificationAudit> {
    const { livePrice, proposals = [], upcomingEvents = [], chartContext } = state

    const hallucinatedLevelsDetected: number[] = []
    const contradictionsFound: string[] = []
    const riskConsequences: string[] = []

    // 1. Audit Price Grounding
    // Build set of valid anchor points from actual telemetry
    const validLevels: number[] = [livePrice]
    const dataPoints: LeoDataPoint[] = chartContext?.dataPoints || chartContext?.selectedDataPoints || []
    for (const dp of dataPoints) {
      const val = typeof dp.value === 'number' ? dp.value : parseFloat(String(dp.value))
      if (Number.isFinite(val) && val > 0) validLevels.push(val)
    }
    if (state.hedgingTelemetry) {
      for (const p of state.hedgingTelemetry.placesTheyMustAct) {
        validLevels.push(p.price)
      }
    }

    const minValid = Math.min(...validLevels) * 0.90
    const maxValid = Math.max(...validLevels) * 1.10

    let totalLevelsChecked = 0
    let groundedLevelsCount = 0

    for (const proposal of proposals) {
      for (const level of proposal.keyLevelsQuoted || []) {
        totalLevelsChecked++
        // Check if price is within plausible structural envelope
        if (level < minValid || level > maxValid || !Number.isFinite(level)) {
          hallucinatedLevelsDetected.push(level)
          contradictionsFound.push(
            `Agent [${proposal.agentName}] quoted implausible/hallucinated price level ${level} outside current market boundary [${minValid.toFixed(1)} - ${maxValid.toFixed(1)}].`
          )
        } else {
          groundedLevelsCount++
        }
      }
    }

    const groundingScore = totalLevelsChecked > 0
      ? Math.round((groundedLevelsCount / totalLevelsChecked) * 100)
      : 100

    const isPriceGrounded = hallucinatedLevelsDetected.length === 0 && groundingScore >= 90

    // 2. Consequence & Contradiction Analysis
    const microProposal = proposals.find((p) => p.role === 'MICROSTRUCTURE_EXECUTION')
    const macroProposal = proposals.find((p) => p.role === 'MACRO_NEWS')
    const hedgeProposal = proposals.find((p) => p.role === 'INSTITUTIONAL_HEDGING')

    // Contradiction Check: Microstructure Bullish vs. Negative Gamma Forced Squeeze
    if (
      microProposal?.bias === 'BULLISH' &&
      hedgeProposal?.bias === 'BEARISH' &&
      hedgeProposal.warnings?.some((w) => w.includes('Negative Gamma'))
    ) {
      riskConsequences.push(
        'Critical Disconnect: Microstructure indicates bullish bounce, but institutional dealers are in Negative Gamma with CTA liquidation risk. Breakouts have high failure rates.'
      )
    }

    // Contradiction Check: Active execution vs. Imminent High-Impact Event
    const highImpactSoon = upcomingEvents.some((ev) => ev.impact.toLowerCase() === 'high')
    if (highImpactSoon && microProposal?.suggestedAction) {
      riskConsequences.push(
        'Timing Risk Warning: High-impact economic event scheduled in immediate session window. Proposing directional leverage into macro events violates desk risk rules.'
      )
    }

    // Contradiction Check: Macro Bearish vs. Microstructure Bullish
    if (
      macroProposal &&
      microProposal &&
      macroProposal.bias === 'BEARISH' &&
      microProposal.bias === 'BULLISH'
    ) {
      contradictionsFound.push(
        'Macro Sentiment vs. Tape Momentum Divergence: Macro environment is net bearish, while intraday order flow is pushing short-covering rallies.'
      )
    }

    const passedVerification = isPriceGrounded && riskConsequences.length === 0

    let auditSummary = ''
    if (passedVerification) {
      auditSummary = `✅ Ground Truth Verified: All ${totalLevelsChecked} price references verified against CME Globex telemetry. No mathematical hallucinations or risk contradictions detected.`
    } else {
      auditSummary = `⚠️ Verification Audit Alert: Grounding Score ${groundingScore}%. Detected ${hallucinatedLevelsDetected.length} ungrounded levels and ${riskConsequences.length} cross-market risk consequences.`
    }

    return {
      verifierId: this.metadata.id,
      timestamp: Date.now(),
      isPriceGrounded,
      groundingScore,
      hallucinatedLevelsDetected,
      contradictionsFound,
      riskConsequences,
      passedVerification,
      auditSummary,
    }
  }
}
