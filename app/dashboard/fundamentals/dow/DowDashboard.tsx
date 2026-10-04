'use client'

/**
 * Dow Jones Fundamental Analyst Main Dashboard Container
 * Market: CME E-mini Dow Futures (YM, $5 Multiplier)
 */

import React, { useState, useEffect, useCallback } from 'react'
import type {
  DowFundamentalDashboardState,
  DowEventEvaluation,
  LiveDowHeadline,
} from '@/types/fundamentals'
import { DowFundamentalsHeader } from './components/DowFundamentalsHeader'
import { TodayDowFundamentalCard } from './components/TodayDowFundamentalCard'
import { DowEventEvaluatorCard } from './components/DowEventEvaluatorCard'
import { DjiaContributionCard } from './components/DjiaContributionCard'
import { DowRotationCreditCard } from './components/DowRotationCreditCard'
import { DowIndustrialCycleCard } from './components/DowIndustrialCycleCard'
import { DowDriversMatrix } from './components/DowDriversMatrix'
import { LiveDowNewsWire } from './components/LiveDowNewsWire'
import { DowFeedsCard } from './components/DowFeedsCard'
import { DowAnalystChat } from './components/DowAnalystChat'

type DowTabKey =
  | 'today'
  | 'evaluator'
  | 'wire'
  | 'contributions'
  | 'rotation_credit'
  | 'industrial'
  | 'drivers'
  | 'feeds'
  | 'terminal'

export function DowDashboard() {
  const [tab, setTab] = useState<DowTabKey>('today')
  const [state, setState] = useState<DowFundamentalDashboardState | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveDowHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/fundamentals/dow')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ok && data.state) {
        setState(data.state)
        setError(null)
      } else {
        throw new Error(data.error || 'Failed to load Dow fundamental state')
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
      const res = await fetch('/api/fundamentals/dow', {
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
    if (!window.confirm('Reset Dow fundamental state to baseline?')) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals/dow', {
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

  const handleEventEvaluated = (evaluation: DowEventEvaluation) => {
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
        overallConfidence: Math.round(evaluation.structuredOutput.confidence * 100),
        biasSummary: evaluation.structuredOutput.summary,
      }
    })
  }

  const handleSelectHeadlineForAnalysis = (headline: LiveDowHeadline) => {
    setSelectedHeadline(headline)
    setTab('evaluator')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <span className="text-2xl animate-spin mb-3">🏭</span>
        <span className="text-xs font-mono">Initializing Dow Jones Macro, Cyclical &amp; Rotation Engine...</span>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl m-6">
        <div className="text-rose-400 font-semibold mb-2">Failed to load Dow Fundamental Engine</div>
        <p className="text-xs text-slate-400 mb-4">{error || 'Unknown error'}</p>
        <button
          onClick={loadState}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition"
        >
          Retry Connection
        </button>
      </div>
    )
  }

  const tabs: Array<{ key: DowTabKey; label: string; icon: string }> = [
    { key: 'today', label: "Today's State (24 Dims)", icon: '📋' },
    { key: 'evaluator', label: '14-Step Evaluator', icon: '⚡' },
    { key: 'wire', label: 'Live Dow Wire', icon: '📡' },
    { key: 'contributions', label: 'Price Weights & DJIA 30', icon: '⚖️' },
    { key: 'rotation_credit', label: 'Rotation & Credit', icon: '🔄' },
    { key: 'industrial', label: 'Industrial Cycle & 4-Quadrant', icon: '🏭' },
    { key: 'drivers', label: '11 Drivers Matrix', icon: '🧭' },
    { key: 'feeds', label: '9 V1 Feeds', icon: '🔌' },
    { key: 'terminal', label: 'Analyst Terminal', icon: '💬' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans">
      {/* Top Telemetry Header */}
      <DowFundamentalsHeader
        state={state}
        onRefresh={handleRefresh}
        onReset={handleReset}
        refreshing={refreshing}
      />

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-3 mb-6 border-b border-slate-800/80 scrollbar-thin">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              tab === t.key
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Active Tab View */}
      {tab === 'today' && (
        <TodayDowFundamentalCard
          today={state.today}
          telemetry={state.dowTelemetry}
          rotation={state.rotation}
          credit={state.credit}
        />
      )}

      {tab === 'evaluator' && (
        <DowEventEvaluatorCard
          onEventEvaluated={handleEventEvaluated}
          selectedHeadline={selectedHeadline}
          onClearHeadline={() => setSelectedHeadline(null)}
        />
      )}

      {tab === 'wire' && (
        <LiveDowNewsWire
          headlines={state.liveHeadlines}
          onSelectHeadline={handleSelectHeadlineForAnalysis}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      )}

      {tab === 'contributions' && (
        <DjiaContributionCard
          contributions={state.contribution}
          constituents={state.dowTelemetry.topConstituentsByWeight}
          dowDivisor={state.dowTelemetry.dowDivisor}
        />
      )}

      {tab === 'rotation_credit' && (
        <DowRotationCreditCard
          rotation={state.rotation}
          credit={state.credit}
          telemetry={state.dowTelemetry}
        />
      )}

      {tab === 'industrial' && (
        <DowIndustrialCycleCard
          industrial={state.industrial}
          quadrant={state.dowTelemetry.growthInflationQuadrant}
        />
      )}

      {tab === 'drivers' && (
        <DowDriversMatrix drivers={state.drivers} />
      )}

      {tab === 'feeds' && (
        <DowFeedsCard feeds={state.feeds} />
      )}

      {tab === 'terminal' && (
        <DowAnalystChat />
      )}
    </div>
  )
}
