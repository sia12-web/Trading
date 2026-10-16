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

export type WyckoffSubTab =
  | 'MTF_ENGINE'
  | 'MINDSET_10'
  | 'ADVERSARIAL_8'
  | 'WEAK_HANDS'
  | 'BACKTEST_MATRIX'
  | 'RULES_22'
  | 'BUS_DESKS'

export interface WyckoffRulesPanelProps {
  instrument: string
  initialSubTab?: WyckoffSubTab
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

const MARKET_TABS: Array<{ key: WyckoffBenchmarkMarket | 'MATRIX'; label: string; contract: string }> = [
  { key: 'NASDAQ', label: 'NQ', contract: 'Nasdaq (NQ)' },
  { key: 'DOW', label: 'YM', contract: 'Dow (YM)' },
  { key: 'CRUDE', label: 'CL', contract: 'Crude Oil (CL)' },
  { key: 'GOLD', label: 'GC', contract: 'Gold (GC)' },
  { key: 'NIKKEI', label: 'NKD', contract: 'Nikkei 225' },
  { key: 'MATRIX', label: '🌐 Matrix', contract: '5-Market Matrix' },
]

function stanceBadgeClass(stance: string | undefined): string {
  const s = (stance || 'NEUTRAL').toUpperCase()
  if (s === 'BULLISH') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  if (s === 'BEARISH') return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
  if (s === 'MIXED') return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  return 'bg-surface-800 text-gray-300 border-surface-700'
}

function classificationBadgeClass(classification: string | undefined): string {
  if (!classification) return 'bg-surface-800 text-gray-300 border-surface-700'
  if (classification.includes('ACCUMULATION')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
  if (classification.includes('DISTRIBUTION')) return 'bg-rose-500/20 text-rose-300 border-rose-500/50'
  if (classification === 'BREAKOUT') return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
  if (classification === 'BREAKDOWN') return 'bg-amber-500/20 text-amber-300 border-amber-500/50'
  return 'bg-blue-500/20 text-blue-300 border-blue-500/50'
}

function conditionBadgeClass(cond: string | undefined): string {
  if (!cond) return 'bg-surface-800 text-gray-300 border-surface-700'
  if (cond.includes('BULLISH')) return 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
  if (cond.includes('BEARISH')) return 'bg-rose-950/80 text-rose-300 border-rose-500/50'
  return 'bg-surface-900 text-gray-300 border-surface-800'
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
  const [syncingBus, setSyncingBus] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab)
    }
  }, [initialSubTab])

  useEffect(() => {
    const mapped = (getWyckoffBenchmark(instrument).market as WyckoffBenchmarkMarket) || 'NASDAQ'
    setSelectedMarketTab(mapped)
    setSelectedEngineMarket(instrument)
  }, [instrument])

  const fetchBusStatus = async () => {
    try {
      const res = await fetch(`/api/trading/market-intelligence-bus?instrument=${encodeURIComponent(selectedEngineMarket)}`)
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

  useEffect(() => {
    fetchBusStatus()
    fetchWyckoffEngine(selectedEngineMarket)
  }, [selectedEngineMarket])

  const handleSwitchMarket = (mktKey: string) => {
    setSelectedEngineMarket(mktKey)
    const benchmark = getWyckoffBenchmark(mktKey)
    if (benchmark && benchmark.market) {
      setSelectedMarketTab(benchmark.market as WyckoffBenchmarkMarket)
    }
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

  const handleSyncMonthlyAndBus = async () => {
    setSyncingBus(true)
    setSyncFeedback(null)
    try {
      const [res] = await Promise.all([
        fetch('/api/trading/market-intelligence-bus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instrument: selectedEngineMarket }),
        }),
        fetchWyckoffEngine(selectedEngineMarket),
      ])
      const json = await res.json()
      if (json?.success) {
        setBusData(json)
        setSyncFeedback(`Synced Bus + MTF Wyckoff Engine + Monthly Snapshot (${json.syncedMonth || '2026-10'})`)
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

  const activeAuditTf: WyckoffTimeframeAnalysis | undefined = wyckoffReport
    ? auditTimeframe === '1D'
      ? wyckoffReport.daily
      : auditTimeframe === '30m'
      ? wyckoffReport.m30
      : wyckoffReport.m5
    : undefined

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
      {/* ── Top Header Banner with 5-Market Switcher ── */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/80 via-surface-900 to-cyan-950/80 border border-emerald-500/50 shadow-md space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧭</span>
            <div>
              <h3 className="text-xs font-mono font-bold text-white tracking-wide flex items-center gap-2">
                Wyckoff Multi-Timeframe Auction Intelligence Engine
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] border border-emerald-500/40">
                  1D → 30m → 5m
                </span>
              </h3>
              <p className="text-[10px] text-emerald-300/80 font-mono">
                Causal Range Discovery · Effort vs. Result · CVD Absorption · Event Lifecycles · Adversarial Auditing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fetchWyckoffEngine(selectedEngineMarket)}
              disabled={loadingWyckoff}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-200 font-mono text-[9.5px] font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <span>{loadingWyckoff ? '⟳' : '🔄'}</span>
              <span>{loadingWyckoff ? 'Scanning…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* 5-Market Quick Switcher Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-surface-800/80 font-mono text-[10px]">
          <span className="text-gray-400 font-semibold text-[9.5px]">Market:</span>
          {MARKET_TABS.map((t) => {
            const isSelected = selectedEngineMarket === t.key || (t.key === 'MATRIX' && selectedMarketTab === 'MATRIX')
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (t.key === 'MATRIX') {
                    setActiveSubTab('BACKTEST_MATRIX')
                    setSelectedMarketTab('MATRIX')
                  } else {
                    handleSwitchMarket(t.key)
                  }
                }}
                className={`px-2 py-0.8 rounded-md border font-bold transition flex items-center gap-1 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500/30 border-emerald-400 text-white shadow-sm'
                    : 'bg-surface-950/80 hover:bg-surface-800 border-surface-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                <span>{t.label}</span>
                {t.key !== 'MATRIX' && wyckoffReport?.instrument === t.key && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
            )
          })}
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
          <span>1D · 30m · 5m Auction Engine</span>
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

        <button
          type="button"
          onClick={() => setActiveSubTab('RULES_22')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'RULES_22'
              ? 'bg-purple-950/90 text-purple-200 border border-purple-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>⚡</span>
          <span>4 Setups & 22 Rules</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('BUS_DESKS')}
          className={`py-1.5 px-2.5 rounded-lg font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
            activeSubTab === 'BUS_DESKS'
              ? 'bg-amber-950/90 text-amber-200 border border-amber-500/60 shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-surface-900 border border-transparent'
          }`}
        >
          <span>🤝</span>
          <span>Multi-Agent Bus</span>
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 1: 🧭 MTF AUCTION ENGINE (HERO VIEW)
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'MTF_ENGINE' && (
        <div className="space-y-3 font-mono">
          {wyckoffReport ? (
            <>
              {/* Hierarchy Synthesis Header Card */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-surface-950 via-surface-900 to-surface-950 border border-emerald-500/40 shadow-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="text-gray-400 text-[10px]">MTF Auction Alignment:</span>
                      <div className="text-white text-xs font-bold flex items-center gap-1.5">
                        <span
                          className={
                            wyckoffReport.hierarchySynthesis.isCountertrend5m
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                          }
                        >
                          {wyckoffReport.hierarchySynthesis.alignmentStatus}
                        </span>
                        {wyckoffReport.hierarchySynthesis.isCountertrend5m && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[8.5px]">
                            ⚠️ 5m Counter-Trend
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-1 rounded bg-emerald-950 border border-emerald-500/60 text-emerald-200 text-[10px] font-bold">
                      Verdict: {wyckoffReport.hierarchySynthesis.combinedVerdict}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9.5px]">
                  <div className="p-1.5 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">1D CONTEXT:</span>
                    <span className="text-cyan-300 font-semibold">{wyckoffReport.hierarchySynthesis.dailyLandscape}</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">30M SETUP:</span>
                    <span className="text-amber-300 font-semibold">{wyckoffReport.hierarchySynthesis.intermediate30mAuction}</span>
                  </div>
                  <div className="p-1.5 rounded bg-surface-900/80 border border-surface-800">
                    <span className="text-gray-400 text-[8.5px] block">5M CONFIRMATION:</span>
                    <span className="text-emerald-300 font-semibold">{wyckoffReport.hierarchySynthesis.tactical5mConfirmation}</span>
                  </div>
                </div>

                <div className="text-gray-300 text-[10px] leading-relaxed pt-1">
                  💡 <strong>Actionable Read:</strong> {wyckoffReport.hierarchySynthesis.actionableSummary}
                </div>

                {wyckoffReport.hierarchySynthesis.explicitConflicts.length > 0 && (
                  <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/50 text-amber-200 text-[9.5px]">
                    <strong>⚠️ Structural Conflicts:</strong> {wyckoffReport.hierarchySynthesis.explicitConflicts.join(' · ')}
                  </div>
                )}
              </div>

              {/* Timeframe Card Selector Tabs */}
              <div className="flex items-center justify-between border-b border-surface-800 pb-1 text-[9.5px]">
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">View:</span>
                  {(['ALL', '1D', '30m', '5m'] as const).map((mode) => (
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
                      {mode === 'ALL' ? '3 Timeframes (Side-by-Side)' : `${mode} Only`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onAskLeo(
                      `Leo, perform a full Wyckoff auction audit across Daily, 30m, and 5m timeframes for ${wyckoffReport.instrument}. Highlight where price is conducting business, the effort vs result on CVD, confirmed events, and any structural conflict.`
                    )
                  }
                  className="px-2 py-0.5 rounded bg-purple-950 hover:bg-purple-900 border border-purple-500/50 text-purple-200 text-[9px] font-bold transition flex items-center gap-1 cursor-pointer"
                >
                  <span>💬</span>
                  <span>Ask Leo to Audit 1D/30m/5m</span>
                </button>
              </div>

              {/* 3-Timeframe Responsive Grid */}
              <div
                className={`grid gap-2.5 ${
                  selectedTimeframeCard === 'ALL'
                    ? 'grid-cols-1 md:grid-cols-3'
                    : 'grid-cols-1'
                }`}
              >
                {[wyckoffReport.daily, wyckoffReport.m30, wyckoffReport.m5]
                  .filter((tf) => selectedTimeframeCard === 'ALL' || selectedTimeframeCard === tf.timeframe)
                  .map((tf) => {
                    const range = tf.detectedRange
                    const event = tf.eventState
                    const currentStageIdx = LIFECYCLE_STEPS.indexOf(event.lifecycleStage)

                    return (
                      <div
                        key={tf.timeframe}
                        className="p-3 rounded-xl bg-surface-950/90 border border-surface-800 hover:border-emerald-500/40 transition space-y-2.5 flex flex-col justify-between shadow-md"
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
                            <div className="p-2 rounded-lg bg-surface-900/90 border border-surface-800 space-y-1.5 text-[9.5px]">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-400">Boundary Range:</span>
                                <span className="text-white font-bold">
                                  <span className="text-emerald-300 font-mono">{range.rangeLow.toFixed(2)}</span>
                                  {' — '}
                                  <span className="text-rose-300 font-mono">{range.rangeHigh.toFixed(2)}</span>
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1 text-[8.5px] text-gray-400">
                                <div>
                                  Mid: <strong className="text-gray-200">{range.rangeMidpoint.toFixed(2)}</strong>
                                </div>
                                <div>
                                  POC: <strong className="text-cyan-300">{range.poc?.toFixed(2) ?? 'N/A'}</strong>
                                </div>
                                <div>
                                  Width: <strong className="text-gray-200">{range.widthAtr?.toFixed(1) ?? 'N/A'} ATR</strong> ({range.widthPts.toFixed(1)} pts)
                                </div>
                                <div>
                                  Phase: <strong className="text-amber-300">{range.provisionalPhase}</strong>
                                </div>
                              </div>

                              <div className="text-[8.5px] text-gray-400 leading-tight">
                                Overlap: {Math.round(range.overlapRatio * 100)}% · Duration: {range.durationBars} bars ({Math.round(range.durationMinutes / 60)}h)
                              </div>
                            </div>
                          ) : (
                            <div className="p-2 rounded-lg bg-surface-900/60 border border-surface-800 text-[9px] text-gray-400">
                              No bounded range confirmed. Structural trend: <strong>{tf.swingStructure.structuralTrend}</strong>.
                            </div>
                          )}

                          {/* Event Lifecycle Stage Stepper */}
                          <div className="p-2 rounded-lg bg-surface-900/80 border border-surface-800 space-y-1.5 text-[9px]">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">Lifecycle State:</span>
                              <span className="text-amber-300 font-bold">
                                {event.candidateEvent} ({event.confirmationStatus})
                              </span>
                            </div>

                            {/* Horizontal Stepper */}
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
                                    title={`Stage: ${stage}`}
                                  >
                                    {stage.replace('_', ' ').slice(0, 7)}
                                  </div>
                                )
                              })}
                            </div>

                            <div className="text-gray-300 text-[8.5px] leading-tight">
                              {event.eventSummary}
                            </div>
                          </div>

                          {/* Volume & CVD Effort vs. Result */}
                          <div className="p-2 rounded-lg bg-surface-900/80 border border-surface-800 space-y-1 text-[9px]">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">CVD & Volume:</span>
                              <span
                                className={`px-1.5 py-0.2 rounded border text-[8px] font-bold ${conditionBadgeClass(
                                  tf.cvdVolume.condition
                                )}`}
                              >
                                {tf.cvdVolume.condition.replace(/_/g, ' ')}
                              </span>
                            </div>

                            <div className="text-gray-300 text-[8.5px]">
                              {tf.cvdVolume.effortVsResultSummary}
                            </div>

                            {tf.cvdVolume.cvdDivergence !== 'NONE' && (
                              <div className="text-cyan-300 text-[8.5px] font-bold">
                                ⚡ Divergence: {tf.cvdVolume.cvdDivergence}
                              </div>
                            )}

                            <div className="text-gray-400 text-[8px]">
                              ATR: {tf.atrRegime.currentAtr?.toFixed(2) ?? 'N/A'} ({tf.atrRegime.atrTrend}) · Vol Ratio: {tf.cvdVolume.relativeVolume?.toFixed(2) ?? '1.0'}x
                            </div>
                          </div>

                          {/* Invalidation & Tradeability Runway */}
                          <div className="p-2 rounded-lg bg-surface-900/80 border border-surface-800 space-y-0.8 text-[8.5px]">
                            <div className="flex items-center justify-between">
                              <span className="text-rose-400 font-semibold">Invalidation:</span>
                              <span className="text-white font-mono font-bold">
                                {tf.structuralInvalidation.price?.toFixed(2) ?? 'N/A'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-emerald-400 font-semibold">Next Obstacle:</span>
                              <span className="text-white font-mono font-bold">
                                {tf.nextImportantObstacle.price?.toFixed(2) ?? 'N/A'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-0.5 border-t border-surface-800">
                              <span className="text-gray-400">Reward-to-Risk:</span>
                              <span
                                className={`font-bold px-1 rounded text-[8px] ${
                                  tf.rewardToRiskRunway.isAtLeast2R
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {tf.rewardToRiskRunway.rrRatio != null
                                  ? `${tf.rewardToRiskRunway.rrRatio.toFixed(1)}R ${
                                      tf.rewardToRiskRunway.isAtLeast2R ? '(≥2R PASS)' : '(WAIT)'
                                    }`
                                  : 'Wait for Invalidation'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Interactive Action Buttons */}
                        <div className="space-y-1 pt-1 border-t border-surface-800">
                          <div className="grid grid-cols-2 gap-1 text-[8.5px]">
                            <button
                              type="button"
                              onClick={() => handleSaveRangeToNotes(tf)}
                              disabled={!range}
                              className="py-1 px-1.5 rounded bg-surface-900 hover:bg-surface-800 border border-surface-700 text-gray-200 font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                              title="Save detected range to Leo Long-Term Memory Notes"
                            >
                              <span>📌</span>
                              <span>Notes</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArmSituationWatch(tf)}
                              disabled={!range}
                              className="py-1 px-1.5 rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200 font-bold transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                              title="Arm live Market Situation Rule for Chart Leo to monitor on chart"
                            >
                              <span>🎯</span>
                              <span>Arm Watch</span>
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onAskLeo(
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

              {/* Deduplicated Live Auction Alerts Feed */}
              {wyckoffReport.alerts.length > 0 && (
                <div className="p-3 rounded-xl bg-surface-950/90 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between border-b border-surface-800 pb-1">
                    <span className="text-white font-bold text-xs flex items-center gap-1.5">
                      <span>🔔</span> Deduplicated Live Auction Alerts ({wyckoffReport.alerts.length})
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
            </>
          ) : (
            <div className="p-8 rounded-xl bg-surface-950/80 border border-surface-800 text-center space-y-3">
              <span className="text-3xl block">🧭</span>
              <div className="text-gray-300 font-bold text-sm">
                {loadingWyckoff
                  ? 'Evaluating Causal 1D / 30m / 5m Wyckoff Auction Engine…'
                  : 'Wyckoff Auction Intelligence Engine Ready'}
              </div>
              <p className="text-gray-400 text-xs max-w-md mx-auto">
                Deterministic range discovery, ATR regimes, CVD effort vs result, event lifecycle transitions, and adversarial questioning.
              </p>
              <button
                type="button"
                onClick={() => fetchWyckoffEngine(selectedEngineMarket)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg cursor-pointer"
              >
                Run Live 1D/30m/5m Discovery on {selectedEngineMarket}
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
                onAskLeo(
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
                  onAskLeo(
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
                onAskLeo(
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
                        onAskLeo(`Leo, audit 1-year 5-minute Wyckoff range backtest benchmarks on ${inspectedBenchmark.market}.`)
                      }
                      className="px-2 py-1 rounded bg-blue-900/60 hover:bg-blue-800/70 border border-blue-500/40 text-blue-200 text-[9.5px] font-semibold transition cursor-pointer"
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
                (wyckoff_detected_ranges · wyckoff_lifecycle_transitions · wyckoff_auction_alerts)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 6: ⚡ 4 SETUPS & 22 RULES
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'RULES_22' && (
        <div className="space-y-3 font-mono">
          {/* Quick-Ask Leo Strategy Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 text-[10px]">
            <button
              type="button"
              onClick={() =>
                onAskLeo(
                  `Leo, audit the 4 Wyckoff execution setups for ${selectedEngineMarket} (Spring, Upthrust, Breakout Retest, Breakdown Retest). Tell me if price is interacting with our frozen pre-market Tier 1 zones.`
                )
              }
              className="p-2 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 font-semibold text-left transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🎯</span>
              <span>Audit 4 Setups on {selectedEngineMarket}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onAskLeo(
                  `Leo, check our pre-market Tier 1 zones on ${selectedEngineMarket} (5D Volume Profile, Yesterday's Profile, Overnight). Which pre-marked zone is price approaching right now?`
                )
              }
              className="p-2 rounded-lg bg-surface-900 hover:bg-surface-800 border border-surface-700 text-gray-200 font-semibold text-left transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🗺️</span>
              <span>Check Frozen Tier 1 Map</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onAskLeo(
                  `Leo, analyze the current trading range on ${selectedEngineMarket} for Wyckoff Accumulation vs Distribution. Identify the phase (A, B, C, D, E), audit effort vs result, and tell me if a tradeable Phase C test or Phase D retest is formed.`
                )
              }
              className="p-2 rounded-lg bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-200 font-semibold text-left transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🏛️</span>
              <span>Audit Accumulation vs Distribution</span>
            </button>
          </div>

          {/* 1. The ONLY 4 Trades in the Universe */}
          <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2.5">
            <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
              <span className="font-bold text-xs text-white flex items-center gap-1.5">
                <span>⚡</span> The ONLY 4 Trades in the Universe (Rule 11)
              </span>
              <span className="text-[9.5px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/60">
                Everything Else: IGNORE
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
              {/* Setup 1: Spring */}
              <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 space-y-1">
                <div className="font-bold text-emerald-300 flex items-center justify-between">
                  <span>1. Support: Spring → Reclaim</span>
                  <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300">LONG</span>
                </div>
                <p className="text-gray-300 text-[10px] leading-tight">
                  Price reaches predetermined support zone → sweeps underneath → sellers fail to continue → price reclaims zone → <strong>LONG</strong>.
                </p>
                <div className="text-[9px] text-gray-400">
                  • <strong>Stop:</strong> Strictly below spring low.<br />
                  • <strong>CVD:</strong> Price equal/higher low while CVD lower low (Buyer Absorption).
                </div>
              </div>

              {/* Setup 2: Upthrust */}
              <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-500/30 space-y-1">
                <div className="font-bold text-rose-300 flex items-center justify-between">
                  <span>2. Resistance: Upthrust → Return</span>
                  <span className="text-[9px] px-1 rounded bg-rose-500/20 text-rose-300">SHORT</span>
                </div>
                <p className="text-gray-300 text-[10px] leading-tight">
                  Price reaches predetermined resistance → breaks above → failure to continue → price returns below resistance → <strong>SHORT</strong>.
                </p>
                <div className="text-[9px] text-gray-400">
                  • <strong>Stop:</strong> Strictly above upthrust high.<br />
                  • <strong>CVD:</strong> Price same/lower high while CVD higher high (Seller Absorption).
                </div>
              </div>

              {/* Setup 3: Breakout Retest */}
              <div className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 space-y-1">
                <div className="font-bold text-cyan-300 flex items-center justify-between">
                  <span>3. Breakout → Successful Retest</span>
                  <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300">LONG (SOS → LPS)</span>
                </div>
                <p className="text-gray-300 text-[10px] leading-tight">
                  Price destroys resistance with initiative volume. Don&apos;t chase initial candle! Wait for pullback to hold as support → <strong>LONG continuation</strong>.
                </p>
                <div className="text-[9px] text-gray-400">
                  • <strong>Stop:</strong> Below retest floor.<br />
                  • <strong>Rule:</strong> Never chase initial breakout.
                </div>
              </div>

              {/* Setup 4: Breakdown Retest */}
              <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-1">
                <div className="font-bold text-amber-300 flex items-center justify-between">
                  <span>4. Breakdown → Failed Reclaim</span>
                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">SHORT (SOW → LPSY)</span>
                </div>
                <p className="text-gray-300 text-[10px] leading-tight">
                  Price cleanly destroys support zone with initiative volume. Wait for weak bounce that fails to reclaim → <strong>SHORT continuation</strong>.
                </p>
                <div className="text-[9px] text-gray-400">
                  • <strong>Stop:</strong> Above failed reclaim high.<br />
                  • <strong>Target:</strong> Next 5D/Yesterday support zone.
                </div>
              </div>
            </div>
          </div>

          {/* 2. Chart Hierarchy */}
          <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2">
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <span>📊</span> Final Chart Hierarchy (Rule 2)
            </span>
            <div className="space-y-1.5 text-[10.5px]">
              <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[9px] shrink-0">
                  TIER 1 (MANDATORY)
                </span>
                <span className="text-gray-300 text-[10px]">
                  <strong>Price + Rolling 5D Profile (POC, HVN, LVN) + Yesterday&apos;s Profile (VAH, POC, VAL, High, Low) + Overnight Levels.</strong> Pre-market map frozen at 9:30 ET.
                </span>
              </div>
              <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold text-[9px] shrink-0">
                  TIER 2 (CONFIRMATION)
                </span>
                <span className="text-gray-300 text-[10px]">
                  <strong>Volume Bars (Effort vs. Result) + CVD (Aggressive Order Flow & Absorption).</strong> Confirms entry confidence; price reclaim triggers trade.
                </span>
              </div>
              <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[9px] shrink-0">
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
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <span>🎯</span> The 8-Step Screen-Reading Sequence (Rule 23)
            </span>
            <div className="flex flex-wrap items-center gap-1 text-[9.5px] text-gray-300 pt-1">
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
            <span className="font-bold text-xs text-rose-300 flex items-center gap-1.5">
              <span>🚫</span> When You Do NOT Trade - Absolute Filters (Rule 20)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] text-gray-300">
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
            <span className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
              <span>🛡️</span> Risk & Stop Discipline (Rules 17, 18, 19)
            </span>
            <p className="text-gray-300 text-[10px] leading-relaxed">
              • <strong>Minimum 2R Target:</strong> Check distance to next major zone BEFORE entering. If &lt; 2R room, skip the trade.<br />
              • <strong>Stop Loss:</strong> Set strictly by market structure (below Spring low / above Upthrust high). Position size is calculated from fixed 1R risk.<br />
              • <strong>Never Widen the Stop:</strong> If structural invalidation is breached, you are wrong. Exit immediately. Never turn -1R into -3R while conducting an emergency seminar.
            </p>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          SUB-TAB 7: 🤝 MULTI-AGENT BUS
          ────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'BUS_DESKS' && (
        <div className="space-y-3 font-mono">
          <div className="p-3 rounded-xl bg-surface-950/90 border border-amber-500/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 pb-1.5">
              <div className="flex items-center gap-1.5">
                <span>🤝</span>
                <span className="font-bold text-xs text-white">
                  Multi-Agent Market Intelligence Bus (Live 5-Desk Cooperation)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSyncMonthlyAndBus}
                  disabled={syncingBus}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-[9.5px] font-bold transition cursor-pointer"
                >
                  {syncingBus ? '⟳ Syncing…' : '🔄 Sync Bus & Monthly Archive'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAskLeo(
                      `Leo, how do the fundamental agent and headline agent cooperate on ${selectedEngineMarket} right now? Connect the dots with our Wyckoff structure.`
                    )
                  }
                  className="px-2 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/50 text-purple-100 text-[9.5px] font-bold transition cursor-pointer"
                >
                  Ask Leo to Synthesize →
                </button>
              </div>
            </div>

            {/* Active Specialist Summary */}
            {activeDeskBus?.snapshot && (
              <div className="p-2.5 rounded-lg bg-surface-900/90 border border-surface-800 space-y-1.5 text-[10px]">
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[9px]">
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
                      className={`p-1.5 rounded border text-left transition flex flex-col justify-between cursor-pointer ${
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
        </div>
      )}
    </div>
  )
}
