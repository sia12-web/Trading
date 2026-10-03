/**
 * Abnormal news reaction bar detection and sentence badge tests.
 * Verifies Gold, Crude Oil, Nasdaq, and Dow across different timeframes.
 * Run: npx tsx __tests__/news_reaction_bars.test.ts
 */
import assert from 'node:assert/strict'
import {
  detectEmotionalNewsMoves,
  isEventDomesticToInstrument,
  type ExcessBar,
  type CalendarEventParam,
} from '../lib/chart/excesses'

// 1. Verify Domestic Event Recognition for Gold, Crude Oil, Nasdaq, Dow
{
  assert.equal(isEventDomesticToInstrument('US', 'CPI m/m', 'GOLD'), true)
  assert.equal(isEventDomesticToInstrument('US', 'FOMC Rate Decision', 'GOLD'), true)
  assert.equal(isEventDomesticToInstrument('US', 'Non-Farm Payrolls', 'NASDAQ'), true)
  assert.equal(isEventDomesticToInstrument('US', 'Retail Sales m/m', 'DOW'), true)
  assert.equal(isEventDomesticToInstrument('US', 'EIA Crude Oil Inventories', 'CRUDE'), true)
  assert.equal(isEventDomesticToInstrument('US', 'API Weekly Crude Oil Stock', 'OIL'), true)
}

// 2. 5-Minute Chart News Move (3 bars) on Nasdaq
{
  const baseTime = 1727784000 // 08:00 AM UTC
  const bars: ExcessBar[] = []
  // 10 pre-news calm bars (avg range ~10 pts)
  for (let i = 0; i < 10; i++) {
    const t = baseTime + i * 300
    bars.push({
      time: t,
      open: 19800 + i * 2,
      high: 19808 + i * 2,
      low: 19798 + i * 2,
      close: 19804 + i * 2,
      volume: 500,
    })
  }

  // Bar 10: CPI release at 08:30 (time = baseTime + 3000)
  // 3-bar abnormal bullish surge: +55 pts
  bars.push({
    time: baseTime + 10 * 300,
    open: 19820,
    high: 19855,
    low: 19818,
    close: 19850,
    volume: 3500,
  })
  bars.push({
    time: baseTime + 11 * 300,
    open: 19850,
    high: 19875,
    low: 19845,
    close: 19870,
    volume: 2800,
  })
  bars.push({
    time: baseTime + 12 * 300,
    open: 19870,
    high: 19880,
    low: 19860,
    close: 19875,
    volume: 1800,
  })

  // Post-news bars
  for (let i = 13; i < 20; i++) {
    const t = baseTime + i * 300
    bars.push({
      time: t,
      open: 19875,
      high: 19882,
      low: 19868,
      close: 19872,
      volume: 600,
    })
  }

  const events: CalendarEventParam[] = [
    {
      time: baseTime + 10 * 300,
      event: 'Core CPI m/m',
      impact: 'High',
      country: 'US',
    },
  ]

  const moves = detectEmotionalNewsMoves(bars, events, 'NASDAQ', undefined, undefined, false)
  assert.equal(moves.length, 1, 'Should detect Nasdaq CPI move')
  const m = moves[0]!
  assert.equal(m.direction, 'BULLISH_DRIVE')
  assert.equal(m.barCount, 3, 'Should span 3 bars on 5m chart')
  assert.ok(m.moveRange >= 50, 'Move range >= 50 pts')
  assert.ok(m.headlineSentence?.includes('Core CPI'), 'Headline sentence must mention CPI')
  assert.ok(m.headlineSentence?.includes('Surge'), 'Headline sentence must mention Surge')
  assert.ok(m.headlineSentence?.includes('3 bars'), 'Headline sentence must mention 3 bars')
}

// 3. 30-Minute Chart News Move (2 bars) on Gold
{
  const baseTime = 1727784000 // 30m bars = 1800s
  const bars: ExcessBar[] = []
  // Pre-news calm bars (avg range ~2 pts on Gold)
  for (let i = 0; i < 8; i++) {
    const t = baseTime + i * 1800
    bars.push({
      time: t,
      open: 2650.0 + i * 0.5,
      high: 2652.0 + i * 0.5,
      low: 2649.5 + i * 0.5,
      close: 2651.0 + i * 0.5,
      volume: 1200,
    })
  }

  // News at bar 8 (30m bar containing event)
  // Gold abnormal flush: -14.5 pts
  bars.push({
    time: baseTime + 8 * 1800,
    open: 2655.0,
    high: 2656.0,
    low: 2644.0,
    close: 2645.0,
    volume: 5200,
  })
  bars.push({
    time: baseTime + 9 * 1800,
    open: 2645.0,
    high: 2646.0,
    low: 2640.5,
    close: 2641.5,
    volume: 4100,
  })
  // Subsequent bars
  for (let i = 10; i < 16; i++) {
    const t = baseTime + i * 1800
    bars.push({
      time: t,
      open: 2642.0,
      high: 2644.0,
      low: 2640.0,
      close: 2643.0,
      volume: 1100,
    })
  }

  const events: CalendarEventParam[] = [
    {
      time: baseTime + 8 * 1800 + 300, // 5 min inside the 30m candle
      event: 'Non-Farm Payrolls',
      impact: 'High',
      country: 'US',
    },
  ]

  const moves = detectEmotionalNewsMoves(bars, events, 'GOLD', undefined, undefined, false)
  assert.equal(moves.length, 1, 'Should detect Gold NFP move on 30m bars')
  const m = moves[0]!
  assert.equal(m.direction, 'BEARISH_DRIVE')
  assert.equal(m.barCount, 2, 'Should span 2 bars on 30m chart')
  assert.ok(m.moveRange >= 14, 'Move range >= 14 pts')
  assert.ok(m.headlineSentence?.includes('Non-Farm Payrolls'), 'Headline sentence must mention NFP')
  assert.ok(m.headlineSentence?.includes('Flush'), 'Headline sentence must mention Flush')
  assert.ok(m.headlineSentence?.includes('2 bars'), 'Headline sentence must mention 2 bars')
}

// 4. Crude Oil EIA Inventories Move (2 bars) on Crude Oil
{
  const baseTime = 1727784000
  const bars: ExcessBar[] = []
  // Pre-news calm bars (avg range ~0.20 pts on CL)
  for (let i = 0; i < 10; i++) {
    const t = baseTime + i * 300
    bars.push({
      time: t,
      open: 71.20,
      high: 71.35,
      low: 71.15,
      close: 71.25,
      volume: 800,
    })
  }

  // EIA Inventories at 10:30 (bar 10)
  // Abnormal move: 1.40 pts
  bars.push({
    time: baseTime + 10 * 300,
    open: 71.25,
    high: 72.40,
    low: 71.20,
    close: 72.30,
    volume: 6500,
  })
  bars.push({
    time: baseTime + 11 * 300,
    open: 72.30,
    high: 72.65,
    low: 72.15,
    close: 72.55,
    volume: 4200,
  })
  bars.push({
    time: baseTime + 12 * 300,
    open: 72.55,
    high: 72.60,
    low: 72.35,
    close: 72.45,
    volume: 2100,
  })

  for (let i = 13; i < 20; i++) {
    bars.push({
      time: baseTime + i * 300,
      open: 72.45,
      high: 72.55,
      low: 72.35,
      close: 72.40,
      volume: 900,
    })
  }

  const events: CalendarEventParam[] = [
    {
      time: baseTime + 10 * 300,
      event: 'EIA Crude Oil Inventories',
      impact: 'High',
      country: 'US',
    },
  ]

  const moves = detectEmotionalNewsMoves(bars, events, 'CRUDE', undefined, undefined, false)
  assert.equal(moves.length, 1, 'Should detect Crude Oil EIA move')
  const m = moves[0]!
  assert.equal(m.direction, 'BULLISH_DRIVE')
  assert.ok(m.moveRange >= 1.2, 'Move range >= 1.2 pts')
  assert.ok(m.headlineSentence?.includes('EIA Crude Oil Inventories'), 'Sentence mentions EIA')
  assert.ok(m.headlineSentence?.includes('Surge'), 'Sentence mentions Surge')
}

// 5. Unscheduled Volatility Spike Detection
{
  const baseTime = 1727784000
  const bars: ExcessBar[] = []
  for (let i = 0; i < 10; i++) {
    bars.push({
      time: baseTime + i * 300,
      open: 42500,
      high: 42520,
      low: 42490,
      close: 42505,
      volume: 400,
    })
  }

  // Unscheduled breaking spike on Dow (+85 pts)
  bars.push({
    time: baseTime + 10 * 300,
    open: 42505,
    high: 42590,
    low: 42500,
    close: 42585,
    volume: 2500,
  })
  bars.push({
    time: baseTime + 11 * 300,
    open: 42585,
    high: 42600,
    low: 42570,
    close: 42580,
    volume: 1400,
  })

  for (let i = 12; i < 18; i++) {
    bars.push({
      time: baseTime + i * 300,
      open: 42580,
      high: 42595,
      low: 42570,
      close: 42585,
      volume: 500,
    })
  }

  const moves = detectEmotionalNewsMoves(bars, [], 'DOW', undefined, undefined, true)
  assert.equal(moves.length, 1, 'Should detect unscheduled spike on Dow')
  const m = moves[0]!
  assert.ok(m.moveRange >= 80, 'Spike range >= 80 pts')
  assert.ok(m.headlineSentence?.includes('Volatility Spike'), 'Headline sentence must mention Volatility Spike')
}

console.log('news_reaction_bars: all tests passed!')
