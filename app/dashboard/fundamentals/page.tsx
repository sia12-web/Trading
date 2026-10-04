'use client'

/**
 * Oil Fundamental Analyst Dashboard Feature
 * Market: NYMEX WTI Crude Oil (CL)
 *
 * Implements:
 * 1. "TODAY'S OIL FUNDAMENTAL STATE" with 8 physical dimensions & invalidation rules
 * 2. Machine-readable Structured JSON Event Evaluator for trading agents
 * 3. Live real-time Finnhub / Reuters oil news wire with 1-click analysis
 * 4. Pragmatic 5-Feed Data Architecture & multi-asset CME telemetry (WTI, Brent, 3:2:1 Crack)
 */

import { useState, useEffect, useCallback } from 'react'
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

type TabKey = 'today' | 'wire' | 'evaluator' | 'matrix' | 'feeds' | 'history' | 'calendar' | 'terminal'

export default function FundamentalsPage() {
  const [tab, setTab] = useState<TabKey>('today')
  const [state, setState] = useState<OilFundamentalDashboardState | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveOilHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (!window.confirm('Reset fundamental state to baseline?')) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/fundamentals', {
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
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || `HTTP ${res.status}`)
    }

    const data = await res.json()
    if (data.ok && (data.evaluation || data.structured)) {
      if (data.state) {
        setState(data.state)
      }
      return data.evaluation
    }
    return null
  }

  if (loading && !state) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8 animate-spin text-brand-400">
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="16" />
          </svg>
          <span className="text-xs font-medium">Assembling Real-Time Oil Telemetry & News Wire...</span>
        </div>
      </div>
    )
  }

  if (error && !state) {
    return (
      <div className="p-6 bg-surface-800 border border-red-500/40 rounded-xl text-center space-y-3">
        <div className="text-red-400 text-sm font-semibold">Failed to load Fundamental Analyst State</div>
        <p className="text-xs text-gray-400">{error}</p>
        <button
          type="button"
          onClick={loadState}
          className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-xs font-medium"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!state) return null

  return (
    <div className="space-y-5 pb-10">
      {/* Executive Header with live WTI quote, calendar spread, and safeguards */}
      <FundamentalsHeader
        telemetry={state.wtiTelemetry}
        overallBias={state.overallBias}
        overallConfidence={state.today ? Math.round(state.today.confidence * 100) : state.overallConfidence}
        physicalBalance={state.physicalBalance}
        onRefresh={handleRefresh}
        onReset={handleReset}
        loading={refreshing}
      />

      {/* Navigation Tabs Bar */}
      <div className="flex items-center justify-between border-b border-surface-700 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setTab('today')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'today'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>🛢️</span>
            <span>Today&apos;s State (V1)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('wire')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'wire'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>⚡</span>
            <span>Live Breaking Wire</span>
            {state.liveOilHeadlines.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('evaluator')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'evaluator'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>⚙️</span>
            <span>Structured Evaluator</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('matrix')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'matrix'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>🏛️</span>
            <span>10-Pillar Matrix</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('feeds')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'feeds'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>📡</span>
            <span>5 Data Feeds</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'history'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>📜</span>
            <span>Event History</span>
            {state.recentEvents.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-brand-500/30 text-brand-200 font-mono">
                {state.recentEvents.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('calendar')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'calendar'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>📅</span>
            <span>Catalyst Calendar</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('terminal')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'terminal'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-surface-800 text-gray-400 hover:text-gray-200 hover:bg-surface-700 border border-surface-600'
            }`}
          >
            <span>💬</span>
            <span>Analyst Chat</span>
          </button>
        </div>
      </div>

      {/* Tab Workspaces */}
      {tab === 'today' && (
        <div className="space-y-5">
          <TodayFundamentalCard today={state.today} telemetry={state.wtiTelemetry} />
          <LiveOilNewsWire
            headlines={state.liveOilHeadlines}
            onSelectHeadline={handleSelectWireHeadline}
            onRefreshNews={handleRefresh}
            loading={refreshing}
          />
          <FiveFeedsCard feeds={state.fiveFeeds} />
        </div>
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
  )
}
