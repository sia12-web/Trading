'use client'

/**
 * Dow Industrial & Business Cycle Analyzer + Growth/Inflation 4-Quadrant Matrix
 * Prompts 5, 6, 12, 13: Manufacturing activity, New Orders, and 4-Quadrant Macro Regime
 */

import React from 'react'
import type { IndustrialCycleState, GrowthInflationQuadrant } from '@/types/fundamentals'

interface DowIndustrialCycleCardProps {
  industrial: IndustrialCycleState
  quadrant: GrowthInflationQuadrant
}

export function DowIndustrialCycleCard({
  industrial,
  quadrant,
}: DowIndustrialCycleCardProps) {
  const getPhaseBadge = (phase: string) => {
    switch (phase) {
      case 'ACCELERATING_DEMAND':
      case 'EXPANSION':
        return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
      case 'CONTRACTION':
        return 'text-rose-300 bg-rose-500/15 border-rose-500/30'
      case 'STAGFLATIONARY_PRESSURE':
        return 'text-amber-300 bg-amber-500/15 border-amber-500/30'
      default:
        return 'text-slate-300 bg-slate-500/15 border-slate-500/30'
    }
  }

  const quadrants = [
    {
      id: 'GROWTH_UP_INFLATION_DOWN' as GrowthInflationQuadrant,
      title: 'Quadrant 1: Growth ↑ / Inflation ↓',
      subtitle: 'The Dow Goldilocks Sweet Spot (Prompt 12)',
      stance: 'VERY BULLISH YM',
      color: 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300',
      description: 'Consumer purchasing power expands while easing inflation keeps rates low and multiple expansion intact. Broad cyclical industrial accumulation.',
    },
    {
      id: 'GROWTH_UP_INFLATION_UP' as GrowthInflationQuadrant,
      title: 'Quadrant 2: Growth ↑ / Inflation ↑',
      subtitle: 'Overheating / Higher Cost Pressures',
      stance: 'MODERATELY BULLISH / MIXED',
      color: 'border-amber-500/50 bg-amber-950/20 text-amber-300',
      description: 'Healthy revenue demand for heavy industrials and energy, but higher input costs and Fed tightening risk pressure duration valuations.',
    },
    {
      id: 'GROWTH_DOWN_INFLATION_DOWN' as GrowthInflationQuadrant,
      title: 'Quadrant 3: Growth ↓ / Inflation ↓',
      subtitle: 'Disinflationary Slowdown / Easing Eagerness',
      stance: 'MIXED / DEFENSIVE ROTATION',
      color: 'border-blue-500/50 bg-blue-950/20 text-blue-300',
      description: 'Fed rate cuts anticipated, but slowdown fears weigh on industrial orders. Capital rotates into Healthcare (UNH) and Staples (PG).',
    },
    {
      id: 'GROWTH_DOWN_INFLATION_UP' as GrowthInflationQuadrant,
      title: 'Quadrant 4: Growth ↓ / Inflation ↑',
      subtitle: 'Stagflationary Squeeze',
      stance: 'BEARISH YM',
      color: 'border-rose-500/50 bg-rose-950/20 text-rose-300',
      description: 'Worst regime for industrial blue chips: margin compression from high commodity/labor costs alongside declining order backlogs.',
    },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* 1. Industrial & Business Cycle Analyzer */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 backdrop-blur-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏭</span>
              <h3 className="text-base font-bold text-slate-100">
                Industrial &amp; Manufacturing Cycle Analyzer
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ISM Manufacturing, New Orders, Production &amp; Core Capital Goods
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border ${getPhaseBadge(industrial.cyclePhase)}`}>
            {industrial.cyclePhase.replace(/_/g, ' ')}
          </span>
        </div>

        {/* ISM Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">ISM Headline</span>
            <div className="text-lg font-bold text-slate-100 mt-0.5">
              {industrial.ismManufacturingHeadline > 0 ? industrial.ismManufacturingHeadline.toFixed(1) : '—'}
            </div>
            <span className={`text-[10px] ${industrial.ismManufacturingHeadline >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {industrial.ismManufacturingHeadline <= 0
                ? 'Not on this feed'
                : industrial.ismManufacturingHeadline >= 50
                  ? 'Expanding (>50)'
                  : 'Contracting (<50)'}
            </span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">ISM New Orders</span>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">
              {industrial.ismNewOrders.toFixed(1)}
            </div>
            <span className="text-[10px] text-slate-400">Leading indicator</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">Prices Paid</span>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {industrial.ismPricesPaid.toFixed(1)}
            </div>
            <span className="text-[10px] text-slate-400">Input cost pressure</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">Production</span>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {industrial.ismProduction.toFixed(1)}
            </div>
            <span className="text-[10px] text-slate-400">Factory output</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">Durable Goods MoM</span>
            <div className="text-lg font-bold text-slate-100 mt-0.5">
              {industrial.durableGoodsMomPct >= 0 ? '+' : ''}{industrial.durableGoodsMomPct.toFixed(1)}%
            </div>
            <span className="text-[10px] text-slate-400">Headline orders</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 block">Core Cap Goods</span>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">
              {industrial.coreCapitalGoodsOrdersMomPct >= 0 ? '+' : ''}{industrial.coreCapitalGoodsOrdersMomPct.toFixed(1)}%
            </div>
            <span className="text-[10px] text-slate-400">Non-defense ex-air</span>
          </div>
        </div>

        <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 text-xs font-mono leading-relaxed">
          <span className="font-bold text-blue-400">DOW INDUSTRIAL TRANSMISSION (Prompt 5): </span>
          Heavy industrial constituents like Caterpillar (CAT), Boeing (BA), and Honeywell (HON) respond directly to the <strong>ISM New Orders</strong> sub-index. A surge above 52 signals factory backlog growth and capital goods deployment.
        </div>
      </div>

      {/* 2. Growth / Inflation 4-Quadrant Matrix */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 backdrop-blur-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🧭</span>
              <h3 className="text-base font-bold text-slate-100">
                Growth / Inflation 4-Quadrant Matrix
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Macro regime classification for Dow Jones Blue-Chip Cyclicals (Prompts 12 &amp; 13)
            </p>
          </div>
          <span className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40">
            {quadrant === 'UNMEASURED' ? 'Not measured' : `Active: ${quadrant.replace(/_/g, ' ')}`}
          </span>
        </div>

        {/* 4 Quadrants Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quadrants.map((q) => {
            const isActive = q.id === quadrant
            return (
              <div
                key={q.id}
                className={`p-3.5 rounded-lg border transition ${
                  isActive
                    ? `${q.color} ring-2 ring-blue-500/50 shadow-lg shadow-blue-950/40`
                    : 'bg-slate-950/40 border-slate-800/80 text-slate-400 opacity-60 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs">{q.title}</span>
                  {isActive && (
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] bg-blue-500/30 text-blue-200 border border-blue-400/40 font-mono font-bold">
                      ACTIVE REGIME
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] font-semibold text-slate-200 mb-1 font-mono">
                  {q.stance}
                </div>
                <p className="text-[11px] leading-relaxed font-sans">
                  {q.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
