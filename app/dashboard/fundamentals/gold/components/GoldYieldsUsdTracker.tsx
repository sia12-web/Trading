'use client'

/**
 * Gold Real Yields & USD Transmission Tracker
 * Implements Prompts 2, 3, 9: Real Yields, Nominal Curve, DXY, and Divergence Detection
 */

import React from 'react'
import type { GoldTelemetry } from '@/types/fundamentals'
import { showNumber } from '@/lib/fundamentals/honesty'

interface GoldYieldsUsdTrackerProps {
  telemetry: GoldTelemetry
}

export function GoldYieldsUsdTracker({ telemetry }: GoldYieldsUsdTrackerProps) {
  const isDivergentStrength = Boolean(
    telemetry.sourced?.dxy && telemetry.sourced?.gold && telemetry.dxyChangePct > 0.1 && telemetry.goldChangePct > 0.2,
  )

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
              After a live print
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
            {showNumber(telemetry.sourced?.us10yReal, telemetry.us10yRealYield, 2, '%')}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series DFII10</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">5Y TIPS Real Yield</div>
          <div className="text-xl font-bold font-mono text-sky-300">
            {showNumber(telemetry.sourced?.us5yReal, telemetry.us5yRealYield, 2, '%')}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series DFII5</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">10Y Nominal Treasury</div>
          <div className="text-xl font-bold font-mono text-slate-200">
            {showNumber(telemetry.sourced?.us10y, telemetry.us10yNominalYield, 2, '%')}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">CBOE ^TNX</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">10Y Breakeven Inflation</div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {showNumber(telemetry.sourced?.breakeven, telemetry.us10yBreakeven, 2, '%')}
          </div>
          <div className="text-[10px] text-slate-400 font-mono">FRED series T10YIE</div>
        </div>
      </div>

      {/* FX Crosses & DXY Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">U.S. Dollar Index (DXY)</div>
          <div className="text-lg font-bold font-mono text-slate-100">
            {showNumber(telemetry.sourced?.dxy, telemetry.dxyIndex, 2)}
          </div>
          <div className={`text-[10px] font-mono ${telemetry.dxyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {telemetry.sourced?.dxy ? `${telemetry.dxyChangePct >= 0 ? '+' : ''}${telemetry.dxyChangePct.toFixed(2)}% (DX-Y.NYB)` : 'Change unavailable'}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">EUR / USD</div>
          <div className="text-lg font-bold font-mono text-slate-200">
            {showNumber(telemetry.sourced?.eurusd, telemetry.eurUsd, 4)}
          </div>
          <div className="text-[10px] text-slate-400">Largest DXY component</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">USD / JPY</div>
          <div className="text-lg font-bold font-mono text-slate-200">
            {showNumber(telemetry.sourced?.usdjpy, telemetry.usdJpy, 2)}
          </div>
          <div className="text-[10px] text-slate-400">Rate differential sensitive</div>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
          <div className="text-[11px] text-slate-400 mb-0.5">Gold / Silver Ratio</div>
          <div className="text-lg font-bold font-mono text-amber-300">
            {telemetry.sourced?.gold && telemetry.sourced?.silver ? `${telemetry.goldSilverRatio.toFixed(1)}:1` : 'Unavailable'}
          </div>
          <div className="text-[10px] text-slate-400">Monetary vs Industrial balance</div>
        </div>
      </div>

    </div>
  )
}
