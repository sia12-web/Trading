'use client'

/**
 * Gold Fundamental Analyst Main Dashboard Container
 * Market: COMEX Gold Futures (GC)
 */

import React, { useState, useEffect, useCallback } from 'react'
import type {
  GoldFundamentalDashboardState,
  GoldEventEvaluation,
  LiveGoldHeadline,
} from '@/types/fundamentals'
import { GoldFundamentalsHeader } from './components/GoldFundamentalsHeader'
import { TodayGoldFundamentalCard } from './components/TodayGoldFundamentalCard'
import { GoldEventEvaluatorCard } from './components/GoldEventEvaluatorCard'
import { LiveGoldNewsWire } from './components/LiveGoldNewsWire'
import { GoldYieldsUsdTracker } from './components/GoldYieldsUsdTracker'
import { GoldEtfCftcComexCard } from './components/GoldEtfCftcComexCard'
import { GoldDriversMatrix } from './components/GoldDriversMatrix'
import { GoldFeedsCard } from './components/GoldFeedsCard'
import { GoldAnalystChat } from './components/GoldAnalystChat'

type GoldTabKey =
  | 'today'
  | 'evaluator'
  | 'wire'
  | 'yields_usd'
  | 'institutional'
  | 'drivers'
  | 'feeds'
  | 'terminal'

export function GoldDashboard() {
  const [tab, setTab] = useState<GoldTabKey>('today')
  const [state, setState] = useState<GoldFundamentalDashboardState | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveGoldHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/fundamentals/gold')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
        setError(null)
      } else {
        throw new Error(data.error || 'Failed to load gold fundamental state')
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
      const res = await fetch('/api/fundamentals/gold', {
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
    if (!window.confirm('Reset Gold fundamental state to baseline?')) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals/gold', {
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

  const handleEventEvaluated = (evaluation: GoldEventEvaluation) => {
    setState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        recentEvents: [evaluation, ...prev.recentEvents.slice(0, 19)],
        today: {
          ...prev.today,
          intraday_bias: evaluation.structuredOutput.fundamental_state.intraday,
          short_term_bias: evaluation.structuredOutput.fundamental_state.short_term,
          medium_term_bias: evaluation.structuredOutput.fundamental_state.medium_term,
          what_changed_since_yesterday: `${evaluation.structuredOutput.event}: ${evaluation.structuredOutput.summary}`,
        },
        overallBias: evaluation.structuredOutput.fundamental_state.short_term,
        overallConfidence: Math.round(evaluation.structuredOutput.confidence * 100),
        biasSummary: evaluation.structuredOutput.summary,
      }
    })
  }

  const handleSelectHeadlineForAnalysis = (headline: LiveGoldHeadline) => {
    setSelectedHeadline(headline)
    setTab('evaluator')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <span className="text-2xl animate-spin mb-3">🪙</span>
        <span className="text-xs font-mono">Initializing Gold Macro & Monetary Analyst Engine...</span>
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

  const tabs: Array<{ key: GoldTabKey; label: string; icon: string }> = [
    { key: 'today', label: "Today's State", icon: '📋' },
    { key: 'yields_usd', label: 'Real Yields & USD', icon: '📊' },
    { key: 'drivers', label: 'Drivers', icon: '⚙️' },
    { key: 'institutional', label: 'ETF, CFTC & COMEX', icon: '🏛️' },
    { key: 'wire', label: 'Live Metals Wire', icon: '📡' },
    { key: 'evaluator', label: 'Event Evaluator', icon: '⚡' },
    { key: 'feeds', label: 'Feeds', icon: '🔌' },
    { key: 'terminal', label: 'Analyst Chat', icon: '💬' },
  ]

  return (
    <div>
      {/* Real-Time Telemetry Header */}
      <GoldFundamentalsHeader
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
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      {tab === 'today' && (
        <TodayGoldFundamentalCard today={state.today} telemetry={state.goldTelemetry} />
      )}

      {tab === 'evaluator' && (
        <GoldEventEvaluatorCard
          onEventEvaluated={handleEventEvaluated}
          selectedHeadline={selectedHeadline}
          onClearHeadline={() => setSelectedHeadline(null)}
        />
      )}

      {tab === 'wire' && (
        <LiveGoldNewsWire
          headlines={state.liveGoldHeadlines}
          onSelectHeadline={handleSelectHeadlineForAnalysis}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      )}

      {tab === 'yields_usd' && (
        <GoldYieldsUsdTracker telemetry={state.goldTelemetry} />
      )}

      {tab === 'institutional' && (
        <GoldEtfCftcComexCard
          etfFlows={state.etfFlows}
          cftc={state.cftcPositioning}
          comex={state.comexInventory}
          centralBank={state.centralBankDemand}
        />
      )}

      {tab === 'drivers' && <GoldDriversMatrix drivers={state.drivers} />}

      {tab === 'feeds' && <GoldFeedsCard feeds={state.feeds} />}

      {tab === 'terminal' && <GoldAnalystChat />}
    </div>
  )
}
