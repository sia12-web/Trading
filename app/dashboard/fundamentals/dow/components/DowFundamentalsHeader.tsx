'use client'

/**
 * Dow Fundamentals Header & Live Macro/Cyclical/Rotation Telemetry Bar
 * Market: CME E-mini Dow Futures (YM, $5 Multiplier)
 */

import React from 'react'
import type { DowFundamentalDashboardState } from '@/types/fundamentals'

interface DowFundamentalsHeaderProps {
  state: DowFundamentalDashboardState
  onRefresh: () => void
  onReset: () => void
  refreshing: boolean
}

export function DowFundamentalsHeader({
  state,
  onRefresh,
  onReset,
  refreshing,
}: DowFundamentalsHeaderProps) {
  const t = state.dowTelemetry
  const rot = state.rotation
  const cred = state.credit
  const contrib = state.contribution

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

  const getYieldDriverBadge = (driver: string) => {
    switch (driver) {
      case 'GROWTH_DRIVEN':
        return { label: 'Growth-Driven Yields', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
      case 'INFLATION_DRIVEN':
        return { label: 'Inflation-Driven Yields', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' }
      case 'FED_DRIVEN':
        return { label: 'Fed Policy Shifts', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' }
      case 'RISK_OFF':
        return { label: 'Flight to Safety', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' }
      default:
        return { label: 'Yield Stable', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }
    }
  }

  const getRotationBadge = (regime: string) => {
    switch (regime) {
      case 'CYCLICAL_VALUE_OUTPERFORMANCE':
        return { label: 'Cyclical / Value Leading', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
      case 'TECH_GROWTH_OUTPERFORMANCE':
        return { label: 'Tech Growth Leading', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' }
      case 'BROAD_RISK_ON':
        return { label: 'Broad Risk-On (YM+ES+NQ)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' }
      case 'BROAD_RISK_OFF':
        return { label: 'Broad Risk-Off', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' }
      case 'DEFENSIVE_HEALTHCARE_CONSUMER':
        return { label: 'Defensive Rotation', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' }
      default:
        return { label: 'Balanced Rotation', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }
    }
  }

  const getCreditBadge = (regime: string) => {
    switch (regime) {
      case 'HEALTHY_EXPANSION':
        return { label: 'Credit Healthy', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
      case 'MILD_COMPRESSION':
        return { label: 'Spreads Tightening', color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' }
      case 'STRESS_WIDENING':
        return { label: 'Spreads Widening', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' }
      case 'ACUTE_DISLOCATION':
        return { label: 'Credit Dislocation', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' }
      default:
        return { label: 'Normal Credit', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }
    }
  }

  const yieldDriverMeta = getYieldDriverBadge(t.yieldMoveDriver)
  const rotMeta = getRotationBadge(rot.rotationRegime)
  const credMeta = getCreditBadge(cred.creditStressRegime)

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 mb-6 backdrop-blur-sm shadow-xl">
      {/* Top Bar: Title, Persona & Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-2xl">🏭</span>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">
              CME E-mini Dow ($5) Futures (YM)
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Macro · Cyclical Economy · Earnings · Sector Rotation
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Price-weighted DJIA 30 analyst engine ($5/pt, Divisor: {t.dowDivisor}). Fundamental context informs the desk; Volume Profile + Wyckoff + CVD decides the trade.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
            title="Refresh live YM/ES/NQ/RTY, yields, credit spreads, and constituent prices"
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
        {/* 1. Prompt YM Futures Price */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>E-mini Dow (YM)</span>
            <span className="text-[10px] font-mono text-blue-400">$5 / pt</span>
          </div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {t.ymPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs">
            <span
              className={`font-semibold font-mono ${
                t.ymChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {t.ymChangePct >= 0 ? '+' : ''}
              {t.ymChangePct.toFixed(2)}%
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              ({t.ymChange >= 0 ? '+' : ''}{t.ymChange.toFixed(0)} pts)
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono">
            Notional: ${(t.contractNotionalValue / 1000).toFixed(1)}k
          </div>
        </div>

        {/* 2. Rates & Yield Move Driver */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Rates Transmission</span>
            <span className="text-[10px] font-mono text-slate-400">2s10s</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-slate-200">
              {t.us10yNominalYield.toFixed(2)}%
            </span>
            <span className="text-xs text-slate-400 font-mono">10Y</span>
            <span className="text-xs font-mono text-emerald-400 ml-1">
              +{t.yieldCurve2s10sSpreadBps}bp
            </span>
          </div>
          <div className="mt-1">
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ${yieldDriverMeta.color}`}
            >
              {yieldDriverMeta.label}
            </span>
          </div>
        </div>

        {/* 3. Cross-Market & Sector Rotation */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Sector Rotation</span>
            <span className="text-[10px] font-mono text-blue-400">YM vs NQ</span>
          </div>
          <div className="flex items-baseline gap-1 text-sm font-mono font-bold">
            <span className={rot.ymVsNqSpreadPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {rot.ymVsNqSpreadPct >= 0 ? '+' : ''}{rot.ymVsNqSpreadPct}%
            </span>
            <span className="text-[10px] text-slate-400 font-normal">spread</span>
          </div>
          <div className="mt-1">
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border truncate max-w-full ${rotMeta.color}`}
              title={rotMeta.label}
            >
              {rotMeta.label}
            </span>
          </div>
        </div>

        {/* 4. Credit Conditions (HYG & OAS) */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Credit Health</span>
            <span className="text-[10px] font-mono text-slate-400">HY OAS</span>
          </div>
          <div className="flex items-baseline gap-1 text-sm font-mono font-bold text-slate-200">
            <span>{cred.highYieldSpreadBps} bps</span>
            <span className="text-[10px] text-slate-400 font-normal">(HYG ${cred.hygPrice.toFixed(1)})</span>
          </div>
          <div className="mt-1">
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ${credMeta.color}`}
            >
              {credMeta.label}
            </span>
          </div>
        </div>

        {/* 5. DJIA 30 Price-Weighting & Concentration */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>DJIA Breadth & Conc.</span>
            <span className="text-[10px] font-mono text-blue-400">Top 3</span>
          </div>
          <div className="flex items-baseline gap-1.5 text-sm font-mono font-bold text-slate-200">
            <span className="text-emerald-400">{t.advancersCount}A</span>
            <span className="text-slate-500">/</span>
            <span className="text-rose-400">{t.declinersCount}D</span>
            <span className="text-[10px] text-slate-400 font-normal font-sans ml-1">
              ({contrib.top3ContributionPct.toFixed(0)}% top3)
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-mono">
            Equal: {contrib.equalWeight30ReturnPct >= 0 ? '+' : ''}{contrib.equalWeight30ReturnPct}% vs DJIA: {contrib.priceWeightedDjiaReturnPct >= 0 ? '+' : ''}{contrib.priceWeightedDjiaReturnPct}%
          </div>
        </div>

        {/* 6. Active Stances & Invalidation */}
        <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Active Fundamental Bias</span>
            <span className="text-[10px] font-mono text-emerald-400">{state.overallConfidence}% Conf</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${getStanceColor(state.today.intraday_bias)}`}>
              {state.today.intraday_bias}
            </span>
            <span className="text-[10px] text-slate-400">Intraday</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 truncate" title={state.biasSummary}>
            {state.biasSummary}
          </div>
        </div>
      </div>
    </div>
  )
}
