/**
 * Institutional Hedging & Dealer Positioning Agent ("Aegis")
 *
 * Specializes in identifying:
 * - Where institutional dealers and market makers must dynamically hedge delta/gamma.
 * - Where systematic trend-following CTAs are forced to liquidate or flip short.
 * - Spot-futures basis arbitrage and commercial carry pressure.
 * - Critical prices where the "big guys" must act.
 */

import type { DeskAgent, DeskAgentMetadata, SharedMarketState, AgentProposal } from '../types'
import type { LeoDataPoint } from '@/lib/ai/leoAssistant'
import {
  buildInstitutionalHedgingTelemetry,
  type InstitutionalHedgingTelemetry,
} from '../models/institutionalHedgingModel'

export class InstitutionalHedgingAgent implements DeskAgent<SharedMarketState, AgentProposal> {
  public readonly metadata: DeskAgentMetadata = {
    id: 'institutional-hedging-agent',
    name: 'Aegis (Hedging & Big Money Specialist)',
    role: 'INSTITUTIONAL_HEDGING',
    description: 'Analyzes dealer gamma pinning, zero-gamma inflection, CTA triggers, and institutional hedging zones.',
    version: '1.0.0',
    enabled: true,
  }

  public async evaluate(state: SharedMarketState, _customPrompt?: string): Promise<AgentProposal> {
    const { instrument, livePrice, observedBasis, chartContext } = state

    // Reconstruct candles from chartContext if present, or fallback
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

    const telemetry: InstitutionalHedgingTelemetry =
      state.hedgingTelemetry ||
      buildInstitutionalHedgingTelemetry({
        instrument,
        currentPrice: livePrice,
        candles,
        observedBasis,
      })

    const mustActPlaces = telemetry.placesTheyMustAct.map((p) => ({
      price: p.price,
      reason: `${p.type} (${p.urgency} urgency): ${p.description}`,
    }))

    const keyLevelsQuoted = telemetry.placesTheyMustAct.map((p) => p.price)

    let bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE' = 'NEUTRAL'
    let confidence = 75

    if (telemetry.dealerGamma.currentRegime === 'POSITIVE_GAMMA') {
      bias = 'BULLISH'
      confidence = 82
    } else if (telemetry.dealerGamma.currentRegime === 'NEGATIVE_GAMMA') {
      bias = telemetry.ctaBands.trendBias === 'BEARISH' ? 'BEARISH' : 'VOLATILE'
      confidence = 88
    } else {
      bias = 'VOLATILE'
      confidence = 70
    }

    const warnings: string[] = []
    if (telemetry.ctaBands.riskOfForcedSqueeze) {
      warnings.push(`Extreme CTA Liquidation Risk: Price is within strike distance of CTA stop trigger (${telemetry.ctaBands.ctaLiquidationTrigger}).`)
    }
    if (telemetry.dealerGamma.currentRegime === 'NEGATIVE_GAMMA') {
      warnings.push(`Negative Gamma Regime Active: Dealer pro-cyclical hedging is amplifying down-moves. Volatility multiplier: ${telemetry.dealerGamma.volatilityMultiplier}x.`)
    }
    if (telemetry.basisArbitrage.arbitragePressure !== 'NEUTRAL') {
      warnings.push(`CME Basis Arbitrage Pressure: Institutional desks executing ${telemetry.basisArbitrage.arbitragePressure}.`)
    }

    const thesis = `### 🛡️ Institutional Hedging & Dealer Positioning (${instrument})
- **Dealer Gamma Regime**: **${telemetry.dealerGamma.currentRegime}** (Volatility multiplier: ${telemetry.dealerGamma.volatilityMultiplier}x)
  - *Behavior*: ${telemetry.dealerGamma.expectedBehavior}
  - *Zero-Gamma Inflection*: **${telemetry.dealerGamma.zeroGammaLevel}**
  - *Dealer Call Wall (Resistance)*: **${telemetry.dealerGamma.callWallResistance}**
  - *Dealer Put Wall (Support)*: **${telemetry.dealerGamma.putWallSupport}**
- **CTA Systematic Models**: **${telemetry.ctaBands.trendBias}**
  - *CTA Liquidation Trigger*: **${telemetry.ctaBands.ctaLiquidationTrigger}** (Distance: ${telemetry.ctaBands.distanceToLiquidationPts} pts)
  - *CTA Short Flip Trigger*: **${telemetry.ctaBands.ctaShortFlipTrigger}**
- **CME Basis Arbitrage**: ${telemetry.basisArbitrage.basisPts} pts basis vs ${telemetry.basisArbitrage.fairValueBasis} pts fair value. Arbitrage bias: **${telemetry.basisArbitrage.arbitragePressure}**.`

    const suggestedAction =
      telemetry.dealerGamma.currentRegime === 'POSITIVE_GAMMA'
        ? `Fade extremes toward Zero-Gamma (${telemetry.dealerGamma.zeroGammaLevel}); dealer inventory will stabilize dips near Put Wall (${telemetry.dealerGamma.putWallSupport}).`
        : telemetry.dealerGamma.currentRegime === 'NEGATIVE_GAMMA'
        ? `Do NOT fight breakdowns below ${telemetry.dealerGamma.zeroGammaLevel}; market maker gamma hedging will cause cascade liquidations toward CTA Trigger (${telemetry.ctaBands.ctaLiquidationTrigger}).`
        : `Trade cautiously around inflection zone (${telemetry.dealerGamma.zeroGammaLevel}); await dealer commitment.`

    return {
      agentId: this.metadata.id,
      agentName: this.metadata.name,
      role: this.metadata.role,
      bias,
      confidence,
      keyLevelsQuoted,
      mustActPlaces,
      thesis,
      suggestedAction,
      warnings,
    }
  }
}
