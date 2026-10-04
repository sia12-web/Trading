'use client'

/**
 * Live Institutional Dow & Industrial News Wire with Event Deduplication
 * Connects directly to real-time Finnhub / Reuters & SEC Edgar wires
 * Supports 1-click evaluation into the 14-step Dow Event Evaluator
 */

import React from 'react'
import type { LiveDowHeadline } from '@/types/fundamentals'

interface LiveDowNewsWireProps {
  headlines: LiveDowHeadline[]
  onSelectHeadline: (headline: LiveDowHeadline) => void
  onRefresh: () => void
  refreshing: boolean
}

export function LiveDowNewsWire({
  headlines,
  onSelectHeadline,
  onRefresh,
  refreshing,
}: LiveDowNewsWireProps) {
  const formatTime = (epochSec: number) => {
    try {
      const d = new Date(epochSec * 1000)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return 'Just now'
    }
  }

  const getRelevanceBadge = (relevance?: string) => {
    switch (relevance) {
      case 'CRITICAL':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold'
      case 'HIGH':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case 'MEDIUM':
        return 'bg-blue-500/10 text-blue-300 border-blue-500/30'
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700'
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📡</span>
            <h2 className="text-lg font-bold text-slate-100">
              Live Dow &amp; Industrial Blue-Chip News Wire
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              60-Min Cluster Deduplication
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time feed filtered for Dow 30, ISM Manufacturing, Boeing, Caterpillar, UnitedHealth, Goldman, Tariffs &amp; Credit.
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
            No breaking Dow, industrial or earnings wire headlines detected in the last polling cycle.
          </div>
        ) : (
          headlines.map((item) => (
            <div
              key={item.id}
              className="py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-950/40 px-2 rounded-lg transition"
            >
              <div className="flex-1 pr-2">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-950/50 px-1.5 py-0.5 rounded border border-blue-800/40">
                    {item.source}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {formatTime(item.datetime)}
                  </span>
                  {item.indexRelevance && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getRelevanceBadge(item.indexRelevance)}`}>
                      {item.indexRelevance}
                    </span>
                  )}
                  {item.duplicateCount && item.duplicateCount > 1 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-300 border border-purple-700/50">
                      DEDUPED: {item.duplicateCount} Wires Clustered
                    </span>
                  )}
                </div>

                <div className="text-xs font-medium text-slate-200 hover:text-blue-300 transition">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {item.headline}
                    </a>
                  ) : (
                    item.headline
                  )}
                </div>

                {item.summary && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                    {item.summary}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 self-end md:self-center">
                <button
                  onClick={() => onSelectHeadline(item)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 transition whitespace-nowrap flex items-center gap-1"
                  title="Load into 14-step Dow evaluator"
                >
                  <span>⚡</span>
                  <span>Evaluate in Engine</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
