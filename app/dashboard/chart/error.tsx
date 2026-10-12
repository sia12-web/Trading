'use client'

import React, { useEffect } from 'react'

export default function ChartError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ChartRouteError] Client-side route exception caught:', error)
  }, [error])

  const handleResetStorage = () => {
    try {
      if (typeof window !== 'undefined') {
        const keysToRemove = [
          'trading_desk_trendlines_v1',
          'trading_desk_ranges_v1',
          'trading_desk_frvps_v1',
          'trading_desk_measures_v1',
          'tradepulse.desk.managePos',
          'tradepulse.desk.positionOverlay',
          'tradepulse.desk.pendingLimit',
          'desk_chart_theme_mode',
        ]
        keysToRemove.forEach((k) => window.localStorage.removeItem(k))
      }
    } catch {
      /* ignore */
    }
    reset()
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[#0d1117] p-6 text-white select-none">
      <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-[#161b22] p-6 shadow-2xl backdrop-blur-md space-y-4 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xl font-bold">
          ⚡
        </div>
        <h2 className="text-base font-bold text-gray-100">
          Trading Desk Recovered from Exception
        </h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          The chart runtime caught a client-side exception. State isolation prevented cascading failure.
        </p>
        {error?.message && (
          <div className="rounded-lg bg-black/50 border border-neutral-800 p-3 text-left">
            <p className="font-mono text-xs text-red-400 break-all">
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
            Retry Chart
          </button>
          <button
            type="button"
            onClick={handleResetStorage}
            className="rounded-lg border border-neutral-700 hover:border-neutral-500 bg-[#21262d] px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white shadow-md transition active:scale-95"
          >
            Clear Cache & Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
