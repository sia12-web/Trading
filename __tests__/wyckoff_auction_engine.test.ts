import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustCandlesForContractRollover,
  analyzeWyckoffSingleTimeframe,
  computeWyckoffSwingStructure,
  evaluateWyckoffMultiTimeframe,
  formatWyckoffMultiTimeframeBriefForLeo,
  generateAndPersistWyckoffReport,
  resetWyckoffAlertDeduplicationCache,
  resolveWyckoffMarketSpec,
  type WyckoffCandle,
} from '../lib/trading/wyckoff'

/**
 * Helper to generate a clean rotational trading range between [100, 120]
 * with realistic bars and volumes so range detection anchors around [100, 120].
 */
function buildRotationalRangeCandles(
  count = 24,
  startTimeSec = 1_729_000_000,
  stepSec = 300
): WyckoffCandle[] {
  const bars: WyckoffCandle[] = []
  let cvd = 0
  for (let i = 0; i < count; i++) {
    // Oscillate smoothly between 100 and 120
    const phase = i % 6
    let open = 110
    let high = 115
    let low = 105
    let close = 110
    if (phase === 0) {
      open = 104
      low = 100
      high = 112
      close = 110
    } else if (phase === 1) {
      open = 110
      low = 108
      high = 119
      close = 117
    } else if (phase === 2) {
      open = 117
      low = 111
      high = 120
      close = 113
    } else if (phase === 3) {
      open = 113
      low = 102
      high = 114
      close = 104
    } else if (phase === 4) {
      open = 104
      low = 100.5
      high = 111
      close = 109
    } else {
      open = 109
      low = 106
      high = 118.5
      close = 114
    }
    const vol = 1000
    const buyVol = close >= open ? 540 : 460
    const sellVol = vol - buyVol
    const delta = buyVol - sellVol
    cvd += delta
    bars.push({
      time: startTimeSec + i * stepSec,
      open,
      high,
      low,
      close,
      volume: vol,
      buyVolume: buyVol,
      sellVolume: sellVol,
      delta,
      cvd,
    })
  }
  return bars
}

test('Market specifications resolve all 5 supported futures markets (NQ, YM, GC, CL, Nikkei)', () => {
  assert.equal(resolveWyckoffMarketSpec('NQ').instrument, 'NASDAQ')
  assert.equal(resolveWyckoffMarketSpec('MNQ').tickSize, 0.25)
  assert.equal(resolveWyckoffMarketSpec('YM').instrument, 'DOW')
  assert.equal(resolveWyckoffMarketSpec('GC').instrument, 'GOLD')
  assert.equal(resolveWyckoffMarketSpec('CL').instrument, 'CRUDE')
  assert.equal(resolveWyckoffMarketSpec('NK225').instrument, 'NIKKEI')
})

test('Causal swing structure never repaints historical confirmedAtTime when future bars arrive', () => {
  const baseBars = buildRotationalRangeCandles(20)
  const snapAt15 = computeWyckoffSwingStructure(baseBars.slice(0, 15), 'NQ', '5m')
  const snapAt20 = computeWyckoffSwingStructure(baseBars, 'NQ', '5m')

  for (const earlySwing of snapAt15.swings) {
    // Confirmed timestamp must strictly be after pivotTime (causal rightBars confirmation)
    assert.ok(
      earlySwing.confirmedAtTime > earlySwing.pivotTime,
      'Swing confirmation must occur strictly after the pivot bar'
    )
    const matching = snapAt20.swings.find((s) => s.pivotTime === earlySwing.pivotTime)
    assert.ok(matching, 'Confirmed swing must persist as new bars arrive')
    assert.equal(
      matching.confirmedAtTime,
      earlySwing.confirmedAtTime,
      'confirmedAtTime must never repaint retroactively'
    )
    assert.equal(matching.price, earlySwing.price)
  }
})

test('Futures contract rollover adjustment removes artificial basis gaps while preserving true bar ranges', () => {
  const raw: WyckoffCandle[] = [
    {
      time: 1000,
      open: 20000,
      high: 20020,
      low: 19990,
      close: 20010,
      volume: 1000,
      contractSymbol: 'NQM6',
    },
    {
      time: 1300,
      open: 20210, // +200 pt quarterly roll premium gap on new contract
      high: 20235,
      low: 20200,
      close: 20225,
      volume: 1100,
      contractSymbol: 'NQZ6',
    },
  ]

  const { candles, rolloverAdjusted } = adjustCandlesForContractRollover(raw)
  assert.equal(rolloverAdjusted, true)
  assert.equal(candles[0]!.close, 20210)
  assert.equal(candles[0]!.high - candles[0]!.low, 30)
  assert.equal(candles[1]!.close, 20225)
})

test('Test A — Bullish absorption vs spring confirmation', () => {
  const rangeBars = buildRotationalRangeCandles(24)
  const lastTime = rangeBars[rangeBars.length - 1]!.time
  const baseCvd = rangeBars[rangeBars.length - 1]!.cvd ?? 0

  // Phase 1: Aggressive selling increases at support (sweep below 100 to 97.5), but downside progress stalls
  const sweepBars: WyckoffCandle[] = [
    ...rangeBars,
    {
      time: lastTime + 300,
      open: 102,
      high: 102.5,
      low: 97.5, // sweeps below 100 support
      close: 99.8, // closes near high of the sweep bar, absorbing massive sell delta
      volume: 3500,
      buyVolume: 800,
      sellVolume: 2700,
      delta: -1900,
      cvd: baseCvd - 1900,
    },
  ]

  const unconfirmedAnalysis = analyzeWyckoffSingleTimeframe({
    candles: sweepBars,
    instrumentRaw: 'GC',
    timeframe: '30m',
  })

  // During the sweep bar itself, absorption is detected or sweep is POTENTIAL/UNCONFIRMED, NOT yet CONFIRMED
  assert.notEqual(
    unconfirmedAnalysis.eventState.confirmationStatus,
    'CONFIRMED',
    'Spring must not be labeled CONFIRMED before structural reclaim and higher-low hold'
  )

  // Phase 2: Price reclaims support (104.5) and holds a higher low retest (102.0 -> 106.5)
  const confirmedSpringBars: WyckoffCandle[] = [
    ...sweepBars,
    {
      time: lastTime + 600,
      open: 99.8,
      high: 105.0,
      low: 99.5,
      close: 104.5, // strong reclaim inside range
      volume: 2800,
      buyVolume: 2000,
      sellVolume: 800,
      delta: 1200,
      cvd: baseCvd - 700,
    },
    {
      time: lastTime + 900,
      open: 104.5,
      high: 107.0,
      low: 102.0, // higher low above 97.5 sweep extreme, holding support
      close: 106.5,
      volume: 1900,
      buyVolume: 1350,
      sellVolume: 550,
      delta: 800,
      cvd: baseCvd + 100,
    },
  ]

  const confirmedAnalysis = analyzeWyckoffSingleTimeframe({
    candles: confirmedSpringBars,
    instrumentRaw: 'GC',
    timeframe: '30m',
  })

  assert.equal(confirmedAnalysis.eventState.candidateEvent, 'SPRING')
  assert.equal(confirmedAnalysis.eventState.confirmationStatus, 'CONFIRMED')
  assert.equal(confirmedAnalysis.monitoringStatus, 'CONFIRMED')
})

test('Test B — Bearish initiative selling invalidates spring hypothesis', () => {
  resetWyckoffAlertDeduplicationCache('CL')
  const rangeBars = buildRotationalRangeCandles(24)
  const lastTime = rangeBars[rangeBars.length - 1]!.time
  const baseCvd = rangeBars[rangeBars.length - 1]!.cvd ?? 0

  // CVD falls and price keeps making sustained lower lows below range low (100)
  const breakdownBars: WyckoffCandle[] = [
    ...rangeBars,
    {
      time: lastTime + 300,
      open: 101,
      high: 101.5,
      low: 95.0,
      close: 95.5,
      volume: 3000,
      buyVolume: 500,
      sellVolume: 2500,
      delta: -2000,
      cvd: baseCvd - 2000,
    },
    {
      time: lastTime + 600,
      open: 95.5,
      high: 96.0,
      low: 89.0,
      close: 89.5,
      volume: 3400,
      buyVolume: 400,
      sellVolume: 3000,
      delta: -2600,
      cvd: baseCvd - 4600,
    },
  ]

  const analysis = analyzeWyckoffSingleTimeframe({
    candles: breakdownBars,
    instrumentRaw: 'CL',
    timeframe: '5m',
  })

  assert.equal(analysis.cvdVolume.condition, 'SUCCESSFUL_BEARISH_INITIATIVE')
  assert.equal(analysis.detectedRange?.classification, 'BREAKDOWN')
  assert.equal(analysis.monitoringStatus, 'INVALIDATED')

  const report = generateAndPersistWyckoffReport(
    {
      instrumentRaw: 'CL',
      m5Candles: breakdownBars,
    },
    { bypassDeduplication: true, persistToDisk: false }
  )
  assert.ok(
    report.alerts.some((a) =>
      a.headline.includes(
        'CL: Selling pressure is achieving fresh downside lows. Spring hypothesis invalidated.'
      )
    ),
    'Should emit exact CL spring invalidation alert'
  )
})

test('Test C — Bearish absorption / Upthrust above resistance', () => {
  resetWyckoffAlertDeduplicationCache('YM')
  const rangeBars = buildRotationalRangeCandles(24, 1_729_000_000, 1800)
  const lastTime = rangeBars[rangeBars.length - 1]!.time
  const baseCvd = rangeBars[rangeBars.length - 1]!.cvd ?? 0

  // Price sweeps above resistance (120 -> 122.8), CVD rises heavily, but price fails to advance and closes back below 120
  const upthrustBars: WyckoffCandle[] = [
    ...rangeBars,
    {
      time: lastTime + 1800,
      open: 118.5,
      high: 122.8, // sweeps above 120 resistance
      low: 117.0,
      close: 117.5, // rejected back inside range
      volume: 3600,
      buyVolume: 2800,
      sellVolume: 800,
      delta: 2000, // heavy buying effort failed to keep price above 120
      cvd: baseCvd + 2000,
    },
    {
      time: lastTime + 3600,
      open: 117.5,
      high: 119.2, // lower high retest below 122.8 sweep extreme
      low: 113.5,
      close: 114.0,
      volume: 2200,
      buyVolume: 700,
      sellVolume: 1500,
      delta: -800,
      cvd: baseCvd + 1200,
    },
  ]

  const report = generateAndPersistWyckoffReport(
    {
      instrumentRaw: 'YM',
      m30Candles: upthrustBars,
    },
    { bypassDeduplication: true, persistToDisk: false }
  )

  assert.equal(report.m30.eventState.candidateEvent, 'UPTHRUST')
  assert.ok(
    report.m30.eventState.lifecycleStage === 'RETURN_INSIDE' ||
      report.m30.eventState.lifecycleStage === 'CONFIRMED'
  )
  assert.ok(
    report.alerts.some((a) =>
      a.headline.includes('YM: Resistance swept; price returned below the range.')
    ),
    'Should emit YM Upthrust alert'
  )
})

test('Test D — Bullish breakout acceptance (SOS -> LPS retest holds above resistance)', () => {
  const rangeBars = buildRotationalRangeCandles(24, 1_729_000_000, 1800)
  const lastTime = rangeBars[rangeBars.length - 1]!.time
  const baseCvd = rangeBars[rangeBars.length - 1]!.cvd ?? 0

  // Price breaks convincingly above 120 resistance to 128, then retests 120.5 and holds at 129.5
  const breakoutBars: WyckoffCandle[] = [
    ...rangeBars,
    {
      time: lastTime + 1800,
      open: 118,
      high: 128.5,
      low: 118,
      close: 127.5, // decisive breakout above 120
      volume: 3200,
      buyVolume: 2500,
      sellVolume: 700,
      delta: 1800,
      cvd: baseCvd + 1800,
    },
    {
      time: lastTime + 3600,
      open: 127.5,
      high: 130.0,
      low: 120.2, // successful retest of former resistance (120) as support (LPS)
      close: 129.2,
      volume: 2400,
      buyVolume: 1700,
      sellVolume: 700,
      delta: 1000,
      cvd: baseCvd + 2800,
    },
  ]

  const analysis = analyzeWyckoffSingleTimeframe({
    candles: breakoutBars,
    instrumentRaw: 'NQ',
    timeframe: '30m',
  })

  assert.equal(analysis.eventState.candidateEvent, 'BREAKOUT_RETEST')
  assert.equal(analysis.eventState.confirmationStatus, 'CONFIRMED')
  assert.equal(analysis.detectedRange?.classification, 'BREAKOUT')
})

test('Test E — Volatility contraction in balance remains BALANCE / UNDETERMINED, not confident accumulation', () => {
  const baseBars = buildRotationalRangeCandles(18, 1_729_000_000, 1800)
  const lastTime = baseBars[baseBars.length - 1]!.time

  // Append quiet, low-ATR bars near the middle of the range (108-112) with balanced delta
  const quietBars: WyckoffCandle[] = [...baseBars]
  for (let i = 1; i <= 6; i++) {
    quietBars.push({
      time: lastTime + i * 1800,
      open: 109.5,
      high: 111.0,
      low: 108.5,
      close: 110.0,
      volume: 600,
      buyVolume: 300,
      sellVolume: 300,
      delta: 0,
      cvd: 0,
    })
  }

  const analysis = analyzeWyckoffSingleTimeframe({
    candles: quietBars,
    instrumentRaw: 'NQ',
    timeframe: '30m',
  })

  assert.equal(analysis.atrRegime.atrTrend, 'CONTRACTING')
  assert.ok(
    analysis.detectedRange?.classification === 'BALANCE' ||
      analysis.detectedRange?.classification === 'UNDETERMINED',
    `Expected BALANCE or UNDETERMINED on contracting ATR without absorption/reclaim, got ${analysis.detectedRange?.classification}`
  )
})

test('Test F — Multi-timeframe conflict: 5m spring against bearish 1D and 30m context', () => {
  resetWyckoffAlertDeduplicationCache('NK225')

  // Bearish 1D and 30m series (sustained lower lows / breakdown)
  const d1RangeBars = buildRotationalRangeCandles(16, 1_720_000_000, 86400)
  const d1LastTime = d1RangeBars[d1RangeBars.length - 1]!.time
  const bearishDailyBars: WyckoffCandle[] = [
    ...d1RangeBars,
    {
      time: d1LastTime + 86400,
      open: 101,
      high: 101.5,
      low: 93,
      close: 93.5,
      volume: 3000,
      buyVolume: 400,
      sellVolume: 2600,
      delta: -2200,
      cvd: -2200,
    },
    {
      time: d1LastTime + 172800,
      open: 93.5,
      high: 94.0,
      low: 86,
      close: 86.5,
      volume: 3500,
      buyVolume: 500,
      sellVolume: 3000,
      delta: -2500,
      cvd: -4700,
    },
  ]

  const m30RangeBars = buildRotationalRangeCandles(24, 1_729_000_000, 1800)
  const m30LastTime = m30RangeBars[m30RangeBars.length - 1]!.time
  const bearishM30Bars: WyckoffCandle[] = [
    ...m30RangeBars,
    {
      time: m30LastTime + 1800,
      open: 101,
      high: 101.5,
      low: 93,
      close: 93.5,
      volume: 3000,
      buyVolume: 400,
      sellVolume: 2600,
      delta: -2200,
      cvd: -2200,
    },
    {
      time: m30LastTime + 3600,
      open: 93.5,
      high: 94.0,
      low: 86,
      close: 86.5,
      volume: 3500,
      buyVolume: 500,
      sellVolume: 3000,
      delta: -2500,
      cvd: -4700,
    },
  ]

  // Bullish 5m confirmed spring series
  const rangeBars = buildRotationalRangeCandles(24, 1_729_000_000, 300)
  const lastTime = rangeBars[rangeBars.length - 1]!.time
  const m5SpringBars: WyckoffCandle[] = [
    ...rangeBars,
    {
      time: lastTime + 300,
      open: 101,
      high: 104.5,
      low: 97.5, // sweeps 100
      close: 104.0, // reclaims inside
      volume: 2900,
      buyVolume: 1900,
      sellVolume: 1000,
      delta: 900,
      cvd: 900,
    },
    {
      time: lastTime + 600,
      open: 104.0,
      high: 107.0,
      low: 101.8, // higher low retest
      close: 106.5,
      volume: 2100,
      buyVolume: 1500,
      sellVolume: 600,
      delta: 900,
      cvd: 1800,
    },
  ]

  const report = generateAndPersistWyckoffReport(
    {
      instrumentRaw: 'NK225',
      dailyCandles: bearishDailyBars,
      m30Candles: bearishM30Bars,
      m5Candles: m5SpringBars,
    },
    { bypassDeduplication: true, persistToDisk: false }
  )

  assert.equal(report.m5.eventState.candidateEvent, 'SPRING')
  assert.equal(
    report.hierarchySynthesis.alignmentStatus,
    'COUNTERTREND_5M_BULLISH_VS_HTF_BEARISH'
  )
  assert.equal(report.hierarchySynthesis.isCountertrend5m, true)
  assert.ok(report.hierarchySynthesis.explicitConflicts.length > 0)
  assert.ok(
    report.alerts.some(
      (a) =>
        a.headline === 'Nikkei: 5m spring reclaim confirmed, but 30m remains bearish.'
    ),
    'Should emit exact Nikkei countertrend spring alert'
  )

  // Verify alert deduplication on a second identical evaluation
  const secondReport = generateAndPersistWyckoffReport(
    {
      instrumentRaw: 'NK225',
      dailyCandles: bearishDailyBars,
      m30Candles: bearishM30Bars,
      m5Candles: m5SpringBars,
    },
    { persistToDisk: false }
  )
  assert.equal(
    secondReport.alerts.length,
    0,
    'Unchanged market state must not emit duplicate alerts'
  )

  // Verify brief formatting for Chart Leo
  const brief = formatWyckoffMultiTimeframeBriefForLeo(report)
  assert.ok(brief.includes('COUNTERTREND_5M_BULLISH_VS_HTF_BEARISH'))
  assert.ok(brief.includes('Self-Challenge'))
})
