'use client'

import React from 'react'
import type { OilCatalystEvent } from '@/types/fundamentals'

interface OilCatalystCalendarProps {
  catalysts: OilCatalystEvent[]
}

export function OilCatalystCalendar({ catalysts }: OilCatalystCalendarProps) {
  return (
    <div className="space-y-4">
      <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Scheduled Oil Catalysts & Tier-1 Reports
          </h3>
          <p className="text-[11px] text-gray-500">
            Standard releases governing WTI cash market liquidity, physical inventories, and OPEC+ policy.
          </p>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-600/20 text-brand-300 border border-brand-500/30">
          Weekly & Monthly Cycles
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {catalysts.map((cat) => (
          <div
            key={cat.id}
            className="bg-surface-800 border border-surface-600 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-surface-500 transition"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white leading-snug">{cat.name}</h4>
                  <span className="text-[11px] text-gray-400 font-mono mt-0.5 block">{cat.agency}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      cat.impact === 'HIGH'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {cat.impact} IMPACT
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 text-xs font-mono text-brand-300 bg-surface-850 px-2.5 py-1.5 rounded-lg border border-surface-700">
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {cat.dayTimeEt}
                </span>
                <span className="text-surface-500">•</span>
                <span className="text-gray-400">{cat.frequency}</span>
              </div>

              <p className="mt-2.5 text-xs text-gray-300 leading-relaxed">{cat.description}</p>
            </div>

            <div className="pt-2 border-t border-surface-700/80 space-y-1.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-1 text-gray-400">
                <span className="text-gray-500">Key Pillars:</span>
                {cat.focusPillars.map((p, i) => (
                  <span key={i} className="px-1.5 py-0.2 rounded bg-surface-700 text-gray-300 font-mono text-[10px]">
                    {p}
                  </span>
                ))}
              </div>

              {cat.lastActual && (
                <div className="text-gray-400">
                  Last Release: <strong className="text-gray-200 font-mono">{cat.lastActual}</strong>{' '}
                  {cat.lastSurprise && <span className="text-brand-300 font-mono">({cat.lastSurprise})</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
