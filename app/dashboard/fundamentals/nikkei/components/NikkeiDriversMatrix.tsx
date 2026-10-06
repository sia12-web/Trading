'use client'

import React from 'react'
import type { NikkeiDriverState } from '@/types/fundamentals'

interface NikkeiDriversMatrixProps {
  drivers: Record<string, NikkeiDriverState> | null
}

export function NikkeiDriversMatrix({ drivers }: NikkeiDriversMatrixProps) {
  if (!drivers) return null

  const list = Object.values(drivers)

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>🧩</span>
          <span>Nikkei 225 Institutional Drivers Matrix</span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Multi-factor drivers evaluated across monetary policy, currency beta, tech cycle, and foreign flows
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((d) => {
          const stanceColor =
            d.stance === 'BULLISH'
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              : d.stance === 'BEARISH'
              ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
              : 'text-amber-400 bg-amber-500/10 border-amber-500/20'

          return (
            <div
              key={d.id}
              className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase">
                    {d.category}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${stanceColor}`}>
                    {d.stance}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white">{d.name}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{d.subtitle}</p>

                <div className="flex items-center gap-4 my-3 text-[11px]">
                  <div>
                    <span className="text-slate-500">Intraday: </span>
                    <span className="text-amber-400 font-mono">
                      {'★'.repeat(d.intradayStars)}{'☆'.repeat(5 - d.intradayStars)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Macro: </span>
                    <span className="text-amber-400 font-mono">
                      {'★'.repeat(d.longTermStars)}{'☆'.repeat(5 - d.longTermStars)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {/\d/.test(d.summary) ? 'Unavailable until a live print is on the feed.' : d.summary}
                </p>
              </div>

              {/* Metrics */}
              <div className="mt-4 pt-3 border-t border-slate-800/60 space-y-1.5">
                {d.metrics.map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400 font-sans text-[11px] truncate max-w-[150px]">
                      {m.name}
                    </span>
                    <span className="font-bold text-slate-200">
                      Unavailable
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
