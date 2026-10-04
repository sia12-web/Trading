'use client'

import React from 'react'
import type { LiveNikkeiHeadline } from '@/types/fundamentals'

interface LiveNikkeiNewsWireProps {
  headlines: LiveNikkeiHeadline[] | null
  onSelectHeadline: (headline: LiveNikkeiHeadline) => void
}

export function LiveNikkeiNewsWire({
  headlines,
  onSelectHeadline,
}: LiveNikkeiNewsWireProps) {
  if (!headlines || headlines.length === 0) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
        <p className="text-xs font-mono">No live Nikkei headlines currently buffered.</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-4">
      <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>📰</span>
            <span>Live Nikkei News Wire & Catalyst Tape</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Deduplicated Tokyo wires with automated market relevance scoring
          </p>
        </div>
        <span className="text-xs font-mono text-cyan-400 font-bold">
          {headlines.length} Buffered
        </span>
      </div>

      <div className="space-y-2.5">
        {headlines.map((item) => {
          const relBadge =
            item.indexRelevance === 'CRITICAL'
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : item.indexRelevance === 'HIGH'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-slate-800 text-slate-400 border-slate-700'

          return (
            <div
              key={item.id}
              onClick={() => onSelectHeadline(item)}
              className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${relBadge}`}>
                    {item.indexRelevance}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {new Date(item.datetime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-slate-500">• {item.source}</span>
                </div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-200 group-hover:text-white transition">
                  {item.headline}
                </h3>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition"
                >
                  Analyze ↗
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
