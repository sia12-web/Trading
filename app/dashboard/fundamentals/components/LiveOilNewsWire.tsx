'use client'

import React from 'react'
import type { LiveOilHeadline } from '@/types/fundamentals'

interface LiveOilNewsWireProps {
  headlines: LiveOilHeadline[]
  onSelectHeadline: (headline: LiveOilHeadline) => void
  onRefreshNews?: () => void
  loading?: boolean
}

function formatRelativeTime(unixSec: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function LiveOilNewsWire({
  headlines,
  onSelectHeadline,
  onRefreshNews,
  loading = false,
}: LiveOilNewsWireProps) {
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-4 sm:p-5 shadow-sm space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-surface-700 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Live Real-Time Oil Wire Feed
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            </h3>
            <p className="text-[11px] text-gray-400">
              Live news ingested from Finnhub & Reuters. Click any headline to evaluate with the 10-step institutional engine.
            </p>
          </div>
        </div>

        {onRefreshNews && (
          <button
            type="button"
            onClick={onRefreshNews}
            disabled={loading}
            className="px-2.5 py-1 text-xs rounded-lg bg-surface-700 hover:bg-surface-600 text-gray-300 border border-surface-600 transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={`w-3 h-3 ${loading ? 'animate-spin text-brand-400' : 'text-gray-400'}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Sync Wire
          </button>
        )}
      </div>

      {headlines.length === 0 ? (
        <div className="py-6 text-center text-xs text-gray-500">
          Syncing breaking energy wire headlines from Finnhub / Reuters...
        </div>
      ) : (
        <div className="space-y-2">
          {headlines.map((item) => (
            <div
              key={item.id}
              className="bg-surface-850 hover:bg-surface-750 p-3 rounded-lg border border-surface-700 transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 group"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="font-semibold text-brand-300">{item.source}</span>
                  <span>•</span>
                  <span className="font-mono">{formatRelativeTime(item.datetime)}</span>
                </div>
                <h4 className="text-xs font-semibold text-gray-200 group-hover:text-white leading-snug">
                  {item.headline}
                </h4>
              </div>

              <button
                type="button"
                onClick={() => onSelectHeadline(item)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand-200 bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/40 transition whitespace-nowrap self-start sm:self-auto flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>Evaluate (10-Step)</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
