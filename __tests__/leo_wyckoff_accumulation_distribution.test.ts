import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLeoSystemPrompt,
  type LeoChatContext,
} from '../lib/ai/leoAssistant'
import { buildDeskFallbackResponse } from '../app/api/trading/leo/chat/route'

describe('Leo Wyckoff Accumulation & Distribution Professional Audit Tests', () => {
  const baseContext: LeoChatContext = {
    instrument: 'NASDAQ',
    currentPrice: 21500.0,
    currentTimeEt: '09:45:00 ET',
    dayType: 'Normal Variation',
    openingType: 'Open Auction',
    sessionDetails: {
      sessionName: 'NYC Cash Session (RTH)',
      sessionPhase: 'Initial Balance (IB)',
      sessionElapsedMinutes: 15,
      candleTimeframe: '5m',
    },
    longTermMoney: {
      avwap5m: 21200.0,
      sigma1Upper: 21450.0,
      sigma1Lower: 20950.0,
      sigma2Upper: 21700.0,
      sigma2Lower: 20700.0,
      distancePts: 300.0,
    },
    intermediateMoney: {
      poc5d: 21480.0,
      vah5d: 21600.0,
      val5d: 21350.0,
      high5d: 21750.0,
      low5d: 21200.0,
      distancePts: 20.0,
    },
    shortTermMoney: {
      sessionDate: '2026-10-14',
      ypoc: 21480.0,
      yhigh: 21580.0,
      ylow: 21380.0,
      yvah: 21550.0,
      yval: 21420.0,
      onpoc: 21490.0,
      onhigh: 21540.0,
      onlow: 21450.0,
      overnightBias: 'BALANCED',
      distanceYpocPts: 20.0,
      distanceOnpocPts: 10.0,
    },
    orderFlow: {
      sessionCvd: 1200,
      latestBarDelta: 150,
      latestBuyVolume: 2100,
      latestSellVolume: 1950,
      latestBuyRatio: 0.52,
      trend: 'BALANCED',
      divergence: 'NONE',
      description: 'Rotational order flow inside value',
    },
    activeExcesses: [],
  }

  it('buildLeoSystemPrompt contains the comprehensive Wyckoff Accumulation & Distribution Audit Framework', () => {
    const prompt = buildLeoSystemPrompt(baseContext)

    // Verify presence of Wyckoff framework in Rule 22
    assert.ok(prompt.includes('22. ACCUMULATION & DISTRIBUTION (THE WYCKOFFIAN AUDIT FRAMEWORK)'))
    assert.ok(prompt.includes('Law of Supply & Demand'))
    assert.ok(prompt.includes('Law of Cause & Effect'))
    assert.ok(prompt.includes('Law of Effort vs Result'))

    // Verify 5 phases definitions
    assert.ok(prompt.includes('Phase A (Stopping the Prior Trend)'))
    assert.ok(prompt.includes('Phase B (Building the Cause & Testing Limits)'))
    assert.ok(prompt.includes('Phase C (The Definitive Test of Float)'))
    assert.ok(prompt.includes('Phase D (Trend Within the Trading Range)'))
    assert.ok(prompt.includes('Phase E (Unfolding Trend Outside the Trading Range)'))

    // Verify zero-error logical rules
    assert.ok(prompt.includes('A dip below support is ONLY a Spring upon a confirmed RECLAIM'))
    assert.ok(prompt.includes('A breakout above resistance is ONLY an Upthrust upon a confirmed RETURN BELOW'))
    assert.ok(prompt.includes('Professional Wyckoffians NEVER trade early in Phase B'))
    assert.ok(prompt.includes('Re-Accumulation vs Distribution'))
    assert.ok(prompt.includes('Re-Distribution vs Accumulation'))

    // Verify response protocol for Wyckoff analysis
    assert.ok(prompt.includes('If asked about Accumulation or Distribution, analyze like a professional Wyckoffian'))
    assert.ok(prompt.includes('Creek / Support floor vs. Ice / Resistance ceiling'))
  })

  it('diagnoses Phase B: Building the Cause when price rotates inside range value', () => {
    const query = 'Leo, is this accumulation or distribution on NASDAQ?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], baseContext)

    assert.ok(resp.includes('Leo Wyckoff Accumulation vs. Distribution Master Audit'))
    assert.ok(resp.includes('The Creek (TR Support Floor)'))
    assert.ok(resp.includes('The Ice (TR Resistance Ceiling)'))
    assert.ok(resp.includes('Phase B: Building the Cause (Range Balance / Absorption)'))
    assert.ok(resp.includes('Rule 20 Absolute Filter: Middle of value / Phase B chop = NO TRADE'))
    assert.ok(resp.includes('VERDICT:** **WAIT**'))
  })

  it('diagnoses Phase C Spring Reclaim when price tests support with bullish absorption', () => {
    const supportContext: LeoChatContext = {
      ...baseContext,
      currentPrice: 21422.0, // Near Y-VAL (21420.0)
      orderFlow: {
        sessionCvd: -3500,
        latestBarDelta: -400,
        latestBuyVolume: 3200,
        latestSellVolume: 3600,
        latestBuyRatio: 0.47,
        trend: 'SELLER_DOMINANT',
        divergence: 'BULLISH_ABSORPTION',
        description: 'Heavy selling into support with prices refusing lower lows',
      },
    }

    const query = 'Leo, analyze accumulation vs distribution. Are we seeing a Wyckoff Spring?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], supportContext)

    assert.ok(resp.includes('Phase C: The Definitive Test (Spring / Shakeout at Support)'))
    assert.ok(resp.includes('Bullish Absorption'))
    assert.ok(resp.includes('Passive institutional bids are absorbing aggressive market selling'))
    assert.ok(resp.includes('Setup 1: At Support — Spring → Reclaim (LONG)'))
    assert.ok(resp.includes('VERDICT:** **VALID LONG HYPOTHESIS**'))
    assert.ok(resp.includes('Stop strictly below Spring low'))
  })

  it('diagnoses Phase C Upthrust / UTAD when price tests resistance with bearish absorption', () => {
    const resistanceContext: LeoChatContext = {
      ...baseContext,
      currentPrice: 21548.0, // Near Y-VAH (21550.0)
      orderFlow: {
        sessionCvd: 4800,
        latestBarDelta: 600,
        latestBuyVolume: 4200,
        latestSellVolume: 3600,
        latestBuyRatio: 0.54,
        trend: 'BUYER_DOMINANT',
        divergence: 'BEARISH_EXHAUSTION',
        description: 'Aggressive buying into resistance with prices refusing higher highs',
      },
    }

    const query = 'Leo, tell me if this is Wyckoff distribution or accumulation at the highs'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], resistanceContext)

    assert.ok(resp.includes('Phase C: The Definitive Test (Upthrust / UTAD at Resistance)'))
    assert.ok(resp.includes('Bearish Absorption / Churn'))
    assert.ok(resp.includes('Setup 3: At Resistance — Upthrust → Return Below (SHORT)'))
    assert.ok(resp.includes('VERDICT:** **VALID SHORT HYPOTHESIS**'))
    assert.ok(resp.includes('Stop strictly above Upthrust extreme'))
  })

  it('diagnoses Phase D / Phase E Markdown when price breaks below support', () => {
    const breakdownContext: LeoChatContext = {
      ...baseContext,
      currentPrice: 21390.0, // Well below Y-VAL (21420.0)
    }

    const query = 'Leo, is this an accumulation spring or a breakdown?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], breakdownContext)

    assert.ok(resp.includes('Phase D / Phase E: Markdown in Progress (Fall Through the Ice / SOW)'))
    assert.ok(resp.includes('Never buy into an un-reclaimed breakdown!'))
    assert.ok(resp.includes('Setup 2: Breakdown → Failed Reclaim (SHORT Continuation)'))
    assert.ok(resp.includes('VERDICT:** **WAIT**'))
  })

  it('diagnoses Phase D / Phase E Markup when price breaks above resistance', () => {
    const breakoutContext: LeoChatContext = {
      ...baseContext,
      currentPrice: 21575.0, // Well above Y-VAH (21550.0)
    }

    const query = 'Leo, are we in distribution or is this a Wyckoff markup breakout?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], breakoutContext)

    assert.ok(resp.includes('Phase D / Phase E: Markup in Progress (Jump Across the Creek / SOS)'))
    assert.ok(resp.includes('Never chase the initial breakout candle!'))
    assert.ok(resp.includes('Setup 4: Breakout → Successful Retest (LONG Continuation)'))
    assert.ok(resp.includes('VERDICT:** **WAIT**'))
  })

  it('eliminates fatal logical errors and reinforces Wyckoff Laws', () => {
    const query = 'Leo, can you explain how a professional Wyckoffian analyzes accumulation and distribution?'
    const resp = buildDeskFallbackResponse([{ role: 'user', content: query }], baseContext)

    // Fatal logical errors highlighted
    assert.ok(resp.includes('Calling a Spring before reclaim'))
    assert.ok(resp.includes('Calling an Upthrust before return below'))
    assert.ok(resp.includes('Predicting in Phase B'))
    assert.ok(resp.includes('Ignoring Effort vs Result'))

    // Re-accumulation vs Re-distribution differentiation
    assert.ok(resp.includes('Re-Accumulation vs. Re-Distribution Filter'))
    assert.ok(resp.includes('Do NOT assume every pause is distribution!'))
    assert.ok(resp.includes('Do NOT assume every bounce is accumulation!'))

    // Execution discipline
    assert.ok(resp.includes('Minimum **2.0R** reward clearance'))
    assert.ok(resp.includes('read-only platform never executes orders'))
  })

  it('incorporates 1-year 5-minute Wyckoff range backtest benchmarks across all markets', () => {
    const prompt = buildLeoSystemPrompt(baseContext)
    const resp = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, what are the empirical Wyckoff range backtest benchmarks?' }],
      baseContext
    )
    // Verify system prompt contains the empirical backtest benchmarks derived from wyckoffBenchmarks.data.json
    assert.ok(prompt.includes('Quantitative 1-Year 5-Minute Wyckoff Range Backtest Benchmarks'))
    assert.ok(prompt.includes('Evaluated 6,104 ranges (3,232 accumulation / 2,872 distribution)'))
    assert.ok(prompt.includes('Accumulation ranges that swept below range low (Spring / Schematic 1): 17.7%'))
    assert.ok(prompt.includes('Held a higher low without a lower-low sweep (LPS / Schematic 2): 82.3%'))
    assert.ok(prompt.includes('Distribution ranges that swept above range high (UTAD): 19.1%'))
    assert.ok(prompt.includes('Formation session: 63% overnight (Asia 33.5% + London 29.4%)'))

    // Verify fallback response includes backtest benchmarks for the active instrument (NASDAQ)
    assert.ok(resp.includes('Quantitative 1-Year 5-Minute Wyckoff Range Benchmarks (NASDAQ'))
    assert.ok(resp.includes('6,104 qualified 5-minute trading ranges'))
    assert.ok(resp.includes('The Spring Sweep Rate'))
    assert.ok(resp.includes('17.3%'))
    assert.ok(resp.includes('The UTAD Sweep Rate'))
    assert.ok(resp.includes('20.1%'))
    assert.ok(resp.includes('64%'))
    assert.ok(resp.includes('09:00 ET, 08:00 ET, 04:00 ET'))
  })

  it('provides active market-specific benchmarks for Gold and Crude with zero hallucinations', () => {
    const goldContext: LeoChatContext = {
      ...baseContext,
      instrument: 'GOLD',
      currentPrice: 4179.0,
    }
    const goldPrompt = buildLeoSystemPrompt(goldContext)
    const goldResp = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, audit accumulation and distribution benchmarks on Gold' }],
      goldContext
    )

    // Verify Gold-specific benchmarks in prompt and response (exact figures from wyckoffBenchmarks.data.json)
    assert.ok(goldPrompt.includes('Active Instrument Empirical Benchmark (GOLD — GC / MGC)'))
    assert.ok(goldPrompt.includes('Spring (lower-low sweep) rate: 5.7% | LPS (no lower-low sweep) rate: 94.3%'))
    assert.ok(goldResp.includes('Quantitative 1-Year 5-Minute Wyckoff Range Benchmarks (GOLD — GC / MGC)'))
    assert.ok(goldResp.includes('Only **5.7%**'))
    assert.ok(goldResp.includes('94.3%'))
    assert.ok(goldResp.includes('0.68x'))
    assert.ok(goldResp.includes('54.4%'))
    assert.ok(goldResp.includes('25.1 hours'))
  })

  it('handles cross-market Wyckoff comparison requests with complete comparative matrix', () => {
    const resp = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, compare markets for accumulation and distribution backtests' }],
      baseContext
    )

    // Verify full comparative matrix structure
    assert.ok(resp.includes('Cross-Market 1-Year Wyckoff Backtest Comparative Matrix (6,104 Ranges)'))
    assert.ok(resp.includes('NASDAQ (NQ)'))
    assert.ok(resp.includes('DOW (YM)'))
    assert.ok(resp.includes('CRUDE (CL)'))
    assert.ok(resp.includes('GOLD (GC)'))
    assert.ok(resp.includes('NIKKEI (NKD)'))

    // Key empirical deductions
    assert.ok(resp.includes('The Universal Law of Higher Lows (LPS Dominance)'))
    assert.ok(resp.includes('Sweep Volume Expansion Varies by Market'))
    assert.ok(resp.includes('Ignition Timing Is Asset-Specific'))
  })

  it('routes "which market sweeps" and UI quick-ask prompts to Wyckoff handlers, not the radar', () => {
    const sweeps = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, which market sweeps lows the most?' }],
      baseContext
    )
    assert.ok(sweeps.includes('Cross-Market 1-Year Wyckoff Backtest Comparative Matrix'))

    // Exact prompts emitted by WyckoffRulesPanel quick-ask buttons
    const benchBtn = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, audit 1-year 5-minute Wyckoff range backtest benchmarks on NASDAQ.' }],
      baseContext
    )
    assert.ok(benchBtn.includes('Quantitative 1-Year 5-Minute Wyckoff Range Benchmarks (NASDAQ'))

    const compareBtn = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, compare markets for accumulation and distribution backtests. Show me the cross-market comparative matrix.' }],
      baseContext
    )
    assert.ok(compareBtn.includes('Cross-Market 1-Year Wyckoff Backtest Comparative Matrix'))
  })

  it('handles manual Anchored VWAP (AVWAP) drawing audits with institutional fair-value slope diagnosis', () => {
    const avwapContext: LeoChatContext = {
      ...baseContext,
      instrument: 'GOLD',
      currentPrice: 4208.5,
      userDrawings: {
        avwaps: [
          {
            id: 'avwap-oct11',
            anchorLabel: 'Oct 11 Low',
            anchorTime: 1728604800,
            currentVwap: 4192.0,
            distanceFromCurrentPrice: 16.5,
            slope: 'RISING',
          },
        ],
      },
    }

    const resp = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, audit my anchored VWAP on Gold.' }],
      avwapContext
    )

    assert.ok(resp.includes('Institutional Anchored VWAP (AVWAP) Audit'))
    assert.ok(resp.includes('Oct 11 Low'))
    assert.ok(resp.includes('4192.00'))
    assert.ok(resp.includes('RISING'))
    assert.ok(resp.includes('ABOVE AVWAP'))
  })

  it('synthesizes Multi-Agent Cooperation across Fundamental Specialist, Desk News / Headline Agent, and Chart Leo', () => {
    const multiAgentContext: LeoChatContext = {
      ...baseContext,
      instrument: 'GOLD',
      currentPrice: 4196.8,
      macroCatalystReaction:
        'US CPI YoY 2.8% vs 2.5% Expected — Sovereign Central Bank Bid Holds $4,190 | Reaction: BULLISH_ABSORPTION (+8.8 pts across 9 bars)',
    }

    const resp = buildDeskFallbackResponse(
      [{ role: 'user', content: 'Leo, how do the fundamental agent and headline agent cooperate on Gold right now?' }],
      multiAgentContext
    )

    assert.ok(resp.includes('Multi-Agent Desk Synthesis: Chart Leo × Fundamental Specialist × Desk News Agent'))
    assert.ok(resp.includes('Active Market Intelligence Bus Brief (GOLD)'))
    assert.ok(resp.includes('Cross-Market Fundamental Specialist Bus Status (All 5 Desks)'))
    assert.ok(resp.includes('Verified Macro Catalyst & Market Reaction Engine'))
    assert.ok(resp.includes('US CPI YoY 2.8% vs 2.5% Expected'))
    assert.ok(resp.includes('BULLISH_ABSORPTION'))
    assert.ok(resp.includes('Connecting the Dots — Catalyst Transmission × Wyckoff Structure (GOLD)'))
  })
})

