'use client'

/**
 * Gold Real Yields & USD Transmission Tracker
 * Implements Prompts 2, 3, 9: Real Yields, Nominal Curve, DXY, and Divergence Detection
 */

import React, { useState } from 'react'
import type { GoldTelemetry } from '@/types/fundamentals'

interface GoldYieldsUsdTrackerProps {
  telemetry: GoldTelemetry
}

export function GoldYieldsUsdTracker({ telemetry }: GoldYieldsUsdTrackerProps) {
  // Before / After Shock Simulator (Prompt 3)
  const [beforeYield, setBeforeYield] = useState<number>(2.76)
  const [afterYield, setAfterYield] = useState<number>(2.88)
  const [beforeDxy, setBeforeDxy] = useState<number>(101.8)
  const [afterDxy, setAfterDxy] = useState<number>(102.4)

  const yieldDeltaBps = +((afterYield - beforeYield) * 100).toFixed(1)
  const dxyDeltaPct = +(((afterDxy - beforeDxy) / beforeDxy) * 100).toFixed(2)

  // Divergence Detection (Prompt 9): Gold rising while USD is rising
  const isDxyRising = telemetry.dxyChangePct > 0.1
  const isGoldRising = telemetry.goldChangePct > 0.2
  const isDivergentStrength = isDxyRising && isGoldRising

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <h2 className="text-lg font-bold text-slate-100">
              Real Yields & U.S. Dollar Transmission Hub
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
              Prompts 2, 3 & 9
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real Yield = Nominal Yield - Breakeven Inflation. Monitors opportunity cost and relative currency strength.
          </p>
        </div>

        {isDivergentStrength && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold animate-pulse">
            <span>🔥</span>
            <span>Relative Strength: Gold rising despite USD firming!</span>
          </div>
        )}
      </div>

      {/* Real Yields Opportunity Cost Principle Banner (Prompt 2) */}
      <div className="mt-4 p-4 rounded-lg bg-sky-950/30 border border-sky-800/40 text-xs text-sky-200 leading-relaxed">
        <span className="font-bold text-sky-300 block mb-1">
          💡 The Institutional Real Yield Mechanism:
        </span>
        Gold pays zero interest. When real government bond yields rise, the opportunity cost of holding physical bullion increases (downward price pressure). When real yields fall, non-yielding gold becomes relatively attractive (upward support).
        <div className="mt-2 text-slate-300 italic">
          ⚠️ Rule: Never turn this into "real yield down = automatically buy GC". The agent must verify whether the market actually responds.
        </div>
      </div>

      {/* Nominal & Real Yields Grid (Prompt 3) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">10Y TIPS Real Yield</div>
          <div className="text-xl font-bold font-mono text-sky-300">
            {telemetry.us10yRealYield.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series DFII10</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">5Y TIPS Real Yield</div>
          <div className="text-xl font-bold font-mono text-sky-300">
            {telemetry.us5yRealYield.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series DFII5</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">10Y Nominal Treasury</div>
          <div className="text-xl font-bold font-mono text-slate-200">
            {telemetry.us10yNominalYield.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-400 font-mono">CBOE ^TNX</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">10Y Breakeven Inflation</div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {telemetry.us10yBreakeven.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series T10YIE</div>
        </div>
      </div>

      {/* FX Crosses & DXY Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">U.S. Dollar Index (DXY)</div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {telemetry.dxyIndex.toFixed(2)}
          </div>
          <div className={`text-[10px] font-mono ${telemetry.dxyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {telemetry.dxyChangePct >= 0 ? '+' : ''}{telemetry.dxyChangePct.toFixed(2)}% (DX-Y.NYB)
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">EUR / USD</div>
          <div className="text-lg font-bold font-mono text-slate-200">
            {telemetry.eurUsd.toFixed(4)}
          </div>
          <div className="text-[10px] text-slate-400">Major DXY weight (57.6%)</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">USD / JPY</div>
          <div className="text-lg font-bold font-mono text-slate-200">
            {telemetry.usdJpy.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400">Rate differential sensitive</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">Gold / Silver Ratio</div>
          <div className="text-lg font-bold font-mono text-amber-300">
            {telemetry.goldSilverRatio.toFixed(1)}:1
          </div>
          <div className="text-[10px] text-slate-400">Monetary vs Industrial balance</div>
        </div>
      </div>

      {/* Before / After Event Impact Calculator (Prompt 3) */}
      <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800">
        <div className="text-xs font-bold text-slate-300 mb-3 flex items-center justify-between">
          <span>⚡ Before / After Event Shock Delta Simulator (Prompt 3)</span>
          <span className="text-[10px] font-mono text-slate-400">e.g. CPI / FOMC Rate Decision Shock</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">10Y Real Yield Before:</label>
            <input
              type="number"
              step="0.01"
              value={beforeYield}
              onChange={(e) => setBeforeYield(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">10Y Real Yield After:</label>
            <input
              type="number"
              step="0.01"
              value={afterYield}
              onChange={(e) => setAfterYield(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-200"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">DXY Before / After:</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                step="0.1"
                value={beforeDxy}
                onChange={(e) => setBeforeDxy(parseFloat(e.target.value) || 0)}
                className="w-1/2 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-200"
              />
              <input
                type="number"
                step="0.1"
                value={afterDxy}
                onChange={(e) => setAfterDxy(parseFloat(e.target.value) || 0)}
                className="w-1/2 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 font-mono text-slate-200"
              />
            </div>
          </div>

          <div className="bg-slate-900/90 rounded border border-slate-800 p-2.5 flex flex-col justify-center">
            <div className="text-[10px] text-slate-400 uppercase">Calculated Impulse:</div>
            <div className="font-mono font-bold text-xs mt-0.5">
              <span className={yieldDeltaBps > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {yieldDeltaBps >= 0 ? '+' : ''}{yieldDeltaBps} bps Real
              </span>
              {' · '}
              <span className={dxyDeltaPct > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {dxyDeltaPct >= 0 ? '+' : ''}{dxyDeltaPct}% DXY
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Expected Gold Bias: <span className="font-bold text-slate-200">{yieldDeltaBps > 5 ? 'BEARISH' : yieldDeltaBps < -5 ? 'BULLISH' : 'NEUTRAL'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
