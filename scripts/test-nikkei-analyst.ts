/**
 * Integration Test Script for Nikkei 225 Macro, BoJ, FX & Tech Analyst (NIKKEI_AGENT)
 * Market: CME Nikkei 225 USD Futures (NKD - $5 Multiplier) / JPX TSE Cash Market
 *
 * Run with: npx tsx scripts/test-nikkei-analyst.ts
 */

import {
  NIKKEI_DIVISOR,
  NKD_CONTRACT_MULTIPLIER,
  DEFAULT_NIKKEI_CONSTITUENTS,
  NIKKEI_EVALUATION_PRESETS,
} from '../lib/fundamentals/nikkeiAnalystConfig'
import {
  computeNikkeiContributions,
  evaluateBojPolicyShift,
  evaluateUsdJpySensitivity,
  evaluateNikkeiEvent,
} from '../lib/fundamentals/nikkeiAnalystEngine'
import {
  getNikkeiFundamentalState,
  formatTodaysNikkeiFundamentalStateText,
} from '../lib/fundamentals/nikkeiStateStore'

async function main() {
  console.log('================================================================')
  console.log('  TESTING NIKKEI 225 MACRO, BOJ, FX & TECH ANALYST (NIKKEI_AGENT)')
  console.log('  Market: CME Nikkei 225 USD Futures (NKD, $5 Multiplier)')
  console.log('================================================================\n')

  // 1. Math Verification: Price-Weighting Leverage & Stock Concentration
  console.log('--- 1. NIKKEI 225 PRICE-WEIGHTING MATHEMATICS & POINT LEVERAGE ---')
  console.log(`Nikkei Divisor: ${NIKKEI_DIVISOR}`)
  console.log(`CME NKD Multiplier: $${NKD_CONTRACT_MULTIPLIER} per index point ($25 per 5.0 pt tick)`)

  const oneThousandYenMovePoints = 1000 / NIKKEI_DIVISOR
  console.log(`¥1,000 price move in ANY constituent = ${oneThousandYenMovePoints.toFixed(2)} Nikkei points ($${(oneThousandYenMovePoints * 5).toFixed(2)} per NKD contract)`)

  const fastRetailing = DEFAULT_NIKKEI_CONSTITUENTS.find((c) => c.symbol === '9983.T')!
  const tokyoElectron = DEFAULT_NIKKEI_CONSTITUENTS.find((c) => c.symbol === '8035.T')!
  const toyota = DEFAULT_NIKKEI_CONSTITUENTS.find((c) => c.symbol === '7203.T')!

  const fr1PctPoints = (fastRetailing.priceJpy * 0.01) / NIKKEI_DIVISOR
  const tel1PctPoints = (tokyoElectron.priceJpy * 0.01) / NIKKEI_DIVISOR
  const toy1PctPoints = (toyota.priceJpy * 0.01) / NIKKEI_DIVISOR

  console.log(`1% move in Fast Retailing (¥${fastRetailing.priceJpy}) = +${fr1PctPoints.toFixed(2)} Nikkei points`)
  console.log(`1% move in Tokyo Electron (¥${tokyoElectron.priceJpy}) = +${tel1PctPoints.toFixed(2)} Nikkei points`)
  console.log(`1% move in Toyota Motor (¥${toyota.priceJpy}) = +${toy1PctPoints.toFixed(2)} Nikkei points`)
  console.log(`Point Leverage Ratio (Fast Retailing / Toyota) = ${(fr1PctPoints / toy1PctPoints).toFixed(1)}x leverage`)

  const contrib = computeNikkeiContributions(DEFAULT_NIKKEI_CONSTITUENTS, NIKKEI_DIVISOR)
  console.log(`\nContribution State computed:`)
  console.log(`- Top 1 Share (Fast Retailing): ${contrib.top1ContributionPct}%`)
  console.log(`- Top 3 Concentration: ${contrib.top3ContributionPct}% (${contrib.weightingConcentration})`)
  console.log(`- Top 5 Concentration: ${contrib.top5ContributionPct}%`)
  console.log(`- Semiconductor Cluster Share: ${contrib.semiconductorSharePct}%`)

  // 2. Bank of Japan & USD/JPY Currency Engine
  console.log('\n--- 2. BOJ MONETARY POLICY & USD/JPY FX REGIME CLASSIFIERS ---')
  const bojHike = evaluateBojPolicyShift({
    rateChangeBps: 25,
    jgb10yYield: 0.95,
  })
  console.log(`BoJ +25 bps hike classified as: Stance=${bojHike.stance}, Banks=${bojHike.bankImpact}, Exporters=${bojHike.exporterImpact}, Net Nikkei=${bojHike.netNikkeiDirection}`)

  const fxIntervention = evaluateUsdJpySensitivity({
    usdjpyRate: 156.8,
    usdjpyChangePct: 0.2,
  })
  console.log(`USD/JPY at 156.80 classified as: Regime=${fxIntervention.regime}, Intervention Risk=${fxIntervention.interventionRiskLevel}, Bias=${fxIntervention.nikkeiBias}`)

  const fxNormalWeaken = evaluateUsdJpySensitivity({
    usdjpyRate: 152.4,
    usdjpyChangePct: 0.65,
  })
  console.log(`USD/JPY +0.65% at 152.40 classified as: Regime=${fxNormalWeaken.regime}, Bias=${fxNormalWeaken.nikkeiBias}`)

  // 3. Live State Store & Plain Text Format for Leo
  console.log('\n--- 3. LIVE STATE STORE & LEO AI ASSISTANT PLAIN TEXT FORMAT ---')
  const state = await getNikkeiFundamentalState()
  console.log(`Live NKD Price: ${state.nikkeiTelemetry.nkdPrice} (${state.nikkeiTelemetry.nkdChange >= 0 ? '+' : ''}${state.nikkeiTelemetry.nkdChange} pts)`)
  console.log(`USD/JPY Rate: ${state.fx.usdjpyRate} | 10Y JGB: ${state.boj.jgb10yYieldPct}%`)
  console.log(`SOX Index: ${state.nikkeiTelemetry.soxIndex} | Breadth: ${state.nikkeiTelemetry.advancersCount} Adv / ${state.nikkeiTelemetry.declinersCount} Dec`)

  const plainText = formatTodaysNikkeiFundamentalStateText(state.today)
  console.log('\n[PREVIEW OF PLAIN TEXT OUTPUT FOR LEO]:')
  console.log(plainText.split('\n').slice(0, 16).join('\n'))
  console.log('... [remaining text omitted for brevity] ...\n')

  // 4. Test 14-Step Institutional Event Evaluator on Presets
  console.log('--- 4. 14-STEP INSTITUTIONAL EVALUATION ON NIKKEI PRESETS ---')
  for (let i = 0; i < NIKKEI_EVALUATION_PRESETS.length; i++) {
    const preset = NIKKEI_EVALUATION_PRESETS[i]!
    console.log(`\nEvaluating Preset ${i + 1}: ${preset.title}`)
    const evaluation = await evaluateNikkeiEvent({
      rawText: preset.rawText,
      sourceHint: preset.source,
      autoCommitIfMaterial: false,
    })

    const out = evaluation.structuredOutput
    console.log(`- Event: ${out.event}`)
    console.log(`- Category: ${out.category} | Importance: ${out.importance}`)
    console.log(`- Stance: Intraday=${out.market_stance.intraday}, Short-Term=${out.market_stance.short_term}`)
    console.log(`- Est. NKD Point Impact: ${out.estimated_nkd_point_impact || 0} pts ($${((out.estimated_nkd_point_impact || 0) * 5).toLocaleString()} notional per contract)`)
    console.log(`- Abnormal Behavior: detected=${out.abnormal_behavior.detected} (${out.abnormal_behavior.type})`)
    if (out.abnormal_behavior.detected) {
      console.log(`  * Alert: ${out.abnormal_behavior.explanation}`)
    }
    console.log(`- Actionable Rule: ${out.actionable_takeaway}`)
    console.log(`- Confidence: ${out.confidence}%`)
  }

  console.log('\n================================================================')
  console.log('  ALL NIKKEI 225 (NIKKEI_AGENT) TESTS COMPLETED SUCCESSFULLY!')
  console.log('================================================================')
}

main().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
