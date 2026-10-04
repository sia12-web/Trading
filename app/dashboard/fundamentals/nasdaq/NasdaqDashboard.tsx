'use client'

/**
 * Nasdaq-100 Fundamental Analyst Main Dashboard Container
 * Market: CME E-mini Nasdaq-100 Futures (NQ)
 */

import React, { useState, useEffect, useCallback } from 'react'
import type {
  NasdaqFundamentalDashboardState,
  NasdaqEventEvaluation,
  LiveNasdaqHeadline,
} from '@/types/fundamentals'
import { NasdaqFundamentalsHeader } from './components/NasdaqFundamentalsHeader'
import { TodayNasdaqFundamentalCard } from './components/TodayNasdaqFundamentalCard'
import { NasdaqEventEvaluatorCard } from './components/NasdaqEventEvaluatorCard'
import { LiveNasdaqNewsWire } from './components/LiveNasdaqNewsWire'
import { NasdaqRatesBreadthTracker } from './components/NasdaqRatesBreadthTracker'
import { NasdaqEarningsSemiCard } from './components/NasdaqEarningsSemiCard'
import { NasdaqDriversMatrix } from './components/NasdaqDriversMatrix'
import { NasdaqFeedsCard } from './components/NasdaqFeedsCard'
import { NasdaqAnalystChat } from './components/NasdaqAnalystChat'

type NasdaqTabKey =
  | 'today'
  | 'evaluator'
  | 'wire'
  | 'rates_breadth'
  | 'earnings_semi'
  | 'drivers'
  | 'feeds'
  | 'terminal'

export function NasdaqDashboard() {
  const [tab, setTab] = useState<NasdaqTabKey>('today')
  const [state, setState] = useState<NasdaqFundamentalDashboardState | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveNasdaqHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/fundamentals/nasdaq')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
        setError(null)
      } else {
        throw new Error(data.error || 'Failed to load Nasdaq fundamental state')
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
      const res = await fetch('/api/fundamentals/nasdaq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_telemetry' }),
      })
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
      }
    } catch {
      await loadState()
    } finally {
      setRefreshing(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset Nasdaq fundamental state to baseline?')) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals/nasdaq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
      }
    } catch {
      await loadState()
    } finally {
      setRefreshing(false)
    }
  }

  const handleEventEvaluated = (evaluation: NasdaqEventEvaluation) => {
    setState((prev) => {
      if (!prev) return prev
      const effect = evaluation.structuredOutput.fundamental_effect || evaluation.structuredOutput.fundamental_state
      const intraday = effect?.intraday || 'NEUTRAL'
      const shortTerm = effect?.short_term || 'NEUTRAL'
      const mediumTerm = effect?.medium_term || 'NEUTRAL'
      return {
        ...prev,
        recentEvents: [evaluation, ...prev.recentEvents.slice(0, 19)],
        today: {
          ...prev.today,
          intraday_bias: intraday,
          short_term_bias: shortTerm,
          medium_term_bias: mediumTerm,
          what_changed_since_yesterday: `${evaluation.structuredOutput.event}: ${evaluation.structuredOutput.summary}`,
        },
        overallBias: shortTerm,
        overallConfidence: evaluation.structuredOutput.confidence,
        biasSummary: evaluation.structuredOutput.summary,
      }
    })
  }

  const handleSelectHeadlineForAnalysis = (headline: LiveNasdaqHeadline) => {
    setSelectedHeadline(headline)
    setTab('evaluator')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <span className="text-2xl animate-spin mb-3">💻</span>
        <span className="text-xs font-mono">Initializing Nasdaq-100 Macro, Rates &amp; Earnings Engine...</span>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="p-8 text-center text-rose-400 bg-rose-950/20 border border-rose-800 rounded-xl my-6">
        <span className="text-xl block mb-2">⚠️</span>
        <span className="text-xs font-mono">{error || 'Failed to initialize state'}</span>
        <button
          onClick={loadState}
          className="mt-4 px-3 py-1.5 rounded bg-slate-800 text-slate-200 text-xs font-medium"
        >
          Retry
        </button>
      </div>
    )
  }

  const tabs: Array<{ key: NasdaqTabKey; label: string; icon: string }> = [
    { key: 'today', label: "Today's State", icon: '📋' },
    { key: 'evaluator', label: '14-Step Evaluator', icon: '⚡' },
    { key: 'wire', label: 'Live Tech Wire', icon: '📡' },
    { key: 'rates_breadth', label: 'Rates & Breadth', icon: '📈' },
    { key: 'earnings_semi', label: 'Earnings & AI/Semis', icon: '💼' },
    { key: 'drivers', label: '11 Drivers Matrix', icon: '⚙️' },
    { key: 'feeds', label: 'V1 Feeds', icon: '🔌' },
    { key: 'terminal', label: 'Analyst Terminal', icon: '💬' },
  ]

  return (
    <div>
      {/* Real-Time Telemetry Header */}
      <NasdaqFundamentalsHeader
        state={state}
        onRefresh={handleRefresh}
        onReset={handleReset}
        refreshing={refreshing}
      />

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6 border-b border-slate-800 pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              tab === t.key
                ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-200 shadow-sm'
                : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      {tab === 'today' && (
        <TodayNasdaqFundamentalCard
          today={state.today}
          telemetry={state.nasdaqTelemetry}
        />
      )}

      {tab === 'evaluator' && (
        <NasdaqEventEvaluatorCard
          onEventEvaluated={handleEventEvaluated}
          selectedHeadline={selectedHeadline}
          onClearHeadline={() => setSelectedHeadline(null)}
        />
      )}

      {tab === 'wire' && (
        <LiveNasdaqNewsWire
          headlines={state.liveHeadlines}
          onSelectHeadline={handleSelectHeadlineForAnalysis}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      )}

      {tab === 'rates_breadth' && (
        <NasdaqRatesBreadthTracker
          telemetry={state.nasdaqTelemetry}
          breadth={state.breadth}
        />
      )}

      {tab === 'earnings_semi' && (
        <NasdaqEarningsSemiCard
          constituents={state.nasdaqTelemetry.topConstituents}
          semiCycle={state.semiCycle}
          earningsCycle={state.earningsCycle}
          nqPrice={state.nasdaqTelemetry.nqPrice}
        />
      )}

      {tab === 'drivers' && (
        <NasdaqDriversMatrix
          drivers={state.drivers}
        />
      )}

      {tab === 'feeds' && (
        <NasdaqFeedsCard
          feeds={state.feeds}
        />
      )}

      {tab === 'terminal' && (
        <NasdaqAnalystChat />
      )}
    </div>
  )
}
