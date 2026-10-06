'use client'

import React from 'react'
import type { NikkeiBojState, NikkeiFxState } from '@/types/fundamentals'

interface NikkeiBojFxCardProps {
  boj: NikkeiBojState | null
  fx: NikkeiFxState | null
}

export function NikkeiBojFxCard({ boj, fx }: NikkeiBojFxCardProps) {
  if (!boj || !fx) return null

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>🏦</span>
          <span>Bank of Japan Policy & USD/JPY Currency Transmission</span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Monetary normalization dynamics, JGB yields, Yen pass-through, and Ministry of Finance intervention alerts
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* BoJ Monetary Policy Panel */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>🏛️</span>
              <span>Bank of Japan Stance</span>
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
              {boj.policyStance}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                Overnight Call Rate
              </div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {boj.uncollateralizedCallRatePct > 0 ? `${boj.uncollateralizedCallRatePct}%` : '—'}
              </div>
              <div className="text-[10px] text-cyan-400 mt-0.5">
                Targeted Range
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                10Y JGB Benchmark
              </div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {boj.jgb10yYieldPct > 0 ? `${boj.jgb10yYieldPct}%` : '—'}
              </div>
              <div className="text-[10px] text-emerald-400 mt-0.5">
                Market Determined
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">Yield Curve Control (YCC):</span>
              <span className="font-mono text-slate-200">{boj.yccStatus}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">ETF Purchases Pace:</span>
              <span className="font-mono text-slate-200">{boj.etfPurchasePace}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Next Policy Meeting:</span>
              <span className="font-mono text-amber-400">{boj.nextMeetingDate}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
            {boj.summary}
          </div>
        </div>

        {/* USD/JPY FX & MoF Intervention Panel */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💴</span>
              <span>USD/JPY & MoF Intervention</span>
            </h3>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold ${
                fx.mofInterventionZone
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {fx.mofInterventionZone ? 'INTERVENTION ALERT' : 'STABLE ZONE'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                USD/JPY Spot Rate
              </div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {fx.usdjpyRate.toFixed(2)}
              </div>
              <div
                className={`text-[10px] font-mono mt-0.5 ${
                  fx.usdjpyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {fx.usdjpyChangePct >= 0 ? '+' : ''}
                {fx.usdjpyChangePct.toFixed(2)}%
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                Exporter Currency Beta
              </div>
              <div className="text-lg font-bold text-amber-400 font-mono mt-1">
                +0.55% / ¥1.0
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Operating Profit Pass-Through
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">Active FX Regime:</span>
              <span className="font-mono text-slate-200">{fx.fxRegime}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">MoF Verbal Warning Level:</span>
              <span className="font-mono text-amber-400">
                {fx.usdjpyRate > 155 ? 'Phase 3 (Physical Readiness)' : 'Phase 1 (Monitoring)'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Nikkei Sensitivity:</span>
              <span className="font-mono text-emerald-400">High Exporter Tail-Risk</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
            {fx.implicationForNikkei}
          </div>
        </div>
      </div>
    </div>
  )
}
