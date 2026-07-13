'use client'

import { useState, useEffect, useCallback } from 'react'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
type LevelType = 'support' | 'resistance' | 'vwap'

interface LevelHistory {
  id: string
  instrument: Instrument
  level: number
  type: LevelType
  conviction: number
  reasoning: string
  timeframe: string
  tested_count: number
  success_count: number
  last_tested_date: string | null
  created_at: string
  archived_at: string
}

const TYPE_COLORS: Record<LevelType, string> = {
  support:    'badge-up',
  resistance: 'badge-down',
  vwap:       'badge-warn',
}

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

function ConvictionBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-900 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="price-mono text-xs text-gray-400 w-7 text-right">{pct}</span>
    </div>
  )
}

export default function LevelHistoryPage() {
  const [instrument, setInstrument] = useState<Instrument>('DOW')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<LevelHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/find-levels?instrument=${instrument}&days=${days}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json.levels ?? [])
    } catch (e: any) {
      setError(e.message)
      setData([])
    }
    setLoading(false)
  }, [instrument, days])

  useEffect(() => { load() }, [load])

  const successRate = (l: LevelHistory) =>
    l.tested_count > 0 ? ((l.success_count / l.tested_count) * 100).toFixed(0) + '%' : '—'

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Level History</h1>
          <p className="text-sm text-gray-500 mt-1">AI-identified historical support &amp; resistance levels</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-primary">
          {loading ? 'Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="tab-bar">
          {INSTRUMENTS.map(i => (
            <button key={i} onClick={() => setInstrument(i)}
              className={`tab ${instrument === i ? 'tab-active' : ''}`}>
              {i}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Days:</label>
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`tab text-xs ${days === d ? 'tab-active' : ''}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {!loading && data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Levels', value: data.length },
            { label: 'Support', value: data.filter(l => l.type === 'support').length },
            { label: 'Resistance', value: data.filter(l => l.type === 'resistance').length },
            { label: 'Avg Conviction', value: (data.reduce((s, l) => s + l.conviction, 0) / data.length).toFixed(0) + '/100' },
          ].map(s => (
            <div key={s.label} className="stat-block">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value text-white">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {error && (
        <div className="card p-6 text-center text-red-400">
          <div className="text-4xl mb-2">⚠️</div>
          {error}
          <div className="text-xs text-gray-600 mt-1">Authentication may be required</div>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="card p-12 text-center text-gray-600">
          <div className="text-4xl mb-3">📂</div>
          <p className="font-medium text-gray-500">No level history for {instrument} in the last {days} days</p>
          <p className="text-sm mt-1">Run the AI Level Finder to start populating history</p>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex gap-4">
                <div className="h-6 bg-surface-700 rounded w-28" />
                <div className="h-6 bg-surface-700 rounded w-20" />
                <div className="flex-1 h-6 bg-surface-700 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && data.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600 text-xs text-gray-500 uppercase tracking-wide">
                {['Level','Type','TF','Conviction','Tests','Success Rate','Last Tested','Archived'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((level, i) => (
                <>
                  <tr
                    key={level.id}
                    onClick={() => setExpandedId(expandedId === level.id ? null : level.id)}
                    className={`border-b border-surface-700/50 cursor-pointer hover:bg-surface-700/40 transition ${i % 2 === 0 ? '' : 'bg-surface-800/30'}`}
                  >
                    <td className="px-4 py-3 price-mono font-bold text-white">{level.level.toLocaleString()}</td>
                    <td className="px-4 py-3"><span className={`badge ${TYPE_COLORS[level.type]}`}>{level.type}</span></td>
                    <td className="px-4 py-3"><span className="badge badge-neutral">{level.timeframe}</span></td>
                    <td className="px-4 py-3 w-32"><ConvictionBar value={level.conviction} /></td>
                    <td className="px-4 py-3 price-mono text-gray-400">{level.tested_count}</td>
                    <td className="px-4 py-3">
                      <span className={`price-mono font-bold text-xs ${
                        level.tested_count === 0 ? 'text-gray-600'
                        : (level.success_count / level.tested_count) >= 0.6 ? 'text-green-400'
                        : (level.success_count / level.tested_count) >= 0.4 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>{successRate(level)}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {level.last_tested_date ? new Date(level.last_tested_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{new Date(level.archived_at).toLocaleDateString()}</td>
                  </tr>
                  {expandedId === level.id && (
                    <tr key={`${level.id}-expanded`} className="bg-surface-700/30">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="text-xs text-gray-400 leading-relaxed">
                          <span className="font-semibold text-gray-300">AI Reasoning: </span>
                          {level.reasoning}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
