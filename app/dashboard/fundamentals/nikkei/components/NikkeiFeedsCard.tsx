'use client'

import React from 'react'
import type { NikkeiFeedStatus } from '@/types/fundamentals'

interface NikkeiFeedsCardProps {
  feeds: NikkeiFeedStatus[] | null
}

export function NikkeiFeedsCard({ feeds }: NikkeiFeedsCardProps) {
  if (!feeds) return null

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>📡</span>
          <span>Nikkei 225 Live Feed Connectivity</span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Real-time status of Bank of Japan statements, EBS currency ticks, CME Globex NKD MDP 3.0, and JPX Arrowhead cash tape
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {feeds.map((feed) => {
          const statusBg =
            feed.status === 'ONLINE'
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : feed.status === 'ACTIVE'
              ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
              : 'bg-amber-500/20 text-amber-400 border-amber-500/30'

          return (
            <div
              key={feed.id}
              className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase">
                    {feed.category}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${statusBg}`}>
                    {feed.status}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white">{feed.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{feed.subtitle}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
                <div>Source: <span className="text-slate-300">{feed.primarySource}</span></div>
                <div>Latency: <span className="text-cyan-400 font-bold">{feed.latency}</span></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
