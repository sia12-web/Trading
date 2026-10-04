'use client'

/**
 * 11 Major Nasdaq Drivers Matrix
 * Implements Item 1 Hierarchy: Intraday vs Long-Term Importance & Transmission Roles
 */

import React, { useState } from 'react'
import type { NasdaqDriverState, NasdaqDriverId } from '@/types/fundamentals'

interface NasdaqDriversMatrixProps {
  drivers: Record<NasdaqDriverId, NasdaqDriverState>
}

export function NasdaqDriversMatrix({ drivers }: NasdaqDriversMatrixProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<NasdaqDriverId>('fed_rate_expectations')

  const driverList = Object.values(drivers)
  const activeDriver = drivers[selectedDriverId] || driverList[0]

  const getStanceBadge = (stance: string) => {
    switch (stance) {
      case 'BULLISH':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      case 'BEARISH':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30'
      case 'MIXED':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      case 'NEUTRAL':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/30'
    }
  }

  const renderStars = (count: number) => {
    return (
      <span className="font-mono text-cyan-400 text-xs tracking-widest">
        {'★'.repeat(count)}
        <span className="text-slate-600">{'★'.repeat(5 - count)}</span>
      </span>
    )
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2 className="text-lg font-bold text-slate-100">
              The 11 Major Nasdaq-100 Drivers Matrix
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Fundamental Hierarchy
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Organized by Intraday vs Longer-Term transmission weighting. Macro, rates, corporate earnings, and order flow.
          </p>
        </div>
      </div>

      {/* Driver Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 my-5">
        {driverList.map((d) => (
          <div
            key={d.id}
            onClick={() => setSelectedDriverId(d.id)}
            className={`p-3.5 rounded-lg border cursor-pointer transition ${
              selectedDriverId === d.id
                ? 'bg-slate-950 border-cyan-500/60 shadow-md ring-1 ring-cyan-500/30'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-slate-100 line-clamp-1">{d.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono font-bold ${getStanceBadge(d.stance)}`}>
                {d.stance}
              </span>
            </div>

            <div className="space-y-1 mb-2.5 text-[11px]">
              <div className="flex items-center justify-between text-slate-400">
                <span>Intraday Impact:</span>
                {renderStars(d.intradayStars)}
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Long-Term Impact:</span>
                {renderStars(d.longTermStars)}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
              {d.summary}
            </p>
          </div>
        ))}
      </div>

      {/* Selected Driver Detailed Deep-Dive */}
      {activeDriver && (
        <div className="mt-5 p-4 rounded-lg bg-slate-950/90 border border-slate-800">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80 mb-3">
            <div>
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider block">
                Selected Driver Deep-Dive
              </span>
              <h3 className="text-base font-bold text-slate-100">{activeDriver.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Current Stance:</span>
              <span className={`text-xs px-2 py-0.5 rounded border font-mono font-bold ${getStanceBadge(activeDriver.stance)}`}>
                {activeDriver.stance}
              </span>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-slate-400 font-semibold block mb-0.5">Transmission Mechanism to NQ:</span>
              <p className="text-slate-300 leading-relaxed pl-2 border-l-2 border-cyan-500/50">
                {activeDriver.transmissionRole}
              </p>
            </div>

            <div>
              <span className="text-slate-400 font-semibold block mb-0.5">Institutional Assessment:</span>
              <p className="text-slate-300 leading-relaxed">
                {activeDriver.summary}
              </p>
            </div>

            {/* Metrics */}
            {activeDriver.metrics && activeDriver.metrics.length > 0 && (
              <div>
                <span className="text-slate-400 font-semibold block mb-1.5">Monitored Factor Metrics:</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {activeDriver.metrics.map((m, idx) => (
                    <div key={idx} className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                      <div className="text-[11px] text-slate-400">{m.label}</div>
                      <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
                        {m.value}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>Chg: {m.change}</span>
                        <span className={`font-mono font-semibold ${
                          m.stance === 'BULLISH' ? 'text-emerald-400' :
                          m.stance === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'
                        }`}>
                          {m.stance}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
