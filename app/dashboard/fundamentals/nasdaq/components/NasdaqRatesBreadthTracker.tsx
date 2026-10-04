'use client'

/**
 * Nasdaq Rates Engine & Market Breadth Tracker
 * Combines Dedicated Rates Engine (2Y, 10Y, 2s10s, 10Y Real TIPS via FRED/ALFRED)
 * and Market Breadth Engine (Advance/Decline, % above MAs, QQQ vs QQQE).
 */

import React from 'react'
import type { NasdaqTelemetry, NdxBreadthState } from '@/types/fundamentals'

interface NasdaqRatesBreadthTrackerProps {
  telemetry: NasdaqTelemetry
  breadth: NdxBreadthState
}

export function NasdaqRatesBreadthTracker({ telemetry, breadth }: NasdaqRatesBreadthTrackerProps) {
  const getBreadthBadge = (stance: string) => {
    switch (stance) {
      case 'BROAD_EXPANSION':
        return { label: 'Broad Market Expansion', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' }
      case 'CONCENTRATED_MEGA_CAP_RALLY':
        return { label: 'Narrow Mega-Cap Concentration', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' }
      case 'BROAD_DETERIORATION':
        return { label: 'Broad Deterioration / Liquidation', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' }
      default:
        return { label: 'Neutral Participation', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }
    }
  }

  const breadthMeta = getBreadthBadge(breadth.marketParticipationStance)

  return (
    <div className="space-y-6 mb-8">
      {/* 1. DEDICATED RATES ENGINE */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📈</span>
              <h3 className="text-base font-bold text-slate-100">
                Dedicated Treasury Rates Engine &amp; Growth Valuation Model
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono">
                FRED / ALFRED Vintages
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Tracks the cost of capital, discount rate for future tech cash flows, and 2s10s yield curve regime.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Curve Spread:</span>
            <span className={`px-2 py-0.5 rounded border font-bold ${
              telemetry.yieldCurve2s10sSpreadBps >= 0 ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
            }`}>
              2s10s: {telemetry.yieldCurve2s10sSpreadBps >= 0 ? '+' : ''}{telemetry.yieldCurve2s10sSpreadBps.toFixed(1)} bps (Disinverted)
            </span>
          </div>
        </div>

        {/* Rates Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-5">
          {/* US 2Y */}
          <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>US 2-Year Treasury</span>
              <span className="font-mono text-cyan-400 text-[10px]">Fed Expectations</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-100">
              {telemetry.us2yNominalYield.toFixed(2)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Sensitive to short-term FOMC terminal rate pricing &amp; labor data.
            </div>
          </div>

          {/* US 10Y */}
          <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>US 10-Year Treasury</span>
              <span className="font-mono text-cyan-400 text-[10px]">Long-Duration</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-100">
              {telemetry.us10yNominalYield.toFixed(2)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Primary discount rate for terminal value growth cash flows.
            </div>
          </div>

          {/* 10Y Real TIPS (FRED DFII10) */}
          <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>10Y Real TIPS Yield</span>
              <span className="font-mono text-emerald-400 text-[10px]">FRED DFII10</span>
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-300">
              {telemetry.us10yRealYield.toFixed(2)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Real opportunity cost. Real yield spikes directly compress P/E multiples.
            </div>
          </div>

          {/* CBOE VXN Tech Volatility */}
          <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>CBOE VXN (Nasdaq Vol)</span>
              <span className="font-mono text-indigo-400 text-[10px]">VIX: {telemetry.vixIndex.toFixed(1)}</span>
            </div>
            <div className="text-2xl font-bold font-mono text-indigo-300">
              {telemetry.vxnIndex.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Tech volatility spread: +{(telemetry.vxnIndex - telemetry.vixIndex).toFixed(2)} pts over S&amp;P 500 VIX.
            </div>
          </div>
        </div>

        {/* Rates Transmission Framework Note */}
        <div className="p-3.5 rounded-lg bg-slate-950/50 border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
          <span className="text-cyan-400 font-semibold">Institutional Rates Rule: </span>
          Never treat &quot;Rates Up = Short NQ&quot; blindly. If yields rise due to accelerating economic growth and corporate earnings power, tech frequently outperforms. If yields surge due to sticky inflation and hawkish Fed recalibration, growth multiples face acute compression.
        </div>
      </div>

      {/* 2. MARKET BREADTH ENGINE */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🌐</span>
              <h3 className="text-base font-bold text-slate-100">
                Nasdaq-100 Market Breadth &amp; Participation Engine
              </h3>
              <span className={`text-[11px] px-2 py-0.5 rounded border font-semibold ${breadthMeta.color}`}>
                {breadthMeta.label}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Monitors advance/decline ratios, moving average participation, and cap-weighted vs equal-weight divergence.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">QQQ / QQQE Ratio:</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-cyan-300 font-bold">
              {breadth.qqqVsQqqeRatio.toFixed(3)}x
            </span>
          </div>
        </div>

        {/* Breadth Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
          {/* A/D Ratio */}
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
            <div className="text-[11px] text-slate-400 mb-1">Advance / Decline</div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {breadth.advancingCount} <span className="text-emerald-400 text-sm">Adv</span> / {breadth.decliningCount} <span className="text-rose-400 text-sm">Dec</span>
            </div>
            <div className="text-xs font-mono text-cyan-300 mt-1">
              Ratio: {breadth.advanceDeclineRatio.toFixed(2)}:1
            </div>
          </div>

          {/* % Above 20d MA */}
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
            <div className="text-[11px] text-slate-400 mb-1">% Above 20-Day MA</div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {breadth.pctAbove20dMa.toFixed(0)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Short-term momentum
            </div>
          </div>

          {/* % Above 50d MA */}
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
            <div className="text-[11px] text-slate-400 mb-1">% Above 50-Day MA</div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {breadth.pctAbove50dMa.toFixed(0)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Intermediate regime health
            </div>
          </div>

          {/* % Above 200d MA */}
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
            <div className="text-[11px] text-slate-400 mb-1">% Above 200-Day MA</div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {breadth.pctAbove200dMa.toFixed(0)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Secular structural trend
            </div>
          </div>
        </div>

        {/* Warning Indicator */}
        {breadth.marketParticipationStance === 'CONCENTRATED_MEGA_CAP_RALLY' && (
          <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-600/50 text-amber-200 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>
              <strong>Concentrated Breadth Divergence Warning:</strong> Top 5 mega-cap constituents are holding up the index while majority of constituent equities decline. Rally is vulnerable to single-stock headline exhaustion.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
