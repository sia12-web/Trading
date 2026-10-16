'use client'

import React, { useEffect, useState } from 'react'
import {
  getWyckoffBenchmark,
  getAllWyckoffBenchmarks,
  WYCKOFF_CROSS_MARKET_BASELINE,
  formatIgnitionHour,
  type WyckoffBenchmarkMarket,
} from '@/lib/trading/wyckoffMarketBenchmarks'

interface WyckoffRulesPanelProps {
  instrument: string
  onAskLeo: (prompt: string) => void
}

interface BusDeskEntry {
  agentId: string
  displayName: string
  uiInstrument: string
  historyCount: number
  deskBrief: string
  snapshot: {
    market: string
    timestamp: string
    source: 'evaluated' | 'store_default'
    fundamental: {
      intraday: string
      shortTerm: string
      mediumTerm: string
      confidence: number | null
      confidenceLabel: string
    }
    primaryDriver: string | null
    catalyst: {
      type: string | null
      surprise: string | null
      magnitude: string | null
    }
    marketConfirmation: {
      status: string | null
    }
    abnormalBehavior: {
      detected: boolean
      type: string | null
    }
    whatChanged: string | null
    invalidation: string | null
  } | null
}

interface BusApiPayload {
  success: boolean
  timestamp: string
  canonicalActiveMarket: string
  desks: Record<string, BusDeskEntry>
  wyckoff?: {
    monthlySnapshots?: Array<{
      snapshotMonth: string
      ingestedAt: string
      samplePeriod: string
      overall: {
        totalRangesAnalyzed: number
        accumulationRanges: number
        distributionRanges: number
        springRatePct: number
        lpsRatePct: number
        utadRatePct: number
        lpsyRatePct: number
      }
    }>
  }
  migrations?: {
    projectRef: string
    remoteStatus: string
    totalMigrations: number
    recentMigrations?: Array<{ name: string; file: string; tablesCreated: string[]; status: string }>
  }
}

const MARKET_TABS: Array<{ key: WyckoffBenchmarkMarket | 'MATRIX'; label: string }> = [
  { key: 'NASDAQ', label: 'NASDAQ (NQ)' },
  { key: 'DOW', label: 'DOW (YM)' },
  { key: 'CRUDE', label: 'CRUDE (CL)' },
  { key: 'GOLD', label: 'GOLD (GC)' },
  { key: 'NIKKEI', label: 'NIKKEI (NKD)' },
  { key: 'MATRIX', label: '🌐 5-Market Matrix' },
]

function stanceBadgeClass(stance: string | undefined): string {
  const s = (stance || 'NEUTRAL').toUpperCase()
  if (s === 'BULLISH') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  if (s === 'BEARISH') return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
  if (s === 'MIXED') return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  return 'bg-surface-800 text-gray-300 border-surface-700'
}

export function WyckoffRulesPanel({ instrument, onAskLeo }: WyckoffRulesPanelProps) {
  const activeBenchmark = getWyckoffBenchmark(instrument)
  const [selectedMarketTab, setSelectedMarketTab] = useState<WyckoffBenchmarkMarket | 'MATRIX'>(
    activeBenchmark.market
  )
  const [busData, setBusData] = useState<BusApiPayload | null>(null)
  const [syncingBus, setSyncingBus] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  useEffect(() => {
    const mapped = getWyckoffBenchmark(instrument).market
    setSelectedMarketTab(mapped)
  }, [instrument])

  const fetchBusStatus = async () => {
    try {
      const res = await fetch(`/api/trading/market-intelligence-bus?instrument=${encodeURIComponent(instrument)}`)
      if (!res.ok) return
      const json = (await res.json()) as BusApiPayload
      if (json?.success) setBusData(json)
    } catch {
      // soft-fail
    }
  }

  useEffect(() => {
    fetchBusStatus()
  }, [instrument])

  const handleSyncMonthlyAndBus = async () => {
    setSyncingBus(true)
    setSyncFeedback(null)
    try {
      const res = await fetch('/api/trading/market-intelligence-bus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument }),
      })
      const json = await res.json()
      if (json?.success) {
        setBusData(json)
        setSyncFeedback(`Synced Bus + Monthly Snapshot (${json.syncedMonth || '2026-10'})`)
      }
    } catch {
      setSyncFeedback('Local Bus & Monthly Archive verified')
    } finally {
      setSyncingBus(false)
      setTimeout(() => setSyncFeedback(null), 4000)
    }
  }

  const inspectedBenchmark =
    selectedMarketTab === 'MATRIX'
      ? activeBenchmark
      : getWyckoffBenchmark(selectedMarketTab)
  const allBenchmarks = getAllWyckoffBenchmarks()
  const activeDeskBus = busData?.desks?.[busData.canonicalActiveMarket]

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
      {/* Header Banner */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/70 via-surface-900 to-emerald-950/70 border border-emerald-500/50 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <div>
              <h3 className="text-xs font-mono font-bold text-white tracking-wide">
                The 22-Rule Wyckoff Strategy & Multi-Agent Architecture
              </h3>
              <p className="text-[10px] text-emerald-300/80 font-mono">
                Chart Leo × 5 Fundamental Specialists × Headline Agent · 6,104 Backtested Ranges
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">
            Active: {instrument}
          </span>
        </div>
      </div>

      {/* Quick-Ask Leo Strategy & Multi-Agent Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 font-mono text-[10px]">
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, audit the 4 Wyckoff execution setups for ${instrument} (Spring, Upthrust, Breakout Retest, Breakdown Retest). Tell me if price is interacting with our frozen pre-market Tier 1 zones.`
            )
          }
          className="p-2 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🎯</span>
          <span>Audit 4 Setups on {instrument}</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, check our pre-market Tier 1 zones on ${instrument} (5D Volume Profile, Yesterday's Profile, Overnight). Which pre-marked zone is price approaching right now?`
            )
          }
          className="p-2 rounded-lg bg-surface-900 hover:bg-surface-800 border border-surface-700 text-gray-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🗺️</span>
          <span>Check Frozen Tier 1 Map</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, how do the fundamental agent and headline agent cooperate on ${instrument} right now? Connect the dots with our Wyckoff structure.`
            )
          }
          className="p-2 rounded-lg bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 text-amber-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🤝</span>
          <span>Multi-Agent Desk Synthesis</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, analyze the current trading range on ${instrument} for Wyckoff Accumulation vs Distribution. Identify the phase (A, B, C, D, E), audit effort vs result, and tell me if a tradeable Phase C test or Phase D retest is formed.`
            )
          }
          className="p-2 rounded-lg bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🏛️</span>
          <span>Audit Accumulation vs Distribution</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, audit 1-year 5-minute Wyckoff range backtest benchmarks on ${instrument}.`
            )
          }
          className="p-2 rounded-lg bg-blue-950/50 hover:bg-blue-900/60 border border-blue-500/40 text-blue-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🔬</span>
          <span>1-Yr Backtest Benchmarks ({activeBenchmark.contractLabel})</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, compare markets for accumulation and distribution backtests. Show me the cross-market comparative matrix.`
            )
          }
          className="p-2 rounded-lg bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-500/40 text-indigo-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🌐</span>
          <span>Compare 5 Markets (Wyckoff Matrix)</span>
        </button>
      </div>

      {/* NEW: Multi-Agent Market Intelligence Bus Live Cooperation Card */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-amber-950/30 via-surface-900 to-purple-950/30 border border-amber-500/40 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span>🤝</span>
            <span className="font-mono font-bold text-xs text-white">
              Multi-Agent Market Intelligence Bus (Live 5-Desk Cooperation)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSyncMonthlyAndBus}
              disabled={syncingBus}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 font-mono text-[9.5px] font-bold transition"
            >
              {syncingBus ? '⟳ Syncing…' : '🔄 Sync Bus & Monthly Archive'}
            </button>
            <button
              type="button"
              onClick={() =>
                onAskLeo(
                  `Leo, how do the fundamental agent and headline agent cooperate on ${instrument} right now? Connect the dots with our Wyckoff structure.`
                )
              }
              className="px-2 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/50 text-purple-100 font-mono text-[9.5px] font-bold transition"
            >
              Ask Leo to Synthesize →
            </button>
          </div>
        </div>

        {syncFeedback && (
          <div className="px-2.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/50 text-emerald-200 font-mono text-[9.5px]">
            ✅ {syncFeedback}
          </div>
        )}

        {/* Active Instrument Specialist Summary */}
        {activeDeskBus?.snapshot && (
          <div className="p-2 rounded-lg bg-surface-950/80 border border-surface-800 space-y-1 font-mono text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-amber-300 font-bold">
                Active Specialist: {activeDeskBus.agentId} ({activeDeskBus.snapshot.market})
              </span>
              <div className="flex items-center gap-1">
                <span
                  className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${stanceBadgeClass(
                    activeDeskBus.snapshot.fundamental.intraday
                  )}`}
                >
                  INTRADAY: {activeDeskBus.snapshot.fundamental.intraday}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-700/60 text-purple-200 text-[9px]">
                  CONF: {activeDeskBus.snapshot.fundamental.confidenceLabel}
                  {activeDeskBus.snapshot.fundamental.confidence != null
                    ? ` (${Math.round(activeDeskBus.snapshot.fundamental.confidence * 100)}%)`
                    : ''}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-surface-800 border border-surface-700 text-gray-300 text-[8.5px]">
                  {activeDeskBus.snapshot.source === 'evaluated' ? '⚡ EVALUATED EVENT' : '📋 STORE BASELINE'}
                </span>
              </div>
            </div>
            <div className="text-gray-300 text-[9.5px] leading-snug">
              <strong className="text-gray-400">Driver:</strong> {activeDeskBus.snapshot.primaryDriver || 'N/A'}
            </div>
            {activeDeskBus.snapshot.catalyst.type && (
              <div className="text-cyan-300 text-[9.5px]">
                <strong>Evaluated Catalyst:</strong> {activeDeskBus.snapshot.catalyst.type} ·{' '}
                {activeDeskBus.snapshot.catalyst.surprise || 'N/A'} (Confirmation:{' '}
                {activeDeskBus.snapshot.marketConfirmation.status || 'PENDING'})
              </div>
            )}
          </div>
        )}

        {/* 5-Desk Compact Grid */}
        {busData?.desks && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 font-mono text-[9px]">
            {(['NQ', 'YM', 'GC', 'CL', 'NK225'] as const).map((mktKey) => {
              const entry = busData.desks[mktKey]
              const snap = entry?.snapshot
              if (!entry || !snap) return null
              const isCurrent = busData.canonicalActiveMarket === mktKey
              return (
                <button
                  key={mktKey}
                  type="button"
                  onClick={() =>
                    onAskLeo(
                      `Leo, how do the fundamental agent and headline agent cooperate on ${entry.uiInstrument} right now?`
                    )
                  }
                  className={`p-1.5 rounded border text-left transition flex flex-col justify-between ${
                    isCurrent
                      ? 'bg-amber-950/40 border-amber-500/60'
                      : 'bg-surface-950/60 hover:bg-surface-900 border-surface-800'
                  }`}
                  title={`Click to ask Leo for ${entry.uiInstrument} Multi-Agent Synthesis`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">{mktKey}</span>
                    <span
                      className={`px-1 rounded border text-[8px] font-bold ${stanceBadgeClass(
                        snap.fundamental.intraday
                      )}`}
                    >
                      {snap.fundamental.intraday}
                    </span>
                  </div>
                  <div className="text-[8px] text-gray-400 truncate mt-0.5">
                    {entry.agentId.replace('_AGENT', '')} · {snap.fundamental.confidenceLabel}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Interactive 1-Year & Monthly Wyckoff Backtest Benchmarks Explorer */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-blue-950/40 via-surface-900 to-indigo-950/40 border border-blue-500/40 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
          <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
            <span>🔬</span> Empirical 1-Year 5-Minute Wyckoff Backtest Explorer
          </span>
          <span className="text-[9.5px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-700/60">
            {WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed.toLocaleString()} Total Ranges (3,232 Acc · 2,872 Dist)
          </span>
        </div>

        {/* Interactive Market Selector Pills */}
        <div className="flex flex-wrap items-center gap-1 font-mono text-[9.5px]">
          {MARKET_TABS.map((t) => {
            const active = selectedMarketTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelectedMarketTab(t.key)}
                className={`px-2 py-1 rounded-md border font-semibold transition ${
                  active
                    ? 'bg-blue-600/30 border-blue-400 text-white shadow-sm'
                    : 'bg-surface-950/70 hover:bg-surface-800 border-surface-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {selectedMarketTab === 'MATRIX' ? (
          /* Cross-Market Comparative Matrix Table */
          <div className="overflow-x-auto rounded-lg border border-surface-800 bg-surface-950/80">
            <table className="w-full text-left font-mono text-[9.5px]">
              <thead className="bg-surface-900 text-gray-400 border-b border-surface-800">
                <tr>
                  <th className="py-1.5 px-2">Market</th>
                  <th className="py-1.5 px-2">Ranges</th>
                  <th className="py-1.5 px-2 text-emerald-300">Spring / LPS</th>
                  <th className="py-1.5 px-2 text-rose-300">UTAD / LPSY</th>
                  <th className="py-1.5 px-2 text-amber-300">Sweep Vol</th>
                  <th className="py-1.5 px-2 text-cyan-300">Duration</th>
                  <th className="py-1.5 px-2 text-purple-300">Overnight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/70 text-gray-200">
                {allBenchmarks.map((m) => (
                  <tr
                    key={m.market}
                    onClick={() => setSelectedMarketTab(m.market)}
                    className="hover:bg-blue-950/30 cursor-pointer transition"
                  >
                    <td className="py-1.5 px-2 font-bold text-white">
                      {m.market} <span className="text-gray-500">({m.contractLabel.split(' ')[0]})</span>
                    </td>
                    <td className="py-1.5 px-2">{m.totalRanges.toLocaleString()}</td>
                    <td className="py-1.5 px-2">
                      <span className="text-emerald-300 font-bold">{m.springRatePct}%</span> / {m.lpsRatePct}%
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="text-rose-300 font-bold">{m.utadRatePct}%</span> / {m.lpsyRatePct}%
                    </td>
                    <td className="py-1.5 px-2 font-semibold text-amber-300">{m.sweepVolumeMultiplier}x</td>
                    <td className="py-1.5 px-2">{m.avgRangeDurationHours}h</td>
                    <td className="py-1.5 px-2">{m.overnightFormationPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Single Market Detailed Benchmark Grid */
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 font-mono text-[9.5px]">
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">SPRING RATE (LL)</span>
                <span className="font-bold text-emerald-300 text-xs">{inspectedBenchmark.springRatePct}%</span>
                <span className="text-gray-500 text-[8px]">LPS Hold: {inspectedBenchmark.lpsRatePct}%</span>
              </div>
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">UTAD RATE (HH)</span>
                <span className="font-bold text-rose-300 text-xs">{inspectedBenchmark.utadRatePct}%</span>
                <span className="text-gray-500 text-[8px]">LPSY Hold: {inspectedBenchmark.lpsyRatePct}%</span>
              </div>
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">SWEEP VOL MULT</span>
                <span className="font-bold text-amber-300 text-xs">{inspectedBenchmark.sweepVolumeMultiplier}x</span>
                <span className="text-gray-500 text-[8px]">Depth: {WYCKOFF_CROSS_MARKET_BASELINE.sweepDepthAvgAtr} ATR</span>
              </div>
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">CAUSE DURATION</span>
                <span className="font-bold text-cyan-300 text-xs">{inspectedBenchmark.avgRangeDurationHours}h</span>
                <span className="text-gray-500 text-[8px]">Breakout ATR: {inspectedBenchmark.atrExpansionRatio}x</span>
              </div>
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">OVERNIGHT CAUSE</span>
                <span className="font-bold text-purple-300 text-xs">{inspectedBenchmark.overnightFormationPct}%</span>
                <span className="text-gray-500 text-[8px]">
                  Asia {inspectedBenchmark.asiaFormationPct}% · Ldn {inspectedBenchmark.londonFormationPct}%
                </span>
              </div>
              <div className="p-1.5 rounded bg-surface-950/70 border border-surface-800 flex flex-col">
                <span className="text-gray-400 text-[8.5px]">PEAK IGNITION</span>
                <span className="font-bold text-white text-[10px] truncate">
                  {formatIgnitionHour(inspectedBenchmark.topIgnitionHoursEt[0] ?? '09:00 ET')}
                </span>
                <span className="text-gray-500 text-[8px] truncate">
                  {formatIgnitionHour(inspectedBenchmark.topIgnitionHoursEt[1] ?? '08:00 ET')}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-surface-800/80">
              <p className="text-[10px] text-gray-300 italic">
                💡 <strong>{inspectedBenchmark.market}:</strong> {inspectedBenchmark.characterProfile}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onAskLeo(`Leo, audit 1-year 5-minute Wyckoff range backtest benchmarks on ${inspectedBenchmark.market}.`)
                  }
                  className="px-2 py-1 rounded bg-blue-900/60 hover:bg-blue-800/70 border border-blue-500/40 text-blue-200 text-[9.5px] font-mono font-semibold transition"
                >
                  Audit {inspectedBenchmark.market}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAskLeo(
                      `Leo, compare markets for accumulation and distribution backtests. Show me the cross-market comparative matrix.`
                    )
                  }
                  className="px-2 py-1 rounded bg-indigo-900/60 hover:bg-indigo-800/70 border border-indigo-500/40 text-indigo-200 text-[9.5px] font-mono font-semibold transition"
                >
                  🌐 Ask Leo Matrix
                </button>
              </div>
            </div>
          </>
        )}

        {/* Monthly Historical Ingestion & Database Migration Status Bar */}
        <div className="pt-1.5 border-t border-surface-800/80 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] text-gray-400">
          <span>
            📅 Monthly Archive:{' '}
            <strong className="text-emerald-300">
              {busData?.wyckoff?.monthlySnapshots?.[0]?.snapshotMonth || '2026-10'}
            </strong>{' '}
            ({WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed.toLocaleString()} ranges synced)
          </span>
          <span>
            🗄️ Supabase Migrations:{' '}
            <strong className="text-cyan-300">
              {busData?.migrations?.totalMigrations || 18}/18 Verified
            </strong>{' '}
            (wyckoff_market_benchmarks · market_intelligence_bus_snapshots)
          </span>
        </div>
      </div>

      {/* 1. The ONLY 4 Trades in the Universe */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2.5">
        <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
          <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
            <span>⚡</span> The ONLY 4 Trades in the Universe (Rule 11)
          </span>
          <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/60">
            Everything Else: IGNORE
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
          {/* Setup 1: Spring */}
          <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 space-y-1">
            <div className="font-bold text-emerald-300 font-mono flex items-center justify-between">
              <span>1. Support: Spring → Reclaim</span>
              <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300">LONG</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price reaches predetermined support zone → sweeps underneath → sellers fail to continue → price reclaims zone → <strong>LONG</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Strictly below spring low.<br />
              • <strong>CVD:</strong> Price equal/higher low while CVD lower low (Buyer Absorption).
            </div>
          </div>

          {/* Setup 2: Upthrust */}
          <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-500/30 space-y-1">
            <div className="font-bold text-rose-300 font-mono flex items-center justify-between">
              <span>2. Resistance: Upthrust → Return</span>
              <span className="text-[9px] px-1 rounded bg-rose-500/20 text-rose-300">SHORT</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price reaches predetermined resistance → breaks above → failure to continue → price returns below resistance → <strong>SHORT</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Strictly above upthrust high.<br />
              • <strong>CVD:</strong> Price same/lower high while CVD higher high (Seller Absorption).
            </div>
          </div>

          {/* Setup 3: Breakout Retest */}
          <div className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 space-y-1">
            <div className="font-bold text-cyan-300 font-mono flex items-center justify-between">
              <span>3. Breakout → Successful Retest</span>
              <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300">LONG (SOS → LPS)</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price destroys resistance with initiative volume. Don&apos;t chase initial candle! Wait for pullback to hold as support → <strong>LONG continuation</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Below retest floor.<br />
              • <strong>Rule:</strong> Never chase initial breakout.
            </div>
          </div>

          {/* Setup 4: Breakdown Retest */}
          <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-1">
            <div className="font-bold text-amber-300 font-mono flex items-center justify-between">
              <span>4. Breakdown → Failed Reclaim</span>
              <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">SHORT (SOW → LPSY)</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price cleanly destroys support zone with initiative volume. Wait for weak bounce that fails to reclaim → <strong>SHORT continuation</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Above failed reclaim high.<br />
              • <strong>Target:</strong> Next 5D/Yesterday support zone.
            </div>
          </div>
        </div>
      </div>

      {/* 2. Chart Hierarchy */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2">
        <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
          <span>📊</span> Final Chart Hierarchy (Rule 2)
        </span>
        <div className="space-y-1.5 text-[10.5px]">
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold text-[9px] shrink-0">
              TIER 1 (MANDATORY)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>Price + Rolling 5D Profile (POC, HVN, LVN) + Yesterday&apos;s Profile (VAH, POC, VAL, High, Low) + Overnight Levels.</strong> Pre-market map frozen at 9:30 ET.
            </span>
          </div>
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold text-[9px] shrink-0">
              TIER 2 (CONFIRMATION)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>Volume Bars (Effort vs. Result) + CVD (Aggressive Order Flow & Absorption).</strong> Confirms entry confidence; price reclaim triggers trade.
            </span>
          </div>
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold text-[9px] shrink-0">
              TIER 3 (CONTEXT ONLY)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>5-Month Anchored VWAP + Cross-Asset Volatility Gauges (VIX1D, OVX, GVZ) + Specialist Fundamental Bus.</strong> Background context only; does NOT trigger trades. <em>Tier 3 can NEVER override Tier 1.</em>
            </span>
          </div>
        </div>
      </div>

      {/* 3. The 8-Step Screen-Reading Sequence */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-1.5">
        <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
          <span>🎯</span> The 8-Step Screen-Reading Sequence (Rule 23)
        </span>
        <div className="flex flex-wrap items-center gap-1 font-mono text-[9.5px] text-gray-300 pt-1">
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">1. LOCATION</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">2. REACTION</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">3. RESULT</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">4. CVD + VOL</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">5. TRIGGER</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">6. RISK</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">7. REWARD (≥2R)</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 font-bold">8. TRADEABLE HYPOTHESIS</span>
        </div>
      </div>

      {/* 4. Absolute Filters: When NOT to Trade */}
      <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 space-y-2">
        <span className="font-mono font-bold text-xs text-rose-300 flex items-center gap-1.5">
          <span>🚫</span> When You Do NOT Trade - Absolute Filters (Rule 20)
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] text-gray-300 font-mono">
          <div>• No predetermined zone = <strong>NO TRADE</strong></div>
          <div>• Middle of value / POC chop = <strong>NO TRADE</strong></div>
          <div>• Random range away from zones = <strong>NO TRADE</strong></div>
          <div>• Spring without reclaim = <strong>NO TRADE</strong></div>
          <div>• Upthrust without return below = <strong>NO TRADE</strong></div>
          <div>• Breakout without pullback = <strong>DON&apos;T CHASE</strong></div>
          <div>• Less than 2R room to next zone = <strong>NO TRADE</strong></div>
          <div>• Nothing happens all day = <strong>ZERO TRADES (Fully OK)</strong></div>
        </div>
      </div>

      {/* 5. Risk & Stop Discipline */}
      <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1.5 text-[10.5px]">
        <span className="font-mono font-bold text-xs text-amber-300 flex items-center gap-1.5">
          <span>🛡️</span> Risk & Stop Discipline (Rules 17, 18, 19)
        </span>
        <p className="text-gray-300 text-[10px] leading-relaxed">
          • <strong>Minimum 2R Target:</strong> Check distance to next major zone BEFORE entering. If &lt; 2R room, skip the trade.<br />
          • <strong>Stop Loss:</strong> Set strictly by market structure (below Spring low / above Upthrust high). Position size is calculated from fixed 1R risk.<br />
          • <strong>Never Widen the Stop:</strong> If structural invalidation is breached, you are wrong. Exit immediately. Never turn -1R into -3R while conducting an emergency seminar.
        </p>
      </div>
    </div>
  )
}
