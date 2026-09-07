import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  extractChartDataPoints,
  buildLeoSystemPrompt,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'

describe('Leo AI Desk Assistant Unit Tests', () => {
  const sampleContext: LeoChatContext = {
    instrument: 'DOW',
    currentPrice: 44050.25,
    currentTimeEt: '09:35 AM ET',
    dayType: 'Neutral Day',
    openingType: 'Open Auction',
    longTermMoney: {
      avwap5m: 43200.5,
      sigma1Upper: 43800.0,
      sigma1Lower: 42600.0,
      sigma2Upper: 44400.0,
      sigma2Lower: 42000.0,
      distancePts: 849.75,
    },
    intermediateMoney: {
      poc5d: 43900.0,
      vah5d: 44200.0,
      val5d: 43600.0,
      high5d: 44350.0,
      low5d: 43500.0,
      distancePts: 150.25,
    },
    shortTermMoney: {
      sessionDate: '2026-09-04',
      ypoc: 44100.0,
      yhigh: 44250.0,
      ylow: 43950.0,
      yvah: 44180.0,
      yval: 44020.0,
      onpoc: 44080.0,
      onhigh: 44150.0,
      onlow: 44010.0,
      overnightBias: '85% Long Skew',
      distanceYpocPts: -49.75,
      distanceOnpocPts: -29.75,
    },
    activeExcesses: [
      {
        type: 'BUYING_EXCESS',
        price: 43940.0,
        volumeStr: '75k',
        retestRatio: 0.85,
      },
    ],
  }

  it('extracts all active chart reference points correctly across all money tiers', () => {
    const points = extractChartDataPoints(sampleContext)
    assert.ok(points.length >= 10)

    // Verify Long-Term Money (5M VWAP)
    const vwapPt = points.find((p) => p.id === 'lt-5m-vwap')
    assert.ok(vwapPt)
    assert.equal(vwapPt.value, 43200.5)
    assert.equal(vwapPt.tier, 'LT')

    // Verify Intermediate-Term Money (5D POC)
    const poc5dPt = points.find((p) => p.id === 'it-5d-poc')
    assert.ok(poc5dPt)
    assert.equal(poc5dPt.value, 43900.0)
    assert.equal(poc5dPt.tier, 'IT')

    // Verify Short-Term Money (Y-POC & ON-POC)
    const ypocPt = points.find((p) => p.id === 'st-y-poc')
    assert.ok(ypocPt)
    assert.equal(ypocPt.value, 44100.0)
    assert.equal(ypocPt.tier, 'ST')

    const onpocPt = points.find((p) => p.id === 'st-on-poc')
    assert.ok(onpocPt)
    assert.equal(onpocPt.value, 44080.0)
    assert.equal(onpocPt.tier, 'ST')

    // Verify Excess Tail
    const excessPt = points.find((p) => p.category === 'EXCESS')
    assert.ok(excessPt)
    assert.equal(excessPt.value, 43940.0)
  })

  it('builds comprehensive system prompt infused with live telemetry and Dalton rules', () => {
    const prompt = buildLeoSystemPrompt(sampleContext)

    // Check Assistant Identity
    assert.ok(prompt.includes('You are Leo'))
    assert.ok(prompt.includes('DOW'))
    assert.ok(prompt.includes('44050.25'))

    // Check Multi-Timeframe Money tiers
    assert.ok(prompt.includes('LONG-TERM MONEY'))
    assert.ok(prompt.includes('43200.5'))
    assert.ok(prompt.includes('INTERMEDIATE-TERM MONEY'))
    assert.ok(prompt.includes('43900'))
    assert.ok(prompt.includes('SHORT-TERM MONEY'))
    assert.ok(prompt.includes('44100'))
    assert.ok(prompt.includes('44080'))

    // Check holiday session awareness
    assert.ok(prompt.includes('2026-09-04'))

    // Check day and open types
    assert.ok(prompt.includes('Neutral Day'))
    assert.ok(prompt.includes('Open Auction'))

    // Check excess tails
    assert.ok(prompt.includes('BUYING_EXCESS @ 43940'))
  })

  it('formats attached / clicked data points cleanly in prompt', () => {
    const ctxWithAttached: LeoChatContext = {
      ...sampleContext,
      selectedDataPoints: [
        {
          id: 'st-y-val',
          label: 'Y-VAL',
          value: 44020.0,
          tier: 'ST',
          category: 'VALUE_AREA',
          description: 'Yesterday Value Area Low',
        },
        {
          id: 'it-5d-poc',
          label: '5D POC',
          value: 43900.0,
          tier: 'IT',
          category: 'POC',
          description: '5-Day POC extended line',
        },
      ],
    }

    const prompt = buildLeoSystemPrompt(ctxWithAttached)
    assert.ok(prompt.includes('[ST] Y-VAL: 44020'))
    assert.ok(prompt.includes('[IT] 5D POC: 43900'))
  })
})
