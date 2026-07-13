export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-96 p-6">
      <div className="text-center">
        <div className="text-6xl mb-4">📊</div>
        <h3 className="text-2xl font-bold text-gray-900 mb-2">No data available</h3>
        <p className="text-gray-600 max-w-md">
          No levels found for the selected instrument and date range. Try adjusting your filters or create some levels first.
        </p>
      </div>
    </div>
  )
}
