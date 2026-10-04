'use client'

/**
 * Today's Gold Fundamental State Component
 * Implements Item 37: 14 Physical/Macro dimensions + Biases + Invalidation rules
 * Implements Item 39: Unified Multi-Agent Protocol viewer
 */

import React, { useState } from 'react'
import type { TodaysGoldFundamentalState, UnifiedAgentProtocolOutput, GoldTelemetry } from '@/types/fundamentals'

interface TodayGoldFundamentalCardProps {
  today: TodaysGoldFundamentalState
  telemetry: GoldTelemetry
}

export function TodayGoldFundamentalCard({ today, telemetry }: TodayGoldFundamentalCardProps) {
  const [copied, setCopied] = useState(false)
  const [showUnified, setShowUnified] = useState(false)

  const formattedText = [
    `GOLD FUNDAMENTAL STATE`,
    `Monetary policy: ${today.monetary_policy}`,
    `Real-rate regime: ${today.real_rate_regime}`,
    `USD regime: ${today.usd_regime}`,
    `Inflation: ${today.inflation}`,
    `Growth: ${today.growth}`,
    `Financial stress: ${today.financial_stress}`,
    `Geopolitical risk: ${today.geopolitical_risk}`,
    `ETF flows: ${today.etf_flows}`,
    `Central-bank demand: ${today.central_bank_demand}`,
    `CFTC positioning: ${today.cftc_positioning}`,
    `Physical demand: ${today.physical_demand}`,
    `Supply: ${today.supply}`,
    `COMEX inventory/deliveries: ${today.comex_inventory_deliveries}`,
    `Gold volatility: ${today.gold_volatility}`,
    ``,
    `INTRADAY BIAS: ${today.intraday_bias}`,
    `SHORT-TERM BIAS: ${today.short_term_bias}`,
    `MEDIUM-TERM BIAS: ${today.medium_term_bias}`,
    ``,
    `Main current driver: ${today.main_current_driver}`,
    `Upcoming catalysts: ${today.upcoming_catalysts}`,
    `What changed since yesterday: ${today.what_changed_since_yesterday}`,
    `What would invalidate the current thesis: ${today.what_would_invalidate_this_view}`,
  ].join('\n')

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const unifiedProtocolData: UnifiedAgentProtocolOutput = {
    market: 'GC',
    regime: `10Y Real TIPS ${telemetry.us10yRealYield.toFixed(2)}% | Breakeven ${telemetry.us10yBreakeven.toFixed(2)}% | DXY ${telemetry.dxyIndex.toFixed(2)} | Official CB ~1,080t/yr`,
    catalyst: today.main_current_driver,
    expected_direction: today.short_term_bias,
    magnitude: 'HIGH',
    horizon: 'SHORT_TERM',
    confidence: 0.85,
    market_confirmation: 'CONFIRMED',
    key_drivers: [
      {
        factor: 'REAL_YIELDS_TIPS',
        impact: `10Y TIPS real yield holding at ${telemetry.us10yRealYield.toFixed(2)}%`,
        effect: telemetry.us10yRealYield > 3.0 ? 'BEARISH' : 'NEUTRAL',
      },
      {
        factor: 'USD_DXY',
        impact: `DXY at ${telemetry.dxyIndex.toFixed(2)} (EUR/USD ${telemetry.eurUsd.toFixed(4)})`,
        effect: telemetry.dxyChangePct > 0.5 ? 'BEARISH' : 'BULLISH',
      },
      {
        factor: 'CENTRAL_BANK_DEMAND',
        impact: `Sovereign reserve de-dollarization pacing record >1,000t/yr`,
        effect: 'BULLISH',
      },
    ],
    invalidation: today.what_would_invalidate_this_view,
  }

  const dimensions = [
    { label: 'Monetary policy', value: today.monetary_policy, icon: '🏛️' },
    { label: 'Real-rate regime', value: today.real_rate_regime, icon: '📊' },
    { label: 'USD regime', value: today.usd_regime, icon: '💵' },
    { label: 'Inflation', value: today.inflation, icon: '🔥' },
    { label: 'Growth', value: today.growth, icon: '📈' },
    { label: 'Financial stress', value: today.financial_stress, icon: '⚠️' },
    { label: 'Geopolitical risk', value: today.geopolitical_risk, icon: '🌍' },
    { label: 'ETF flows', value: today.etf_flows, icon: '📦' },
    { label: 'Central-bank demand', value: today.central_bank_demand, icon: '🏦' },
    { label: 'CFTC positioning', value: today.cftc_positioning, icon: '🎯' },
    { label: 'Physical demand', value: today.physical_demand, icon: '💍' },
    { label: 'Supply', value: today.supply, icon: '⛏️' },
    { label: 'COMEX inventory/deliveries', value: today.comex_inventory_deliveries, icon: '🏭' },
    { label: 'Gold volatility', value: today.gold_volatility, icon: '📉' },
  ]

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h2 className="text-lg font-bold text-slate-100">
              TODAY'S GOLD FUNDAMENTAL STATE
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Live Macro Anchor
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Continuously maintained physical, monetary & positioning matrix for COMEX GC.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnified(!showUnified)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            {showUnified ? 'Hide Unified Protocol' : 'Unified Protocol (Item 39)'}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-slate-950 transition shadow-sm"
          >
            <span>{copied ? '✓ Copied!' : '📋 Copy for Bots'}</span>
          </button>
        </div>
      </div>

      {/* Unified Protocol Drawer if toggled */}
      {showUnified && (
        <div className="mt-4 p-4 rounded-lg bg-slate-950 border border-amber-500/30 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-amber-400 font-bold">
            <span>UNIFIED MULTI-AGENT PROTOCOL OUTPUT (OIL · NQ · GOLD)</span>
            <span className="text-[10px] text-slate-400">Uniform cross-agent execution schema</span>
          </div>
          <pre className="text-emerald-400 whitespace-pre-wrap overflow-x-auto">
            {JSON.stringify(unifiedProtocolData, null, 2)}
          </pre>
        </div>
      )}

      {/* 14 Core Dimensions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 my-5">
        {dimensions.map((dim, idx) => (
          <div
            key={idx}
            className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 hover:border-slate-700 transition"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/90 mb-1">
              <span>{dim.icon}</span>
              <span>{dim.label}:</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed pl-5">
              {dim.value}
            </p>
          </div>
        ))}
      </div>

      {/* Biases & Syntheses Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800 mb-4">
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-center">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            INTRADAY BIAS
          </div>
          <div className="text-sm font-bold font-mono text-amber-300">
            {today.intraday_bias}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-center">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            SHORT-TERM BIAS (1-10d)
          </div>
          <div className="text-sm font-bold font-mono text-emerald-400">
            {today.short_term_bias}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-center">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            MEDIUM-TERM BIAS (1-3m)
          </div>
          <div className="text-sm font-bold font-mono text-emerald-400">
            {today.medium_term_bias}
          </div>
        </div>
      </div>

      {/* Catalysts & Revisions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-xs">
        <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
          <span className="font-semibold text-slate-300 block mb-1">📅 Upcoming catalysts:</span>
          <p className="text-slate-400 leading-relaxed">{today.upcoming_catalysts}</p>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
          <span className="font-semibold text-slate-300 block mb-1">🔄 What changed since yesterday:</span>
          <p className="text-slate-400 leading-relaxed">{today.what_changed_since_yesterday}</p>
        </div>
      </div>

      {/* Invalidation Criteria (CRITICAL TRADING ANCHOR) */}
      <div className="p-4 rounded-lg bg-rose-950/20 border border-rose-800/40 text-xs">
        <div className="flex items-center gap-2 text-rose-400 font-bold mb-1">
          <span>🛑</span>
          <span className="uppercase tracking-wider">What would invalidate the current thesis:</span>
        </div>
        <p className="text-rose-200/90 leading-relaxed pl-6">
          {today.what_would_invalidate_this_view}
        </p>
      </div>
    </div>
  )
}
