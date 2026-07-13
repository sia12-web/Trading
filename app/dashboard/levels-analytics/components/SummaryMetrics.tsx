import type { AnalyticsSummary } from '@/types/analytics'

interface SummaryMetricsProps {
  summary: AnalyticsSummary
}

export function SummaryMetrics({ summary }: SummaryMetricsProps) {
  const metrics = [
    {
      label: 'Total Levels',
      value: summary.total_levels,
      icon: '📍',
    },
    {
      label: 'Total Tests',
      value: summary.total_tests,
      icon: '🧪',
    },
    {
      label: 'Total Successes',
      value: summary.total_successes,
      icon: '✅',
    },
    {
      label: 'Avg Conviction',
      value: summary.avg_conviction.toFixed(1),
      unit: '/10',
      icon: '💪',
    },
    {
      label: 'Success Rate',
      value: (summary.overall_success_rate * 100).toFixed(2),
      unit: '%',
      icon: '📈',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {metrics.map((metric, index) => (
        <div
          key={index}
          className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:shadow-lg transition"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">{metric.label}</span>
            <span className="text-2xl">{metric.icon}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-gray-900">{metric.value}</span>
            {metric.unit && <span className="text-sm text-gray-500">{metric.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
