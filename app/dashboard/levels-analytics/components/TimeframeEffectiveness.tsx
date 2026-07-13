'use client'

import { memo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TimeframeMetrics } from '@/types/analytics'

interface TimeframeEffectivenessProps {
  data: TimeframeMetrics[]
}

export const TimeframeEffectiveness = memo(function TimeframeEffectiveness({ data }: TimeframeEffectivenessProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200 h-80 flex items-center justify-center">
        <p className="text-gray-500">No timeframe data available</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance by Timeframe</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timeframe" />
          <YAxis label={{ value: 'Success Rate', angle: -90, position: 'insideLeft' }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
            formatter={(value: any) => {
              if (typeof value === 'number') {
                return (value * 100).toFixed(2) + '%'
              }
              return String(value)
            }}
          />
          <Legend />
          <Bar dataKey="success_rate" fill="#8b5cf6" name="Success Rate" />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-4 text-sm text-gray-600">
        <p>Total timeframes: {data.length}</p>
        <p>
          Best performing: {data.length > 0 ? data.reduce((max, d) => d.success_rate > max.success_rate ? d : max).timeframe : 'N/A'}
        </p>
      </div>
    </div>
  )
})
