'use client'

/**
 * 8-Feed V1 Architecture Status Card for Gold
 * Implements Item 38: Pragmatic V1 Feeds Architecture
 */

import React from 'react'
import type { GoldFeedStatus } from '@/types/fundamentals'

interface GoldFeedsCardProps {
  feeds: GoldFeedStatus[]
}

export function GoldFeedsCard({ feeds }: GoldFeedsCardProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
      case 'ACTIVE':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      case 'POLLING':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/30'
      case 'DEGRADED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    }
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔌</span>
            <h2 className="text-lg font-bold text-slate-100">
              V1 Pragmatic Data Feeds Architecture
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Item 38 Architecture
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Normalized facts from 8 core feeds. The LLM reasons over normalized facts without hallucinating numbers.
          </p>
        </div>
      </div>

      {/* Feeds Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 my-4">
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-200 truncate">{feed.name}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${getStatusBadge(feed.status)}`}>
                  {feed.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug mb-2">
                {feed.subtitle}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-500 font-mono flex justify-between items-center">
              <span>{feed.primarySource.split('/')[0]}</span>
              <span className="text-emerald-400/90">{feed.latency}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
