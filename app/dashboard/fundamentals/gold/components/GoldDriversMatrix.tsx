'use client'

/**
 * 7 Major Gold Drivers Matrix
 * Implements Item 1: Intraday vs Long-Term Importance Rankings & Transmission Roles
 */

import React, { useState } from 'react'
import type { GoldDriverState, GoldDriverId } from '@/types/fundamentals'

interface GoldDriversMatrixProps {
  drivers: Record<GoldDriverId, GoldDriverState>
}

export function GoldDriversMatrix({ drivers }: GoldDriversMatrixProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<GoldDriverId>('real_interest_rates')

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
      <span className="font-mono text-amber-400 text-xs tracking-widest">
        {'★'.repeat(count)}
        <span className="text-slate-600">{'★'.repeat(5 - count)}</span>
      </span>
    )
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2 className="text-lg font-bold text-slate-100">
              The 7 Major Gold Drivers Matrix
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Sourced metrics only
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Organized by Intraday vs Longer-Term transmission weighting. COMEX referenced macro drivers.
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
                ? 'bg-slate-950 border-amber-500/50 shadow-md ring-1 ring-amber-500/30'
                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-slate-200 truncate">{d.name}</span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${getStanceBadge(d.stance)}`}>
                {d.stance}
              </span>
            </div>

            <div className="space-y-1 text-[11px] mb-2.5">
              <div className="flex justify-between items-center text-slate-400">
                <span>Intraday:</span>
                {renderStars(d.intradayStars)}
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Longer-Term:</span>
                {renderStars(d.longTermStars)}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
              {d.summary}
            </p>
          </div>
        ))}
      </div>

      {/* Active Driver Focus Inspector */}
      {activeDriver && (
        <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
            <div>
              <span className="text-amber-400 font-bold text-sm">{activeDriver.name}</span>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Transmission Role: {activeDriver.transmissionRole}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Current Stance:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded border ${getStanceBadge(activeDriver.stance)}`}>
                {activeDriver.stance}
              </span>
            </div>
          </div>

          <div className="text-slate-300 leading-relaxed mb-3">
            {activeDriver.summary}
          </div>

          {/* Key Metrics Table */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {activeDriver.metrics.map((m, idx) => (
              <div key={idx} className="p-2.5 rounded bg-slate-900 border border-slate-800">
                <div className="text-[10px] text-slate-400 mb-0.5">{m.label}</div>
                <div className="text-sm font-mono font-bold text-slate-100">{m.value}</div>
                {m.change && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {m.change}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
