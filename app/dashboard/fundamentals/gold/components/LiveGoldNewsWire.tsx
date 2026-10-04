'use client'

/**
 * Live Institutional Metals News Wire
 * Connects directly to real-time Finnhub / Reuters & Yahoo RSS market wires
 * Supports 1-click evaluation into the 11-step Gold Event Evaluator
 */

import React from 'react'
import type { LiveGoldHeadline } from '@/types/fundamentals'

interface LiveGoldNewsWireProps {
  headlines: LiveGoldHeadline[]
  onSelectHeadline: (headline: LiveGoldHeadline) => void
  onRefresh: () => void
  refreshing: boolean
}

export function LiveGoldNewsWire({
  headlines,
  onSelectHeadline,
  onRefresh,
  refreshing,
}: LiveGoldNewsWireProps) {
  const formatTime = (epochSec: number) => {
    try {
      const d = new Date(epochSec * 1000)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return 'Just now'
    }
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📡</span>
            <h2 className="text-lg font-bold text-slate-100">
              Live Institutional Gold News Wire
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Finnhub / Reuters Institutional Wire
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time feed filtered for Bullion, Central Banks, Real Yields, Fed, Inflation & Geopolitics. 1-click loads into 11-step evaluator.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
        >
          <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
          <span>{refreshing ? 'Polling Wire...' : 'Refresh Wire'}</span>
        </button>
      </div>

      {/* Headlines List */}
      <div className="divide-y divide-slate-800/80 my-2">
        {headlines.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No breaking gold or precious metals wire headlines detected in the last polling cycle.
          </div>
        ) : (
          headlines.map((item) => (
            <div
              key={item.id}
              className="py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-950/40 px-2 rounded-lg transition"
            >
              <div className="flex-1 pr-2">
                <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-1">
                  <span className="font-semibold text-amber-400/90">{item.source}</span>
                  <span>•</span>
                  <span className="font-mono">{formatTime(item.datetime)}</span>
                </div>
                <h3 className="text-xs font-semibold text-slate-200 leading-snug">
                  {item.headline}
                </h3>
                {item.summary && (
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                    {item.summary}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/60 rounded border border-slate-700/80 transition"
                  >
                    Source ↗
                  </a>
                )}
                <button
                  onClick={() => onSelectHeadline(item)}
                  className="px-3 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded transition shadow-sm flex items-center gap-1"
                >
                  <span>⚡</span>
                  <span>Analyze Event</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
