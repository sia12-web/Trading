'use client'

import React from 'react'
import type { NikkeiFundamentalDashboardState } from '@/types/fundamentals'
import { confidencePercent, showNumber } from '@/lib/fundamentals/honesty'

interface NikkeiFundamentalsHeaderProps {
  state: NikkeiFundamentalDashboardState | null
  onRefresh: () => void
  refreshing: boolean
}

export function NikkeiFundamentalsHeader({
  state,
  onRefresh,
  refreshing,
}: NikkeiFundamentalsHeaderProps) {
  if (!state) return null

  const t = state.nikkeiTelemetry
  const fx = state.fx

  const biasColor =
    state.overallBias === 'BULLISH'
      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      : state.overallBias === 'BEARISH'
      ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 backdrop-blur-md shadow-xl">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Title & Persona */}
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🏯</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-wide">
                  Nikkei 225 Fundamental Analyst Engine
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-mono font-semibold">
                  CME NKD ($5/pt)
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  JPX Cash 09:00 JST
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {state.analystPersona}
              </p>
            </div>
          </div>
        </div>

        {/* Live Bias Badge & Refresh */}
        <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
          <div className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 ${biasColor}`}>
            <span className="text-xs font-semibold uppercase tracking-wider">
              Fundamental Bias:
            </span>
            <span className="text-sm font-extrabold">{state.overallBias}</span>
            <span className="text-xs opacity-75 font-mono">({confidencePercent(state.overallConfidence)}%)</span>
          </div>

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition border border-slate-700 disabled:opacity-50"
          >
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Live Telemetry Ticker Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-slate-800/80">
        {/* NKD Futures */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            CME NKD Price
          </div>
          <div className="text-sm font-bold text-white font-mono mt-0.5">
            {t.sourced?.nkd ? t.nkdPrice.toLocaleString() : 'Unavailable'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            {t.sourced?.nkd
              ? `${t.nkdChange >= 0 ? '+' : ''}${t.nkdChange.toFixed(0)} (${t.nkdChangePct >= 0 ? '+' : ''}${t.nkdChangePct.toFixed(2)}%)`
              : 'Waiting for a quote'}
          </div>
        </div>

        {/* USD/JPY */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            USD/JPY Spot
          </div>
          <div className="text-sm font-bold text-white font-mono mt-0.5">
            {showNumber(t.sourced?.usdjpy, fx.usdjpyRate, 2)}
          </div>
          <div
            className={`text-[10px] font-mono ${
              fx.usdjpyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {t.sourced?.usdjpy
              ? `${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%`
              : 'Waiting for a quote'}
          </div>
        </div>

        {/* BoJ Policy & JGB */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            BoJ Call / 10Y JGB
          </div>
          <div className="text-sm font-bold text-white font-mono mt-0.5">
            Unavailable
          </div>
          <div className="text-[10px] font-mono text-cyan-400">
            Policy print unavailable
          </div>
        </div>

        {/* SOX Index */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            SOX (US Semis)
          </div>
          <div className="text-sm font-bold text-white font-mono mt-0.5">
            {t.sourced?.sox ? t.soxIndex.toLocaleString() : 'Unavailable'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            {t.sourced?.sox ? `${t.soxChangePct >= 0 ? '+' : ''}${t.soxChangePct.toFixed(2)}%` : 'Waiting for a quote'}
          </div>
        </div>

        {/* Market Breadth */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            TSE 225 Breadth
          </div>
          <div className="text-sm font-bold text-white font-mono mt-0.5">
            Unavailable
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Full TSE breadth is not on a live feed
          </div>
        </div>

        {/* Tokyo Session Clock */}
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
          <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
            Tokyo Session
          </div>
          <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">
            {t.tokyoSessionPhase}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            {t.tokyoCashSessionActive ? 'Cash Active' : 'Overnight/Break'}
          </div>
        </div>
      </div>
    </div>
  )
}
