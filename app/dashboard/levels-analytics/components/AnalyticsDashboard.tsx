'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAnalytics } from '@/lib/hooks/useAnalytics'
import type { Instrument } from '@/types/analytics'
import { FilterBar } from './FilterBar'
import { SummaryMetrics } from './SummaryMetrics'
import { TypeBreakdownChart } from './TypeBreakdownChart'
import { TimeframeEffectiveness } from './TimeframeEffectiveness'
import { TopPerformersTable } from './TopPerformersTable'
import { ReliabilityRankings } from './ReliabilityRankings'
import { LoadingState } from './LoadingState'
import { ErrorState } from './ErrorState'
import { EmptyState } from './EmptyState'

export function AnalyticsDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [instrument, setInstrument] = useState<Instrument>(
    (searchParams.get('instrument') as Instrument) || 'DOW'
  )
  const [days, setDays] = useState<number>(parseInt(searchParams.get('days') || '30'))

  const { data, error, isLoading, mutate } = useAnalytics(instrument, days)

  // Update URL when filters change
  // SWR watches the URL as cache key and automatically refetches when it changes
  // This provides automatic cache invalidation without explicit mutate() calls
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('instrument', instrument)
    params.set('days', days.toString())
    router.push(`?${params.toString()}`)
  }, [instrument, days, router])

  const handleInstrumentChange = (newInstrument: Instrument) => {
    setInstrument(newInstrument)
  }

  const handleDaysChange = (newDays: number) => {
    if (newDays >= 1 && newDays <= 90) {
      setDays(newDays)
    }
  }

  const handleRetry = () => {
    mutate()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <FilterBar
        instrument={instrument}
        days={days}
        onInstrumentChange={handleInstrumentChange}
        onDaysChange={handleDaysChange}
        disabled={isLoading}
      />

      {/* Content */}
      {isLoading && <LoadingState />}

      {error && <ErrorState error={error.message} onRetry={handleRetry} />}

      {!isLoading && !error && (!data || data.summary.total_levels === 0) && <EmptyState />}

      {!isLoading && !error && data && data.summary.total_levels > 0 && (
        <>
          {/* Summary Metrics */}
          <SummaryMetrics summary={data.summary} />

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TypeBreakdownChart data={data.by_type} />
            <TimeframeEffectiveness data={data.by_timeframe} />
          </div>

          {/* Top Performers Table */}
          <TopPerformersTable data={data.top_performers} />

          {/* Reliability Rankings */}
          <ReliabilityRankings data={data.reliability_ranking} />
        </>
      )}
    </div>
  )
}
