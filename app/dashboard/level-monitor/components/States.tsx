/**
 * Loading, Error, and Empty States for Level Monitor Widget
 */

export function LoadingState() {
  return (
    <div className="space-y-4">
      {/* Skeleton card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
              <div className="h-8 bg-gray-300 rounded w-32"></div>
            </div>
            <div className="h-6 bg-gray-200 rounded w-24"></div>
          </div>

          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>

      {/* Repeat for multiple cards */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
              <div className="h-8 bg-gray-300 rounded w-32"></div>
            </div>
            <div className="h-6 bg-gray-200 rounded w-24"></div>
          </div>

          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="bg-red-50 border-2 border-red-200 rounded-lg p-6">
      <div className="flex gap-3">
        <div className="text-red-600 text-2xl flex-shrink-0">⚠️</div>
        <div className="flex-1">
          <h3 className="font-semibold text-red-900 mb-1">Error Loading Levels</h3>
          <p className="text-red-800 text-sm mb-4">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition text-sm font-semibold"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="bg-gray-50 border border-gray-300 rounded-lg p-12 text-center">
      <div className="text-gray-400 text-4xl mb-3">○</div>
      <p className="text-gray-600 font-medium">{message}</p>
      <p className="text-gray-500 text-sm mt-2">
        Real-time level monitoring will appear here
      </p>
    </div>
  )
}
