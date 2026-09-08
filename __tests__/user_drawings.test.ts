import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCustomFixedRangeVolumeProfile,
  computeTrendlineMetrics,
  computeRangeMetrics,
  formatEtTime,
} from '../lib/trading/userDrawings'
import {
  extractChartDataPoints,
  buildLeoSystemPrompt,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'

describe('User Drawings: Calculations and Metrics', () => {
  it('computes trendline metrics accurately (ascending)', () => {
    const t0 = 1700000000
    const t1 = t0 + 600 // 10 minutes = 2 five-minute bars
    const p1 = { time: t0, price: 40000 }
    const p2 = { time: t1, price: 40100 } // +100 pts over 10 min = 10 pts/min = 50 pts / 5m

    const curTime = t1 + 300 // 5 min later
    const curPrice = 40160 // projected should be 40150, so price is 10 pts above

    const metrics = computeTrendlineMetrics(p1, p2, curPrice, curTime)

    assert.equal(metrics.direction, 'ASCENDING')
    assert.equal(metrics.slopePtsPerMin, 10)
    assert.equal(metrics.slopePtsPer5mBar, 50)
    assert.equal(metrics.projectedPrice, 40150)
    assert.equal(metrics.distancePts, 10)
    assert.equal(metrics.priceRelation, 'ABOVE')
  })

  it('computes trendline metrics accurately (descending and testing)', () => {
    const t0 = 1700000000
    const t1 = t0 + 300
    const p1 = { time: t0, price: 20000 }
    const p2 = { time: t1, price: 19950 } // -50 pts over 5 min = -10 pts/min

    const curTime = t1
    const curPrice = 19951 // within 2 pts of 19950 -> TESTING

    const metrics = computeTrendlineMetrics(p1, p2, curPrice, curTime)

    assert.equal(metrics.direction, 'DESCENDING')
    assert.equal(metrics.slopePtsPerMin, -10)
    assert.equal(metrics.projectedPrice, 19950)
    assert.equal(metrics.priceRelation, 'TESTING')
  })

  it('computes range box metrics accurately (inside, above, below)', () => {
    const t0 = 1700000000
    const t1 = t0 + 3600 // 60 minutes
    const p1 = { time: t0, price: 43000 }
    const p2 = { time: t1, price: 43200 }

    // Inside range at 43100 (midpoint)
    const mInside = computeRangeMetrics(p1, p2, 43100)
    assert.equal(mInside.priceHigh, 43200)
    assert.equal(mInside.priceLow, 43000)
    assert.equal(mInside.midPrice, 43100)
    assert.equal(mInside.heightPts, 200)
    assert.equal(mInside.durationMin, 60)
    assert.equal(mInside.priceRelation, 'INSIDE')
    assert.equal(mInside.positionPct, 50)

    // Above range
    const mAbove = computeRangeMetrics(p1, p2, 43250)
    assert.equal(mAbove.priceRelation, 'ABOVE')

    // Below range
    const mBelow = computeRangeMetrics(p1, p2, 42950)
    assert.equal(mBelow.priceRelation, 'BELOW')
  })

  it('computes custom Fixed Range Volume Profile (FRVP) correctly', () => {
    const bars = [
      { time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
      { time: 1300, open: 105, high: 120, low: 100, close: 115, volume: 2000 },
      { time: 1600, open: 115, high: 118, low: 108, close: 110, volume: 500 },
    ]

    const frvp = computeCustomFixedRangeVolumeProfile(bars, 900, 1500)
    assert.ok(frvp)
    assert.ok(frvp.totalVolume > 0)
    assert.ok(frvp.bins.length > 0)
    assert.ok(frvp.poc >= 90 && frvp.poc <= 120)
    assert.ok(frvp.val <= frvp.poc)
    assert.ok(frvp.vah >= frvp.poc)
    assert.ok(frvp.buyVolume >= 0)
  })

  it('formats ET timestamps properly', () => {
    const formatted = formatEtTime(1700000000)
    assert.ok(formatted.includes('ET'))
    assert.ok(formatted.includes(':'))
  })
})

describe('User Drawings: Leo AI Integration', () => {
  const baseContext: LeoChatContext = {
    instrument: 'MYM',
    currentPrice: 44000,
    currentTimeEt: '10:15:00 AM ET',
    rthSession: true,
    dayType: 'Normal Variation Day of Buyer Control',
    openingType: 'Open-Drive',
    activeExcesses: [],
    recentNews: [],
    userDrawings: {
      trendlines: [
        {
          id: 'tl-1',
          label: 'Bullish Support TL',
          startPrice: 43800,
          endPrice: 43950,
          startTimeEt: '09:30 AM ET',
          endTimeEt: '10:00 AM ET',
          slopePtsPerMin: 5,
          slopePtsPer5mBar: 25,
          slopeDirection: 'ASCENDING',
          projectedPrice: 44025,
          distancePts: 25,
          priceRelation: 'BELOW',
        },
      ],
      ranges: [
        {
          id: 'range-1',
          label: 'Morning Consolidation',
          priceHigh: 44100,
          priceLow: 43900,
          midPrice: 44000,
          heightPts: 200,
          startTimeEt: '09:30 AM ET',
          endTimeEt: '10:15 AM ET',
          durationMin: 45,
          positionPct: 50,
          priceRelation: 'INSIDE',
        },
      ],
      frvps: [
        {
          id: 'frvp-1',
          label: 'Opening Swing FRVP',
          poc: 44020,
          vah: 44080,
          val: 43940,
          high: 44100,
          low: 43900,
          totalVolume: 45000,
          buyRatioPct: 58,
          distancePocPts: 20,
          priceRelation: 'INSIDE_VALUE',
          startTimeEt: '09:30 AM ET',
          endTimeEt: '10:15 AM ET',
        },
      ],
    },
  }

  it('extracts interactive chips for user drawings', () => {
    const chips = extractChartDataPoints(baseContext)
    const tlChip = chips.find((c) => c.category === 'TRENDLINE')
    const rangeChip = chips.find((c) => c.category === 'RANGE')
    const frvpChip = chips.find((c) => c.category === 'FRVP')

    assert.ok(tlChip)
    assert.equal(tlChip.tier, 'DRAWING')
    assert.equal(tlChip.label, 'Bullish Support TL')

    assert.ok(rangeChip)
    assert.equal(rangeChip.tier, 'DRAWING')
    assert.equal(rangeChip.label, 'Morning Consolidation')

    assert.ok(frvpChip)
    assert.equal(frvpChip.tier, 'DRAWING')
    assert.equal(frvpChip.label, 'Opening Swing FRVP')
  })

  it('injects user drawings and Dalton auction rules into system prompt', () => {
    const prompt = buildLeoSystemPrompt(baseContext)

    assert.ok(prompt.includes('[USER-DRAWN CHART TOOLS & MANUAL REFERENCES]'))
    assert.ok(prompt.includes('Bullish Support TL'))
    assert.ok(prompt.includes('Morning Consolidation'))
    assert.ok(prompt.includes('Opening Swing FRVP'))
    assert.ok(prompt.includes('44020')) // POC
    assert.ok(prompt.includes('User Drawings & Manual References'))
  })

  it('omits drawing entries cleanly when no user drawings exist', () => {
    const emptyCtx: LeoChatContext = {
      ...baseContext,
      userDrawings: undefined,
    }
    const prompt = buildLeoSystemPrompt(emptyCtx)
    assert.ok(prompt.includes('No manual drawings currently on chart.'))
  })
})
