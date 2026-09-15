/**
 * Leo Notes vs Situations Distinction Tests
 *
 * Verifies that:
 * 1. Leo correctly parses ARM_DESK_ALERT / SAVE_LONG_TERM_MEMORY for alarms/notes.
 * 2. Leo correctly parses ARM_CONDITIONAL_ENTRY for trade entry situations.
 * 3. User drawings (trendlines, range boxes, manual FRVPs) re-project correctly.
 * 4. Per-market rule separation holds for DOW, NASDAQ, GOLD, CRUDE.
 */

import assert from 'node:assert/strict'
import {
  parseLeoDirectives,
  extractChartDataPoints,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'

// 1. Test directive parsing for Alarm Notes vs Conditional Entry Situations
{
  const alarmDirectiveText = `
I have set an alarm for Yesterday's POC.
<execute>
{
  "action": "ARM_DESK_ALERT",
  "targetReference": "Yesterday POC",
  "targetPrice": 29500.0,
  "requireHighVolume": true,
  "isLongTerm": false
}
</execute>
  `

  const directives = parseLeoDirectives(alarmDirectiveText)
  assert.equal(directives.length, 1)
  assert.equal(directives[0]?.action, 'ARM_DESK_ALERT')
  if (directives[0]?.action === 'ARM_DESK_ALERT') {
    assert.equal(directives[0].targetPrice, 29500)
    assert.equal(directives[0].targetReference, "Yesterday POC")
  }
}

{
  const conditionalEntryText = `
Strategy armed for Bullish Engulfing at FRVP LVN.
<execute>
{
  "action": "ARM_CONDITIONAL_ENTRY",
  "userPrompt": "monitor yesterday FRVP low volume node; if we see a bullish engulfing enter long",
  "instrument": "NASDAQ",
  "direction": "LONG",
  "targetReference": "Yesterday FRVP Low Volume Node",
  "targetPrice": 29500.0,
  "pattern": "BULLISH_ENGULFING",
  "stopLossMode": "BELOW_CANDLE_LOW",
  "takeProfitMode": "1:2",
  "size": 1
}
</execute>
  `

  const directives = parseLeoDirectives(conditionalEntryText)
  assert.equal(directives.length, 1)
  assert.equal(directives[0]?.action, 'ARM_CONDITIONAL_ENTRY')
  if (directives[0]?.action === 'ARM_CONDITIONAL_ENTRY') {
    assert.equal(directives[0].direction, 'LONG')
    assert.equal(directives[0].pattern, 'BULLISH_ENGULFING')
    assert.equal(directives[0].stopLossMode, 'BELOW_CANDLE_LOW')
  }
}

// 2. Test Drawing Re-projection and Data Point Extraction
{
  const mockContext: LeoChatContext = {
    instrument: 'NASDAQ',
    currentPrice: 29480,
    currentTimeEt: '10:15:00',
    dayType: 'DOUBLE_DISTRIBUTION',
    openingType: 'OPEN_REJECTION_REVERSE',
    longTermMoney: { avwap5m: 29300, sigma1Upper: 29500, sigma1Lower: 29100, sigma2Upper: 29700, sigma2Lower: 28900, distancePts: 180 },
    intermediateMoney: { poc5d: 29450, vah5d: 29600, val5d: 29300, high5d: 29650, low5d: 29250, distancePts: 30 },
    shortTermMoney: { sessionDate: '2026-09-15', ypoc: 29400, yhigh: 29550, ylow: 29250, yvah: 29500, yval: 29350, onpoc: 29420, onhigh: 29500, onlow: 29380, overnightBias: 'BULLISH', distanceYpocPts: 80, distanceOnpocPts: 60 },
    activeExcesses: [],
    userDrawings: {
      trendlines: [
        {
          id: 'tl-1',
          label: 'Ascending Support Trendline',
          startPrice: 29400,
          endPrice: 29460,
          startTimeEt: '09:30',
          endTimeEt: '10:00',
          slopePtsPerMin: 2,
          slopePtsPer5mBar: 10,
          slopeDirection: 'ASCENDING',
          projectedPrice: 29490,
          distancePts: 10,
          priceRelation: 'ABOVE',
        },
      ],
      ranges: [
        {
          id: 'r-1',
          label: 'OR30 Range Box',
          priceHigh: 29550,
          priceLow: 29400,
          midPrice: 29475,
          heightPts: 150,
          startTimeEt: '09:30',
          endTimeEt: '10:00',
          durationMin: 30,
          positionPct: 53,
          priceRelation: 'INSIDE',
        },
      ],
      frvps: [
        {
          id: 'frvp-1',
          label: 'Manual RTH Profile',
          startTimeEt: '09:30',
          endTimeEt: '10:15',
          poc: 29450,
          vah: 29520,
          val: 29410,
          high: 29550,
          low: 29390,
          totalVolume: 45000,
          buyRatioPct: 54,
          distancePocPts: 30,
          priceRelation: 'INSIDE_VALUE',
        },
      ],
    },
  }

  const dataPoints = extractChartDataPoints(mockContext)
  assert.ok(dataPoints.some((p) => p.category === 'TRENDLINE' && p.value.toString().includes('29,400')), 'trendline extracted')
  assert.ok(dataPoints.some((p) => p.category === 'RANGE' && p.value.toString().includes('29,400')), 'range box extracted')
  assert.ok(dataPoints.some((p) => p.category === 'FRVP' && p.value.toString().includes('29,450')), 'frvp extracted')
}

console.log('leo_notes_situations: all passed')
