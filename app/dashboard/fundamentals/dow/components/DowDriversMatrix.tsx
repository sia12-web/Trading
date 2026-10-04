'use client'

/**
 * 11 Major Fundamental Drivers Matrix for Dow Jones Industrial Average (YM)
 * Item 4 in specification: Intraday & Long-Term Importance Star Ratings & Transmission Roles
 */

import React from 'react'
import type { DowDriverId, DowDriverState } from '@/types/fundamentals'

interface DowDriversMatrixProps {
  drivers: Record<DowDriverId, DowDriverState>
}

export function DowDriversMatrix({ drivers }: DowDriversMatrixProps) {
  const driverList = Object.values(drivers)

  const getStanceColor = (bias: string) => {
    switch (bias) {
      case 'BULLISH':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      case 'BEARISH':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30'
      case 'MIXED':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      case 'NEUTRAL':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30'
    }
  }

  const renderStars = (count: number) => {
    return (
      <span className="text-amber-400 font-mono tracking-tighter">
        {'★'.repeat(count)}
        <span className="text-slate-700">{'★'.repeat(5 - count)}</span>
      </span>
    )
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-sm shadow-xl space-y-6">
      {/* Title & Description */}
      <div className="pb-4 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🧭</span>
            <h2 className="text-lg font-bold text-slate-100">
              Dow Fundamental Drivers Matrix (11 Drivers)
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              YM · Star Hierarchy
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Categorized by intraday vs long-term sensitivity, economic cycle transmission, and price-weighted constituent impact.
          </p>
        </div>
      </div>

      {/* 11 Drivers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {driverList.map((driver) => (
          <div
            key={driver.id}
            className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition"
          >
            <div>
              {/* Header: Title & Stance */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-xs font-bold text-slate-200 tracking-tight">
                  {driver.name}
                </h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${getStanceColor(driver.stance)}`}>
                  {driver.stance}
                </span>
              </div>

              {/* Star Ratings */}
              <div className="grid grid-cols-2 gap-2 text-[10.5px] bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 mb-3">
                <div>
                  <span className="text-slate-400 block text-[9.5px]">Intraday Impact:</span>
                  <div>{renderStars(driver.intradayStars)}</div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9.5px]">Long-Term Impact:</span>
                  <div>{renderStars(driver.longTermStars)}</div>
                </div>
              </div>

              {/* Transmission Role */}
              <div className="mb-2">
                <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider block mb-0.5">
                  Transmission Mechanism:
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                  {driver.transmissionRole}
                </p>
              </div>

              {/* Summary */}
              <div className="mb-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-0.5">
                  Current Assessment:
                </span>
                <p className="text-[11px] text-slate-300 leading-relaxed font-mono">
                  {driver.summary}
                </p>
              </div>
            </div>

            {/* Live Metrics Chips */}
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <span className="text-[10px] uppercase text-slate-400 font-bold block">
                Tracked Metrics:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {driver.metrics.map((m, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10.5px] font-mono flex items-center gap-1.5"
                  >
                    <span className="text-slate-400">{m.label}:</span>
                    <span className="font-bold text-slate-200">{m.value}</span>
                    {m.change && (
                      <span className="text-[9.5px] text-slate-400">({m.change})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
