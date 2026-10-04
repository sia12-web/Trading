'use client'

/**
 * Gold Fundamentals Header & Live Macro Telemetry Bar
 * Market: COMEX Gold Futures (GC)
 */

import React from 'react'
import type { GoldFundamentalDashboardState } from '@/types/fundamentals'

interface GoldFundamentalsHeaderProps {
  state: GoldFundamentalDashboardState
  onRefresh: () => void
  onReset: () => void
  refreshing: boolean
}

export function GoldFundamentalsHeader({
  state,
  onRefresh,
  onReset,
  refreshing,
}: GoldFundamentalsHeaderProps) {
  const t = state.goldTelemetry
  const today = state.today

  const getStanceColor = (bias: string) => {
    switch (bias) {
      case 'BULLISH':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      case 'BEARISH':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      case 'MIXED':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      case 'NEUTRAL':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
      default:
        return 'bg-slate-500/15 text-slate-400 border-slate-500/30'
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 mb-6 backdrop-blur-sm shadow-xl">
      {/* Top Bar: Title, Persona & Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-2xl">🪙</span>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">
              COMEX Gold Futures (GC)
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Macro · Monetary · Physical Demand
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Maintains continuous fundamental context for COMEX GC. Your Volume Profile + Wyckoff + CVD system decides the trade.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
            title="Refresh live prices, FRED real yields and headlines"
          >
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshing ? 'Refreshing...' : 'Refresh Telemetry'}
          </button>
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700/80 hover:border-rose-800/50 transition"
            title="Reset state to baseline"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Live Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4">
        {/* 1. Prompt Gold Price */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>COMEX Gold (GC)</span>
            <span className="text-[10px] font-mono text-amber-400">Prompt</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100">
            ${t.goldPrice.toFixed(2)}
          </div>
          <div className={`text-xs font-mono font-medium ${t.goldChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {t.goldChange >= 0 ? '+' : ''}${t.goldChange.toFixed(2)} ({t.goldChangePct >= 0 ? '+' : ''}{t.goldChangePct.toFixed(2)}%)
          </div>
        </div>

        {/* 2. 10Y Real TIPS Yield */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>10Y Real Yield (TIPS)</span>
            <span className="text-[10px] font-mono text-sky-400">DFII10</span>
          </div>
          <div className="text-lg font-bold font-mono text-sky-300">
            {t.us10yRealYield.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-400 truncate" title="Real Yield = Nominal - Inflation Expectation">
            Opportunity Cost Anchor
          </div>
        </div>

        {/* 3. 10Y Nominal & Breakeven */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>10Y Nominal & BE</span>
            <span className="text-[10px] font-mono text-slate-400">^TNX</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-200">
            {t.us10yNominalYield.toFixed(2)}%
          </div>
          <div className="text-[10px] font-mono text-emerald-400 truncate">
            BE: {t.us10yBreakeven.toFixed(2)}% (T10YIE)
          </div>
        </div>

        {/* 4. US Dollar Index (DXY) */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>US Dollar Index</span>
            <span className="text-[10px] font-mono text-amber-300">DXY</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {t.dxyIndex.toFixed(2)}
          </div>
          <div className={`text-[10px] font-mono ${t.dxyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {t.dxyChangePct >= 0 ? '+' : ''}{t.dxyChangePct.toFixed(2)}% · EUR {t.eurUsd.toFixed(4)}
          </div>
        </div>

        {/* 5. Silver & Gold/Silver Ratio */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Silver & Ratio</span>
            <span className="text-[10px] font-mono text-slate-400">GSR</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-200">
            ${t.silverPrice.toFixed(2)}
          </div>
          <div className="text-[10px] font-mono text-amber-300">
            GSR: {t.goldSilverRatio.toFixed(1)}:1
          </div>
        </div>

        {/* 6. Gold CVOL (Implied Volatility) */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Gold CVOL (30d)</span>
            <span className="text-[10px] font-mono text-purple-400">Options</span>
          </div>
          <div className="text-lg font-bold font-mono text-purple-300">
            {t.goldCvol.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400">
            Realized: {t.goldRealizedVol30d.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Horizon Biases & Macro Driver Strip */}
      <div className="mt-4 pt-3 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-medium">Stance Horizon:</span>
          
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border bg-slate-950">
            <span className="text-[10px] uppercase text-slate-400 font-semibold">Intraday:</span>
            <span className={`text-xs font-bold ${getStanceColor(today.intraday_bias)} px-1.5 py-0.5 rounded border`}>
              {today.intraday_bias}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border bg-slate-950">
            <span className="text-[10px] uppercase text-slate-400 font-semibold">Short-Term (1-10d):</span>
            <span className={`text-xs font-bold ${getStanceColor(today.short_term_bias)} px-1.5 py-0.5 rounded border`}>
              {today.short_term_bias}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border bg-slate-950">
            <span className="text-[10px] uppercase text-slate-400 font-semibold">Medium-Term (1-3m):</span>
            <span className={`text-xs font-bold ${getStanceColor(today.medium_term_bias)} px-1.5 py-0.5 rounded border`}>
              {today.medium_term_bias}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-400">
          <span className="text-[11px]">Primary Anchor:</span>
          <span className="text-slate-200 font-medium truncate max-w-xs md:max-w-md">
            {today.main_current_driver}
          </span>
        </div>
      </div>
    </div>
  )
}
