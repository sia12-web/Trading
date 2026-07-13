'use client'

import { Suspense } from 'react'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'

export const dynamic = 'force-dynamic'

export default function AnalyticsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Level performance metrics and success rate analysis</p>
      </div>
      <Suspense fallback={
        <div className="card p-12 text-center text-gray-600 animate-pulse">Loading analytics…</div>
      }>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  )
}
