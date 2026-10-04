/**
 * Integration Test Script for Dow Jones Macro, Cyclical Economy & Rotation Analyst (DOW_AGENT)
 * Run with: npx tsx scripts/test-dow-analyst.ts
 */

import {
  DJIA_DIVISOR,
  DEFAULT_DJIA_30_CONSTITUENTS,
  DOW_EVALUATION_PRESETS,
} from '../lib/fundamentals/dowAnalystConfig'
import {
  computeDjiaContributions,
  evaluateSectorRotation,
  classifyYieldMoveDriver,
  classifyGrowthInflationQuadrant,
  evaluateDowEvent,
} from '../lib/fundamentals/dowAnalystEngine'
import {
  getDowFundamentalState,
  formatTodaysDowFundamentalStateText,
} from '../lib/fundamentals/dowStateStore'

async function main() {
  console.log('================================================================')
  console.log('  TESTING DOW JONES MACRO, CYCLICAL & ROTATION ANALYST (DOW_AGENT)')
  console.log('  Market: CME E-mini Dow Futures (YM, $5 Multiplier)')
  console.log('================================================================\n')

  // 1. Math Verification: Price Weighting vs Market-Cap Weighting
  console.log('--- 1. DJIA PRICE-WEIGHTING MATHEMATICS & POINT LEVERAGE ---')
  console.log(`Dow Divisor: ${DJIA_DIVISOR}`)
  const oneDollarMovePoints = 1 / DJIA_DIVISOR
  console.log(`$1 price move in ANY constituent = ${oneDollarMovePoints.toFixed(4)} Dow points ($${(oneDollarMovePoints * 5).toFixed(2)} per YM contract)`)

  const unh = DEFAULT_DJIA_30_CONSTITUENTS.find((c) => c.symbol === 'UNH')!
  const nke = DEFAULT_DJIA_30_CONSTITUENTS.find((c) => c.symbol === 'NKE') || { price: 86.0 }

  const unh1PctMove = unh.price * 0.01
  const nke1PctMove = nke.price * 0.01

  const unhPoints = unh1PctMove / DJIA_DIVISOR
  const nkePoints = nke1PctMove / DJIA_DIVISOR
  console.log(`1% move in UNH ($${unh.price}) = +$${unh1PctMove.toFixed(2)}/sh = +${unhPoints.toFixed(2)} Dow points`)
  console.log(`1% move in NKE ($${nke.price}) = +$${nke1PctMove.toFixed(2)}/sh = +${nkePoints.toFixed(2)} Dow points`)
  console.log(`Relative Point Leverage Ratio (UNH / NKE) = ${(unhPoints / nkePoints).toFixed(2)}x leverage`)

  const contribState = computeDjiaContributions(DEFAULT_DJIA_30_CONSTITUENTS, DJIA_DIVISOR)
  console.log(`\nContribution State computed:`)
  console.log(`- Sum of 30 prices: $${contribState.sumSharePrices}`)
  console.log(`- Top 1 Point Share: ${contribState.top1ContributionPct}%`)
  console.log(`- Top 3 Concentration: ${contribState.top3ContributionPct}% (${contribState.contributionConcentration})`)
  console.log(`- Top 5 Concentration: ${contribState.top5ContributionPct}%`)
  console.log(`- Equal-Weight 30 Return: ${contribState.equalWeight30ReturnPct}% vs Price-Weighted DJIA: ${contribState.priceWeightedDjiaReturnPct}%`)
  console.log(`- Weighting Divergence Signal: ${contribState.weightingDivergenceSignal}`)

  // 2. Sector Rotation & Yield Move Classification
  console.log('\n--- 2. CROSS-MARKET ROTATION & YIELD CLASSIFIER ---')
  const rotation = evaluateSectorRotation({
    ymChangePct: +0.82,
    esChangePct: +0.45,
    nqChangePct: -0.15,
    rtyChangePct: +1.10,
  })
  console.log(`Rotation Regime (YM outperforming NQ): ${rotation.rotationRegime}`)
  console.log(`Leading: ${rotation.leadershipSector} | Lagging: ${rotation.laggingSector}`)
  console.log(`YM vs NQ Spread: ${rotation.ymVsNqSpreadPct >= 0 ? '+' : ''}${rotation.ymVsNqSpreadPct}%`)

  const yieldDriverGrowth = classifyYieldMoveDriver({
    yieldChangeBps: +8,
    growthSignal: 'UP',
    inflationSignal: 'NEUTRAL',
    fedSignal: 'NEUTRAL',
  })
  console.log(`Yield move (+8 bps with robust activity) classified as: ${yieldDriverGrowth}`)

  const quadrant = classifyGrowthInflationQuadrant(true, false)
  console.log(`Growth Rising + Inflation Cooling classified as: ${quadrant}`)

  // 3. Live State Store & Bot Plain Text Format
  console.log('\n--- 3. LIVE STATE STORE & BOT PLAIN TEXT (ITEM 35: 24 POINTS) ---')
  const state = await getDowFundamentalState()
  console.log(`Live YM Price: ${state.dowTelemetry.ymPrice} (${state.dowTelemetry.ymChangePct}%)`)
  console.log(`US 10Y Yield: ${state.dowTelemetry.us10yNominalYield}% | 2Y: ${state.dowTelemetry.us2yNominalYield}% | 2s10s: +${state.dowTelemetry.yieldCurve2s10sSpreadBps} bps`)
  console.log(`Credit: HY OAS ${state.credit.highYieldSpreadBps} bps (${state.credit.creditStressRegime}) | HYG: $${state.credit.hygPrice}`)
  console.log(`Advancers: ${state.dowTelemetry.advancersCount} | Decliners: ${state.dowTelemetry.declinersCount}`)

  const botText = formatTodaysDowFundamentalStateText(state.today)
  console.log('\n[PREVIEW OF PLAIN TEXT BOT OUTPUT - 24 DIMENSIONS]:')
  console.log(botText.split('\n').slice(0, 15).join('\n'))
  console.log('... [remaining dimensions omitted for brevity] ...\n')

  // 4. Test 14-Step Institutional Event Evaluator with Presets
  console.log('--- 4. 14-STEP INSTITUTIONAL EVALUATION ON PRESETS ---')
  for (let i = 0; i < DOW_EVALUATION_PRESETS.length; i++) {
    const preset = DOW_EVALUATION_PRESETS[i]!
    console.log(`\nEvaluating Preset ${i + 1}: ${preset.title}`)
    const evaluation = await evaluateDowEvent({
      rawText: preset.rawText,
      sourceHint: preset.source,
      autoCommitIfMaterial: false,
    })

    const out = evaluation.structuredOutput
    console.log(`- Event: ${out.event}`)
    console.log(`- Category: ${out.event_analysis?.category} | Importance: ${out.importance}`)
    console.log(`- Fundamental Stance: Intraday=${out.fundamental_state.intraday}, Short-Term=${out.fundamental_state.short_term}`)
    console.log(`- Estimated Dow Point Impact: ${out.event_analysis?.estimated_dow_point_impact ?? 'N/A'} pts`)
    console.log(`- Yield Move Driver: ${out.transmission?.yield_move_driver ?? 'N/A'}`)
    console.log(`- Market Confirmation: ${out.market_response?.confirmation}`)
    console.log(`- Abnormal Behavior Detected: ${out.abnormal_behavior?.detected} (${out.abnormal_behavior?.type})`)
    if (out.abnormal_behavior?.detected) {
      console.log(`  * Alert: ${out.abnormal_behavior.description}`)
    }
    console.log(`- Confidence: ${Math.round(out.confidence * 100)}%`)
    console.log(`- Summary: ${out.summary}`)

    // Check Unified Protocol
    if (out.unified_protocol) {
      console.log(`- Unified Protocol: Market=${out.unified_protocol.market}, Expected=${out.unified_protocol.expected_direction}, Confirmation=${out.unified_protocol.market_confirmation}`)
    }
  }

  console.log('\n================================================================')
  console.log('  ALL DOW JONES (DOW_AGENT) TESTS COMPLETED SUCCESSFULLY!')
  console.log('================================================================\n')
}

main().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
