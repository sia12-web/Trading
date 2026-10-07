'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type {
  NikkeiFundamentalDashboardState,
  NikkeiEventEvaluation,
  LiveNikkeiHeadline,
} from '@/types/fundamentals'
import { NikkeiFundamentalsHeader } from './components/NikkeiFundamentalsHeader'
import { TodayNikkeiFundamentalCard } from './components/TodayNikkeiFundamentalCard'
import { NikkeiEventEvaluatorCard } from './components/NikkeiEventEvaluatorCard'
import { NikkeiContributionCard } from './components/NikkeiContributionCard'
import { NikkeiBojFxCard } from './components/NikkeiBojFxCard'
import { NikkeiDriversMatrix } from './components/NikkeiDriversMatrix'
import { LiveNikkeiNewsWire } from './components/LiveNikkeiNewsWire'
import { NikkeiFeedsCard } from './components/NikkeiFeedsCard'
import { NikkeiAnalystChat } from './components/NikkeiAnalystChat'

type NikkeiTabKey =
  | 'today'
  | 'evaluator'
  | 'wire'
  | 'boj_fx'
  | 'contributions'
  | 'drivers'
  | 'feeds'
  | 'terminal'

export function NikkeiDashboard() {
  const [tab, setTab] = useState<NikkeiTabKey>('today')
  const [state, setState] = useState<NikkeiFundamentalDashboardState | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedHeadline, setSelectedHeadline] = useState<LiveNikkeiHeadline | null>(null)
  const [prefillNonce, setPrefillNonce] = useState(0)

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/fundamentals/nikkei')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setState(data)
      setError(null)
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
    await loadState()
    setRefreshing(false)
  }

  const handleEventEvaluated = (evaluation: NikkeiEventEvaluation, nextState?: NikkeiFundamentalDashboardState) => {
    if (nextState) {
      setState(nextState)
      return
    }
    if (state) {
      setState({
        ...state,
        recentEvents: [evaluation, ...state.recentEvents],
      })
    }
  }

  const handleSelectHeadline = (headline: LiveNikkeiHeadline) => {
    setSelectedHeadline(headline)
    setPrefillNonce((n) => n + 1)
    setTab('evaluator')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <span className="text-3xl animate-bounce mb-3">🏯</span>
        <span className="text-xs font-mono">Loading Nikkei 225 Fundamental Analyst Engine...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Live Telemetry & Persona */}
      <NikkeiFundamentalsHeader
        state={state}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* Secondary Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl overflow-x-auto">
        <button
          onClick={() => setTab('today')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'today'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          📋 Today's State
        </button>

        <button
          onClick={() => setTab('boj_fx')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'boj_fx'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          🏦 BoJ & USD/JPY
        </button>

        <button
          onClick={() => setTab('contributions')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'contributions'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          ⚖️ Price Weights
        </button>

        <button
          onClick={() => setTab('drivers')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'drivers'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          🧩 Drivers
        </button>

        <button
          onClick={() => setTab('wire')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'wire'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          📰 Live Wire
        </button>

        <button
          onClick={() => setTab('evaluator')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'evaluator'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          🧠 Event Evaluator
        </button>

        <button
          onClick={() => setTab('feeds')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'feeds'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          📡 Feeds Status
        </button>

        <button
          onClick={() => setTab('terminal')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            tab === 'terminal'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          💬 Analyst Chat
        </button>
      </div>

      {/* Tab Panels */}
      {tab === 'today' && <TodayNikkeiFundamentalCard today={state?.today || null} />}
      {tab === 'evaluator' && (
        <NikkeiEventEvaluatorCard
          onEventEvaluated={handleEventEvaluated}
          prefillText={selectedHeadline ? `${selectedHeadline.headline}\n${selectedHeadline.summary || ''}` : ''}
          prefillSource={selectedHeadline?.source}
          prefillNonce={prefillNonce}
        />
      )}
      {tab === 'wire' && (
        <LiveNikkeiNewsWire
          headlines={state?.liveHeadlines || []}
          onSelectHeadline={handleSelectHeadline}
        />
      )}
      {tab === 'boj_fx' && (
        <NikkeiBojFxCard
          boj={state?.boj || null}
          fx={state?.fx || null}
          usdjpyLive={Boolean(state?.nikkeiTelemetry?.sourced?.usdjpy)}
        />
      )}
      {tab === 'contributions' && (
        <NikkeiContributionCard contribution={state?.contribution || null} />
      )}
      {tab === 'drivers' && <NikkeiDriversMatrix drivers={state?.drivers || null} />}
      {tab === 'feeds' && <NikkeiFeedsCard feeds={state?.feeds || null} />}
      {tab === 'terminal' && <NikkeiAnalystChat />}
    </div>
  )
}
