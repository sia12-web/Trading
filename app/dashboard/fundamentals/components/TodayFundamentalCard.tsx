'use client'

import React, { useState } from 'react'
import type { TodaysOilFundamentalState, WtiTelemetry } from '@/types/fundamentals'

interface TodayFundamentalCardProps {
  today: TodaysOilFundamentalState
  telemetry: WtiTelemetry
}

export function TodayFundamentalCard({ today, telemetry }: TodayFundamentalCardProps) {
  const [copied, setCopied] = useState(false)
  const [showJson, setShowJson] = useState(false)

  const formattedText = `TODAY'S OIL FUNDAMENTAL STATE

Supply: ${today.supply}
Demand: ${today.demand}
Inventories: ${today.inventories}
OPEC: ${today.opec}
Geopolitical risk: ${today.geopolitical_risk}
Positioning: ${today.positioning}
Curve: ${today.curve}
Upcoming catalysts: ${today.upcoming_catalysts}

Bias: ${today.bias}
Confidence: ${today.confidence}
What changed since yesterday: ${today.what_changed_since_yesterday}
What would invalidate this view: ${today.what_would_invalidate_this_view}`

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isBullish = today.bias === 'BULLISH'
  const isBearish = today.bias === 'BEARISH'
  const biasBadgeColor = isBullish
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : isBearish
    ? 'bg-red-500/20 text-red-300 border-red-500/40'
    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-surface-700 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-300 font-bold text-xs">
            V1
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide uppercase flex items-center gap-2">
              TODAY&apos;S OIL FUNDAMENTAL STATE
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </h2>
            <p className="text-[11px] text-gray-400">
              Pragmatic physical snapshot across 8 core dimensions + invalidation thresholds.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowJson(!showJson)}
            className="px-2.5 py-1 text-xs rounded-lg bg-surface-700 hover:bg-surface-650 text-gray-300 border border-surface-600 font-mono transition"
          >
            {showJson ? 'Visual View' : '{ } Agent JSON'}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-brand-600/30 hover:bg-brand-600/40 text-brand-200 border border-brand-500/40 transition flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-emerald-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
                Copy for Bots
              </>
            )}
          </button>
        </div>
      </div>

      {showJson ? (
        <div className="bg-surface-900 border border-surface-700 rounded-lg p-3 text-xs font-mono text-gray-200 overflow-x-auto">
          <pre>{JSON.stringify(today, null, 2)}</pre>
        </div>
      ) : (
        <div className="space-y-4 text-xs font-sans">
          {/* Top 8 Dimensions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Supply:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.supply}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Demand:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.demand}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Inventories:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.inventories}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">OPEC:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.opec}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Geopolitical Risk:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.geopolitical_risk}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Positioning:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.positioning}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Curve:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed font-mono">{today.curve}</p>
            </div>

            <div className="bg-surface-850 p-3 rounded-lg border border-surface-700">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Upcoming Catalysts:</span>
              <p className="text-gray-200 mt-0.5 leading-relaxed">{today.upcoming_catalysts}</p>
            </div>
          </div>

          {/* Synthesis & Invalidation Panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Bias & Confidence */}
            <div className="bg-surface-850 p-3.5 rounded-lg border border-surface-700 flex flex-col justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  Active Fundamental Bias & Confidence
                </span>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider border ${biasBadgeColor}`}>
                    Bias: {today.bias}
                  </span>
                  <span className="font-mono text-xs text-gray-300">
                    Confidence: <strong className="text-white">{(today.confidence * 100).toFixed(0)}%</strong> ({today.confidence})
                  </span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-surface-700/80 text-[11px] text-gray-400 font-mono">
                CME WTI tip: {telemetry.priceLive ? `$${telemetry.promptPrice.toFixed(2)}` : '—'} · Prompt spread:{' '}
                {telemetry.curveLive
                  ? `${telemetry.promptSpread >= 0 ? '+' : ''}$${telemetry.promptSpread.toFixed(2)}/bbl (${telemetry.spreadRegime})`
                  : 'unavailable'}
              </div>
            </div>

            {/* Invalidation Criteria */}
            <div className="bg-surface-850 p-3.5 rounded-lg border border-surface-700 space-y-2">
              <div>
                <span className="text-[10px] uppercase font-bold text-brand-300 tracking-wider">
                  What Changed Since Yesterday:
                </span>
                <p className="text-xs text-gray-200 mt-0.5 leading-relaxed">
                  {today.what_changed_since_yesterday}
                </p>
              </div>

              <div className="pt-2 border-t border-surface-700/80">
                <span className="text-[10px] uppercase font-bold text-red-300 tracking-wider">
                  What Would Invalidate This View:
                </span>
                <p className="text-xs text-red-200 mt-0.5 leading-relaxed">
                  {today.what_would_invalidate_this_view}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
