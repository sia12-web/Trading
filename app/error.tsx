'use client'

import React, { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalAppError] Uncaught application exception:', error)
  }, [error])

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[#0d1117] p-6 text-white select-none">
      <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-[#161b22] p-6 shadow-2xl space-y-4 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 border border-neutral-700 text-gray-300 text-xl font-bold">
          ⚡
        </div>
        <h2 className="text-base font-bold text-gray-100">
          Application Exception Caught
        </h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          The application intercepted an unexpected client-side exception.
        </p>
        {error?.message && (
          <div className="rounded-lg bg-black/50 border border-neutral-800 p-3 text-left">
            <p className="font-mono text-xs text-amber-300 break-all">
              {error.message}
            </p>
          </div>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-md transition active:scale-95"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.location.reload()
            }}
            className="rounded-lg border border-neutral-700 hover:border-neutral-500 bg-[#21262d] px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white shadow-md transition active:scale-95"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  )
}
