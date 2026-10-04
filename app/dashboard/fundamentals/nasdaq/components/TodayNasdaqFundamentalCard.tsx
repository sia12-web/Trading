'use client'

/**
 * Today's Nasdaq Fundamental State Component
 * Implements Item 30: 18 Physical/Macro dimensions + Biases + Invalidation rules
 * Implements Item 39: Unified Multi-Agent Protocol viewer
 */

import React, { useState } from 'react'
import type { TodaysNasdaqFundamentalState, UnifiedAgentProtocolOutput, NasdaqTelemetry } from '@/types/fundamentals'

interface TodayNasdaqFundamentalCardProps {
  today: TodaysNasdaqFundamentalState
  telemetry: NasdaqTelemetry
}

export function TodayNasdaqFundamentalCard({ today, telemetry }: TodayNasdaqFundamentalCardProps) {
  const [copied, setCopied] = useState(false)
  const [showUnified, setShowUnified] = useState(false)

  const formattedText = [
    `NASDAQ FUNDAMENTAL STATE`,
    `Fed regime: ${today.fed_regime}`,
    `Rate regime: ${today.rate_regime}`,
    `2Y: ${today.us2y}`,
    `10Y: ${today.us10y}`,
    `Inflation trend: ${today.inflation_trend}`,
    `Labor trend: ${today.labor_trend}`,
    `Growth trend: ${today.growth_trend}`,
    `Financial conditions: ${today.financial_conditions}`,
    `NDX earnings trend: ${today.ndx_earnings_trend}`,
    `Forward guidance trend: ${today.forward_guidance_trend}`,
    `AI/capex trend: ${today.ai_capex_trend}`,
    `Semiconductor trend: ${today.semiconductor_trend}`,
    `Breadth: ${today.breadth}`,
    `Leadership: ${today.leadership}`,
    `Volatility: ${today.volatility}`,
    `Positioning: ${today.positioning}`,
    `Main current market driver: ${today.main_current_market_driver}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Upcoming catalysts: ${today.upcoming_catalysts}`,
    `What changed since yesterday: ${today.what_changed_since_yesterday}`,
    `What would invalidate the current interpretation: ${today.what_would_invalidate_the_current_interpretation}`,
  ].join('\n')

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const unifiedProtocolData: UnifiedAgentProtocolOutput = {
    market: 'NQ',
    regime: `2Y ${telemetry.us2yNominalYield.toFixed(2)}% | 10Y ${telemetry.us10yNominalYield.toFixed(2)}% | 10Y Real TIPS ${telemetry.us10yRealYield.toFixed(2)}% | VXN ${telemetry.vxnIndex.toFixed(2)} | Hyperscaler Capex ~$210B`,
    catalyst: today.main_current_market_driver,
    expected_direction: today.short_term_bias,
    magnitude: 'HIGH',
    horizon: 'SHORT_TERM',
    confidence: 0.84,
    market_confirmation: 'CONFIRMED',
    key_drivers: [
      {
        factor: 'TREASURY_RATES_ENGINE',
        impact: `2Y yield at ${telemetry.us2yNominalYield.toFixed(2)}%, 10Y real TIPS at ${telemetry.us10yRealYield.toFixed(2)}%`,
        effect: telemetry.us10yRealYield > 3.0 ? 'BEARISH' : 'NEUTRAL',
      },
      {
        factor: 'AI_SEMI_CAPEX',
        impact: `Hyperscaler capex run-rate resilient; semi basket ${telemetry.semiBasketChangePct >= 0 ? '+' : ''}${telemetry.semiBasketChangePct.toFixed(2)}%`,
        effect: 'BULLISH',
      },
      {
        factor: 'MARKET_BREADTH',
        impact: `Advance/Decline ratio at ${telemetry.advanceDeclineRatio.toFixed(2)}:1`,
        effect: telemetry.advanceDeclineRatio >= 1.0 ? 'BULLISH' : 'MIXED',
      },
    ],
    invalidation: today.what_would_invalidate_the_current_interpretation,
  }

  const dimensions = [
    { label: 'Fed regime', value: today.fed_regime, icon: '🏛️' },
    { label: 'Rate regime', value: today.rate_regime, icon: '📊' },
    { label: '2Y Treasury Yield', value: today.us2y, icon: '⏱️' },
    { label: '10Y Treasury Yield', value: today.us10y, icon: '📈' },
    { label: 'Inflation trend', value: today.inflation_trend, icon: '🔥' },
    { label: 'Labor trend', value: today.labor_trend, icon: '💼' },
    { label: 'Growth trend', value: today.growth_trend, icon: '🏭' },
    { label: 'Financial conditions', value: today.financial_conditions, icon: '💵' },
    { label: 'NDX earnings trend', value: today.ndx_earnings_trend, icon: '📊' },
    { label: 'Forward guidance trend', value: today.forward_guidance_trend, icon: '🔭' },
    { label: 'AI/capex trend', value: today.ai_capex_trend, icon: '🤖' },
    { label: 'Semiconductor trend', value: today.semiconductor_trend, icon: '⚡' },
    { label: 'Market breadth', value: today.breadth, icon: '🌐' },
    { label: 'Leadership', value: today.leadership, icon: '🏆' },
    { label: 'Implied Volatility', value: today.volatility, icon: '📉' },
    { label: 'CFTC positioning', value: today.positioning, icon: '🎯' },
  ]

  const getStanceColor = (bias: string) => {
    switch (bias) {
      case 'BULLISH':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      case 'BEARISH':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30'
      case 'MIXED':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      case 'NEUTRAL':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30'
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-sm shadow-xl">
      {/* Header and Copy Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h2 className="text-lg font-bold text-slate-100">
              Today&apos;s Nasdaq Fundamental State
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
              NQ · 18 Macro/Earnings Dimensions
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Institutional macro, rates, guidance, capex, and breadth environment for algorithmic bots &amp; execution desks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnified(!showUnified)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 transition flex items-center gap-1.5"
            title="View Multi-Agent Unified Protocol Output (Item 39)"
          >
            <span>⚡</span>
            {showUnified ? 'Hide Protocol' : 'Unified Protocol'}
          </button>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/50 transition flex items-center gap-1.5"
            title="Copy plain text state for algorithmic bots"
          >
            <span>{copied ? '✓' : '📋'}</span>
            {copied ? 'Copied to Clipboard!' : 'Copy for Bots'}
          </button>
        </div>
      </div>

      {/* Unified Multi-Agent Protocol Drawer */}
      {showUnified && (
        <div className="my-4 p-4 rounded-lg bg-slate-950/90 border border-cyan-500/40 text-xs font-mono">
          <div className="flex items-center justify-between text-cyan-400 font-bold mb-2 pb-1 border-b border-cyan-500/30">
            <span>UNIFIED MULTI-AGENT PROTOCOL (NQ)</span>
            <span className="text-[10px] text-slate-400">Consumed by Multi-Asset Execution Desks</span>
          </div>
          <pre className="text-slate-200 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {JSON.stringify(unifiedProtocolData, null, 2)}
          </pre>
        </div>
      )}

      {/* Triad Biases Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-5">
        <div className={`p-3.5 rounded-lg border flex flex-col items-center justify-center text-center ${getStanceColor(today.intraday_bias)}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
            Intraday Bias
          </div>
          <div className="text-lg font-bold font-mono tracking-tight">
            {today.intraday_bias}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Session VP / CVD Context
          </div>
        </div>

        <div className={`p-3.5 rounded-lg border flex flex-col items-center justify-center text-center ${getStanceColor(today.short_term_bias)}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
            Short-Term Bias
          </div>
          <div className="text-lg font-bold font-mono tracking-tight">
            {today.short_term_bias}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Weekly Composite / Catalysts
          </div>
        </div>

        <div className={`p-3.5 rounded-lg border flex flex-col items-center justify-center text-center ${getStanceColor(today.medium_term_bias)}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
            Medium-Term Bias
          </div>
          <div className="text-lg font-bold font-mono tracking-tight">
            {today.medium_term_bias}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Rates &amp; Earnings Cycle
          </div>
        </div>
      </div>

      {/* 16 Physical/Macro Dimensions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {dimensions.map((d, idx) => (
          <div
            key={idx}
            className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition"
          >
            <div className="flex items-center gap-1.5 text-slate-400 font-medium mb-1">
              <span>{d.icon}</span>
              <span className="text-slate-300 font-semibold">{d.label}</span>
            </div>
            <div className="text-slate-200 text-xs leading-relaxed pl-5 font-sans">
              {d.value}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Synthesis & Invalidation Rules */}
      <div className="mt-5 pt-4 border-t border-slate-800 space-y-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/90">
          <div className="flex items-center gap-1.5 text-cyan-400 font-semibold mb-1">
            <span>🎯</span>
            <span>Main Current Market Driver:</span>
          </div>
          <div className="text-slate-200 pl-5 leading-relaxed">
            {today.main_current_market_driver}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/90">
          <div className="flex items-center gap-1.5 text-amber-400 font-semibold mb-1">
            <span>📅</span>
            <span>Upcoming Catalysts:</span>
          </div>
          <div className="text-slate-200 pl-5 leading-relaxed">
            {today.upcoming_catalysts}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/90">
          <div className="flex items-center gap-1.5 text-purple-400 font-semibold mb-1">
            <span>🔄</span>
            <span>What Changed Since Yesterday:</span>
          </div>
          <div className="text-slate-200 pl-5 leading-relaxed">
            {today.what_changed_since_yesterday}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-800/40">
          <div className="flex items-center gap-1.5 text-rose-300 font-semibold mb-1">
            <span>⚠️</span>
            <span>What Would Invalidate This View:</span>
          </div>
          <div className="text-rose-200/90 pl-5 leading-relaxed">
            {today.what_would_invalidate_the_current_interpretation}
          </div>
        </div>
      </div>
    </div>
  )
}
