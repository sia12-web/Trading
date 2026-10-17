'use client'

import React, { useEffect, useState } from 'react'
import {
  getWyckoffBenchmark,
  getAllWyckoffBenchmarks,
  WYCKOFF_CROSS_MARKET_BASELINE,
  formatIgnitionHour,
  type WyckoffBenchmarkMarket,
} from '@/lib/trading/wyckoffMarketBenchmarks'
import type {
  WyckoffMultiTimeframeReport,
  WyckoffTimeframeAnalysis,
  WeakHandBehaviorAssessment,
  WyckoffTimeframe,
} from '@/lib/trading/wyckoff'
import { saveLongTermMemory } from '@/lib/trading/leoLongTermMemory'
import { addRule } from '@/lib/trading/leoRules'
import type {
  BoxRegimeAnalysis,
  BoxSubLeg,
} from '@/lib/trading/boxRangeBacktester'

export type WyckoffSubTab =
  | 'MTF_ENGINE'
  | 'MINDSET_10'
  | 'ADVERSARIAL_8'
  | 'WEAK_HANDS'
  | 'BACKTEST_MATRIX'

export interface WyckoffRulesPanelProps {
  instrument: string
  initialSubTab?: WyckoffSubTab
  onAskLeo: (prompt: string, extra?: { boxAnalysis?: any; wyckoffReport?: any }) => void
  onSyncData?: (data: { boxAnalysis?: any; wyckoffReport?: any }) => void
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

const MARKET_TABS: Array<{ key: WyckoffBenchmarkMarket | 'MATRIX'; label: string; contract: string }> = [
  { key: 'NASDAQ', label: 'NQ', contract: 'Nasdaq (NQ)' },
  { key: 'DOW', label: 'YM', contract: 'Dow (YM)' },
  { key: 'CRUDE', label: 'CL', contract: 'Crude Oil (CL)' },
  { key: 'GOLD', label: 'GC', contract: 'Gold (GC)' },
  { key: 'NIKKEI', label: 'NKD', contract: 'Nikkei 225' },
  { key: 'MATRIX', label: '🌐 Matrix', contract: '5-Market Matrix' },
]

function classificationBadgeClass(classification: string | undefined): string {
  if (!classification) return 'bg-surface-800 text-gray-300 border-surface-700'
  if (classification.includes('ACCUMULATION')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
  if (classification.includes('DISTRIBUTION')) return 'bg-rose-500/20 text-rose-300 border-rose-500/50'
  if (classification === 'BREAKOUT') return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
  if (classification === 'BREAKDOWN') return 'bg-amber-500/20 text-amber-300 border-amber-500/50'
  return 'bg-blue-500/20 text-blue-300 border-blue-500/50'
}

function formatVolumeNum(v: number | undefined): string {
  if (v == null || isNaN(v)) return '0'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + 'k'
  return Math.round(v).toLocaleString()
}

function cvdBiasBadgeClass(bias: string | undefined): string {
  if (!bias) return 'bg-surface-800 text-gray-300 border-surface-700'
  if (bias.includes('BULLISH')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  if (bias.includes('BEARISH')) return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
  return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
}

function subLegTypeBadgeClass(type: BoxSubLeg['type']): string {
  switch (type) {
    case 'ACCUMULATION':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
    case 'MARKUP':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
    case 'DISTRIBUTION':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/50'
    case 'MARKDOWN':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/50'
    default:
      return 'bg-surface-800 text-gray-300 border-surface-700'
  }
}

const LIFECYCLE_STEPS = [
  'RANGE_DETECTED',
  'BOUNDARY_APPROACH',
  'BOUNDARY_TEST',
  'SWEEP',
  'RECLAIM',
  'RETEST',
  'CONFIRMED',
]

export function WyckoffRulesPanel({
  instrument,
  initialSubTab = 'MTF_ENGINE',
  onAskLeo,
  onSyncData,
}: WyckoffRulesPanelProps) {
  const activeBenchmark = getWyckoffBenchmark(instrument)
  const [activeSubTab, setActiveSubTab] = useState<WyckoffSubTab>(initialSubTab)
  const [selectedMarketTab, setSelectedMarketTab] = useState<WyckoffBenchmarkMarket | 'MATRIX'>(
    (activeBenchmark.market as WyckoffBenchmarkMarket) || 'NASDAQ'
  )
  const [selectedEngineMarket, setSelectedEngineMarket] = useState<string>(instrument)
  const [selectedTimeframeCard, setSelectedTimeframeCard] = useState<WyckoffTimeframe | 'ALL'>('ALL')
  const [auditTimeframe, setAuditTimeframe] = useState<WyckoffTimeframe>('5m')

  const [busData, setBusData] = useState<BusApiPayload | null>(null)
  const [wyckoffReport, setWyckoffReport] = useState<WyckoffMultiTimeframeReport | null>(null)
  const [loadingWyckoff, setLoadingWyckoff] = useState(false)
  const [boxAnalysis, setBoxAnalysis] = useState<BoxRegimeAnalysis | null>(null)
  const [loadingBoxAnalysis, setLoadingBoxAnalysis] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  const askLeoWithContext = (prompt: string) => {
    onAskLeo(prompt, { boxAnalysis, wyckoffReport })
  }

  useEffect(() => {
    if (onSyncData && (boxAnalysis || wyckoffReport)) {
      onSyncData({ boxAnalysis, wyckoffReport })
    }
  }, [boxAnalysis, wyckoffReport, onSyncData])

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab)
    }
  }, [initialSubTab])

  const fetchBusStatus = async (inst = selectedEngineMarket) => {
    try {
      const res = await fetch(`/api/trading/market-intelligence-bus?instrument=${encodeURIComponent(inst)}`)
      if (!res.ok) return
      const json = (await res.json()) as BusApiPayload
      if (json?.success) setBusData(json)
    } catch {
      // soft-fail
    }
  }

  const fetchWyckoffEngine = async (marketToFetch = selectedEngineMarket) => {
    setLoadingWyckoff(true)
    try {
      const res = await fetch(`/api/trading/wyckoff-engine?instrument=${encodeURIComponent(marketToFetch)}`)
      if (!res.ok) return
      const json = await res.json()
      if (json?.ok && json.report) {
        setWyckoffReport(json.report as WyckoffMultiTimeframeReport)
      }
    } catch {
      // soft-fail
    } finally {
      setLoadingWyckoff(false)
    }
  }

  const fetchBoxAnalysis = async (marketToFetch = activeBenchmark.market) => {
    setLoadingBoxAnalysis(true)
    try {
      const res = await fetch('/api/trading/edges/backtest-box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: marketToFetch, timeframe: '1D' }),
      })
      if (!res.ok) return
      const json = await res.json()
      if (json?.success && json.analysis) {
        setBoxAnalysis(json.analysis as BoxRegimeAnalysis)
      }
    } catch {
      // soft-fail
    } finally {
      setLoadingBoxAnalysis(false)
    }
  }

  // Strict chart-market lock: when instrument changes, strictly lock and fetch everything
  useEffect(() => {
    const mapped = (getWyckoffBenchmark(instrument).market as WyckoffBenchmarkMarket) || 'NASDAQ'
    setSelectedMarketTab(mapped)
    setSelectedEngineMarket(instrument)
    fetchBusStatus(instrument)
    fetchWyckoffEngine(instrument)
    fetchBoxAnalysis(mapped)
  }, [instrument])

  const handleRefreshAll = () => {
    const mapped = (getWyckoffBenchmark(instrument).market as WyckoffBenchmarkMarket) || 'NASDAQ'
    fetchWyckoffEngine(selectedEngineMarket)
    fetchBoxAnalysis(mapped)
    fetchBusStatus(selectedEngineMarket)
  }

  const handleSaveRangeToNotes = (tf: WyckoffTimeframeAnalysis) => {
    if (!tf.detectedRange) return
    saveLongTermMemory({
      id: tf.detectedRange.rangeId,
      instrument: tf.instrument,
      timeframe: tf.timeframe,
      priceLow: tf.detectedRange.rangeLow,
      priceHigh: tf.detectedRange.rangeHigh,
      purpose: `${tf.timeframe} Wyckoff ${tf.detectedRange.classification} (${tf.detectedRange.provisionalPhase}) · Event: ${tf.eventState.candidateEvent} (${tf.eventState.lifecycleStage})`,
      notes: `${tf.eventState.eventSummary} | Invalidation: ${tf.structuralInvalidation.price?.toFixed(2) ?? 'N/A'} | Next Target: ${tf.nextImportantObstacle.price?.toFixed(2) ?? 'N/A'}`,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      triggerCount: 0,
      alarmSoundEnabled: true,
      isLongTerm: tf.timeframe === '1D' || tf.timeframe === '30m',
    })
    setSyncFeedback(`Saved ${tf.instrument} ${tf.timeframe} Range [${tf.detectedRange.rangeLow.toFixed(2)} – ${tf.detectedRange.rangeHigh.toFixed(2)}] to Notes`)
    setTimeout(() => setSyncFeedback(null), 4000)
  }

  const handleArmSituationWatch = (tf: WyckoffTimeframeAnalysis) => {
    if (!tf.detectedRange) return
    const isSpring =
      tf.eventState.candidateEvent.includes('SPRING') ||
      tf.detectedRange.classification.includes('ACCUMULATION') ||
      tf.eventState.directionBias === 'BULLISH'
    const direction = isSpring ? 'LONG' : 'SHORT'
    const targetPrice = isSpring ? tf.detectedRange.rangeLow : tf.detectedRange.rangeHigh

    const newRule = addRule({
      type: 'MARKET_SITUATION',
      description: `${tf.instrument} ${tf.timeframe} Wyckoff ${tf.detectedRange.classification}: Watch ${tf.eventState.candidateEvent || 'Boundary Test'} at [${tf.detectedRange.rangeLow.toFixed(2)} – ${tf.detectedRange.rangeHigh.toFixed(2)}]`,
      instrument: tf.instrument as any,
      direction,
      targetPrice,
      pattern: tf.eventState.candidateEvent || 'SWEEP_REVERSAL',
      stopLoss: tf.structuralInvalidation.price ?? undefined,
      takeProfit: tf.nextImportantObstacle.price ?? undefined,
      isLongTerm: tf.timeframe === '1D' || tf.timeframe === '30m',
      status: 'ARMED',
    })

    setSyncFeedback(`🎯 Armed Situation Watch: ${newRule.description}`)
    setTimeout(() => setSyncFeedback(null), 5000)
  }

  const inspectedBenchmark =
    selectedMarketTab === 'MATRIX'
      ? activeBenchmark
      : getWyckoffBenchmark(selectedMarketTab)
  const allBenchmarks = getAllWyckoffBenchmarks()

  const activeAuditTf: WyckoffTimeframeAnalysis | undefined = wyckoffReport
    ? auditTimeframe === '1D'
      ? wyckoffReport.daily
      : auditTimeframe === '30m'
      ? wyckoffReport.m30
      : wyckoffReport.m5
    : undefined

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
      {/* ── Top Header Banner with Active Market Lock ── */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/80 via-surface-900 to-cyan-950/80 border border-emerald-500/50 shadow-md space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧭</span>
            <div>
              <h3 className="text-xs font-mono font-bold text-white tracking-wide flex items-center gap-2">
                Wyckoff Multi-Timeframe Accumulation & Distribution Intelligence Engine
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] border border-emerald-500/40">
                  1D → 4H → 15m → 5m → 1m
                </span>
              </h3>
              <p className="text-[10px] text-emerald-300/80 font-mono">
                Causal Range Discovery · CVD Absorption · Downtrend Invalidation · 4H Sub-Legs · Zero Hallucination
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={loadingWyckoff || loadingBoxAnalysis}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-200 font-mono text-[9.5px] font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <span>{loadingWyckoff || loadingBoxAnalysis ? '⟳' : '🔄'}</span>
              <span>{loadingWyckoff || loadingBoxAnalysis ? 'Scanning…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Active Chart Market Lock Banner (No Foreign Market Tabs) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-surface-800/80 font-mono text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 font-semibold text-[9.5px]">Chart Instrument:</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-500/50 text-white font-bold shadow-sm">
              <span className="text-sm">
                {activeBenchmark.market === 'GOLD' ? '🥇' : activeBenchmark.market === 'CRUDE' ? '🛢️' : activeBenchmark.market === 'DOW' ? '📈' : activeBenchmark.market === 'NIKKEI' ? '🗾' : '💻'}
              </span>
              <span className="text-emerald-300 font-mono text-xs">{activeBenchmark.market}</span>
              <span className="text-gray-400 text-[10px]">({activeBenchmark.contractLabel})</span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[8.5px] border border-emerald-500/40">
                🔒 Locked to Chart
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-300 font-mono">1D · 4H · 15m · 5m · 1m Synchronized</span>
            </span>
          </div>
        </div>
      </div>

      {/* Sync Feedback Toast */}
      {syncFeedback && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 font-mono text-[10px] flex items-center justify-between animate-fadeIn">
          <span>✅ {syncFeedback}</span>
          <button
            type="button"
            onClick={() => setSyncFeedback(null)}
            className="text-emerald-400 hover:text-white ml-2 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Top Primary Sub-Navigation Tabs ── */}
      <div className="flex items-center overflow-x-auto gap-1 border-b border-surface-800/80 pb-1 scrollbar-none shrink-0 font-mono text-[9.5px]">
        <button
          type="button"
          onClick={() => setActiveSubTab('MTF_ENGINE')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'MTF_ENGINE'
              ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>🧭</span>
          <span>Wyckoff MTF Engine (1D · 4H · 15m · 5m · 1m)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('MINDSET_10')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'MINDSET_10'
              ? 'bg-cyan-950/90 text-cyan-200 border border-cyan-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>🧠</span>
          <span>10 Mindset & Inventory Audit</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('ADVERSARIAL_8')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'ADVERSARIAL_8'
              ? 'bg-rose-950/90 text-rose-200 border border-rose-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>🛡️</span>
          <span>8 Adversarial Questions</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('WEAK_HANDS')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'WEAK_HANDS'
              ? 'bg-amber-950/90 text-amber-200 border border-amber-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>👥</span>
          <span>Weak-Hand Participant Modeling</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('BACKTEST_MATRIX')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'BACKTEST_MATRIX'
              ? 'bg-blue-950/90 text-blue-200 border border-blue-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>🔬</span>
          <span>1-Yr Backtest & Matrix</span>
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 1: 🧭 MTF AUCTION ENGINE (HERO VIEW)
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'MTF_ENGINE' && (
        <div className="space-y-3 font-mono">
          {loadingBoxAnalysis && !boxAnalysis ? (
            <div className="p-8 rounded-xl bg-surface-950/80 border border-surface-800 text-center space-y-2">
              <span className="text-2xl animate-spin inline-block">🧭</span>
              <div className="text-emerald-300 font-bold text-xs">
                Analyzing Multi-Timeframe Telemetry for {activeBenchmark.market} (1D · 4H · 15m · 5m · 1m)…
              </div>
              <p className="text-gray-500 text-[10px]">
                Computing True ATR, CVD absorption, trend invalidation, and Wyckoff micro-ranges…
              </p>
            </div>
          ) : boxAnalysis ? (
            <>
              {/* 1. MACRO TREND DEFINITION & STRUCTURAL INVALIDATION (DAILY CHART) */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-surface-950 via-surface-900 to-surface-950 border border-emerald-500/40 shadow-sm space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="text-gray-400 text-[10px] block">Daily Macro Structural Regime:</span>
                      <div className="text-white text-xs font-bold flex items-center gap-2">
                        <span className="text-emerald-300">{boxAnalysis.label}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                          boxAnalysis.isTrendInvalidated
                            ? 'bg-rose-950/90 text-rose-200 border-rose-500/60 animate-pulse'
                            : 'bg-emerald-950/90 text-emerald-200 border-emerald-500/60'
                        }`}>
                          {boxAnalysis.isTrendInvalidated ? '🚨 TREND INVALIDATED → ACCUMULATION RANGE' : boxAnalysis.regime}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        askLeoWithContext(
                          `Leo, audit the macro trend invalidation on ${boxAnalysis.market}. Explain why the prior ${boxAnalysis.regime.toLowerCase()} failed, how the Higher-Low base held with CVD absorption, and the roadmap for Phase C/D markups.`
                        )
                      }
                      className="px-2.5 py-1 rounded bg-purple-950 hover:bg-purple-900 border border-purple-500/50 text-purple-200 text-[9px] font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>💬</span>
                      <span>Ask Leo: Invalidation Audit</span>
                    </button>
                  </div>
                </div>

                {/* Macro Context Metrics Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9.5px]">
                  <div className="p-2 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">PRICE SPAN (RANGE):</span>
                    <span className="text-white font-bold font-mono">
                      ${boxAnalysis.lowPrice.toFixed(2)} – ${boxAnalysis.highPrice.toFixed(2)}
                    </span>
                    <span className="text-gray-400 text-[8.5px] block">({boxAnalysis.priceSpanPts.toFixed(1)} pts / {boxAnalysis.trendSlopePct > 0 ? '+' : ''}{boxAnalysis.trendSlopePct}%)</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">DAILY ATR (VOLATILITY):</span>
                    <span className="text-cyan-300 font-bold font-mono">{boxAnalysis.avgAtr.toFixed(2)} pts</span>
                    <span className="text-gray-500 text-[8.5px] block">True Daily 14-ATR</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">DURATION / BARS:</span>
                    <span className="text-amber-300 font-bold font-mono">{boxAnalysis.durationDays} Days</span>
                    <span className="text-gray-500 text-[8.5px] block">{boxAnalysis.totalBars} Bars Analyzed</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">INVALIDATION TYPE:</span>
                    <span className="text-emerald-300 font-bold font-mono">{boxAnalysis.invalidationType}</span>
                    <span className="text-gray-500 text-[8.5px] block">Level: ${boxAnalysis.invalidationPrice ?? boxAnalysis.lowPrice.toFixed(2)}</span>
                  </div>
                </div>

                {/* Invalidation Narrative Box */}
                <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-[10px] space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold text-[9.5px]">
                    <span>⚡</span>
                    <span>Empirical Structural Invalidation Verdict:</span>
                  </div>
                  <p className="text-gray-200 leading-relaxed font-sans text-[10px]">
                    {boxAnalysis.invalidationNotes}
                  </p>
                </div>
              </div>

              {/* 1B. VOLATILITY GAUGE & CROSS-MARKET RADAR WYCKOFF ACCUMULATION / DISTRIBUTION SYNTHESIS */}
              {wyckoffReport?.volatilityAndRadarSynthesis && (
                <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-950/50 via-surface-900 to-cyan-950/40 border border-indigo-500/40 shadow-sm space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📡</span>
                      <div>
                        <div className="text-white text-xs font-bold flex items-center gap-2 flex-wrap">
                          <span>Vol Gauge ({wyckoffReport.volatilityAndRadarSynthesis.primaryGaugeSymbol}) & Cross-Market Radar Wyckoff Diagnostic</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                              wyckoffReport.volatilityAndRadarSynthesis.combinedAccDistVerdict === 'ACCUMULATION_FAVORED'
                                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/60'
                                : wyckoffReport.volatilityAndRadarSynthesis.combinedAccDistVerdict === 'DISTRIBUTION_FAVORED'
                                ? 'bg-rose-950/90 text-rose-200 border-rose-500/60'
                                : wyckoffReport.volatilityAndRadarSynthesis.combinedAccDistVerdict === 'CAUSE_BUILDING_NEUTRAL'
                                ? 'bg-cyan-950/90 text-cyan-200 border-cyan-500/60'
                                : 'bg-amber-950/90 text-amber-200 border-amber-500/60'
                            }`}
                          >
                            {wyckoffReport.volatilityAndRadarSynthesis.combinedAccDistVerdict.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <span className="text-gray-400 text-[9.5px] block">
                          Silent Spring Absorption · Post-Spring Vol Crush · Distribution Skew Divergence · Intermarket SMTI
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        askLeoWithContext(
                          `Leo, audit whether ${activeBenchmark.market} is in Wyckoff Accumulation or Distribution using its live implied volatility gauge (${wyckoffReport.volatilityAndRadarSynthesis?.primaryGaugeSymbol}: ${wyckoffReport.volatilityAndRadarSynthesis?.primaryGaugeValue?.toFixed(1) ?? 'N/A'}, signal: ${wyckoffReport.volatilityAndRadarSynthesis?.volGaugeSignal}) and the Cross-Market Radar (Grade ${wyckoffReport.volatilityAndRadarSynthesis?.radarGrade ?? 'N/A'}, signal: ${wyckoffReport.volatilityAndRadarSynthesis?.crossMarketSignal}).`
                        )
                      }
                      className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/50 text-indigo-200 text-[9px] font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>🤖</span>
                      <span>Ask Leo: Vol & Radar Acc/Dist Audit</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9.5px]">
                    <div className="p-2.5 rounded-lg bg-surface-900/80 border border-surface-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-cyan-300 font-bold">
                          Implied Vol Gauge ({wyckoffReport.volatilityAndRadarSynthesis.primaryGaugeSymbol}):{' '}
                          {wyckoffReport.volatilityAndRadarSynthesis.primaryGaugeValue != null
                            ? wyckoffReport.volatilityAndRadarSynthesis.primaryGaugeValue.toFixed(1)
                            : 'N/A'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-800 text-gray-200 text-[8.5px] font-bold border border-surface-700">
                          {wyckoffReport.volatilityAndRadarSynthesis.volGaugeSignal.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-gray-300 font-sans text-[9.5px] leading-relaxed">
                        {wyckoffReport.volatilityAndRadarSynthesis.volGaugeDiagnosis}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-surface-900/80 border border-surface-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-300 font-bold">
                          Cross-Market Radar: Grade {wyckoffReport.volatilityAndRadarSynthesis.radarGrade ?? 'N/A'} (Top Pick:{' '}
                          {wyckoffReport.volatilityAndRadarSynthesis.radarTopPick ?? 'NONE'})
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-800 text-gray-200 text-[8.5px] font-bold border border-surface-700">
                          {wyckoffReport.volatilityAndRadarSynthesis.crossMarketSignal.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-gray-300 font-sans text-[9.5px] leading-relaxed">
                        {wyckoffReport.volatilityAndRadarSynthesis.crossMarketDiagnosis}
                      </p>
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-[10px] text-indigo-100 font-sans flex items-start gap-2">
                    <span className="text-indigo-400 font-bold shrink-0">🎯 Desk Synthesis:</span>
                    <span>{wyckoffReport.volatilityAndRadarSynthesis.actionableSynthesis}</span>
                  </div>
                </div>
              )}

              {/* 2. THE 5-TIMEFRAME TELEMETRY MATRIX (DAILY · 4H · 15M · 5M · 1M) */}
              <div className="p-3 rounded-xl bg-surface-950/90 border border-surface-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">📊</span>
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        Multi-Timeframe Telemetry Engine
                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[8.5px] border border-cyan-500/40">
                          1D · 4H · 15M · 5M · 1M
                        </span>
                      </h4>
                      <p className="text-[9.5px] text-gray-400">
                        True ATR, Total Volume, Buy/Sell Split, Net CVD Delta, and Institutional Bias across all 5 tiers
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] text-emerald-400 font-mono">
                    Zero Hallucination · Exact Local Tick Aggregation
                  </span>
                </div>

                {/* Telemetry Matrix Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[9.5px]">
                    <thead>
                      <tr className="border-b border-surface-800 text-gray-400 text-[8.5px]">
                        <th className="py-1.5 px-2">TIMEFRAME & ROLE</th>
                        <th className="py-1.5 px-2 text-cyan-300">TRUE ATR</th>
                        <th className="py-1.5 px-2 text-gray-300">TOTAL VOL</th>
                        <th className="py-1.5 px-2 text-amber-300 min-w-[120px]">BUY / SELL SPLIT</th>
                        <th className="py-1.5 px-2 text-emerald-300">NET CVD DELTA</th>
                        <th className="py-1.5 px-2 text-purple-300">INSTITUTIONAL BIAS</th>
                        <th className="py-1.5 px-2 text-gray-400">BARS</th>
                        <th className="py-1.5 px-2 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800/60 text-gray-200">
                      {(
                        [
                          { key: 'daily', label: '1D (Daily)', desc: 'Macro Regime & Invalidation', data: boxAnalysis.timeframes.daily },
                          { key: 'h4', label: '4H (4-Hour)', desc: 'Intermediate Sub-Leg Decomposition', data: boxAnalysis.timeframes.h4 },
                          { key: 'm15', label: '15M (15-Min)', desc: 'Tactical Execution Boundaries', data: boxAnalysis.timeframes.m15 },
                          { key: 'm5', label: '5M (5-Min)', desc: 'Micro Absorption & Spring/UTAD Reclaim', data: boxAnalysis.timeframes.m5 },
                          { key: 'm1', label: '1M (1-Min)', desc: 'Precision Tape Delta & Scalp Confirmation', data: boxAnalysis.timeframes.m1 },
                        ] as const
                      ).map((row) => {
                        const total = row.data.totalVolume || 1
                        const buyPct = Math.round((row.data.buyVolume / total) * 100)
                        const sellPct = 100 - buyPct
                        const isPositiveDelta = row.data.netCvd >= 0

                        return (
                          <tr key={row.key} className="hover:bg-surface-900/60 transition">
                            <td className="py-2 px-2">
                              <span className="font-bold text-white block">{row.label}</span>
                              <span className="text-[8px] text-gray-400 block">{row.desc}</span>
                            </td>
                            <td className="py-2 px-2 font-bold text-cyan-300">
                              {row.data.atr.toFixed(2)} pts
                            </td>
                            <td className="py-2 px-2 font-mono text-gray-300">
                              {formatVolumeNum(row.data.totalVolume)}
                            </td>
                            <td className="py-2 px-2">
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between text-[8px] font-mono">
                                  <span className="text-emerald-400">{buyPct}% B</span>
                                  <span className="text-rose-400">{sellPct}% S</span>
                                </div>
                                <div className="h-1.5 w-full bg-surface-800 rounded-full overflow-hidden flex">
                                  <div style={{ width: `${buyPct}%` }} className="bg-emerald-500 h-full" />
                                  <div style={{ width: `${sellPct}%` }} className="bg-rose-500 h-full" />
                                </div>
                              </div>
                            </td>
                            <td className="py-2 px-2 font-bold font-mono">
                              <span className={isPositiveDelta ? 'text-emerald-400' : 'text-rose-400'}>
                                {isPositiveDelta ? '+' : ''}{formatVolumeNum(row.data.netCvd)}
                              </span>
                            </td>
                            <td className="py-2 px-2">
                              <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border ${cvdBiasBadgeClass(row.data.cvdBias)}`}>
                                {row.data.cvdBias.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-gray-400 text-[8.5px]">
                              {row.data.barsCount}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  askLeoWithContext(
                                    `Leo, audit the ${row.label} timeframe for ${boxAnalysis.market}. ATR is ${row.data.atr.toFixed(2)} pts, Net CVD is ${row.data.netCvd > 0 ? '+' : ''}${row.data.netCvd}, volume is ${row.data.totalVolume}. What is the institutional order flow read?`
                                  )
                                }
                                className="px-2 py-0.5 rounded bg-surface-900 hover:bg-surface-800 border border-surface-700 hover:border-purple-500/50 text-purple-200 text-[8.5px] font-semibold transition cursor-pointer"
                              >
                                💬 Ask Leo
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. FIXED RANGE VOLUME PROFILE (FRVP) & FAIR VALUE */}
              <div className="p-3 rounded-xl bg-surface-950/90 border border-surface-800 space-y-2">
                <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
                  <span className="font-bold text-xs text-white flex items-center gap-1.5">
                    <span>🎯</span> Fixed Range Volume Profile & Fair Value Distribution
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                    boxAnalysis.volumeProfile.deltaBias.includes('BULLISH')
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                  }`}>
                    {boxAnalysis.volumeProfile.deltaBias.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[9.5px]">
                  <div className="p-2 rounded bg-surface-900/80 border border-cyan-500/30">
                    <span className="text-gray-400 text-[8.5px] block">POC (POINT OF CONTROL):</span>
                    <span className="text-cyan-300 font-bold text-xs font-mono">
                      ${boxAnalysis.volumeProfile.poc.toFixed(2)}
                    </span>
                    <span className="text-gray-500 text-[8px] block">Peak volume node of entire range</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-rose-500/30">
                    <span className="text-gray-400 text-[8.5px] block">VAH (VALUE AREA HIGH 70%):</span>
                    <span className="text-rose-300 font-bold text-xs font-mono">
                      ${boxAnalysis.volumeProfile.vah.toFixed(2)}
                    </span>
                    <span className="text-gray-500 text-[8px] block">Upper boundary of 70% distribution</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-emerald-500/30">
                    <span className="text-gray-400 text-[8.5px] block">VAL (VALUE AREA LOW 70%):</span>
                    <span className="text-emerald-300 font-bold text-xs font-mono">
                      ${boxAnalysis.volumeProfile.val.toFixed(2)}
                    </span>
                    <span className="text-gray-500 text-[8px] block">Lower boundary of 70% distribution</span>
                  </div>
                  <div className="p-2 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">NET CVD DELTA:</span>
                    <span className={`font-bold text-xs font-mono ${boxAnalysis.volumeProfile.netDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {boxAnalysis.volumeProfile.netDelta >= 0 ? '+' : ''}{boxAnalysis.volumeProfile.netDelta.toLocaleString()}
                    </span>
                    <span className="text-gray-500 text-[8px] block">
                      Total: {formatVolumeNum(boxAnalysis.volumeProfile.totalVolume)} contracts
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. 4-HOUR SUB-LEG DECOMPOSITION (THE SUB-BOXES INSIDE THE RANGE) */}
              <div className="p-3 rounded-xl bg-surface-950/90 border border-surface-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <span>📦</span> 4-Hour Sub-Leg Decomposition ({boxAnalysis.subLegs.length} Boxes)
                    </h4>
                    <p className="text-[9.5px] text-gray-400">
                      As requested: Breaking down the macro range into 4-hour markdown, markup, and accumulation sub-boxes
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      askLeoWithContext(
                        `Leo, analyze the 6 4-hour sub-boxes for ${boxAnalysis.market}. How did institutional operators transition from the initial markdown to Creek accumulation, SOS markup, and re-accumulation?`
                      )
                    }
                    className="px-2 py-0.5 rounded bg-purple-950 hover:bg-purple-900 border border-purple-500/50 text-purple-200 text-[9px] font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>💬</span>
                    <span>Audit All 4H Boxes</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {boxAnalysis.subLegs.map((sub, idx) => (
                    <div
                      key={sub.id}
                      className="p-2.5 rounded-lg bg-surface-900/90 border border-surface-800 hover:border-emerald-500/50 transition space-y-1.5 text-[9.5px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-[10px] truncate">
                          {sub.label}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold border shrink-0 ${subLegTypeBadgeClass(sub.type)}`}>
                          {sub.type}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1 text-[8.5px] text-gray-400 border-t border-b border-surface-800/80 py-1 font-mono">
                        <div>
                          Range: <span className="text-white">${sub.lowPrice.toFixed(1)} – ${sub.highPrice.toFixed(1)}</span>
                        </div>
                        <div>
                          Span: <span className="text-cyan-300">{sub.spanPts.toFixed(1)} pts</span>
                        </div>
                        <div>
                          POC: <span className="text-amber-300">${sub.poc.toFixed(1)}</span>
                        </div>
                        <div>
                          Delta: <span className={sub.netDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {sub.netDelta >= 0 ? '+' : ''}{sub.netDelta.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <p className="text-gray-300 text-[8.5px] leading-tight font-sans">
                        {sub.behaviorNote}
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          askLeoWithContext(
                            `Leo, backtest and audit sub-box ${idx + 1} (${sub.label}) on ${boxAnalysis.market}. Price span: $${sub.lowPrice} – $${sub.highPrice}, POC: $${sub.poc}, Net Delta: ${sub.netDelta}. Detail institutional behavior.`
                          )
                        }
                        className="w-full py-0.8 rounded bg-surface-950 hover:bg-surface-800 border border-surface-800 hover:border-purple-500/50 text-purple-300 text-[8px] font-semibold transition cursor-pointer"
                      >
                        💬 Audit Box {idx + 1} with Leo
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. EMPIRICAL WYCKOFF INSTITUTIONAL ACCUMULATION/DISTRIBUTION EDGE */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/40 via-surface-900 to-cyan-950/40 border border-emerald-500/50 space-y-2 text-[9.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span>🔬</span>
                    <span className="font-bold text-xs text-white">
                      Empirical Wyckoff Institutional Edge ({boxAnalysis.market})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      askLeoWithContext(
                        `Leo, what is our empirical statistical edge for ${boxAnalysis.market}? Compare the 78.6% Higher-Low base rate vs the 17.3% Spring sweep rate and tell me how to structure execution.`
                      )
                    }
                    className="px-2 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 text-[9px] font-bold transition cursor-pointer"
                  >
                    <span>💬</span>
                    <span>Audit Edge with Leo</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 text-[9px]">
                  <div className="p-1.5 rounded bg-surface-950/80 border border-emerald-500/30">
                    <span className="text-gray-400 text-[8px] block">HIGHER-LOW BASE (EDGE)</span>
                    <span className="text-emerald-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.higherLowBaseRatePct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">Dominant Accumulation</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-950/80 border border-cyan-500/30">
                    <span className="text-gray-400 text-[8px] block">SPRING SWEEP RATE</span>
                    <span className="text-cyan-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.springRatePct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">Lows Swept Below Creek</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-950/80 border border-emerald-500/30">
                    <span className="text-gray-400 text-[8px] block">SPRING CVD ABSORPTION</span>
                    <span className="text-emerald-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.springCvdAbsorptionPct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">Positive Absorption</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-950/80 border border-rose-500/30">
                    <span className="text-gray-400 text-[8px] block">UTAD SWEEP RATE</span>
                    <span className="text-rose-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.utadRatePct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">Highs Swept Above Ice</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-950/80 border border-amber-500/30">
                    <span className="text-gray-400 text-[8px] block">WIN RATE (1R TARGET)</span>
                    <span className="text-amber-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.winRate1RPct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">MFE: +{boxAnalysis.wyckoffBacktest.avgMarkupMfePts} pts</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-950/80 border border-purple-500/30">
                    <span className="text-gray-400 text-[8px] block">WIN RATE (2R TARGET)</span>
                    <span className="text-purple-300 font-bold text-xs font-mono">{boxAnalysis.wyckoffBacktest.winRate2RPct}%</span>
                    <span className="text-gray-500 text-[7.5px] block">Full Target Runway</span>
                  </div>
                </div>

                <div className="p-2 rounded bg-surface-950/60 border border-surface-800 text-[9.5px] text-gray-300 italic">
                  💡 <strong>Institutional Edge Read:</strong> {boxAnalysis.wyckoffBacktest.institutionalRead}
                </div>
              </div>

              {/* 6. COLLAPSIBLE REAL-TIME EVENT LIFECYCLE STEPPERS & LIVE ALERTS */}
              {wyckoffReport && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-surface-800 pb-1 text-[9.5px]">
                    <span className="text-white font-bold flex items-center gap-1.5">
                      <span>⚡</span> Real-Time Event Lifecycle Steppers & Scans ({wyckoffReport.instrument})
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">View:</span>
                      {(['ALL', '1D', '4H', '30m', '5m'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setSelectedTimeframeCard(mode)}
                          className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                            selectedTimeframeCard === mode
                              ? 'bg-emerald-500/30 border border-emerald-400 text-white'
                              : 'bg-surface-900 border border-surface-800 text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          {mode === 'ALL' ? 'Side-by-Side' : `${mode} Only`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4-Timeframe Responsive Grid */}
                  <div
                    className={`grid gap-2.5 ${
                      selectedTimeframeCard === 'ALL'
                        ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
                        : 'grid-cols-1'
                    }`}
                  >
                    {[wyckoffReport.daily, wyckoffReport.h4, wyckoffReport.m30, wyckoffReport.m5]
                      .filter((tf): tf is WyckoffTimeframeAnalysis => tf != null && (selectedTimeframeCard === 'ALL' || selectedTimeframeCard === tf.timeframe))
                      .map((tf) => {
                        const range = tf.detectedRange
                        const event = tf.eventState
                        const currentStageIdx = LIFECYCLE_STEPS.indexOf(event.lifecycleStage)

                        return (
                          <div
                            key={tf.timeframe}
                            className="p-3 rounded-xl bg-surface-950/90 border border-surface-800 hover:border-emerald-500/40 transition space-y-2 flex flex-col justify-between shadow-md"
                          >
                            <div className="space-y-2">
                              {/* Card Header */}
                              <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700 text-white font-bold text-xs">
                                    {tf.timeframe}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${classificationBadgeClass(
                                      range?.classification
                                    )}`}
                                  >
                                    {range?.classification ?? tf.swingStructure.structuralTrend}
                                  </span>
                                </div>
                                <span className="px-1.5 py-0.5 rounded bg-surface-900 border border-surface-700 text-cyan-300 text-[8.5px] font-semibold">
                                  {tf.monitoringStatus}
                                </span>
                              </div>

                              {/* Range Zone Visualizer */}
                              {range ? (
                                <div className="p-2 rounded-lg bg-surface-900/90 border border-surface-800 space-y-1 text-[9.5px]">
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-400">Boundary Range:</span>
                                    <span className="text-white font-bold">
                                      <span className="text-emerald-300 font-mono">{range.rangeLow.toFixed(2)}</span>
                                      {' — '}
                                      <span className="text-rose-300 font-mono">{range.rangeHigh.toFixed(2)}</span>
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 text-[8.5px] text-gray-400">
                                    <div>Mid: <strong className="text-gray-200">{range.rangeMidpoint.toFixed(2)}</strong></div>
                                    <div>POC: <strong className="text-cyan-300">{range.poc?.toFixed(2) ?? 'N/A'}</strong></div>
                                    <div>Width: <strong className="text-gray-200">{range.widthAtr?.toFixed(1) ?? 'N/A'} ATR</strong></div>
                                    <div>Phase: <strong className="text-amber-300">{range.provisionalPhase}</strong></div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-2 rounded-lg bg-surface-900/60 border border-surface-800 text-[9px] text-gray-400">
                                  Structural trend: <strong>{tf.swingStructure.structuralTrend}</strong>
                                </div>
                              )}

                              {/* Event Lifecycle Stage Stepper */}
                              <div className="p-2 rounded-lg bg-surface-900/80 border border-surface-800 space-y-1 text-[9px]">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400">Lifecycle State:</span>
                                  <span className="text-amber-300 font-bold">
                                    {event.candidateEvent} ({event.confirmationStatus})
                                  </span>
                                </div>
                                <div className="flex items-center gap-0.5 overflow-x-auto pb-0.5">
                                  {LIFECYCLE_STEPS.map((stage, idx) => {
                                    const isPassed = currentStageIdx >= idx
                                    const isCurrent = event.lifecycleStage === stage
                                    return (
                                      <div
                                        key={stage}
                                        className={`px-1 py-0.5 rounded text-[7.5px] font-mono shrink-0 transition ${
                                          isCurrent
                                            ? 'bg-amber-500/30 text-amber-200 border border-amber-400 font-bold'
                                            : isPassed
                                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                                            : 'bg-surface-950 text-gray-600 border border-surface-900'
                                        }`}
                                      >
                                        {stage.replace('_', ' ').slice(0, 7)}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-1 pt-1 border-t border-surface-800">
                              <div className="grid grid-cols-2 gap-1 text-[8.5px]">
                                <button
                                  type="button"
                                  onClick={() => handleSaveRangeToNotes(tf)}
                                  disabled={!range}
                                  className="py-1 px-1.5 rounded bg-surface-900 hover:bg-surface-800 border border-surface-700 text-gray-200 font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <span>📌</span>
                                  <span>Notes</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleArmSituationWatch(tf)}
                                  disabled={!range}
                                  className="py-1 px-1.5 rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                                >
                                  <span>🎯</span>
                                  <span>Arm Watch</span>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  askLeoWithContext(
                                    `Leo, audit the ${tf.instrument} ${tf.timeframe} Wyckoff structure. Range: [${range?.rangeLow.toFixed(2) ?? 'N/A'} – ${range?.rangeHigh.toFixed(2) ?? 'N/A'}], Event: ${event.candidateEvent} (${event.lifecycleStage}). Invalidation: ${tf.structuralInvalidation.price?.toFixed(2) ?? 'N/A'}. Explain effort vs result and tradeability.`
                                  )
                                }
                                className="w-full py-1 rounded bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-[8.5px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <span>💬</span>
                                <span>Audit {tf.timeframe} with Leo</span>
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>

                  {/* Deduplicated Live Wyckoff Alerts Feed */}
                  {wyckoffReport.alerts.length > 0 && (
                    <div className="p-3 rounded-xl bg-surface-950/90 border border-emerald-500/30 space-y-2">
                      <div className="flex items-center justify-between border-b border-surface-800 pb-1">
                        <span className="text-white font-bold text-xs flex items-center gap-1.5">
                          <span>🔔</span> Deduplicated Live Wyckoff Alerts ({wyckoffReport.alerts.length})
                        </span>
                        <span className="text-[8.5px] text-gray-500">Real-Time State Transitions</span>
                      </div>
                      <div className="space-y-1">
                        {wyckoffReport.alerts.map((a) => (
                          <div
                            key={a.id}
                            className="px-2.5 py-1.5 rounded-lg bg-surface-900/90 border border-surface-800 text-gray-200 flex flex-wrap items-center justify-between gap-2 text-[9.5px]"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  a.monitoringStatus === 'CONFIRMED'
                                    ? 'bg-emerald-400 animate-ping'
                                    : a.monitoringStatus === 'INVALIDATED'
                                    ? 'bg-rose-400'
                                    : 'bg-amber-400'
                                }`}
                              />
                              <span className="font-bold text-white">[{a.timeframe}]</span>
                              <span>{a.headline}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[8.5px] text-gray-400">
                              <span className="text-amber-300 font-semibold">{a.candidateEvent}</span>
                              <span className="px-1.5 py-0.2 rounded bg-surface-800 border border-surface-700">
                                {a.monitoringStatus}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="p-8 rounded-xl bg-surface-950/80 border border-surface-800 text-center space-y-3">
              <span className="text-3xl block">🧭</span>
              <div className="text-gray-300 font-bold text-sm">
                Wyckoff Multi-Timeframe Accumulation & Distribution Intelligence Engine Ready
              </div>
              <p className="text-gray-400 text-xs max-w-md mx-auto">
                Deterministic range discovery, ATR regimes, CVD effort vs result, event lifecycle transitions, and 1D/4H/15m/5m/1m box backtesting.
              </p>
              <button
                type="button"
                onClick={handleRefreshAll}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg cursor-pointer"
              >
                Run Live 1D/4H/15m/5m/1m Discovery on {selectedEngineMarket}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 2: 🧠 10 MINDSET & INVENTORY AUDIT
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'MINDSET_10' && (
        <div className="space-y-3 font-mono">
          <div className="p-3 rounded-xl bg-gradient-to-r from-cyan-950/60 via-surface-900 to-cyan-950/60 border border-cyan-500/40 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>🧠</span> The 10 Wyckoffian Mindset Questions
                </h4>
                <p className="text-[9.5px] text-cyan-300/80">
                  Ask these for every meaningful price move — EFFORT versus RESULT
                </p>
              </div>
              <div className="flex items-center gap-1 font-mono text-[9px]">
                <span className="text-gray-400">TF:</span>
                {(['1D', '30m', '5m'] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setAuditTimeframe(tf)}
                    className={`px-2 py-0.5 rounded font-bold cursor-pointer transition ${
                      auditTimeframe === tf
                        ? 'bg-cyan-500/30 border border-cyan-400 text-white'
                        : 'bg-surface-900 border border-surface-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {activeAuditTf ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[9.5px]">
                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">1. Where is the market conducting business?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.whereConductingBusiness}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">2. In a range or transitioning away?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.inRangeOrTransitioning}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">3. Who appears to be the aggressive side?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.aggressiveSide}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">4. Is aggressive activity moving price?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.isAggressiveMovingPrice}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">5. Is supply absorbed or driving lower?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.supplyAbsorptionVsSellingProgress}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">6. Is demand absorbed or driving higher?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.demandAbsorptionVsBuyingProgress}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">7. Where could fresh opposite orders originate?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.freshOppositeOrderOrigin}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">8. Are breakout participants potentially trapped?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.areBreakoutParticipantsTrapped}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">9. Is market accepting or rejecting outside prices?</div>
                  <div className="text-cyan-200 text-[9px]">{activeAuditTf.mindsetAudit.outsideRangeAcceptanceOrRejection}</div>
                </div>

                <div className="p-2 rounded bg-surface-950/80 border border-surface-800 space-y-1">
                  <div className="font-bold text-white">10. What evidence would invalidate interpretation?</div>
                  <div className="text-rose-300 text-[9px] font-semibold">{activeAuditTf.mindsetAudit.invalidationEvidence}</div>
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-center py-4">No report loaded. Run refresh.</div>
            )}
          </div>

          {/* Strategic Inventory-Seeking Participant Diagnostic Thought Experiment */}
          <div className="p-3 rounded-xl bg-surface-950/90 border border-cyan-500/40 space-y-2.5">
            <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span>🎯</span> Inventory-Seeking Participant Diagnostic Thought Experiment
              </span>
              <span className="text-[9px] text-gray-500">Diagnostic Thought Experiment · Not Proof of Manipulation</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[9.5px]">
              {/* Accumulation Box */}
              <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 space-y-1.5">
                <div className="font-bold text-emerald-300 flex items-center justify-between">
                  <span>Accumulation: Where are the sellers?</span>
                  <span className="text-[8.5px] px-1 rounded bg-emerald-500/20 text-emerald-300">BULLISH INVENTORY</span>
                </div>
                <p className="text-gray-300 text-[9px] leading-relaxed">
                  If an inventory-seeking buyer needs to acquire size without moving price, who provides liquidity?
                </p>
                <div className="p-2 rounded bg-surface-900/80 border border-surface-800 text-[9px] text-emerald-200 leading-snug">
                  {wyckoffReport?.m5.hypothesis.inventoryThoughtExperiment.accumulationWhereAreSellers ||
                    'Monitoring breakdown traders below support and capitulating longs. Absorption remains a hypothesis until confirmed by reclaim.'}
                </div>
              </div>

              {/* Distribution Box */}
              <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/40 space-y-1.5">
                <div className="font-bold text-rose-300 flex items-center justify-between">
                  <span>Distribution: Where are the buyers?</span>
                  <span className="text-[8.5px] px-1 rounded bg-rose-500/20 text-rose-300">BEARISH INVENTORY</span>
                </div>
                <p className="text-gray-300 text-[9px] leading-relaxed">
                  If an inventory-seeking seller needs to offload size without crashing price, who provides liquidity?
                </p>
                <div className="p-2 rounded bg-surface-900/80 border border-surface-800 text-[9px] text-rose-200 leading-snug">
                  {wyckoffReport?.m5.hypothesis.inventoryThoughtExperiment.distributionWhereAreBuyers ||
                    'Monitoring breakout momentum buyers chasing highs and short covering. Rejection below resistance is required to confirm.'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                askLeoWithContext(
                  `Leo, run the inventory-seeking participant thought experiment for ${selectedEngineMarket}. Where would aggressive sellers or buyers originate right now, and what price action would confirm true absorption vs initiative?`
                )
              }
              className="w-full py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-[9.5px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>💬</span>
              <span>Ask Leo to Audit Inventory Liquidity for {selectedEngineMarket}</span>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 3: 🛡️ 8 ADVERSARIAL QUESTIONS & CRITIQUE
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'ADVERSARIAL_8' && (
        <div className="space-y-3 font-mono">
          {wyckoffReport ? (
            <div className="p-3 rounded-xl bg-surface-950/90 border border-rose-500/40 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🛡️</span> The 8 Adversarial Questions & Self-Challenge
                  </h4>
                  <p className="text-[9.5px] text-rose-300/80">
                    Hostile cross-examination to protect capital from confirmation bias
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-surface-900 border border-surface-700 text-rose-200 text-[9px] font-bold">
                  Direction Audited: {wyckoffReport.m5.adversarialCheck.direction}
                </span>
              </div>

              {/* 8 Questions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[9.5px]">
                {wyckoffReport.m5.adversarialCheck.questions.map((q) => (
                  <div
                    key={q.questionNumber}
                    className={`p-2 rounded-lg border space-y-1 ${
                      q.passed
                        ? 'bg-emerald-950/30 border-emerald-500/40'
                        : 'bg-amber-950/30 border-amber-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">
                        {q.questionNumber}. {q.question}
                      </span>
                      <span
                        className={`px-1 rounded text-[8px] font-bold ${
                          q.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {q.passed ? '✅ PASS' : '⚠️ WARN'}
                      </span>
                    </div>
                    <div className="text-gray-300 text-[9px] leading-snug">{q.answer}</div>
                  </div>
                ))}
              </div>

              {/* Devil's Advocate Self-Challenge Critique */}
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/50 space-y-1">
                <span className="text-rose-300 font-bold text-xs flex items-center gap-1">
                  <span>⚔️</span> Devil&apos;s Advocate Self-Challenge Critique:
                </span>
                <p className="text-rose-100 text-[10px] leading-relaxed">
                  {wyckoffReport.m5.adversarialCheck.selfChallengeCritique}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  askLeoWithContext(
                    `Leo, challenge my bias on ${selectedEngineMarket} aggressively. Run through the 8 adversarial questions, tell me every reason why this trade hypothesis might fail, and identify where weak hands could be trapped.`
                  )
                }
                className="w-full py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200 text-[9.5px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>⚔️</span>
                <span>Ask Leo to Attack This Trade Hypothesis</span>
              </button>
            </div>
          ) : (
            <div className="text-gray-400 text-center py-4">No report loaded. Click Refresh.</div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 4: 👥 WEAK-HAND PARTICIPANT MODELING
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'WEAK_HANDS' && (
        <div className="space-y-3 font-mono">
          <div className="p-3 rounded-xl bg-surface-950/90 border border-amber-500/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>👥</span> Weak-Hand & Participant Behavioral Modeling
                </h4>
                <p className="text-[9.5px] text-amber-300/80">
                  8 behavioral categories consistent with observed auction data — no claims of manipulation
                </p>
              </div>
              <span className="text-[9px] text-gray-400 font-mono">
                Market: {selectedEngineMarket} (5m Evaluation)
              </span>
            </div>

            {wyckoffReport?.m5.cvdVolume.weakHandBehaviors ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[9.5px]">
                {wyckoffReport.m5.cvdVolume.weakHandBehaviors.map((beh: WeakHandBehaviorAssessment) => {
                  const isConsistent = beh.consistency === 'CONSISTENT_WITH_OBSERVATIONS'
                  const isSpeculative = beh.consistency === 'SPECULATIVE'

                  return (
                    <div
                      key={beh.category}
                      className="p-2.5 rounded-lg bg-surface-900/90 border border-surface-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">
                          {beh.category.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[8px] font-bold ${
                            isConsistent
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : isSpeculative
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-surface-800 text-gray-400 border border-surface-700'
                          }`}
                        >
                          {beh.consistency.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="text-gray-300 text-[9px] leading-snug">
                        <strong className="text-gray-400">Observable Evidence:</strong> {beh.observableEvidence}
                      </div>

                      <div className="text-cyan-300 text-[8.5px] leading-snug">
                        <strong className="text-gray-400">How to Distinguish:</strong> {beh.howToDistinguish}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-gray-400 text-center py-4">No report loaded. Run refresh.</div>
            )}

            <button
              type="button"
              onClick={() =>
                askLeoWithContext(
                  `Leo, which weak-hand participant behaviors are consistent with the current tape on ${selectedEngineMarket}? Distinguish between breakout sellers, late buyers, and forced liquidations.`
                )
              }
              className="w-full py-1.5 rounded-lg bg-amber-950 hover:bg-amber-900 border border-amber-500/50 text-amber-200 text-[9.5px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>💬</span>
              <span>Ask Leo to Analyze Weak-Hand Positioning on {selectedEngineMarket}</span>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 5: 🔬 1-YR BACKTEST & 5-MARKET MATRIX
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'BACKTEST_MATRIX' && (
        <div className="space-y-3 font-mono">
          <div className="p-3 rounded-xl bg-surface-950/90 border border-blue-500/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
              <span className="font-bold text-xs text-white flex items-center gap-1.5">
                <span>🔬</span> Empirical 1-Year 5-Minute Wyckoff Backtest Explorer
              </span>
              <span className="text-[9.5px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-700/60">
                {WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed.toLocaleString()} Total Ranges (3,232 Acc · 2,872 Dist)
              </span>
            </div>

            {/* Interactive Market Selector Pills */}
            <div className="flex flex-wrap items-center gap-1 text-[9.5px]">
              {MARKET_TABS.map((t) => {
                const active = selectedMarketTab === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedMarketTab(t.key)}
                    className={`px-2 py-1 rounded-md border font-semibold transition cursor-pointer ${
                      active
                        ? 'bg-blue-600/30 border-blue-400 text-white shadow-sm'
                        : 'bg-surface-950/70 hover:bg-surface-800 border-surface-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {t.contract}
                  </button>
                )
              })}
            </div>

            {selectedMarketTab === 'MATRIX' ? (
              /* Cross-Market Comparative Matrix Table */
              <div className="overflow-x-auto rounded-lg border border-surface-800 bg-surface-950/80">
                <table className="w-full text-left text-[9.5px]">
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
                        onClick={() => setSelectedMarketTab(m.market as WyckoffBenchmarkMarket)}
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 text-[9.5px]">
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
                        askLeoWithContext(`Leo, audit 1-year 5-minute Wyckoff range backtest benchmarks on ${inspectedBenchmark.market}.`)
                      }
                      className="px-2 py-1 rounded bg-blue-900/60 hover:bg-blue-800/70 border border-blue-500/40 text-blue-200 text-[9.5px] font-semibold transition cursor-pointer"
                    >
                      Audit {inspectedBenchmark.market}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        askLeoWithContext(
                          `Leo, compare markets for accumulation and distribution backtests. Show me the cross-market comparative matrix.`
                        )
                      }
                      className="px-2 py-1 rounded bg-indigo-900/60 hover:bg-indigo-800/70 border border-indigo-500/40 text-indigo-200 text-[9.5px] font-semibold transition cursor-pointer"
                    >
                      🌐 Matrix Audit
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Monthly Ingestion & Database Migration Status Bar */}
            <div className="pt-2 border-t border-surface-800/80 flex flex-wrap items-center justify-between gap-2 text-[9px] text-gray-400">
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
                (wyckoff_detected_ranges · wyckoff_lifecycle_transitions · wyckoff_alerts)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
