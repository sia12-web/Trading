'use client'

/**
 * Nasdaq Fundamentals Header & Live Macro/Rates Telemetry Bar
 * Market: CME E-mini Nasdaq-100 Futures (NQ)
 */

import React from 'react'
import type { NasdaqFundamentalDashboardState } from '@/types/fundamentals'
import { confidencePercent, showNumber } from '@/lib/fundamentals/honesty'

interface NasdaqFundamentalsHeaderProps {
  state: NasdaqFundamentalDashboardState
  onRefresh: () => void
  onReset: () => void
  refreshing: boolean
}

export function NasdaqFundamentalsHeader({
  state,
  onRefresh,
  onReset,
  refreshing,
}: NasdaqFundamentalsHeaderProps) {
  const t = state.nasdaqTelemetry
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

  const getRelativeStrengthLabel = (rs: string) => {
    switch (rs) {
      case 'GROWTH_TECH_LEADERSHIP':
        return { label: 'NQ Tech Leading', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
      case 'VALUE_DEFENSIVE_LEADERSHIP':
        return { label: 'YM/ES Defensive Rotation', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' }
      case 'BROAD_RISK_ON':
        return { label: 'Broad Risk-On (NQ+ES+YM)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' }
      case 'BROAD_LIQUIDATION':
        return { label: 'Broad Liquidation', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' }
      default:
        return { label: 'Neutral Relative Strength', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }
    }
  }

  const rsMeta = getRelativeStrengthLabel(t.relativeStrengthStance)

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 mb-6 backdrop-blur-sm shadow-xl">
      {/* Top Bar: Title, Persona & Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-2xl">💻</span>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">
              CME E-mini Nasdaq-100 (NQ)
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Macro · Earnings · Rates · Order Flow
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Maintains continuous fundamental context for Nasdaq-100. Your Volume Profile + Wyckoff + CVD system decides the trade.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
            title="Refresh live NQ/ES/YM, FRED yields, VXN/VIX, and tech headlines"
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
        {/* 1. Prompt NQ Futures Price */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Nasdaq-100 (NQ)</span>
            <span className="text-[10px] font-mono text-cyan-400">Front CME</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {t.sourced?.nq ? t.nqPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unavailable'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs">
            <span
              className={`font-semibold font-mono ${
                t.nqChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {t.sourced?.nq ? `${t.nqChangePct >= 0 ? '+' : ''}${t.nqChangePct.toFixed(2)}%` : 'Unavailable'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {t.sourced?.nq ? `(${t.nqChange >= 0 ? '+' : ''}${t.nqChange.toFixed(1)} pts)` : ''}
            </span>
          </div>
        </div>

        {/* 2. Rates Engine: US 2Y & 10Y Yields */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Treasury Yields</span>
            <span className="text-[10px] font-mono text-slate-400">2Y · 10Y</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-slate-200">
              {showNumber(t.sourced?.us2y, t.us2yNominalYield, 2, '%')}
            </span>
            <span className="text-xs text-slate-400 font-mono">2Y</span>
            <span className="text-base font-bold font-mono text-slate-200 ml-1">
              {showNumber(t.sourced?.us10y, t.us10yNominalYield, 2, '%')}
            </span>
            <span className="text-xs text-slate-400 font-mono">10Y</span>
          </div>
          <div className="flex items-center justify-between mt-0.5 text-[11px]">
            <span className="text-slate-400">2s10s Spread:</span>
            <span className={`font-mono font-semibold ${t.yieldCurve2s10sSpreadBps >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}>
              {t.sourced?.us2y && t.sourced?.us10y
                ? `${t.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}${t.yieldCurve2s10sSpreadBps.toFixed(1)} bps`
                : 'Unavailable'}
            </span>
          </div>
        </div>

        {/* 3. Real 10Y TIPS Yield (FRED DFII10) */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>10Y Real TIPS Yield</span>
            <span className="text-[10px] font-mono text-emerald-400">FRED DFII10</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {showNumber(t.sourced?.us10yReal, t.us10yRealYield, 2, '%')}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Discount rate for growth valuation
          </div>
        </div>

        {/* 4. Implied Volatility: VXN vs VIX */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Tech Vol (VXN / VIX)</span>
            <span className="text-[10px] font-mono text-indigo-400">CBOE</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold font-mono text-slate-100">
              {showNumber(t.sourced?.vxn, t.vxnIndex, 2)}
            </span>
            <span className="text-xs text-slate-400 font-mono">VXN</span>
            <span className="text-sm font-semibold font-mono text-slate-300 ml-1">
              {showNumber(t.sourced?.vix, t.vixIndex, 2)}
            </span>
            <span className="text-xs text-slate-400 font-mono">VIX</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {t.sourced?.vxn && t.sourced?.vix
              ? `Spread: ${(t.vxnIndex - t.vixIndex >= 0 ? '+' : '')}${(t.vxnIndex - t.vixIndex).toFixed(2)} pts`
              : 'Spread unavailable'}
          </div>
        </div>

        {/* 5. Relative Strength: NQ vs ES & YM */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>NQ vs ES vs YM</span>
            <span className="text-[10px] font-mono text-cyan-400">Cross-Asset</span>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">ES:</span>
            <span className={t.esChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {showNumber(t.sourced?.es, t.esChangePct, 2, '%')}
            </span>
            <span className="text-slate-400 ml-2">YM:</span>
            <span className={t.ymChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {showNumber(t.sourced?.ym, t.ymChangePct, 2, '%')}
            </span>
          </div>
          <div className="mt-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${rsMeta.color}`}>
              {rsMeta.label}
            </span>
          </div>
        </div>

        {/* 6. AI & Semi Basket + Breadth */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Semis & Breadth</span>
            <span className="text-[10px] font-mono text-amber-400">SOXX · A/D</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Semi Basket:</span>
            <span className={`text-xs font-mono font-bold ${t.semiBasketChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              Unavailable
            </span>
          </div>
          <div className="flex items-center justify-between mt-1 text-[11px]">
            <span className="text-slate-400">A/D Ratio:</span>
            <span className="font-mono font-bold text-slate-400">
              Unavailable
            </span>
          </div>
        </div>
      </div>

      {/* Fundamental Stance Bar */}
      <div className="mt-4 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Fundamental Horizon Stance:</span>
          <span className={`px-2 py-0.5 rounded border font-bold ${getStanceColor(today.intraday_bias)}`}>
            Intraday: {today.intraday_bias}
          </span>
          <span className={`px-2 py-0.5 rounded border font-bold ${getStanceColor(today.short_term_bias)}`}>
            Short-Term: {today.short_term_bias}
          </span>
          <span className={`px-2 py-0.5 rounded border font-bold ${getStanceColor(today.medium_term_bias)}`}>
            Medium-Term: {today.medium_term_bias}
          </span>
        </div>

        <div className="flex items-center gap-4 text-slate-400">
          <div className="flex items-center gap-1.5">
            <span>Regime:</span>
            <span className="font-mono text-cyan-300 font-medium">{today.fed_regime ? 'Data-Dependent' : 'Balanced'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Confidence:</span>
            <span className="font-mono text-slate-200 font-bold">{confidencePercent(state.overallConfidence)}%</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Updated: {new Date(state.updatedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  )
}
