'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAnalytics } from '@/lib/hooks/useAnalytics'
import type { Instrument } from '@/types/analytics'
import { SummaryMetrics } from './SummaryMetrics'
import { TypeBreakdownChart } from './TypeBreakdownChart'
import { TimeframeEffectiveness } from './TimeframeEffectiveness'
import { TopPerformersTable } from './TopPerformersTable'
import { ReliabilityRankings } from './ReliabilityRankings'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
const DAY_OPTIONS = [7, 14, 30, 60, 90]

export function AnalyticsDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [instrument, setInstrument] = useState<Instrument>(
    (searchParams.get('instrument') as Instrument) || 'DOW'
  )
  const [days, setDays] = useState<number>(parseInt(searchParams.get('days') || '30'))

  const { data, error, isLoading, mutate } = useAnalytics(instrument, days)

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('instrument', instrument)
    params.set('days', days.toString())
    router.push(`?${params.toString()}`)
  }, [instrument, days, router])

  return (
    <div className="space-y-5">
      {/* Filter bar */}
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
          <span className="text-xs text-gray-500">Range:</span>
          {DAY_OPTIONS.map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`tab text-xs ${days === d ? 'tab-active' : ''}`}>
              {d}d
            </button>
          ))}
        </div>

        <button onClick={() => mutate()} disabled={isLoading} className="btn-ghost ml-auto text-xs">
          {isLoading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-pulse">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="stat-block h-20 bg-surface-700" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-8 text-center text-red-400">
          <div className="text-4xl mb-2">⚠️</div>
          <div className="font-semibold">{error.message}</div>
          <div className="text-xs text-gray-600 mt-1">Authentication may be required</div>
          <button onClick={() => mutate()} className="btn-primary mt-4 mx-auto">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && (!data || data.summary.total_levels === 0) && (
        <div className="card p-12 text-center text-gray-600">
          <div className="text-4xl mb-3">📊</div>
          <p className="font-medium text-gray-500">No level data for {instrument} in the last {days} days</p>
          <p className="text-sm mt-1">Run the AI Level Finder to populate analytics</p>
        </div>
      )}

      {/* Data */}
      {!isLoading && !error && data && data.summary.total_levels > 0 && (
        <div className="space-y-5 animate-slide-up">
          <SummaryMetrics summary={data.summary} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <TypeBreakdownChart data={data.by_type} />
            <TimeframeEffectiveness data={data.by_timeframe} />
          </div>
          <TopPerformersTable data={data.top_performers} />
          <ReliabilityRankings data={data.reliability_ranking} />
        </div>
      )}
    </div>
  )
}
