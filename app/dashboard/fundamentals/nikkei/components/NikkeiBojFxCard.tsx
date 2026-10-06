'use client'

import React from 'react'
import type { NikkeiBojState, NikkeiFxState } from '@/types/fundamentals'

interface NikkeiBojFxCardProps {
  boj: NikkeiBojState | null
  fx: NikkeiFxState | null
}

export function NikkeiBojFxCard({ boj: _boj, fx, usdjpyLive = false }: NikkeiBojFxCardProps & { usdjpyLive?: boolean }) {
  if (!_boj || !fx) return null

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
              Unavailable
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                Overnight Call Rate
              </div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                Unavailable
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
                Unavailable
              </div>
              <div className="text-[10px] text-emerald-400 mt-0.5">
                Market Determined
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">Yield Curve Control (YCC):</span>
              <span className="font-mono text-slate-200">Unavailable</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">ETF Purchases Pace:</span>
              <span className="font-mono text-slate-200">Unavailable</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Next Policy Meeting:</span>
              <span className="font-mono text-amber-400">Unavailable</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
            BoJ policy text is unavailable until a live release is on the wire.
          </div>
        </div>

        {/* USD/JPY FX & MoF Intervention Panel */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>💴</span>
              <span>USD/JPY & MoF Intervention</span>
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
              Intervention status unavailable
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                USD/JPY Spot Rate
              </div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {usdjpyLive ? fx.usdjpyRate.toFixed(2) : 'Unavailable'}
              </div>
              <div className="text-[10px] font-mono mt-0.5 text-slate-400">
                {usdjpyLive ? `${fx.usdjpyChangePct >= 0 ? '+' : ''}${fx.usdjpyChangePct.toFixed(2)}%` : 'Waiting for a quote'}
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">
                Exporter Currency Beta
              </div>
              <div className="text-lg font-bold text-amber-400 font-mono mt-1">
                Unavailable
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Operating Profit Pass-Through
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">Active FX Regime:</span>
              <span className="font-mono text-slate-200">Unavailable</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/80">
              <span className="text-slate-400">MoF Verbal Warning Level:</span>
              <span className="font-mono text-amber-400">Unavailable</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Nikkei Sensitivity:</span>
              <span className="font-mono text-emerald-400">Unavailable</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 text-xs text-slate-300 leading-relaxed">
            Exporter pass-through is unavailable until USD/JPY and earnings prints are both on a live feed.
          </div>
        </div>
      </div>
    </div>
  )
}
