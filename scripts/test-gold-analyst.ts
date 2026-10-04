import { evaluateGoldEvent } from '../lib/fundamentals/goldAnalystEngine'
import {
  getGoldFundamentalState,
  formatTodaysGoldFundamentalStateText,
} from '../lib/fundamentals/goldStateStore'
import { GOLD_EVALUATION_PRESETS } from '../lib/fundamentals/goldAnalystConfig'

async function run() {
  console.log('=== 1. Testing Live Gold Telemetry & State ===')
  const state = await getGoldFundamentalState()
  console.log('GC Gold Prompt Price: $' + state.goldTelemetry.goldPrice.toFixed(2))
  console.log('10Y Real TIPS (DFII10): ' + state.goldTelemetry.us10yRealYield.toFixed(2) + '%')
  console.log('10Y Breakeven (T10YIE): ' + state.goldTelemetry.us10yBreakeven.toFixed(2) + '%')
  console.log('10Y Nominal (^TNX): ' + state.goldTelemetry.us10yNominalYield.toFixed(2) + '%')
  console.log('DXY Dollar Index: ' + state.goldTelemetry.dxyIndex.toFixed(2))
  console.log('Gold/Silver Ratio (GSR): ' + state.goldTelemetry.goldSilverRatio.toFixed(1) + ':1')
  console.log('Live Headlines fetched: ' + state.liveGoldHeadlines.length)

  console.log('\n=== 2. Testing Plain-Text Bot Output (Item 37) ===')
  const textOutput = formatTodaysGoldFundamentalStateText(state.today)
  console.log(textOutput.split('\n').slice(0, 8).join('\n') + '\n...')

  console.log('\n=== 3. Testing 11-Step Event Evaluation (Preset 1: Hot CPI with Rejection) ===')
  const preset1 = GOLD_EVALUATION_PRESETS[0]
  const eval1 = await evaluateGoldEvent({
    rawText: preset1.rawText,
    sourceHint: preset1.source,
    autoCommitIfMaterial: false,
  })

  console.log('Event Name:', eval1.structuredOutput.event)
  console.log('Expected Direction:', eval1.structuredOutput.event_analysis.expected_gold_effect)
  console.log('Standardized Surprise:', eval1.structuredOutput.event_analysis.standardized_surprise + ' σ')
  console.log('Transmission:', JSON.stringify(eval1.structuredOutput.transmission))
  console.log('Market Response Quality:', eval1.structuredOutput.market_response.gold_response_quality)
  console.log('GC 15m:', eval1.structuredOutput.market_response.gc_15m)
  console.log('Summary:', eval1.structuredOutput.summary)

  console.log('\n=== 4. Testing Unified Agent Protocol (Item 39) ===')
  console.log(JSON.stringify(eval1.structuredOutput.unified_protocol, null, 2))

  console.log('\n✅ Gold Fundamental Analyst verification completed successfully!')
}

run().catch(console.error)
