'use client'

import React from 'react'
import type { FiveFeedStatus } from '@/types/fundamentals'
import { connectedFeedCount } from '@/lib/fundamentals/honesty'

interface FiveFeedsCardProps {
  feeds: FiveFeedStatus[]
}

export function FiveFeedsCard({ feeds }: FiveFeedsCardProps) {
  const health = connectedFeedCount(feeds)
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-4 sm:p-5 shadow-sm space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-surface-700 pb-2.5">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <span>📡</span>
            Oil data feeds
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Targeted data feeds powering oil supply, inventories, positioning, consensus, and CME market data.
          </p>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 self-start sm:self-auto">
          {health.connected} / {health.total} feeds with a live print
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className="bg-surface-850 p-3 rounded-xl border border-surface-700/80 flex flex-col justify-between space-y-2"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-gray-400">Feed</span>
                <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${feed.status === 'ONLINE' || feed.status === 'ACTIVE' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${feed.status === 'ONLINE' || feed.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                  {feed.status}
                </span>
              </div>
              <h4 className="text-xs font-bold text-white mt-1">{feed.name}</h4>
              <p className="text-[10px] text-gray-400 font-mono mt-0.5">{feed.source}</p>
              <p className="text-[11px] text-gray-300 mt-2 leading-relaxed line-clamp-3">
                {feed.details}
              </p>
            </div>

            <div className="pt-2 border-t border-surface-700/80 text-[10px] text-gray-500 font-mono truncate" title={feed.lastSync}>
              {feed.lastSync}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
