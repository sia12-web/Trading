'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/client/reportClientError'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error, 'dashboard')
  }, [error])

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-100 flex items-center justify-center px-6">
      <div className="max-w-lg">
        <h1 className="text-lg font-semibold text-white">The desk hit an error</h1>
        <p className="mt-2 break-all font-mono text-xs text-red-200">
          {error.message || 'Unknown client error'}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
