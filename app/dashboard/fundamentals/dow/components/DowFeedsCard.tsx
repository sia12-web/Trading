'use client'

/**
 * 9-Feed V1 Data Architecture Status Card for Dow (Prompt 39)
 * Market: CME E-mini Dow Futures (YM)
 */

import React from 'react'
import type { DowFeedStatus } from '@/types/fundamentals'

interface DowFeedsCardProps {
  feeds: DowFeedStatus[]
}

export function DowFeedsCard({ feeds }: DowFeedsCardProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
      case 'ACTIVE':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      case 'POLLING':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
      case 'DEGRADED':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      default:
        return 'bg-slate-500/15 text-slate-400 border-slate-500/30'
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-sm shadow-xl space-y-6">
      <div className="pb-4 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔌</span>
            <h2 className="text-lg font-bold text-slate-100">
              Dow data feeds
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              Dow data feeds
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time infrastructure powering price weights, dividend adjustments, ISM cycle, corporate credit spreads, and cross-market rotation.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-200">
                  {feed.name}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${getStatusBadge(feed.status)}`}>
                  {feed.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans leading-relaxed mb-3">
                {feed.subtitle}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-1 font-mono text-[10.5px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>Latency:</span>
                <span className="text-slate-200 font-bold">{feed.latency}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Sync Cadence:</span>
                <span className="text-slate-200">{feed.lastSync}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 truncate">
                <span>Primary Source:</span>
                <span className="text-blue-400 truncate max-w-[170px]" title={feed.primarySource}>
                  {feed.primarySource}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
