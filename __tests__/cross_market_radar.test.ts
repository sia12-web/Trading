import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mapInstrumentToVolatilityGauge,
  classifyVolatilityRegime,
  buildDefaultVolatilityQuotes,
  buildCrossMarketVolatilityState,
} from '../lib/trading/crossMarketVolatility'
import {
  evaluateMarket,
  buildCrossMarketRadarReport,
  deriveRadarMarketInput,
  type MarketInputData,
} from '../lib/trading/crossMarketRadar'
import { buildLeoSystemPrompt, type LeoChatContext } from '../lib/ai/leoAssistant'

describe('Cross-Asset Volatility & 5-Market Opportunity Radar Tests', () => {
  it('maps instruments strictly to their dedicated Cboe volatility gauges', () => {
    // Equities -> VIX1D / VIX
    const nq = mapInstrumentToVolatilityGauge('NASDAQ')
    assert.strictEqual(nq.primaryGauge, 'VIX1D')
    assert.strictEqual(nq.secondaryGauge, 'VIX')
    assert.strictEqual(nq.assetClass, 'EQUITIES')

    const dow = mapInstrumentToVolatilityGauge('DOW')
    assert.strictEqual(dow.primaryGauge, 'VIX1D')
    assert.strictEqual(dow.assetClass, 'EQUITIES')

    const es = mapInstrumentToVolatilityGauge('SP500')
    assert.strictEqual(es.primaryGauge, 'VIX1D')

    // Crude Oil -> OVX (USO options)
    const cl = mapInstrumentToVolatilityGauge('CRUDE')
    assert.strictEqual(cl.primaryGauge, 'OVX')
    assert.strictEqual(cl.assetClass, 'CRUDE')

    // Gold -> GVZ (GLD options)
    const gc = mapInstrumentToVolatilityGauge('GOLD')
    assert.strictEqual(gc.primaryGauge, 'GVZ')
    assert.strictEqual(gc.assetClass, 'GOLD')

    // Nikkei -> JNIV (Nikkei VI)
    const nk = mapInstrumentToVolatilityGauge('NIKKEI')
    assert.strictEqual(nk.primaryGauge, 'JNIV')
    assert.strictEqual(nk.assetClass, 'NIKKEI')
  })

  it('classifies volatility regimes and detects expansions accurately', () => {
    // Normal VIX
    const norm = classifyVolatilityRegime('VIX', 16.5, 0.5)
    assert.strictEqual(norm.regime, 'NORMAL')
    assert.strictEqual(norm.isExpanding, false)

    // Surging OVX (> 4% change and elevated level)
    const surgingOvx = classifyVolatilityRegime('OVX', 38.0, 6.5)
    assert.strictEqual(surgingOvx.regime, 'EXPANDING')
    assert.strictEqual(surgingOvx.isExpanding, true)

    // High VIX1D
    const highVix1d = classifyVolatilityRegime('VIX1D', 23.5, 8.0)
    assert.strictEqual(highVix1d.regime, 'EXPANDING')
    assert.strictEqual(highVix1d.isExpanding, true)
  })

  it('awards Grade A ONLY when all 3 factors (Participation, Location, Structure) are present', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)

    // Market with all 3: OVX expanding + at 5D LVN + Wyckoff Spring
    const gradeAInput: MarketInputData = {
      market: 'CRUDE',
      currentPrice: 72.8,
      dayChangePct: 1.8,
      recentVolumeRatio: 1.6,
      cvdTrend: 'BUYER_DOMINANT',
      cvdDivergence: 'BULLISH_ABSORPTION',
      nearestLevel: { type: '5D_LVN', price: 72.7, distancePts: 0.1, thresholdPts: 0.35 },
      wyckoffPattern: 'SPRING',
      candlestickPattern: 'Bullish Engulfing',
      runwayRatio: 2.5,
    }

    const card = evaluateMarket(gradeAInput, volState)
    assert.strictEqual(card.grade, 'A')
    assert.strictEqual(card.verdict, 'FOCUS_TRADE')
    assert.strictEqual(card.participation.present, true)
    assert.strictEqual(card.location.present, true)
    assert.strictEqual(card.structure.present, true)
    assert.ok(card.summaryLine.includes('GRADE A'))
  })

  it('enforces the Anti-Chase Rule: a market moving +4% without Location is classified Grade B (Trap Risk)', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)

    // Market up 4% with huge volume and a breakout, but floating in the middle of nowhere (distance 85 pts from shelf)
    const chasingInput: MarketInputData = {
      market: 'NASDAQ',
      currentPrice: 20450,
      dayChangePct: 4.1,
      recentVolumeRatio: 2.2,
      cvdTrend: 'BUYER_DOMINANT',
      nearestLevel: { type: '5D_POC', price: 20100, distancePts: 350, thresholdPts: 15 },
      candlestickPattern: 'Bullish Engulfing',
      runwayRatio: 2.0,
    }

    const card = evaluateMarket(chasingInput, volState)
    assert.strictEqual(card.grade, 'B', 'Must NOT be Grade A because location is missing')
    assert.strictEqual(card.location.present, false)
    assert.strictEqual(card.verdict, 'ARMED_STAND_ASIDE')
    assert.ok(card.summaryLine.includes('DO NOT CHASE') || card.summaryLine.includes('Trap Risk'))
  })

  it('classifies quiet chop as Grade C (Ignore / Stand Aside)', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)

    // Flat, quiet market
    const chopInput: MarketInputData = {
      market: 'GOLD',
      currentPrice: 2680,
      dayChangePct: 0.05,
      recentVolumeRatio: 0.7,
      cvdTrend: 'BALANCED',
      nearestLevel: { type: 'NONE', price: 0, distancePts: 999, thresholdPts: 3.5 },
    }

    const card = evaluateMarket(chopInput, volState)
    assert.strictEqual(card.grade, 'C')
    assert.strictEqual(card.verdict, 'IGNORE_CHOP')
    assert.strictEqual(card.participation.present, false)
    assert.strictEqual(card.location.present, false)
  })

  it('does not invent a Grade A crude book when no live inputs are supplied', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)
    const report = buildCrossMarketRadarReport(volState, {})
    assert.strictEqual(report.topPick, null)
    assert.strictEqual(Object.keys(report.markets).length, 0)
    assert.ok(!report.deskDirective.includes('CRUDE'))
    assert.ok(!JSON.stringify(report).includes('72.8'))
  })

  it('ranks an explicit Grade A input above quiet markets', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)
    const quiet: MarketInputData = {
      market: 'GOLD',
      currentPrice: 4100,
      dayChangePct: 0.05,
      recentVolumeRatio: 0.7,
      cvdTrend: 'BALANCED',
      nearestLevel: { type: 'NONE', price: 0, distancePts: 999, thresholdPts: 3.5 },
    }
    const report = buildCrossMarketRadarReport(volState, {
      CRUDE: {
        market: 'CRUDE',
        currentPrice: 89.4,
        dayChangePct: 1.8,
        recentVolumeRatio: 1.6,
        cvdTrend: 'BUYER_DOMINANT',
        cvdDivergence: 'BULLISH_ABSORPTION',
        nearestLevel: { type: 'Y_VAL', price: 89.3, distancePts: 0.1, thresholdPts: 0.35 },
        wyckoffPattern: 'SPRING',
        candlestickPattern: 'Bullish Engulfing',
        runwayRatio: 2.5,
      },
      GOLD: quiet,
    })
    assert.strictEqual(report.topPick, 'CRUDE')
    assert.strictEqual(report.markets.CRUDE?.grade, 'A')
    assert.strictEqual(report.markets.CRUDE?.isTopPick, true)
    assert.strictEqual(report.markets.GOLD?.grade, 'C')
    assert.ok(report.deskDirective.includes('CRUDE'))
  })

  it('derives price, day change, and the prior-session shelf from the bars it is given', () => {
    const day1 = Math.floor(Date.UTC(2026, 9, 5, 15, 0, 0) / 1000)
    const day2 = Math.floor(Date.UTC(2026, 9, 6, 15, 0, 0) / 1000)
    const prior = Array.from({ length: 12 }, (_, i) => ({
      time: day1 + i * 300,
      open: 100,
      high: 100.4,
      low: 99.6,
      close: 100,
      volume: 1000,
    }))
    const current = [
      { time: day2, open: 101, high: 101.2, low: 100.4, close: 100.6, volume: 4000 },
      { time: day2 + 300, open: 100.8, high: 101, low: 99.8, close: 100.2, volume: 4000 },
      { time: day2 + 600, open: 100, high: 102.4, low: 99.9, close: 102, volume: 5000 },
    ]
    const input = deriveRadarMarketInput({
      market: 'NASDAQ',
      price: 102,
      previousClose: 100,
      candles: [...prior, ...current],
      timeZone: 'UTC',
      bin: 1,
    })
    assert.ok(input)
    assert.strictEqual(input!.currentPrice, 102)
    assert.ok(Math.abs(input!.dayChangePct! - 2) < 0.01)
    assert.ok((input!.recentVolumeRatio ?? 0) > 1.2)
    assert.ok(input!.nearestLevel)
    assert.notStrictEqual(input!.nearestLevel!.type, 'NONE')
    assert.ok(input!.nearestLevel!.price > 99 && input!.nearestLevel!.price < 101)
    assert.ok(String(input!.candlestickPattern).includes('Engulfing'))
  })

  it('infuses Leo system prompt with cross-asset volatility gauges, the 3-factor matrix, and live radar', () => {
    const quotes = buildDefaultVolatilityQuotes(new Date())
    const volState = buildCrossMarketVolatilityState(quotes)
    const report = buildCrossMarketRadarReport(volState, {
      CRUDE: {
        market: 'CRUDE',
        currentPrice: 89.4,
        dayChangePct: 1.2,
        recentVolumeRatio: 1.6,
        cvdTrend: 'BUYER_DOMINANT',
        nearestLevel: { type: 'Y_VAL', price: 89.3, distancePts: 0.1, thresholdPts: 0.35 },
        wyckoffPattern: 'SPRING',
        candlestickPattern: 'Bullish Engulfing',
        runwayRatio: 2.5,
      },
    })

    const ctx: LeoChatContext = {
      instrument: 'CRUDE',
      currentPrice: 72.8,
      currentTimeEt: '10:45 AM ET',
      dayType: 'Trend Day',
      openingType: 'Open Drive',
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      activeExcesses: [],
      crossMarketVolatility: volState,
      marketRadar: report,
    }

    const prompt = buildLeoSystemPrompt(ctx)

    // Verify system instructions for 5h section
    assert.ok(prompt.includes('CROSS-ASSET VOLATILITY & 5-MARKET SELECTION MATRIX'))
    assert.ok(prompt.includes('VIX1D measures 1-day expected volatility'))
    assert.ok(prompt.includes('OVX'))
    assert.ok(prompt.includes('GVZ'))
    assert.ok(prompt.includes('PARTICIPATION x LOCATION x STRUCTURE'))
    assert.ok(prompt.includes('TRADE ONLY GRADE A'))
    assert.ok(prompt.includes('The Anti-Chase Imperative'))

    // Verify live telemetry injection
    assert.ok(prompt.includes('[CROSS-ASSET VOLATILITY & 5-MARKET SELECTION RADAR]'))
    assert.ok(prompt.includes('Crude Oil Volatility: OVX'))
    assert.ok(prompt.includes('Grade A'))
  })
})
