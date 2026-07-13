export function LoadingState() {
  return (
    <div className="space-y-6">
      {/* Summary Metrics Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-gray-200 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
            <div className="h-8 bg-gray-300 rounded"></div>
          </div>
        ))}
      </div>

      {/* Charts Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-200 rounded-lg p-6 h-80 animate-pulse"></div>
        <div className="bg-gray-200 rounded-lg p-6 h-80 animate-pulse"></div>
      </div>

      {/* Table Skeleton */}
      <div className="bg-gray-200 rounded-lg p-6 animate-pulse">
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-300 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  )
}
