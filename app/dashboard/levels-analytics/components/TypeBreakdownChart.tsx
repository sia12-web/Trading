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
import type { TypeMetrics } from '@/types/analytics'

interface TypeBreakdownChartProps {
  data: TypeMetrics[]
}

export const TypeBreakdownChart = memo(function TypeBreakdownChart({ data }: TypeBreakdownChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200 h-80 flex items-center justify-center">
        <p className="text-gray-500">No type data available</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance by Type</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="type" />
          <YAxis yAxisId="left" label={{ value: 'Success Rate', angle: -90, position: 'insideLeft' }} />
          <YAxis yAxisId="right" orientation="right" label={{ value: 'Conviction', angle: 90, position: 'insideRight' }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}
            formatter={(value: any) => {
              if (typeof value === 'number') {
                return value.toFixed(2)
              }
              return String(value)
            }}
          />
          <Legend />
          <Bar yAxisId="left" dataKey="success_rate" fill="#3b82f6" name="Success Rate" />
          <Bar yAxisId="right" dataKey="avg_conviction" fill="#10b981" name="Avg Conviction" />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-4 text-sm text-gray-600">
        <p>Total types: {data.length}</p>
        <p>Avg success rate: {(data.reduce((sum, d) => sum + d.success_rate, 0) / data.length * 100).toFixed(2)}%</p>
      </div>
    </div>
  )
})
