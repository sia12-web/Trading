import type { AnalyticsSummary } from '@/types/analytics'

interface SummaryMetricsProps {
  summary: AnalyticsSummary
}

export function SummaryMetrics({ summary }: SummaryMetricsProps) {
  const rate = summary.overall_success_rate * 100
  const metrics = [
    { label: 'Total Levels',    value: summary.total_levels,                      icon: '📍', color: 'text-white' },
    { label: 'Total Tests',     value: summary.total_tests,                       icon: '🧪', color: 'text-white' },
    { label: 'Total Successes', value: summary.total_successes,                   icon: '✅', color: 'text-green-400' },
    { label: 'Avg Conviction',  value: summary.avg_conviction.toFixed(1), unit: '/10', icon: '💪', color: 'text-brand-400' },
    { label: 'Success Rate',    value: rate.toFixed(1), unit: '%',  icon: '📈',
      color: rate >= 60 ? 'text-green-400' : rate >= 40 ? 'text-yellow-400' : 'text-red-400' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map((m, i) => (
        <div key={i} className="stat-block hover:border-surface-400 transition-colors border border-surface-600">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">{m.label}</span>
            <span className="text-lg">{m.icon}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`stat-value ${m.color}`}>{m.value}</span>
            {m.unit && <span className="text-xs text-gray-600">{m.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
