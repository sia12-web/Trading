import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  computeRangeVolumeMetrics,
  compareTwoRanges,
  compareMultipleRanges,
  formatRangeVolumeComparisonReport,
  type RangeCandleBar,
} from '../lib/trading/rangeVolumeComparison'
import {
  buildLeoSystemPrompt,
  extractChartDataPoints,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'
import { buildDeskFallbackResponse } from '../app/api/trading/leo/chat/route'

describe('Range Volume Comparison & Support/Resistance Readiness Tests', () => {
  const baseTime = 1770000000

  // Mock 5m candle bars (each bar 300s)
  const mockCandles: RangeCandleBar[] = [
    // Range 1 bars (10 bars = 50 mins): Heavy volume consolidation around 20,000 - 20,050
    { time: baseTime + 0, open: 20010, high: 20040, low: 20005, close: 20035, volume: 2500 },
    { time: baseTime + 300, open: 20035, high: 20050, low: 20020, close: 20025, volume: 3000 },
    { time: baseTime + 600, open: 20025, high: 20045, low: 20015, close: 20040, volume: 2200 },
    { time: baseTime + 900, open: 20040, high: 20048, low: 20010, close: 20015, volume: 2800 },
    { time: baseTime + 1200, open: 20015, high: 20030, low: 20000, close: 20020, volume: 2000 },
    { time: baseTime + 1500, open: 20020, high: 20045, low: 20015, close: 20042, volume: 2500 },
    { time: baseTime + 1800, open: 20042, high: 20050, low: 20025, close: 20030, volume: 2100 },
    { time: baseTime + 2100, open: 20030, high: 20040, low: 20010, close: 20015, volume: 1900 },
    { time: baseTime + 2400, open: 20015, high: 20035, low: 20005, close: 20032, volume: 2400 },
    { time: baseTime + 2700, open: 20032, high: 20045, low: 20020, close: 20025, volume: 2600 },

    // Middle bars: expansion upward
    { time: baseTime + 3000, open: 20030, high: 20080, low: 20028, close: 20075, volume: 4000 },
    { time: baseTime + 3300, open: 20075, high: 20110, low: 20070, close: 20105, volume: 4500 },

    // Range 2 bars (10 bars = 50 mins): Low volume retest around 20,090 - 20,120
    { time: baseTime + 3600, open: 20105, high: 20115, low: 20095, close: 20110, volume: 800 },
    { time: baseTime + 3900, open: 20110, high: 20120, low: 20100, close: 20102, volume: 900 },
    { time: baseTime + 4200, open: 20102, high: 20118, low: 20092, close: 20112, volume: 750 },
    { time: baseTime + 4500, open: 20112, high: 20122, low: 20105, close: 20108, volume: 850 },
    { time: baseTime + 4800, open: 20108, high: 20115, low: 20090, close: 20095, volume: 600 },
    { time: baseTime + 5100, open: 20095, high: 20110, low: 20090, close: 20105, volume: 700 },
    { time: baseTime + 5400, open: 20105, high: 20125, low: 20100, close: 20115, volume: 950 },
    { time: baseTime + 5700, open: 20115, high: 20120, low: 20095, close: 20098, volume: 800 },
    { time: baseTime + 6000, open: 20098, high: 20112, low: 20092, close: 20108, volume: 720 },
    { time: baseTime + 6300, open: 20108, high: 20118, low: 20095, close: 20100, volume: 650 },
  ]

  it('computes range volume metrics with duration, rate per min, and delta', () => {
    const range1 = computeRangeVolumeMetrics(
      { time: baseTime, price: 20000 },
      { time: baseTime + 2700, price: 20050 },
      mockCandles,
      20030,
      'Support Base Range',
      'range-1'
    )

    assert.strictEqual(range1.id, 'range-1')
    assert.strictEqual(range1.label, 'Support Base Range')
    assert.strictEqual(range1.priceLow, 20000)
    assert.strictEqual(range1.priceHigh, 20050)
    assert.strictEqual(range1.durationMin, 45)
    assert.ok(range1.totalVolume > 20000, `Expected totalVolume > 20000, got ${range1.totalVolume}`)
    assert.ok(range1.volumeRatePerMin > 0)
    assert.ok(range1.buyVolume > 0)
    assert.ok(range1.sellVolume > 0)
    assert.ok(range1.buyRatioPct > 0 && range1.buyRatioPct < 100)
  })

  it('correctly compares two ranges when volume decreased and identifies Good Support & Good Resistance', () => {
    const range1 = computeRangeVolumeMetrics(
      { time: baseTime, price: 20000 },
      { time: baseTime + 2700, price: 20050 },
      mockCandles,
      20100,
      'Range 1 (Initial Base)',
      'r1'
    )

    const range2 = computeRangeVolumeMetrics(
      { time: baseTime + 3600, price: 20090 },
      { time: baseTime + 6300, price: 20120 },
      mockCandles,
      20100,
      'Range 2 (High Retest)',
      'r2'
    )

    const comp = compareTwoRanges(range1, range2, 20100)

    assert.strictEqual(comp.volumeTrend, 'DECREASED')
    assert.ok(comp.volumeChangePct < -50, `Expected volumeChangePct < -50%, got ${comp.volumeChangePct}%`)
    assert.strictEqual(comp.rateTrend, 'DECREASED')

    // Decreased volume into higher range = supply exhaustion at floor / buyer exhaustion at ceiling
    assert.strictEqual(comp.supportReadiness.classification, 'GOOD_SUPPORT')
    assert.ok(comp.supportReadiness.label.includes('GOOD SUPPORT'))
    assert.strictEqual(comp.resistanceReadiness.classification, 'GOOD_RESISTANCE')
    assert.ok(comp.resistanceReadiness.label.includes('GOOD RESISTANCE'))
  })

  it('identifies Bad Support when volume surges on aggressive seller delta', () => {
    const rA: any = {
      id: 'ra',
      label: 'Prior Support Shelf',
      priceLow: 29000,
      priceHigh: 29050,
      midPrice: 29025,
      heightPts: 50,
      timeStart: 1000,
      timeEnd: 3000,
      startTimeEt: '09:30 ET',
      endTimeEt: '10:00 ET',
      durationMin: 30,
      totalVolume: 10000,
      inRangeVolume: 9000,
      volumeRatePerMin: 333,
      buyVolume: 5500,
      sellVolume: 4500,
      delta: 1000,
      buyRatioPct: 55,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const rB: any = {
      id: 'rb',
      label: 'Support Breakdown Attempt',
      priceLow: 28980,
      priceHigh: 29030,
      midPrice: 29005,
      heightPts: 50,
      timeStart: 4000,
      timeEnd: 6000,
      startTimeEt: '10:15 ET',
      endTimeEt: '10:45 ET',
      durationMin: 30,
      totalVolume: 22000, // +120% surge
      inRangeVolume: 21000,
      volumeRatePerMin: 733,
      buyVolume: 5000,
      sellVolume: 17000, // Heavy selling: 23% buy
      delta: -12000,
      buyRatioPct: 23,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const comp = compareTwoRanges(rA, rB, 29000)

    assert.strictEqual(comp.volumeTrend, 'INCREASED')
    assert.strictEqual(comp.supportReadiness.classification, 'BAD_SUPPORT')
    assert.ok(comp.supportReadiness.label.includes('BAD / VULNERABLE SUPPORT'))
  })

  it('identifies Bad Resistance when volume surges on aggressive buyer delta', () => {
    const rA: any = {
      id: 'ra',
      label: 'Initial Ceiling',
      priceLow: 29100,
      priceHigh: 29150,
      midPrice: 29125,
      heightPts: 50,
      timeStart: 1000,
      timeEnd: 3000,
      startTimeEt: '09:30 ET',
      endTimeEt: '10:00 ET',
      durationMin: 30,
      totalVolume: 12000,
      inRangeVolume: 11000,
      volumeRatePerMin: 400,
      buyVolume: 6000,
      sellVolume: 6000,
      delta: 0,
      buyRatioPct: 50,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const rB: any = {
      id: 'rb',
      label: 'Ceiling Retest Push',
      priceLow: 29120,
      priceHigh: 29170,
      midPrice: 29145,
      heightPts: 50,
      timeStart: 4000,
      timeEnd: 6000,
      startTimeEt: '10:15 ET',
      endTimeEt: '10:45 ET',
      durationMin: 30,
      totalVolume: 26000, // +116% surge
      inRangeVolume: 25000,
      volumeRatePerMin: 866,
      buyVolume: 19500, // 75% buy
      sellVolume: 6500,
      delta: 13000,
      buyRatioPct: 75,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const comp = compareTwoRanges(rA, rB, 29140)

    assert.strictEqual(comp.volumeTrend, 'INCREASED')
    assert.strictEqual(comp.resistanceReadiness.classification, 'BAD_RESISTANCE')
    assert.ok(comp.resistanceReadiness.label.includes('BAD / VULNERABLE RESISTANCE'))
  })

  it('formats range volume comparison report cleanly in markdown', () => {
    const rA: any = {
      id: 'ra',
      label: 'Range 1',
      priceLow: 20000,
      priceHigh: 20050,
      midPrice: 20025,
      heightPts: 50,
      timeStart: 1000,
      timeEnd: 3000,
      startTimeEt: '09:30 ET',
      endTimeEt: '10:00 ET',
      durationMin: 30,
      totalVolume: 15000,
      inRangeVolume: 14000,
      volumeRatePerMin: 500,
      buyVolume: 8000,
      sellVolume: 7000,
      delta: 1000,
      buyRatioPct: 53,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const rB: any = {
      id: 'rb',
      label: 'Range 2',
      priceLow: 20040,
      priceHigh: 20090,
      midPrice: 20065,
      heightPts: 50,
      timeStart: 4000,
      timeEnd: 6000,
      startTimeEt: '10:15 ET',
      endTimeEt: '10:45 ET',
      durationMin: 30,
      totalVolume: 7500,
      inRangeVolume: 7000,
      volumeRatePerMin: 250,
      buyVolume: 3500,
      sellVolume: 4000,
      delta: -500,
      buyRatioPct: 47,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const comps = compareMultipleRanges([rA, rB], 20070)
    assert.strictEqual(comps.length, 1)

    const report = formatRangeVolumeComparisonReport(comps)
    assert.ok(report.includes('Range 1 vs. Range 2'))
    assert.ok(report.includes('Volume Change:'))
    assert.ok(report.includes('Support Readiness Assessment:'))
    assert.ok(report.includes('Resistance Readiness Assessment:'))
  })

  it('Leo buildDeskFallbackResponse answers the user prompt "leo compare the volume traded in these ranges"', () => {
    const rA: any = {
      id: 'ra',
      label: 'Morning Range 1',
      priceLow: 21500,
      priceHigh: 21550,
      midPrice: 21525,
      heightPts: 50,
      timeStart: 1000,
      timeEnd: 3000,
      startTimeEt: '09:30 ET',
      endTimeEt: '10:00 ET',
      durationMin: 30,
      totalVolume: 20000,
      inRangeVolume: 19000,
      volumeRatePerMin: 666.7,
      buyVolume: 11000,
      sellVolume: 9000,
      delta: 2000,
      buyRatioPct: 55,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const rB: any = {
      id: 'rb',
      label: 'Retest Range 2',
      priceLow: 21520,
      priceHigh: 21570,
      midPrice: 21545,
      heightPts: 50,
      timeStart: 4000,
      timeEnd: 6000,
      startTimeEt: '10:15 ET',
      endTimeEt: '10:45 ET',
      durationMin: 30,
      totalVolume: 10000, // 50% decrease
      inRangeVolume: 9500,
      volumeRatePerMin: 333.3,
      buyVolume: 4800,
      sellVolume: 5200,
      delta: -400,
      buyRatioPct: 48,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const comps = compareMultipleRanges([rA, rB], 21540)

    const ctx: LeoChatContext = {
      instrument: 'NASDAQ',
      currentPrice: 21540,
      currentTimeEt: '10:50 AM ET',
      dayType: 'Normal Variation',
      openingType: 'Open Auction',
      activeExcesses: [],
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      userDrawings: {
        trendlines: [],
        ranges: [rA, rB],
        frvps: [],
      },
      rangeComparisons: comps,
    }

    const response = buildDeskFallbackResponse(
      [{ role: 'user', content: 'leo compare the volume traded in these ranges' }],
      ctx
    )

    assert.ok(response.includes('Range Volume Comparison'))
    assert.ok(response.includes('Morning Range 1 vs. Retest Range 2'))
    assert.ok(response.includes('GOOD SUPPORT'))
    assert.ok(response.includes('GOOD RESISTANCE'))
    assert.ok(response.includes('Institutional Desk Readiness Directives'))
  })

  it('buildLeoSystemPrompt includes section 5g and range volume comparison matrix', () => {
    const rA: any = {
      id: 'ra',
      label: 'Base 1',
      priceLow: 44000,
      priceHigh: 44050,
      midPrice: 44025,
      heightPts: 50,
      timeStart: 1000,
      timeEnd: 3000,
      startTimeEt: '09:30 ET',
      endTimeEt: '10:00 ET',
      durationMin: 30,
      totalVolume: 15000,
      inRangeVolume: 14000,
      volumeRatePerMin: 500,
      buyVolume: 8000,
      sellVolume: 7000,
      delta: 1000,
      buyRatioPct: 53,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const rB: any = {
      id: 'rb',
      label: 'Base 2',
      priceLow: 44030,
      priceHigh: 44080,
      midPrice: 44055,
      heightPts: 50,
      timeStart: 4000,
      timeEnd: 6000,
      startTimeEt: '10:15 ET',
      endTimeEt: '10:45 ET',
      durationMin: 30,
      totalVolume: 8000,
      inRangeVolume: 7500,
      volumeRatePerMin: 266.7,
      buyVolume: 4000,
      sellVolume: 4000,
      delta: 0,
      buyRatioPct: 50,
      candleCount: 6,
      priceRelation: 'INSIDE',
      positionPct: 50,
    }

    const comps = compareMultipleRanges([rA, rB], 44060)

    const ctx: LeoChatContext = {
      instrument: 'DOW',
      currentPrice: 44060,
      currentTimeEt: '10:50 AM ET',
      dayType: 'Neutral Day',
      openingType: 'Open Auction',
      activeExcesses: [],
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      userDrawings: {
        trendlines: [],
        ranges: [rA, rB],
        frvps: [],
      },
      rangeComparisons: comps,
    }

    const prompt = buildLeoSystemPrompt(ctx)
    assert.ok(prompt.includes('5g. RANGE & LEVEL VOLUME COMPARISONS & SUPPORT/RESISTANCE READINESS'))
    assert.ok(prompt.includes('GOOD SUPPORT'))
    assert.ok(prompt.includes('GOOD RESISTANCE'))
    assert.ok(prompt.includes('[RANGE & LEVEL VOLUME COMPARISON MATRIX]'))
    assert.ok(prompt.includes('Base 1 vs. Base 2'))

    const points = extractChartDataPoints(ctx)
    const compPoint = points.find((p) => p.id.startsWith('range-comp'))
    assert.ok(compPoint, 'Expected range comparison data point chip to be extracted')
    assert.ok(compPoint.label.includes('Base 1 vs Base 2'))
  })
})
