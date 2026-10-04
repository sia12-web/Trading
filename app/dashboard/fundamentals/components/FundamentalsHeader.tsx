'use client'

import React from 'react'
import type { WtiTelemetry, DirectionalBias } from '@/types/fundamentals'

interface FundamentalsHeaderProps {
  telemetry: WtiTelemetry
  overallBias: DirectionalBias
  overallConfidence: number
  physicalBalance: 'DEFICIT' | 'SURPLUS' | 'BALANCED'
  onRefresh: () => void
  onReset: () => void
  loading?: boolean
}

export function FundamentalsHeader({
  telemetry,
  overallBias,
  overallConfidence,
  physicalBalance,
  onRefresh,
  onReset,
  loading = false,
}: FundamentalsHeaderProps) {
  const isUp = telemetry.change >= 0
  const isBackwardation = telemetry.spreadRegime === 'BACKWARDATION'

  const biasBadgeColor =
    overallBias === 'BULLISH'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : overallBias === 'BEARISH'
      ? 'bg-red-500/20 text-red-300 border-red-500/40'
      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'

  const balanceColor =
    physicalBalance === 'DEFICIT'
      ? 'text-emerald-400'
      : physicalBalance === 'SURPLUS'
      ? 'text-red-400'
      : 'text-amber-400'

  return (
    <div className="space-y-4">
      {/* Top Bar with Title and Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-surface-800 border border-surface-600 rounded-xl p-4 lg:p-5 shadow-sm">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-red-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 shadow-inner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6 text-amber-400">
              {/* Oil barrel / refinery tower icon */}
              <ellipse cx="12" cy="5" rx="7" ry="2.5" />
              <path d="M5 5v14c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V5" />
              <path d="M5 12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Oil Fundamental Analyst</h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-brand-600/30 text-brand-300 border border-brand-500/40">
                NYMEX WTI · CL
              </span>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-surface-700 text-gray-300 border border-surface-600">
                10-Pillar Institutional Engine
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Continuously maintained physical balance sheet, 10-step institutional event evaluator, and term structure validation.
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2.5 self-end lg:self-auto">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-700 hover:bg-surface-600 text-gray-200 border border-surface-600 transition disabled:opacity-50"
            title="Refresh live WTI quote and telemetry"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-400' : 'text-gray-400'}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh Telemetry
          </button>

          <button
            type="button"
            onClick={onReset}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-700/60 hover:bg-surface-700 text-gray-400 hover:text-gray-200 border border-surface-600 transition"
            title="Reset fundamental state to baseline"
          >
            Reset State
          </button>
        </div>
      </div>

      {/* Live Market Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {/* Metric 1: Prompt WTI */}
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Prompt WTI ({telemetry.symbol})</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live CME
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tracking-tight">
              ${telemetry.promptPrice.toFixed(2)}
            </span>
            <span
              className={`text-xs font-semibold font-mono ${
                isUp ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {isUp ? '+' : ''}${telemetry.change.toFixed(2)} ({isUp ? '+' : ''}
              {telemetry.changePct.toFixed(2)}%)
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1 font-mono">
            Day: ${telemetry.low.toFixed(2)} – ${telemetry.high.toFixed(2)}
          </div>
        </div>

        {/* Metric 2: Curve Structure & Front Spread */}
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Front Calendar Spread (M1-M2)</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                isBackwardation
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              }`}
            >
              {telemetry.spreadRegime}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tracking-tight">
              {telemetry.promptSpread >= 0 ? '+' : ''}${telemetry.promptSpread.toFixed(2)}
            </span>
            <span className="text-xs text-gray-400">/ bbl prompt</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            {isBackwardation ? '🔥 Bullish spot physical tightness' : '❄️ Contango storage incentive'}
          </div>
        </div>

        {/* Metric 3: Physical Balance */}
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Physical Balance</span>
            <span className="text-[10px] text-gray-500">Global & US</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-bold font-mono uppercase tracking-tight ${balanceColor}`}>
              {physicalBalance}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            Cushing storage near operational bottoms (~23M bbl)
          </div>
        </div>

        {/* Metric 4: Overall Stance */}
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Overall Fundamental Stance</span>
            <span className="text-[10px] text-gray-400 font-mono">Conf: {overallConfidence}/10</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`px-2.5 py-1 rounded-lg text-sm font-bold uppercase tracking-wider border ${biasBadgeColor}`}
            >
              {overallBias}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            Synthesized across all 10 verified pillars
          </div>
        </div>
      </div>

      {/* Institutional Safeguards Invariants Banner */}
      <div className="bg-surface-850/80 border border-surface-700/80 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 text-brand-300 font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-brand-400 flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="font-semibold text-gray-200">Strict Analyst Mandate:</span>
          <span className="text-gray-400">Never invent missing data</span>
          <span className="text-surface-500">•</span>
          <span className="text-gray-400">Never assume correlation implies causation</span>
          <span className="text-surface-500">•</span>
          <span className="text-gray-400">Never issue a trade solely from a headline</span>
          <span className="text-surface-500">•</span>
          <span className="text-gray-400">Explicit conflict reporting</span>
        </div>
        <div className="text-gray-500 font-mono text-[10px]">
          Refreshed: {new Date(telemetry.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
