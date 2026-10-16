'use client'

import React, { useState, useEffect } from 'react'
import { BoxRangeBacktesterView } from './BoxRangeBacktesterView'

export interface EdgeData {
  success: boolean
  liveState: {
    timestamp: string
    market: string
    current_price: number
    session: string
    current_atr: number
    micro_range: {
      creek_support: number
      ice_resistance: number
      range_span_pts: number
      range_span_atr: number
      is_ascending_base: boolean
      session_delta: number
      absorption_bias: string
    }
    edge_signal: {
      signal: string
      action: string
      edge_type: string
      confidence_score: number
      stop_loss: number | null
      take_profit: number | null
      risk_reward: number | null
    }
  } | null
  benchmarks: {
    higher_low_rate_pct: number
    spring_lower_low_rate_pct: number
    spring_cvd_absorption_pct: number
    utad_higher_high_rate_pct: number
    utad_cvd_absorption_pct: number
    avg_markup_mfe_pts: number
    avg_markdown_mfe_pts: number
  }
  macroSummary: {
    market: string
    timeframe: string
    samplePeriod: string
    totalSmallRanges: number
    macroRangeLow: number
    macroRangeHigh: number
    macroRangeSpan: number
    accumRanges: number
    distribRanges: number
    springCount: number
    utadCount: number
    ascendingCount: number
  }
  recentRanges: Array<{
    type: string
    subtype: string
    start_time: string
    breakout_time: string
    duration_hours: number
    range_low: number
    range_high: number
    range_span_pts: number
    had_spring: boolean
    spring_depth_pts: number
    spring_cvd_div: boolean
    had_utad: boolean
    utad_depth_pts: number
    utad_cvd_div: boolean
    low_progression: string
    high_progression: string
    breakout_session: string
    mfe_pts: number
    win_1r: boolean
    win_2r: boolean
  }>
}

export function GoldEdgePanel() {
  const [data, setData] = useState<EdgeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState<'BOX_BACKTEST' | 'MICRO_EDGE'>('BOX_BACKTEST')
  const [filterType, setFilterType] = useState<'ALL' | 'SPRING' | 'ASCENDING' | 'UTAD'>('ALL')
  const [selectedRange, setSelectedRange] = useState<any | null>(null)

  const fetchEdgeData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/trading/edges/gold')
      const json = await res.json()
      if (json.success) {
        setData(json)
      }
    } catch (err) {
      console.error('Failed to load Gold Edge data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEdgeData()
    const interval = setInterval(fetchEdgeData, 15000)
    return () => clearInterval(interval)
  }, [])

  const filteredRanges = (data?.recentRanges || []).filter((r) => {
    if (filterType === 'SPRING') return r.had_spring
    if (filterType === 'ASCENDING') return r.low_progression === 'HIGHER_LOWS'
    if (filterType === 'UTAD') return r.had_utad
    return true
  })

  const live = data?.liveState
  const macro = data?.macroSummary
  const bench = data?.benchmarks

  return (
    <div className="space-y-6">
      {/* ── Top Market Switcher ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900/70 p-3 rounded-2xl border border-neutral-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/50 font-mono text-xs font-bold flex items-center gap-2 shadow-sm shadow-amber-500/10"
          >
            <span>🥇</span>
            <span>GOLD (XAU/USD · CME MGC)</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-400 text-black font-extrabold uppercase">
              ACTIVE EDGE
            </span>
          </button>

          <button
            type="button"
            className="px-3.5 py-2 rounded-xl bg-surface-900/60 text-neutral-400 hover:text-neutral-200 border border-neutral-800/80 font-mono text-xs font-semibold flex items-center gap-1.5 transition"
            title="Next markets can be added: Dow, Nasdaq, Crude, Nikkei"
          >
            <span>🥈</span>
            <span>+ Next Market</span>
            <span className="text-[10px] text-neutral-500">(Pending Selection)</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-neutral-400">Macro Period:</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface-900 border border-neutral-700 text-amber-200 font-semibold">
            Jan 26, 2026 – Present
          </span>
          <button
            type="button"
            onClick={fetchEdgeData}
            disabled={loading}
            className="p-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-neutral-300 border border-neutral-700 transition"
            title="Refresh edge data"
          >
            🔄
          </button>
        </div>
      </div>

      {/* ── Sub-Navigation Tabs ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveSubTab('BOX_BACKTEST')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 border ${
            activeSubTab === 'BOX_BACKTEST'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm shadow-amber-500/10'
              : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-neutral-200'
          }`}
        >
          <span>📦</span>
          <span>Box Range Backtester & Regime Analyzer</span>
          <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-400 text-black font-extrabold uppercase">
            Daily → 4H → 15M
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('MICRO_EDGE')}
          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition flex items-center gap-2 border ${
            activeSubTab === 'MICRO_EDGE'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-500/10'
              : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-neutral-200'
          }`}
        >
          <span>⚡</span>
          <span>Live Micro-Wyckoff Edge & 503-Range Explorer</span>
        </button>
      </div>

      {activeSubTab === 'BOX_BACKTEST' ? (
        <BoxRangeBacktesterView />
      ) : (
        <>
          {/* ── Macro Range Context Banner ── */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 via-neutral-900 to-neutral-900 border border-amber-500/30 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📐</span>
              <h2 className="text-sm font-mono font-bold text-white tracking-wide">
                Macro Range Context: Nested Micro-Wyckoff Engine
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                {macro?.totalSmallRanges ?? 503} Micro-Ranges Analyzed
              </span>
            </div>
            <p className="text-xs text-neutral-400 font-sans mt-1">
              From January 26 to now is a macro trading corridor (${macro?.macroRangeLow?.toFixed(2)} – ${macro?.macroRangeHigh?.toFixed(2)}). Inside this span, institutions accumulate in small Higher-Low bases (78.6%) and lower-low liquidity sweeps (17.3%).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right font-mono">
              <span className="block text-[10px] text-neutral-500 uppercase">Macro Range Corridor</span>
              <span className="text-sm font-bold text-amber-300">
                ${macro?.macroRangeLow?.toFixed(0)} – ${macro?.macroRangeHigh?.toFixed(0)}
              </span>
            </div>
            <div className="w-px h-8 bg-neutral-800" />
            <div className="text-right font-mono">
              <span className="block text-[10px] text-neutral-500 uppercase">Total Corridor Span</span>
              <span className="text-sm font-bold text-emerald-400">
                +${macro?.macroRangeSpan?.toFixed(0)} pts
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Live Market State & Active Edge Signals ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Live Price & Range Boundary */}
        <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
              Live Gold Market State
            </span>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              {live?.session ?? 'SESSION ACTIVE'}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-mono font-bold text-white tracking-tight">
                ${live?.current_price?.toFixed(2) ?? '4,165.42'}
              </span>
              <span className="block text-[10px] text-neutral-500 font-mono mt-0.5">
                ATR (14): ${live?.current_atr?.toFixed(2) ?? '5.01'}
              </span>
            </div>
            <div className="text-right font-mono text-xs">
              <span className="text-neutral-500 block text-[10px]">Delta Imbalance</span>
              <span className={live?.micro_range?.session_delta && live.micro_range.session_delta > 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {live?.micro_range?.session_delta ? (live.micro_range.session_delta > 0 ? `+${live.micro_range.session_delta.toLocaleString()}` : live.micro_range.session_delta.toLocaleString()) : '-12,688'}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-800/80 grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2 rounded-xl bg-neutral-950/60 border border-neutral-800">
              <span className="block text-[10px] text-neutral-500">Creek (Support)</span>
              <span className="font-bold text-emerald-400">
                ${live?.micro_range?.creek_support?.toFixed(2) ?? '4,155.95'}
              </span>
            </div>
            <div className="p-2 rounded-xl bg-neutral-950/60 border border-neutral-800">
              <span className="block text-[10px] text-neutral-500">Ice (Resistance)</span>
              <span className="font-bold text-rose-400">
                ${live?.micro_range?.ice_resistance?.toFixed(2) ?? '4,199.08'}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Edge Signal */}
        <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
              Live Edge Signal
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-amber-300">
                {live?.edge_signal?.signal ?? 'NEUTRAL'}
              </span>
              <span className="text-[10px] font-mono text-neutral-400">
                {live?.edge_signal?.edge_type ?? 'CONSOLIDATION_WATCH'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 font-sans leading-tight">
              {live?.edge_signal?.signal === 'SPRING_RECLAIM_BUY'
                ? 'Spring trap confirmed: Lower low swept Creek, bullish CVD absorbed orders, and price reclaimed range.'
                : live?.edge_signal?.signal === 'UTAD_RETURN_SHORT'
                ? 'UTAD trap confirmed: Higher high swept Ice, bearish CVD absorbed breakout buyers, and price rejected back below.'
                : 'Market is oscillating within micro-range. Monitoring Creek for Spring flushes and Ice for UTAD sweeps.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
            <div className="p-1.5 rounded-lg bg-neutral-950/50 border border-neutral-800">
              <span className="block text-neutral-500">Confidence</span>
              <span className="font-bold text-neutral-200">
                {live?.edge_signal?.confidence_score ? `${live.edge_signal.confidence_score}%` : 'WATCH'}
              </span>
            </div>
            <div className="p-1.5 rounded-lg bg-neutral-950/50 border border-neutral-800">
              <span className="block text-neutral-500">Stop Loss</span>
              <span className="font-bold text-rose-400">
                {live?.edge_signal?.stop_loss ? `$${live.edge_signal.stop_loss}` : 'Dynamic'}
              </span>
            </div>
            <div className="p-1.5 rounded-lg bg-neutral-950/50 border border-neutral-800">
              <span className="block text-neutral-500">Target</span>
              <span className="font-bold text-emerald-400">
                {live?.edge_signal?.take_profit ? `$${live.edge_signal.take_profit}` : 'Opposite'}
              </span>
            </div>
          </div>
        </div>

        {/* Bot & Execution Hub */}
        <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
                Autonomous Bot Status
              </span>
              <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                READY
              </span>
            </div>
            <p className="text-[11px] text-neutral-300 font-sans leading-relaxed">
              `bots/gold_wyckoff_edge_bot.py` continuously audits 15m order flow, tracking Creek/Ice sweeps and firing Spring and UTAD execution brackets.
            </p>
          </div>

          <div className="space-y-1.5 pt-2">
            <div className="p-2 rounded-xl bg-neutral-950/70 border border-neutral-800 font-mono text-[10px] text-neutral-400 flex items-center justify-between">
              <span>CLI Script:</span>
              <span className="text-amber-200">python scripts/gold_range_micro_wyckoff.py</span>
            </div>
            <div className="p-2 rounded-xl bg-neutral-950/70 border border-neutral-800 font-mono text-[10px] text-neutral-400 flex items-center justify-between">
              <span>Bot Runner:</span>
              <span className="text-emerald-300">python bots/gold_wyckoff_edge_bot.py --once</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Micro Accumulation vs Distribution Empirical Behavior Matrix ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Accumulation Micro-Mechanics */}
        <div className="p-4 rounded-2xl bg-surface-900/80 border border-emerald-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-emerald-300 uppercase flex items-center gap-1.5">
              <span>🟢</span> 1. How Gold Accumulates in Micro-Ranges
            </span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              +{bench?.avg_markup_mfe_pts ?? 40.37} pts Avg Markup
            </span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Higher Lows Base (Ascending Absorption)</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Buyers continuously step in above support; range forms ascending triangle.
                </span>
              </div>
              <span className="text-sm font-bold text-emerald-300 px-2 py-1 rounded bg-emerald-950 border border-emerald-800">
                {bench?.higher_low_rate_pct ?? 78.6}%
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Lower Low Spring Flush (Stop Run)</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Price purges sell stops below Creek ($7.47 avg depth) then violently snaps back.
                </span>
              </div>
              <span className="text-sm font-bold text-amber-300 px-2 py-1 rounded bg-amber-950 border border-amber-800">
                {bench?.spring_lower_low_rate_pct ?? 17.3}%
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Bullish CVD Absorption at Flush</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Negative sell delta absorbed by passive institutional buy limit orders.
                </span>
              </div>
              <span className="text-sm font-bold text-cyan-300 px-2 py-1 rounded bg-cyan-950 border border-cyan-800">
                {bench?.spring_cvd_absorption_pct ?? 97.6}%
              </span>
            </div>
          </div>
        </div>

        {/* Distribution Micro-Mechanics */}
        <div className="p-4 rounded-2xl bg-surface-900/80 border border-rose-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-rose-300 uppercase flex items-center gap-1.5">
              <span>🔴</span> 2. How Gold Distributes in Micro-Ranges
            </span>
            <span className="text-xs font-mono font-bold text-rose-400">
              -{bench?.avg_markdown_mfe_pts ?? 48.55} pts Avg Markdown
            </span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Lower Highs Supply Bleed (LPSY)</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Institutional supply dumps into every bounce; price fails to retest Ice.
                </span>
              </div>
              <span className="text-sm font-bold text-rose-300 px-2 py-1 rounded bg-rose-950 border border-rose-800">
                71.5%
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Higher High UTAD Sweep (Liquidity Trap)</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Spikes above Ice ($4.89 avg depth) into buy stops before sharp reversal.
                </span>
              </div>
              <span className="text-sm font-bold text-amber-300 px-2 py-1 rounded bg-amber-950 border border-amber-800">
                {bench?.utad_higher_high_rate_pct ?? 21.5}%
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between">
              <div>
                <span className="text-neutral-200 font-bold block">Bearish CVD Absorption at UTAD</span>
                <span className="text-[10px] text-neutral-400 font-sans">
                  Positive delta / breakout buying absorbed by passive institutional sell blocks.
                </span>
              </div>
              <span className="text-sm font-bold text-purple-300 px-2 py-1 rounded bg-purple-950 border border-purple-800">
                {bench?.utad_cvd_absorption_pct ?? 89.3}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Interactive Micro-Range Backtest Explorer ── */}
      <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>🔎</span>
              <span>Historical Micro-Ranges Explorer (Inside Jan 26 – Oct 16 Macro Corridor)</span>
            </h3>
            <p className="text-[11px] text-neutral-400 font-sans mt-0.5">
              Click any range to inspect its exact Creek, Ice, sweep depth, and post-breakout expansion.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            {(
              [
                { id: 'ALL', label: `All (${data?.recentRanges?.length ?? 50})` },
                { id: 'SPRING', label: 'Spring Flushes (LL)' },
                { id: 'ASCENDING', label: 'Ascending Bases (HL)' },
                { id: 'UTAD', label: 'UTAD Traps (HH)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`px-2.5 py-1 rounded-lg border transition ${
                  filterType === tab.id
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                    : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-neutral-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Range List / Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-neutral-800 text-[10px] text-neutral-500 uppercase">
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Date Range</th>
                <th className="py-2 px-2">Duration</th>
                <th className="py-2 px-2">Creek / Ice</th>
                <th className="py-2 px-2">Span</th>
                <th className="py-2 px-2">Sweep Behavior</th>
                <th className="py-2 px-2">CVD Absorption</th>
                <th className="py-2 px-2 text-right">Breakout Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {filteredRanges.slice(0, 20).map((r, i) => {
                const isAccum = r.type === 'ACCUMULATION'

                return (
                  <tr
                    key={i}
                    onClick={() => setSelectedRange(r)}
                    className="hover:bg-neutral-800/40 cursor-pointer transition"
                  >
                    <td className="py-2 px-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                          isAccum
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {isAccum ? 'ACCUM' : 'DISTR'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-neutral-300">
                      {r.start_time.slice(5, 16).replace('T', ' ')} → {r.breakout_time.slice(11, 16)}
                    </td>
                    <td className="py-2 px-2 text-neutral-400">{r.duration_hours}h</td>
                    <td className="py-2 px-2">
                      <span className="text-emerald-400">${r.range_low.toFixed(1)}</span>
                      <span className="text-neutral-600 mx-1">/</span>
                      <span className="text-rose-400">${r.range_high.toFixed(1)}</span>
                    </td>
                    <td className="py-2 px-2 text-neutral-300">${r.range_span_pts.toFixed(1)}</td>
                    <td className="py-2 px-2">
                      {r.had_spring ? (
                        <span className="text-amber-300 font-bold">
                          Spring -${r.spring_depth_pts.toFixed(1)} (LL)
                        </span>
                      ) : r.had_utad ? (
                        <span className="text-purple-300 font-bold">
                          UTAD +${r.utad_depth_pts.toFixed(1)} (HH)
                        </span>
                      ) : r.low_progression === 'HIGHER_LOWS' ? (
                        <span className="text-emerald-300">Ascending (HL)</span>
                      ) : (
                        <span className="text-neutral-500">Standard</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {r.spring_cvd_div || r.utad_cvd_div ? (
                        <span className="text-cyan-300">✓ Absorbed</span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span
                        className={`font-bold ${
                          isAccum ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isAccum ? `+${r.mfe_pts.toFixed(1)}` : `-${r.mfe_pts.toFixed(1)}`} pts
                      </span>
                      <span className="text-[9.5px] text-neutral-500 block">
                        {r.breakout_session}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Selected Range Inspector Drawer */}
        {selectedRange && (
          <div className="p-4 rounded-xl bg-neutral-950 border border-amber-500/40 space-y-2 mt-3 font-mono text-xs shadow-lg">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>🔎</span> Range Inspection: {selectedRange.subtype}
              </span>
              <button
                type="button"
                onClick={() => setSelectedRange(null)}
                className="text-neutral-500 hover:text-neutral-200 text-sm px-1.5"
              >
                ✕ Close
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
              <div className="p-2 rounded bg-surface-900 border border-neutral-800">
                <span className="text-neutral-500 block">Formation → Breakout</span>
                <span className="text-neutral-200">
                  {selectedRange.start_time.slice(0, 16)} → {selectedRange.breakout_time.slice(11, 16)} ({selectedRange.duration_hours}h)
                </span>
              </div>
              <div className="p-2 rounded bg-surface-900 border border-neutral-800">
                <span className="text-neutral-500 block">Creek (Low) / Ice (High)</span>
                <span className="text-emerald-400">${selectedRange.range_low}</span> / <span className="text-rose-400">${selectedRange.range_high}</span>
              </div>
              <div className="p-2 rounded bg-surface-900 border border-neutral-800">
                <span className="text-neutral-500 block">Sweep / Absorption</span>
                <span className="text-amber-300">
                  {selectedRange.had_spring ? `Spring -$${selectedRange.spring_depth_pts}` : selectedRange.had_utad ? `UTAD +$${selectedRange.utad_depth_pts}` : 'Ascending Base'}
                </span>
              </div>
              <div className="p-2 rounded bg-surface-900 border border-neutral-800">
                <span className="text-neutral-500 block">Breakout MFE Result</span>
                <span className={selectedRange.type === 'ACCUMULATION' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {selectedRange.type === 'ACCUMULATION' ? `+${selectedRange.mfe_pts}` : `-${selectedRange.mfe_pts}`} pts ({selectedRange.breakout_session})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
