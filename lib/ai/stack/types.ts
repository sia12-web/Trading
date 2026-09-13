/**
 * Core Multi-Agent Stack (MAS) Type Contracts
 *
 * Provides extensible, strictly-typed schemas for:
 * - Domain Agents (Leo, News/Macro, Institutional Hedging).
 * - Anti-Hallucination Verifiers & Consequence Critics.
 * - Team Consensus Orchestration.
 */

import type { InstitutionalHedgingTelemetry } from './models/institutionalHedgingModel'
import type { LeoChatContext } from '@/lib/ai/leoAssistant'

export type AgentRole =
  | 'MICROSTRUCTURE_EXECUTION' // Leo AI
  | 'MACRO_NEWS'               // News & Macro AI
  | 'INSTITUTIONAL_HEDGING'    // Aegis: Dealer Gamma & CTA Hedging Specialist
  | 'VERIFIER_CRITIC'          // Anti-Hallucination Consequence Verifier
  | 'ORCHESTRATOR'             // Desk Team Consensus Lead

export interface DeskAgentMetadata {
  id: string
  name: string
  role: AgentRole
  description: string
  version: string
  enabled: boolean
}

export interface SharedMarketState {
  instrument: string
  livePrice: number
  candlesCount: number
  lastBarTime: number
  observedBasis?: number | null
  chartContext?: LeoChatContext
  hedgingTelemetry?: InstitutionalHedgingTelemetry
  newsHeadlines?: string[]
  upcomingEvents?: Array<{ time: string; event: string; impact: string }>
}

export interface AgentProposal {
  agentId: string
  agentName: string
  role: AgentRole
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE'
  confidence: number // 0 to 100
  keyLevelsQuoted: number[]
  mustActPlaces?: Array<{ price: number; reason: string }>
  thesis: string
  suggestedAction?: string
  warnings?: string[]
}

export interface VerificationAudit {
  verifierId: string
  timestamp: number
  isPriceGrounded: boolean
  groundingScore: number // 0 to 100
  hallucinatedLevelsDetected: number[]
  contradictionsFound: string[]
  riskConsequences: string[]
  passedVerification: boolean
  auditSummary: string
}

export interface TeamConsensusReport {
  timestamp: number
  instrument: string
  livePrice: number
  consensusBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE'
  consensusConfidence: number // 0 to 100
  executiveVerdict: string
  agentBreakdowns: {
    microstructure: AgentProposal
    macroNews: AgentProposal
    institutionalHedging: AgentProposal
  }
  placesTheyMustAct: Array<{
    price: number
    type: string
    urgency: 'HIGH' | 'MEDIUM' | 'EXTREME'
    description: string
  }>
  verification: VerificationAudit
}

/**
 * Common interface implemented by every specialist agent in the stack.
 */
export interface DeskAgent<TInput = SharedMarketState, TOutput = AgentProposal> {
  readonly metadata: DeskAgentMetadata
  evaluate(state: TInput, customPrompt?: string): Promise<TOutput>
}
