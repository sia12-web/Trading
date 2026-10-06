'use client'

/**
 * Fundamental Analyst Dashboard
 * Supports:
 * 1. NYMEX WTI Crude Oil (CL) - Physical supply/demand, inventories, OPEC+, Crack margins
 * 2. COMEX Gold Futures (GC) - Macro, monetary, real yields, USD, ETFs, Central banks
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type {
  OilFundamentalDashboardState,
  OilEventEvaluation,
  LiveOilHeadline,
} from '@/types/fundamentals'
import { FundamentalsHeader } from './components/FundamentalsHeader'
import { TodayFundamentalCard } from './components/TodayFundamentalCard'
import { LiveOilNewsWire } from './components/LiveOilNewsWire'
import { FiveFeedsCard } from './components/FiveFeedsCard'
import { PillarMatrix } from './components/PillarMatrix'
import { EventEvaluatorCard } from './components/EventEvaluatorCard'
import { EvaluatedEventsHistory } from './components/EvaluatedEventsHistory'
import { OilCatalystCalendar } from './components/OilCatalystCalendar'
import { OilAnalystChat } from './components/OilAnalystChat'
import { GoldDashboard } from './gold/GoldDashboard'
import { NasdaqDashboard } from './nasdaq/NasdaqDashboard'
import { DowDashboard } from './dow/DowDashboard'
import { NikkeiDashboard } from './nikkei/NikkeiDashboard'
import { confidencePercent } from '@/lib/fundamentals/honesty'

type OilTabKey = 'today' | 'wire' | 'evaluator' | 'matrix' | 'feeds' | 'history' | 'calendar' | 'terminal'
type MarketKey = 'CL' | 'GC' | 'NQ' | 'YM' | 'NKD'

function FundamentalsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const marketParam = searchParams.get('market')?.toUpperCase()
  const initialMarket: MarketKey =
    marketParam === 'GC'
      ? 'GC'
      : marketParam === 'NQ'
      ? 'NQ'
      : marketParam === 'YM'
      ? 'YM'
      : marketParam === 'NKD'
      ? 'NKD'
      : 'CL'
  const [market, setMarket] = useState<MarketKey>(initialMarket)

  useEffect(() => {
    setMarket(initialMarket)
    const raw = searchParams.get('market')?.toUpperCase()
    if (raw !== initialMarket) {
      router.replace(`/dashboard/fundamentals?market=${initialMarket}`)
    }
  }, [initialMarket, router, searchParams])

  // Oil State
  const [tab, setTab] = useState<OilTabKey>('today')
  const [state, setState] = useState<OilFundamentalDashboardState | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveOilHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMarketChange = (newMarket: MarketKey) => {
    setMarket(newMarket)
    router.replace(`/dashboard/fundamentals?market=${newMarket}`)
  }

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/fundamentals')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
        setError(null)
      } else {
        throw new Error(data.error || 'Failed to load fundamental state')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_telemetry' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok || !data.state) {
        throw new Error(data.error || `Refresh failed (${res.status})`)
      }
      setState(data.state)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset fundamental state to baseline?')) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok || !data.state) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setState(data.state)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSelectWireHeadline = (headline: LiveOilHeadline) => {
    setSelectedHeadline(headline)
    setTab('evaluator')
  }

  const handleEvaluateEvent = async (params: {
    rawText: string
    sourceHint?: string
    timestampHint?: string
    autoCommitIfMaterial: boolean
  }): Promise<OilEventEvaluation | null> => {
    const res = await fetch('/api/fundamentals/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      throw new Error(`Evaluation failed with HTTP ${res.status}`)
    }

    const data = await res.json()
    if (!data.ok || !data.evaluation) {
      throw new Error(data.error || 'Failed to evaluate event')
    }

    await loadState()
    return data.evaluation
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top-Level Asset Switcher: Oil vs Gold vs Nasdaq */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-2 bg-slate-900/90 border border-slate-800 rounded-2xl backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800/80 flex-wrap">
          <button
            onClick={() => handleMarketChange('CL')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              market === 'CL'
                ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>🛢️</span>
            <span>WTI Crude (CL)</span>
            <span className="text-[10px] font-mono opacity-80">Physical</span>
          </button>

          <button
            onClick={() => handleMarketChange('GC')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              market === 'GC'
                ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>🪙</span>
            <span>COMEX Gold (GC)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-400/30 text-amber-200">
              Macro/Monetary
            </span>
          </button>

          <button
            onClick={() => handleMarketChange('NQ')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              market === 'NQ'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>💻</span>
            <span>Nasdaq-100 (NQ)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/30 text-cyan-950 font-bold">
              Tech / Growth
            </span>
          </button>

          <button
            onClick={() => handleMarketChange('YM')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              market === 'YM'
                ? 'bg-blue-600 text-white shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>🏭</span>
            <span>Dow Jones (YM)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-400/30 text-blue-200 font-bold">
              Cyclical / $5
            </span>
          </button>

          <button
            onClick={() => handleMarketChange('NKD')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              market === 'NKD'
                ? 'bg-red-500 text-white shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
            }`}
          >
            <span>🏯</span>
            <span>Nikkei 225 (NKD)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-400/30 text-red-100 font-bold">
              Japan / $5
            </span>
          </button>
        </div>

        <div className="px-3 text-[11px] text-slate-400 hidden sm:block">
          {market === 'NKD'
            ? 'Nikkei Analyst: NKD and USD/JPY after a Yahoo quote. BoJ policy and index weights stay unavailable.'
            : market === 'YM'
            ? 'Dow Analyst: quoted names, yields, and credit after a live print. ISM and the official divisor stay unavailable.'
            : market === 'NQ'
            ? 'Nasdaq Analyst: Macro · Rates Engine · Mega-Cap Guidance · AI/Semis · Breadth'
            : market === 'GC'
            ? 'Gold Analyst: Real Rates · USD · Fed · Central Banks · WGC ETFs · Wyckoff Rejection'
            : 'Oil Analyst: Physical balances · Cushing inventories · OPEC+ quota · 3:2:1 Crack margins'}
        </div>
      </div>

      {/* Render Selected Market Engine */}
      {market === 'NKD' ? (
        <NikkeiDashboard />
      ) : market === 'YM' ? (
        <DowDashboard />
      ) : market === 'NQ' ? (
        <NasdaqDashboard />
      ) : market === 'GC' ? (
        <GoldDashboard />
      ) : (
        /* Oil Fundamental Analyst */
        <>
          {loading && (
            <div className="flex flex-col items-center justify-center p-16 text-slate-400">
              <span className="text-2xl animate-spin mb-3">🛢️</span>
              <span className="text-xs font-mono">Loading Oil Fundamental Analyst Engine...</span>
            </div>
          )}

          {error && !state && (
            <div className="p-6 bg-slate-900 border border-rose-500/40 rounded-xl text-center space-y-3">
              <div className="text-rose-400 text-sm font-semibold">Failed to load Fundamental Analyst State</div>
              <p className="text-xs text-slate-400">{error}</p>
              <button
                type="button"
                onClick={loadState}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {state && (
            <div className="space-y-5 pb-10">
              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                  {error}
                </div>
              )}
              {/* Executive Header with live WTI quote, calendar spread, and safeguards */}
              <FundamentalsHeader
                telemetry={state.wtiTelemetry}
                overallBias={state.overallBias}
                overallConfidence={state.today ? confidencePercent(state.today.confidence) : confidencePercent(state.overallConfidence)}
                physicalBalance={state.physicalBalance}
                onRefresh={handleRefresh}
                onReset={handleReset}
                loading={refreshing}
              />

              {/* Navigation Tabs Bar */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setTab('today')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'today'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>🛢️</span>
                    <span>Today&apos;s State</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('matrix')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'matrix'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>🏛️</span>
                    <span>Drivers</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('calendar')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'calendar'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>📅</span>
                    <span>Catalyst Calendar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('wire')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'wire'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>⚡</span>
                    <span>Live Breaking Wire</span>
                    {state.liveOilHeadlines.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('evaluator')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'evaluator'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>⚙️</span>
                    <span>Event Evaluator</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('history')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'history'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>📜</span>
                    <span>Event History</span>
                    {state.recentEvents.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/30 text-amber-200 font-mono">
                        {state.recentEvents.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('feeds')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'feeds'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>🔌</span>
                    <span>Feeds</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('terminal')}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition border ${
                      tab === 'terminal'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800'
                    }`}
                  >
                    <span>💬</span>
                    <span>Analyst Chat</span>
                  </button>
                </div>
              </div>

              {/* Tab Workspaces */}
              {tab === 'today' && (
                <TodayFundamentalCard today={state.today} telemetry={state.wtiTelemetry} />
              )}

              {tab === 'wire' && (
                <div className="space-y-5">
                  <LiveOilNewsWire
                    headlines={state.liveOilHeadlines}
                    onSelectHeadline={handleSelectWireHeadline}
                    onRefreshNews={handleRefresh}
                    loading={refreshing}
                  />
                </div>
              )}

              {tab === 'evaluator' && (
                <div className="space-y-5">
                  <EventEvaluatorCard
                    onEvaluate={handleEvaluateEvent}
                    currentTelemetry={state.wtiTelemetry}
                    selectedHeadline={selectedHeadline}
                    onStateUpdated={loadState}
                  />
                  {state.liveOilHeadlines.length > 0 && (
                    <LiveOilNewsWire
                      headlines={state.liveOilHeadlines}
                      onSelectHeadline={handleSelectWireHeadline}
                      onRefreshNews={handleRefresh}
                      loading={refreshing}
                    />
                  )}
                </div>
              )}

              {tab === 'matrix' && (
                <PillarMatrix
                  pillars={state.pillars}
                  onSelectPillar={() => {
                    /* optional handler */
                  }}
                />
              )}

              {tab === 'feeds' && <FiveFeedsCard feeds={state.fiveFeeds} />}

              {tab === 'history' && <EvaluatedEventsHistory events={state.recentEvents} />}

              {tab === 'calendar' && <OilCatalystCalendar catalysts={state.scheduledCatalysts} />}

              {tab === 'terminal' && <OilAnalystChat telemetry={state.wtiTelemetry} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function FundamentalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-16 text-slate-400">
          <span className="text-xl animate-spin mr-2">🔄</span>
          <span className="text-xs font-mono">Loading Fundamentals Desk...</span>
        </div>
      }
    >
      <FundamentalsContent />
    </Suspense>
  )
}
