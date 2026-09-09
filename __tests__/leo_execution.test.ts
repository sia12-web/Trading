import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLeoDirectives,
  buildLeoSystemPrompt,
  extractChartDataPoints,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'
import {
  computeOrderFlowCvd,
  computeFootprintBars,
  summarizeFootprintForLeo,
} from '../lib/trading/orderFlowDelta'

describe('Leo Execution Directives & Parsing', () => {
  it('parses CLOSE_POSITION directive from <execute> block', () => {
    const responseText = `Understood. Executing immediate market close on DOW at 29,510.\n\n<execute>\n{\n  "action": "CLOSE_POSITION",\n  "reason": "Trader voice command: Close position"\n}\n</execute>`
    const directives = parseLeoDirectives(responseText)
    assert.equal(directives.length, 1)
    assert.equal(directives[0]?.action, 'CLOSE_POSITION')
    if (directives[0]?.action === 'CLOSE_POSITION') {
      assert.equal(directives[0].reason, 'Trader voice command: Close position')
    }
  })

  it('parses ARM_STAGNATION_RULE directive with custom minutes', () => {
    const responseText = `Roger that. Stagnation rule armed for 5 minutes.\n\n<execute>\n{\n  "action": "ARM_STAGNATION_RULE",\n  "maxMinutes": 5,\n  "requireProfitPoints": 1,\n  "description": "Close position if not in profit after 5 minutes"\n}\n</execute>`
    const directives = parseLeoDirectives(responseText)
    assert.equal(directives.length, 1)
    assert.equal(directives[0]?.action, 'ARM_STAGNATION_RULE')
    if (directives[0]?.action === 'ARM_STAGNATION_RULE') {
      assert.equal(directives[0].maxMinutes, 5)
      assert.equal(directives[0].requireProfitPoints, 1)
    }
  })

  it('parses ARM_TELEGRAM_ALERT directive for Asia session reference touch', () => {
    const responseText = `Understood. Telegram alert armed for 5D POC in Asia session.\n\n<execute>\n{\n  "action": "ARM_TELEGRAM_ALERT",\n  "targetReference": "5D POC",\n  "targetPrice": 29140.0,\n  "requireHighVolume": true,\n  "requireConfidence": true,\n  "session": "Asia"\n}\n</execute>`
    const directives = parseLeoDirectives(responseText)
    assert.equal(directives.length, 1)
    assert.equal(directives[0]?.action, 'ARM_TELEGRAM_ALERT')
    if (directives[0]?.action === 'ARM_TELEGRAM_ALERT') {
      assert.equal(directives[0].targetReference, '5D POC')
      assert.equal(directives[0].targetPrice, 29140.0)
      assert.equal(directives[0].session, 'Asia')
      assert.equal(directives[0].requireHighVolume, true)
    }
  })

  it('returns empty array when no valid execution directive present', () => {
    const responseText = `Just regular chat commentary about the 5M VWAP and yesterday POC.`
    const directives = parseLeoDirectives(responseText)
    assert.equal(directives.length, 0)
  })
})

describe('Leo Time, Session & Position Telemetry in System Prompt', () => {
  it('injects session details and open position details accurately', () => {
    const ctx: LeoChatContext = {
      instrument: 'NASDAQ',
      currentPrice: 29558.15,
      currentTimeEt: '09:47:30 ET',
      dayType: 'Neutral Day',
      openingType: 'Open Auction',
      sessionDetails: {
        sessionName: 'NYC Cash Session (RTH)',
        sessionPhase: 'Initial Balance (IB)',
        sessionElapsedMinutes: 17,
        timeToNextCheckpoint: '43m to IB Close (10:30 ET)',
        candleTimeframe: '5m',
        barCountdown: '02:45 remaining on current 5m candle',
        calendarDate: 'Mon, Sep 7, 2026',
        isHoliday: true,
        holidayName: 'US Labor Day Holiday',
      },
      activePosition: {
        positionId: 'pos-123',
        instrument: 'NASDAQ',
        direction: 'LONG',
        entryPrice: 29550.0,
        positionSize: 2,
        stopLoss: 29530.0,
        profitTarget: 29600.0,
        entryTimestamp: Date.now() - 3 * 60 * 1000, // 3 mins ago
        durationMinutes: 3.0,
        unrealizedPnlPoints: 8.15,
        unrealizedPnlCad: 32.6,
        isInProfit: true,
      },
      longTermMoney: {
        avwap5m: 29006.59,
        sigma1Upper: 30261.36,
        sigma1Lower: 27751.82,
        sigma2Upper: 31516.13,
        sigma2Lower: 26497.05,
        distancePts: 551.56,
      },
      intermediateMoney: {
        poc5d: 29140.0,
        vah5d: 29484.0,
        val5d: 29032.0,
        high5d: 29720.0,
        low5d: 28950.0,
        distancePts: 418.15,
      },
      shortTermMoney: {
        sessionDate: '2026-09-04',
        ypoc: 29520.0,
        yhigh: 29585.0,
        ylow: 29199.25,
        yvah: 29584.0,
        yval: 29320.0,
        onpoc: 29548.0,
        onhigh: 29720.0,
        onlow: 29481.5,
        overnightBias: '81% Long Skew',
        distanceYpocPts: 38.15,
        distanceOnpocPts: 10.15,
      },
      activeExcesses: [
        {
          type: 'SELLING_EXCESS',
          price: 29585.0,
          session: 'London',
          volumeStr: '30.1k',
          retestRatio: 0.95,
          isRetested: true,
        },
      ],
      selectedDataPoints: [
        {
          id: 'arrow-london-high',
          label: 'London High',
          value: 29585.0,
          tier: 'IT',
          category: 'EXCESS',
          session: 'London',
          volume: '30.1k',
          retestRatio: 0.95,
          isRetested: true,
          description: 'London High at 29585 (30.1k) [Retest 0.95x]',
        },
      ],
    }

    const prompt = buildLeoSystemPrompt(ctx)

    // Assert session and time details present
    assert.match(prompt, /Active Session: NYC Cash Session \(RTH\)/)
    assert.match(prompt, /Initial Balance \(IB\)/)
    assert.match(prompt, /17 minutes into session/)
    assert.match(prompt, /43m to IB Close/)
    assert.match(prompt, /US Labor Day Holiday/)

    // Assert active position details present
    assert.match(prompt, /STATE: OPEN POSITION ACTIVE/)
    assert.match(prompt, /LONG on NASDAQ/)
    assert.match(prompt, /Entry Price: 29550\.00/)
    assert.match(prompt, /Duration in Trade: 3\.0 minutes/)
    assert.match(prompt, /🟢 IN PROFIT/)

    // Assert clicked chart arrow details present
    assert.match(prompt, /London High: 29585/)
    assert.match(prompt, /Session: London/)
    assert.match(prompt, /Volume: 30\.1k/)
    assert.match(prompt, /Retest Ratio: 0\.95x/)
  })

  it('extracts chart data points including session and retest info', () => {
    const ctx: LeoChatContext = {
      instrument: 'DOW',
      currentPrice: 44200,
      currentTimeEt: '20:30:00 ET',
      dayType: 'NTREND',
      openingType: 'Open Auction',
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      activeExcesses: [
        {
          type: 'BUYING_EXCESS',
          price: 43980,
          session: 'Asia',
          volumeStr: '19.7k',
          retestRatio: 0.69,
          isRetested: true,
        },
      ],
    }

    const points = extractChartDataPoints(ctx)
    const excessPt = points.find((p) => p.category === 'EXCESS')
    assert.ok(excessPt)
    assert.equal(excessPt.value, 43980)
    assert.equal(excessPt.session, 'Asia')
    assert.equal(excessPt.volume, '19.7k')
    assert.equal(excessPt.retestRatio, 0.69)
    assert.equal(excessPt.isRetested, true)
  })

  it('computes and injects order flow CVD & institutional absorption telemetry into Leo prompt', () => {
    const bars = [
      { time: 1000, open: 4390, high: 4395, low: 4389, close: 4394, volume: 100 },
      { time: 1060, open: 4394, high: 4396, low: 4392, close: 4395, volume: 150 },
      { time: 1120, open: 4395, high: 4398, low: 4394, close: 4397, volume: 200 },
      { time: 1180, open: 4397, high: 4397, low: 4391, close: 4392, volume: 80 },
      { time: 1240, open: 4392, high: 4394, low: 4390, close: 4391, volume: 90 },
    ]
    const flow = computeOrderFlowCvd(bars)
    assert.ok(flow)
    assert.ok(typeof flow.sessionCvd === 'number')

    const fpBars = computeFootprintBars(bars, 0.25)
    assert.equal(fpBars.length, bars.length)
    assert.ok(fpBars[0]?.candlePocPrice)
    assert.ok(fpBars[0]?.ticks.length! > 0)

    const fpSummary = summarizeFootprintForLeo(fpBars, flow)
    assert.match(fpSummary, /Active Bar Candle POC:/)

    const ctx: LeoChatContext = {
      instrument: 'GOLD',
      currentPrice: 4391.0,
      currentTimeEt: '10:15:00 ET',
      dayType: 'Trend Day',
      openingType: 'Open Drive',
      longTermMoney: null,
      intermediateMoney: null,
      shortTermMoney: null,
      activeExcesses: [],
      orderFlow: {
        sessionCvd: flow.sessionCvd,
        latestBarDelta: flow.latestBarDelta,
        latestBuyVolume: flow.latestBuyVolume,
        latestSellVolume: flow.latestSellVolume,
        latestBuyRatio: flow.latestBuyRatio,
        trend: flow.trend,
        divergence: flow.divergence,
        description: flow.description,
        footprintSummary: fpSummary,
      },
    }

    const prompt = buildLeoSystemPrompt(ctx)
    assert.match(prompt, /ORDER FLOW & FOOTPRINT TELEMETRY \(CVD\)/)
    assert.match(prompt, /Session CVD:/)
    assert.match(prompt, /INSTITUTIONAL FOOTPRINT LADDER & STACKED IMBALANCES/)
    assert.match(prompt, /Active Bar Candle POC:/)
  })
})

