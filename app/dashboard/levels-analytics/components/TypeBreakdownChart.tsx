'use client'

import { memo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { TypeMetrics } from '@/types/analytics'

const DARK_TOOLTIP = {
  contentStyle: { backgroundColor: '#1a1e2e', border: '1px solid #3a4268', borderRadius: 8, color: '#e5e7eb' },
  labelStyle: { color: '#9ca3af' },
  cursor: { fill: 'rgba(59,126,255,0.06)' },
}

interface TypeBreakdownChartProps { data: TypeMetrics[] }

export const TypeBreakdownChart = memo(function TypeBreakdownChart({ data }: TypeBreakdownChartProps) {
  const displayData = data.map(d => ({ ...d, success_rate_pct: +(d.success_rate * 100).toFixed(1) }))
  const avgRate = data.length ? (data.reduce((s, d) => s + d.success_rate, 0) / data.length * 100).toFixed(1) : '—'

  if (!data || data.length === 0) {
    return (
      <div className="card p-6 h-80 flex items-center justify-center text-gray-600">No type data available</div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Performance by Type</h3>
        <span className="text-xs text-gray-600">Avg {avgRate}%</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={displayData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2c3352" />
          <XAxis dataKey="type" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={{ stroke: '#3a4268' }} tickLine={false} />
          <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip {...DARK_TOOLTIP} formatter={(v: any) => [typeof v === 'number' ? v.toFixed(2) : v, '']} />
          <Legend wrapperStyle={{ color: '#6b7280', fontSize: 12 }} />
          <Bar yAxisId="left"  dataKey="success_rate_pct" fill="#3b7eff" name="Success Rate %" radius={[4,4,0,0]} />
          <Bar yAxisId="right" dataKey="avg_conviction"   fill="#34d399" name="Avg Conviction"  radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
})
