import type { LevelPerformance } from '@/types/analytics'

interface TopPerformersTableProps {
  data: LevelPerformance[]
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 0.8) return 'bg-green-100 text-green-900'
  if (rate >= 0.6) return 'bg-emerald-100 text-emerald-900'
  if (rate >= 0.5) return 'bg-yellow-100 text-yellow-900'
  return 'bg-red-100 text-red-900'
}

export function TopPerformersTable({ data }: TopPerformersTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 border border-gray-200 text-center">
        <p className="text-gray-500">No top performers found (need success rate {'>'} 50%)</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Top Performers</h3>
        <p className="text-sm text-gray-600">Levels with success rate {'>='} 50%, sorted by performance</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table" aria-label="Top performing levels sorted by success rate">
          <caption className="sr-only">Table showing top 10 levels by success rate, with conviction scores and test results</caption>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-3 text-left font-semibold text-gray-900">Level</th>
              <th className="px-6 py-3 text-left font-semibold text-gray-900">Type</th>
              <th className="px-6 py-3 text-center font-semibold text-gray-900">Conviction</th>
              <th className="px-6 py-3 text-center font-semibold text-gray-900">Success Rate</th>
              <th className="px-6 py-3 text-center font-semibold text-gray-900">Tests</th>
              <th className="px-6 py-3 text-center font-semibold text-gray-900">Successes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((level) => (
              <tr key={`${level.level}-${level.type}`} className="hover:bg-gray-50 transition">
                <td className="px-6 py-4 font-mono font-medium text-gray-900">
                  {level.level.toFixed(2)}
                </td>
                <td className="px-6 py-4">
                  <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-900">
                    {level.type}
                  </span>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className="font-medium text-gray-900">{level.conviction}/10</span>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getSuccessRateColor(level.success_rate)}`}>
                    {(level.success_rate * 100).toFixed(2)}%
                  </span>
                </td>
                <td className="px-6 py-4 text-center text-gray-600">
                  {level.tested_count}
                </td>
                <td className="px-6 py-4 text-center text-gray-600">
                  {level.success_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
