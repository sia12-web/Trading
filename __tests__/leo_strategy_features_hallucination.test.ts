import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeoSystemPrompt,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'
import { buildDeskFallbackResponse } from '../app/api/trading/leo/chat/route'

describe('Leo Strategy & Features Zero-Hallucination Tests', () => {
  const sampleContext: LeoChatContext = {
    instrument: 'NASDAQ',
    currentPrice: 21500.5,
    currentTimeEt: '09:45:00 ET',
    dayType: 'Normal Variation',
    openingType: 'Open Auction',
    sessionDetails: {
      sessionName: 'NYC Cash Session (RTH)',
      sessionPhase: 'Initial Balance (IB)',
      sessionElapsedMinutes: 15,
      timeToNextCheckpoint: '45m to IB Close (10:30 ET)',
      candleTimeframe: '5m',
    },
    longTermMoney: {
      avwap5m: 21200.0,
      sigma1Upper: 21450.0,
      sigma1Lower: 20950.0,
      sigma2Upper: 21700.0,
      sigma2Lower: 20700.0,
      distancePts: 300.5,
    },
    intermediateMoney: {
      poc5d: 21400.0,
      vah5d: 21600.0,
      val5d: 21250.0,
      high5d: 21750.0,
      low5d: 21100.0,
      distancePts: 100.5,
    },
    shortTermMoney: {
      sessionDate: '2026-10-14',
      ypoc: 21480.0,
      yhigh: 21550.0,
      ylow: 21380.0,
      yvah: 21520.0,
      yval: 21420.0,
      onpoc: 21495.0,
      onhigh: 21530.0,
      onlow: 21460.0,
      overnightBias: 'LONG_BIASED',
      distanceYpocPts: 20.5,
      distanceOnpocPts: 5.5,
    },
    orderFlow: {
      sessionCvd: 4200,
      latestBarDelta: 350,
      latestBuyVolume: 2500,
      latestSellVolume: 2150,
      latestBuyRatio: 0.54,
      trend: 'BUYER_DOMINANT',
      divergence: 'NONE',
      description: 'Moderate buyer initiative holding price near overnight high',
    },
    activeExcesses: [],
  }

  it('buildLeoSystemPrompt contains complete platform features directory and strategy protocol', () => {
    const prompt = buildLeoSystemPrompt(sampleContext)

    // Verify feature catalog presence
    assert.ok(prompt.includes('[COMPLETE PLATFORM FEATURES & CAPABILITIES DIRECTORY]'))
    assert.ok(prompt.includes('Action & Reaction Trendlines (Hotkey: W or X)'))
    assert.ok(prompt.includes('Manual Range Boxes (Hotkey: D)'))
    assert.ok(prompt.includes('Manual Fixed Range Volume Profile / FRVP (Hotkey: V)'))
    assert.ok(prompt.includes('Manual Anchored VWAP / AVWAP (Hotkey: U)'))
    assert.ok(prompt.includes('AUCTION PRICE CRITIQUE & "QUESTIONING" DESK (Hotkey: Q)'))
    assert.ok(prompt.includes('Multi-Range Volume Comparison Matrix'))
    assert.ok(prompt.includes('Cross-Asset Volatility'))

    // Verify zero-hallucination boundaries
    assert.ok(prompt.includes('HARD ZERO-HALLUCINATION PLATFORM BOUNDARIES'))
    assert.ok(prompt.includes('NO broker order execution'))
    assert.ok(prompt.includes('NO lagging retail indicators: NO RSI, NO MACD'))

    // Verify Strategy response protocol
    assert.ok(prompt.includes('STRATEGY & FEATURE INQUIRIES RESPONSE PROTOCOL'))
    assert.ok(prompt.includes('DO NOT output the 8-line live candle screen readout'))
  })

  it('buildDeskFallbackResponse handles Quick-Ask Button 1: Audit 4 Wyckoff Execution Setups', () => {
    const query =
      'Leo, audit the 4 Wyckoff execution setups for NASDAQ (Spring, Upthrust, Breakout Retest, Breakdown Retest). Tell me if price is interacting with our frozen pre-market Tier 1 zones.'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], sampleContext)

    assert.ok(resp.includes('Leo 4-Setup Wyckoff Audit'))
    assert.ok(resp.includes('The Only 4 Trades in the Universe'))
    assert.ok(resp.includes('At Support — Spring → Reclaim (LONG)'))
    assert.ok(resp.includes('At Resistance — Upthrust → Return Below (SHORT)'))
    assert.ok(resp.includes('VERDICT:'))
    assert.ok(!resp.includes('execute stagnation timeout exits'))
  })

  it('buildDeskFallbackResponse handles Quick-Ask Button 2: Check Pre-Market Tier 1 Zones', () => {
    const query =
      "Leo, check our pre-market Tier 1 zones on NASDAQ (5D Volume Profile, Yesterday's Profile, Overnight). Which pre-marked zone is price approaching right now?"
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], sampleContext)

    assert.ok(resp.includes('Pre-Market Tier 1 Frozen Map'))
    assert.ok(resp.includes('Rolling 5-Day Volume Profile'))
    assert.ok(resp.includes('21400.00')) // 5D POC
    assert.ok(resp.includes('Yesterday NYC Profile'))
    assert.ok(resp.includes('21480.00')) // Y-POC
    assert.ok(resp.includes('Overnight Session'))
    assert.ok(resp.includes('Nearest Predetermined Zone:'))
    assert.ok(!resp.includes('execute stagnation timeout exits'))
  })

  it('buildDeskFallbackResponse handles Quick-Ask Button 3: Audit CVD and Volume Effort vs Result', () => {
    const query =
      'Leo, audit CVD and volume on NASDAQ for effort versus result. Is aggressive order flow being absorbed at key levels?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], sampleContext)

    assert.ok(resp.includes('Leo CVD & Volume Audit — Effort vs. Result'))
    assert.ok(resp.includes('Session CVD:'))
    assert.ok(resp.includes('+4,200 contracts'))
    assert.ok(resp.includes('Effort vs. Result Assessment'))
    assert.ok(resp.includes('CVD DOES NOT TRIGGER TRADES'))
  })

  it('buildDeskFallbackResponse explains strategy and 22 rules without hallucinations', () => {
    const queries = [
      'Leo, what is our strategy?',
      'Can you explain the 22 rules?',
      'What are the only 4 trades?',
    ]
    for (const q of queries) {
      const resp = buildDeskFallbackResponse([{ role: 'user', content: q }], sampleContext)
      assert.ok(resp.includes('The Trader\'s 22-Rule Wyckoff & Dalton AMT Execution Playbook'), `Failed on: ${q}`)
      assert.ok(resp.includes('The 3-Tier Chart & Structure Hierarchy'))
      assert.ok(resp.includes('The ONLY 4 Trades in the Entire Execution Universe'))
      assert.ok(resp.includes('When You Do NOT Trade — 9 Absolute Filters'))
      assert.ok(resp.includes('Risk & Stop Discipline'))
      assert.ok(resp.includes('Neither the trader nor Leo ever places orders directly on this platform'))
    }
  })

  it('buildDeskFallbackResponse lists all platform features accurately with correct hotkeys', () => {
    const queries = [
      'Leo, what are all of the features in our system?',
      'What features do we have on this platform?',
      'List all hotkeys and desk features',
    ]
    for (const q of queries) {
      const resp = buildDeskFallbackResponse([{ role: 'user', content: q }], sampleContext)
      assert.ok(resp.includes('Trading Platform Features & Capabilities Master Directory'), `Failed on: ${q}`)
      assert.ok(resp.includes('Action & Reaction Trendlines (Hotkey: W or X)'))
      assert.ok(resp.includes('Range Boxes (Hotkey: D)')) // Not Hotkey R!
      assert.ok(resp.includes('Manual Fixed Range Volume Profile / FRVP (Hotkey: V)'))
      assert.ok(resp.includes('Manual Anchored VWAP / AVWAP (Hotkey: U)'))
      assert.ok(resp.includes('Auction Price Critique & "Questioning" Desk (Hotkey: Q)'))
      assert.ok(resp.includes('Multi-Range Volume Comparison Matrix'))
      assert.ok(resp.includes('**Strict Read-Only:** The platform NEVER places, modifies, or cancels broker orders'))
    }
  })

  it('stagnation rule response does NOT hallucinate automated market order execution', () => {
    const query = 'if we are in a position and we have not moved to profit after 5 minutes close'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], sampleContext)

    assert.ok(!resp.includes('I will automatically execute a market close'))
    assert.ok(resp.includes('I will alert you to manually flatten at your broker'))
    assert.ok(resp.includes('ARM_STAGNATION_RULE'))
  })

  it('range volume comparison instructions state Hotkey D, not Hotkey R', () => {
    const query = 'Leo compare the volume traded in these ranges'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], sampleContext)

    assert.ok(!resp.includes('Hotkey: **R**'))
    assert.ok(resp.includes('Hotkey: **D**'))
  })
})
