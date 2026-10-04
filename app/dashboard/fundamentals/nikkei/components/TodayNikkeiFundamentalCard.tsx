'use client'

import React from 'react'
import type { TodaysNikkeiFundamentalState } from '@/types/fundamentals'

interface TodayNikkeiFundamentalCardProps {
  today: TodaysNikkeiFundamentalState | null
}

export function TodayNikkeiFundamentalCard({ today }: TodayNikkeiFundamentalCardProps) {
  if (!today) return null

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>📋</span>
            <span>Today's Nikkei 225 Fundamental State</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Macro landscape, Bank of Japan policy transmission, and Tokyo cash session parameters
          </p>
        </div>
        <div className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 self-start sm:self-auto">
          Updated: {today.updated_at}
        </div>
      </div>

      {/* Narrative Synthesis */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span>🎯</span>
          <span>Analyst Narrative Synthesis</span>
        </h3>
        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
          {today.summary_narrative}
        </p>
      </div>

      {/* Grid: Multi-Pillar Dimensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* FX & Exporter Regime */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 space-y-1.5">
          <div className="text-[11px] uppercase font-mono text-cyan-400 font-semibold">
            USD/JPY Currency Regime
          </div>
          <div className="text-xs font-bold text-white">
            {today.fx_regime}
          </div>
          <p className="text-xs text-slate-400 leading-normal">
            Stable Yen depreciation maintains competitive overseas pricing and repatriated income for Japanese industrials without immediate MoF panic.
          </p>
        </div>

        {/* Semiconductor & Global Tech */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 space-y-1.5">
          <div className="text-[11px] uppercase font-mono text-amber-400 font-semibold">
            Semiconductor Cycle Momentum
          </div>
          <div className="text-xs font-bold text-white">
            {today.semiconductor_tailwind} TAILWIND
          </div>
          <p className="text-xs text-slate-400 leading-normal">
            Advantest and Tokyo Electron benefiting from robust high-bandwidth memory (HBM) and generative AI accelerator manufacturing cycles.
          </p>
        </div>

        {/* Domestic Macro & Shunto Wages */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 space-y-1.5">
          <div className="text-[11px] uppercase font-mono text-emerald-400 font-semibold">
            Shunto Wages & Inflation Spiral
          </div>
          <p className="text-xs text-slate-300 leading-normal">
            {today.inflation_wages_shunto}
          </p>
        </div>

        {/* Foreign Capital Inflows & TSE Reform */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 space-y-1.5">
          <div className="text-[11px] uppercase font-mono text-indigo-400 font-semibold">
            Foreign Institutional Flow
          </div>
          <div className="text-xs font-bold text-white">
            {today.foreign_investor_flow}
          </div>
          <p className="text-xs text-slate-400 leading-normal">
            {today.domestic_macro_growth}
          </p>
        </div>
      </div>

      {/* Risk Factors & Key Catalysts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div className="bg-rose-950/20 border border-rose-900/30 rounded-xl p-4">
          <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Primary Market Risks</span>
          </h4>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {today.key_risks.map((risk, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-rose-400 font-mono">•</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-4">
          <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span>⚡</span>
            <span>Upcoming Session Catalysts</span>
          </h4>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {today.top_catalysts.map((cat, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-400 font-mono">•</span>
                <span>{cat}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
