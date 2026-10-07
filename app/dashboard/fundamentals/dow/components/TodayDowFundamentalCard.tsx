'use client'

/**
 * Today's Dow Fundamental State Component
 * Implements Item 35: 24 Physical/Macro/Cyclical dimensions + Biases + Invalidation rules
 * Implements Item 39: Unified Multi-Agent Protocol viewer for YM
 */

import React, { useState } from 'react'
import type { TodaysDowFundamentalState, UnifiedAgentProtocolOutput, DowTelemetry, DowRotationState, DowCreditState } from '@/types/fundamentals'
import { formatTodaysDowFundamentalStateText } from '@/lib/fundamentals/dowStateStore'

interface TodayDowFundamentalCardProps {
  today: TodaysDowFundamentalState
  telemetry: DowTelemetry
  rotation: DowRotationState
  credit: DowCreditState
}

export function TodayDowFundamentalCard({
  today,
  telemetry,
  rotation,
  credit,
}: TodayDowFundamentalCardProps) {
  const [copied, setCopied] = useState(false)
  const [showUnified, setShowUnified] = useState(false)

  const formattedText = formatTodaysDowFundamentalStateText(today)

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const unifiedProtocolData: UnifiedAgentProtocolOutput = {
    market: 'YM',
    regime: [
      telemetry.sourced?.us2y ? `2Y ${telemetry.us2yNominalYield.toFixed(2)}%` : '2Y unavailable',
      telemetry.sourced?.us10y ? `10Y ${telemetry.us10yNominalYield.toFixed(2)}%` : '10Y unavailable',
      telemetry.sourced?.hyOas ? `HY OAS ${credit.highYieldSpreadBps} bp` : 'HY OAS unavailable',
      telemetry.sourced?.ym && telemetry.sourced?.nq ? `YM vs NQ ${rotation.ymVsNqSpreadPct}%` : 'rotation unavailable',
    ].join(' | '),
    catalyst: today.primary_current_driver,
    expected_direction: today.short_term_bias,
    magnitude: 'LOW',
    horizon: 'SHORT_TERM',
    confidence: 0,
    market_confirmation: 'INCONCLUSIVE',
    key_drivers: [
      ...(telemetry.sourced?.hyOas
        ? [{ factor: 'CREDIT_CONDITIONS', impact: `High-yield OAS ${credit.highYieldSpreadBps} bp`, effect: 'NEUTRAL' as const }]
        : []),
    ],
    invalidation: today.what_would_invalidate_the_current_interpretation,
  }

  const dimensions = [
    { label: 'Economic growth', value: today.economic_growth, icon: '🏛️' },
    { label: 'Manufacturing', value: today.manufacturing, icon: '🏭' },
    { label: 'Consumer', value: today.consumer, icon: '🛒' },
    { label: 'Labor', value: today.labor, icon: '💼' },
    { label: 'Inflation', value: today.inflation, icon: '🔥' },
    { label: 'Fed policy', value: today.fed, icon: '🏦' },
    { label: '2Y Treasury Yield', value: today.us2y, icon: '⏱️' },
    { label: '10Y Treasury Yield', value: today.us10y, icon: '📈' },
    { label: 'Yield curve', value: today.yield_curve, icon: '📐' },
    { label: 'Financial conditions', value: today.financial_conditions, icon: '💵' },
    { label: 'Credit markets', value: today.credit, icon: '💳' },
    { label: 'Industrial sector', value: today.industrial_sector, icon: '🚜' },
    { label: 'Financial sector', value: today.financial_sector, icon: '🏦' },
    { label: 'Energy sector', value: today.energy, icon: '🛢️' },
    { label: 'Healthcare sector', value: today.healthcare, icon: '🏥' },
    { label: 'Consumer sectors', value: today.consumer_sectors, icon: '📦' },
    { label: 'DJIA earnings', value: today.djia_earnings, icon: '📊' },
    { label: 'Forward guidance', value: today.forward_guidance, icon: '🔭' },
    { label: 'US dollar (DXY)', value: today.usd, icon: '💲' },
    { label: 'Trade & tariff policy', value: today.trade_policy, icon: '🚢' },
    { label: 'DJIA Breadth', value: today.breadth, icon: '🌐' },
    { label: 'Contribution concentration', value: today.contribution_concentration, icon: '⚖️' },
    { label: 'Sector rotation', value: today.sector_rotation, icon: '🔄' },
    { label: 'CFTC positioning', value: today.cftc_positioning, icon: '🎯' },
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
              Today&apos;s Dow Fundamental State
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              YM · sourced prints only
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Blue-chip cyclical, manufacturing, earnings, credit, and price-weighting assessment for algorithmic trading bots.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUnified(!showUnified)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            {showUnified ? 'Hide Protocol' : 'Unified Protocol'}
          </button>
          <button
            onClick={handleCopy}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
              copied
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-600'
                : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500'
            }`}
          >
            <span>{copied ? '✓' : '📋'}</span>
            <span>{copied ? 'Copied for Bots!' : 'Copy for Trading Bots'}</span>
          </button>
        </div>
      </div>

      {/* Unified Multi-Agent Protocol Drawer */}
      {showUnified && (
        <div className="mt-4 p-4 rounded-lg bg-slate-950/80 border border-blue-500/30 text-xs">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <span className="font-semibold text-blue-400 font-mono">
              UNIFIED PROTOCOL · YM
            </span>
            <span className="text-slate-400 font-mono text-[10px]">
              Ready for Automated Cross-Market Bots
            </span>
          </div>
          <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {JSON.stringify(unifiedProtocolData, null, 2)}
          </pre>
        </div>
      )}

      {/* Primary Biases Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-5">
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">INTRADAY BIAS</span>
          <span className={`inline-block px-2.5 py-1 rounded text-sm font-bold border ${getStanceColor(today.intraday_bias)}`}>
            {today.intraday_bias}
          </span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">SHORT-TERM BIAS</span>
          <span className={`inline-block px-2.5 py-1 rounded text-sm font-bold border ${getStanceColor(today.short_term_bias)}`}>
            {today.short_term_bias}
          </span>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">MEDIUM-TERM BIAS</span>
          <span className={`inline-block px-2.5 py-1 rounded text-sm font-bold border ${getStanceColor(today.medium_term_bias)}`}>
            {today.medium_term_bias}
          </span>
        </div>
      </div>

      {/* 24 Dimensions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {dimensions.map((d, idx) => (
          <div
            key={idx}
            className="bg-slate-950/50 hover:bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 transition"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">{d.icon}</span>
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                {d.label}
              </span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed font-mono">
              {d.value}
            </p>
          </div>
        ))}
      </div>

      {/* Context, Catalysts, Revisions & Invalidation */}
      <div className="mt-5 space-y-3 pt-4 border-t border-slate-800">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider block mb-1">
            Primary Current Market Driver
          </span>
          <p className="text-xs text-slate-200 font-mono">
            {today.primary_current_driver}
          </p>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider block mb-1">
            Upcoming Catalysts
          </span>
          <p className="text-xs text-slate-200 font-mono">
            {today.upcoming_catalysts}
          </p>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
          <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block mb-1">
            What Changed Since Yesterday
          </span>
          <p className="text-xs text-slate-200 font-mono">
            {today.what_changed_since_yesterday}
          </p>
        </div>

        <div className="bg-rose-950/20 border border-rose-800/40 rounded-lg p-3">
          <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider block mb-1">
            What Would Invalidate This View (Strict Safeguard)
          </span>
          <p className="text-xs text-rose-200 font-mono leading-relaxed">
            {today.what_would_invalidate_the_current_interpretation}
          </p>
        </div>
      </div>
    </div>
  )
}
