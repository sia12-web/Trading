/**
 * Verification Test Script for Nasdaq-100 Fundamental Analyst (NASDAQ_AGENT)
 * Run with: npx tsx scripts/test-nasdaq-analyst.ts
 */

import { evaluateNasdaqEvent } from '../lib/fundamentals/nasdaqAnalystEngine'
import {
  getNasdaqFundamentalState,
  formatTodaysNasdaqFundamentalStateText,
} from '../lib/fundamentals/nasdaqStateStore'
import { NASDAQ_EVALUATION_PRESETS } from '../lib/fundamentals/nasdaqAnalystConfig'

async function run() {
  console.log('=== 1. Testing Live Nasdaq Telemetry & Macro State ===')
  const state = await getNasdaqFundamentalState()
  const t = state.nasdaqTelemetry
  console.log(`NQ Futures: ${t.nqPrice.toFixed(2)} (${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%)`)
  console.log(`ES Futures: ${t.esPrice.toFixed(2)} (${t.esChangePct >= 0 ? '+' : ''}${t.esChangePct.toFixed(2)}%) | YM: ${t.ymPrice.toFixed(2)}`)
  console.log(`Relative Strength Stance: ${t.relativeStrengthStance}`)
  console.log(`US 2Y Yield: ${t.us2yNominalYield.toFixed(2)}% | US 10Y: ${t.us10yNominalYield.toFixed(2)}%`)
  console.log(`2s10s Yield Curve Spread: +${t.yieldCurve2s10sSpreadBps.toFixed(1)} bps`)
  console.log(`10Y Real TIPS Yield (DFII10): ${t.us10yRealYield.toFixed(2)}%`)
  console.log(`CBOE VXN (Tech IV): ${t.vxnIndex.toFixed(2)} | VIX: ${t.vixIndex.toFixed(2)} | Tech Spread: +${(t.vxnIndex - t.vixIndex).toFixed(2)} pts`)
  console.log(`Advance / Decline Ratio: ${t.advanceDeclineRatio.toFixed(2)}:1`)
  console.log(`Live Deduplicated Headlines Count: ${state.liveHeadlines.length}`)

  console.log('\n=== 2. Testing Plain-Text Bot Output (Item 30: 18 Dimensions) ===')
  const textOutput = formatTodaysNasdaqFundamentalStateText(state.today)
  const lines = textOutput.split('\n')
  console.log(lines.slice(0, 10).join('\n'))
  console.log('...\n' + lines.slice(-6).join('\n'))

  console.log('\n=== 3. Testing 14-Step Institutional Evaluator (Preset 1: Hot CPI with Abnormal CVD Rejection) ===')
  const preset1 = NASDAQ_EVALUATION_PRESETS[0]
  const eval1 = await evaluateNasdaqEvent({
    rawText: preset1.rawText,
    sourceHint: preset1.source,
    autoCommitIfMaterial: false,
  })

  const out1 = eval1.structuredOutput
  console.log('Event Name:', out1.event)
  console.log('Importance:', out1.importance)
  console.log('Fundamental Effect:', JSON.stringify(out1.fundamental_effect))
  console.log('Market Confirmation:', out1.market_confirmation.confirmation)
  console.log('Confidence:', out1.confidence)
  console.log('Abnormal Behavior Detected:', out1.abnormal_behavior.detected)
  if (out1.abnormal_behavior.detected) {
    console.log('Abnormal Behavior Type:', out1.abnormal_behavior.type)
    console.log('Abnormal Behavior Description:', out1.abnormal_behavior.description)
  }
  console.log('Institutional Summary:', out1.summary)

  console.log('\n=== 4. Testing Preset 3: Mega-Cap Earnings Beat with Guidance & Capex Cut ===')
  const preset3 = NASDAQ_EVALUATION_PRESETS[2]
  const eval3 = await evaluateNasdaqEvent({
    rawText: preset3.rawText,
    sourceHint: preset3.source,
    autoCommitIfMaterial: false,
  })
  const out3 = eval3.structuredOutput
  console.log('Event Name:', out3.event)
  console.log('Fundamental Effect (Intraday):', out3.fundamental_effect.intraday)
  console.log('Drivers Evaluated:', out3.drivers.map((d) => `${d.factor} (${d.effect}) - Nuance: ${d.capex_guidance_nuance || 'None'}`))
  console.log('Market Confirmation:', out3.market_confirmation.confirmation)

  console.log('\n=== 5. Testing Unified Multi-Agent Protocol (Item 39) ===')
  console.log(JSON.stringify(out1.unified_protocol, null, 2))

  console.log('\n✅ Nasdaq-100 Fundamental Analyst verification completed successfully!')
}

run().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
