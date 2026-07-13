import type { ReliabilityRanking } from '@/types/analytics'

interface ReliabilityRankingsProps {
  data: ReliabilityRanking
}

export function ReliabilityRankings({ data }: ReliabilityRankingsProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Reliability Rankings</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Most Reliable Type */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
          <p className="text-sm font-medium text-gray-600 mb-2">🏆 Best Performing Type</p>
          <p className="text-2xl font-bold text-green-700">
            {data.most_reliable_type ? data.most_reliable_type.toUpperCase() : 'N/A'}
          </p>
          <p className="text-xs text-gray-600 mt-2">Highest average success rate among all types</p>
        </div>

        {/* Least Reliable Type */}
        <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-lg p-4 border border-red-200">
          <p className="text-sm font-medium text-gray-600 mb-2">📉 Weakest Performing Type</p>
          <p className="text-2xl font-bold text-red-700">
            {data.least_reliable_type ? data.least_reliable_type.toUpperCase() : 'N/A'}
          </p>
          <p className="text-xs text-gray-600 mt-2">Lowest average success rate among all types</p>
        </div>

        {/* Most Reliable Timeframe */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
          <p className="text-sm font-medium text-gray-600 mb-2">⏱️ Best Timeframe</p>
          <p className="text-2xl font-bold text-blue-700">
            {data.most_reliable_timeframe || 'N/A'}
          </p>
          <p className="text-xs text-gray-600 mt-2">Highest success rate timeframe</p>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-700">
          <span className="font-medium">Summary:</span> Focus on {data.most_reliable_type || 'analyzing'} levels on the {data.most_reliable_timeframe || 'optimal'} timeframe for better results.
          {data.least_reliable_type && ` Consider reducing exposure to ${data.least_reliable_type} patterns.`}
        </p>
      </div>
    </div>
  )
}
