'use client'

/**
 * DJIA 30 Price-Weighting and Point Contribution Engine Component
 * Prompts 15 & 16: Price-Weighted Mathematics (Delta Price / Divisor), Concentration & Divergence
 */

import React, { useState, useMemo } from 'react'
import type { DjiaContributionState, DjiaConstituent } from '@/types/fundamentals'

interface DjiaContributionCardProps {
  contributions: DjiaContributionState
  constituents: DjiaConstituent[]
  dowDivisor: number
}

export function DjiaContributionCard({
  contributions,
  constituents,
  dowDivisor,
}: DjiaContributionCardProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'points' | 'price' | 'weight' | 'changePct'>('points')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Filter and sort constituents
  const filteredAndSorted = useMemo(() => {
    return constituents
      .filter((c) => {
        const q = search.toLowerCase()
        return (
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.sector.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        let valA = 0
        let valB = 0
        switch (sortBy) {
          case 'points':
            valA = Math.abs(a.pointContribution)
            valB = Math.abs(b.pointContribution)
            break
          case 'price':
            valA = a.price
            valB = b.price
            break
          case 'weight':
            valA = a.priceWeightPct
            valB = b.priceWeightPct
            break
          case 'changePct':
            valA = a.dayChangePct
            valB = b.dayChangePct
            break
        }
        return sortOrder === 'desc' ? valB - valA : valA - valB
      })
  }, [constituents, search, sortBy, sortOrder])

  const toggleSort = (col: 'points' | 'price' | 'weight' | 'changePct') => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col)
      setSortOrder('desc')
    }
  }

  const getDivergenceBadge = (signal: string) => {
    switch (signal) {
      case 'HIGH_PRICED_DOMINATED':
        return {
          label: 'High-Priced Dominated (Distortion Alert)',
          color: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
          desc: 'A few high-priced stocks (e.g. UNH/GS) are driving the index while the equal-weighted 30 lags.',
        }
      case 'BROAD_CONSTITUENT_RALLY':
        return {
          label: 'Broad Constituent Accumulation',
          color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
          desc: 'Lower and mid-priced components are broadly advancing with healthy equal-weight participation.',
        }
      default:
        return {
          label: 'Balanced Price-Weight Dynamic',
          color: 'text-blue-300 bg-blue-500/15 border-blue-500/30',
          desc: 'Equal-weight 30 and price-weighted DJIA are moving in close harmony.',
        }
    }
  }

  const divMeta = getDivergenceBadge(contributions.weightingDivergenceSignal)

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-sm shadow-xl space-y-6">
      {/* Header and Explanation */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚖️</span>
            <h2 className="text-lg font-bold text-slate-100">
              DJIA 30 Price-Weighting &amp; Point Contribution Engine
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              Divisor: {dowDivisor}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            The Dow is price-weighted, NOT market-cap-weighted. Point move = (&Delta;Price / Divisor). A $1 move in any constituent generates ~6.59 Dow points ($32.95 per YM contract).
          </p>
        </div>

        {/* Weighting Divergence Badge */}
        <div className="text-right">
          <span className={`inline-block px-2.5 py-1 rounded text-xs font-mono font-semibold border ${divMeta.color}`}>
            {divMeta.label}
          </span>
          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
            Equal-weight: {contributions.equalWeight30ReturnPct >= 0 ? '+' : ''}{contributions.equalWeight30ReturnPct}% vs DJIA: {contributions.priceWeightedDjiaReturnPct >= 0 ? '+' : ''}{contributions.priceWeightedDjiaReturnPct}%
          </div>
        </div>
      </div>

      {/* Top 3 Metric Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5">
          <div className="text-[10.5px] text-slate-400 uppercase tracking-wider mb-1">
            Top 1 Constituent Point Share
          </div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {contributions.top1ContributionPct.toFixed(1)}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full"
              style={{ width: `${Math.min(100, contributions.top1ContributionPct)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5">
          <div className="text-[10.5px] text-slate-400 uppercase tracking-wider mb-1">
            Top 3 Point Concentration
          </div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {contributions.top3ContributionPct.toFixed(1)}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                contributions.top3ContributionPct > 55 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, contributions.top3ContributionPct)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-1 block">
            Regime: {contributions.contributionConcentration}
          </span>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5">
          <div className="text-[10.5px] text-slate-400 uppercase tracking-wider mb-1">
            Top 5 Point Concentration
          </div>
          <div className="text-xl font-bold font-mono text-slate-100">
            {contributions.top5ContributionPct.toFixed(1)}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-purple-500 h-full rounded-full"
              style={{ width: `${Math.min(100, contributions.top5ContributionPct)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5">
          <div className="text-[10.5px] text-slate-400 uppercase tracking-wider mb-1">
            Total Net Daily Points Moved
          </div>
          <div
            className={`text-xl font-bold font-mono ${
              contributions.totalDayPointsMove >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {contributions.totalDayPointsMove >= 0 ? '+' : ''}
            {contributions.totalDayPointsMove.toFixed(1)} pts
          </div>
          <span className="text-[10px] text-slate-400 font-mono mt-1 block">
            Notional $\Delta$: ${(Math.abs(contributions.totalDayPointsMove * 5)).toLocaleString('en-US', { maximumFractionDigits: 0 })} / contract
          </span>
        </div>
      </div>

      {/* Institutional Explanatory Alert */}
      <div className="bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 text-xs text-slate-300 leading-relaxed font-mono">
        <span className="font-bold text-blue-400">PRICE-WEIGHTING LEVERAGE RULE: </span>
        UnitedHealth ($585) or Goldman Sachs ($535) has roughly <strong>6.8x the point influence</strong> of Nike ($86) or Coca-Cola ($68). When high-priced stocks have earnings or guidance shocks, they overpower dozens of lower-priced constituents combined.
      </div>

      {/* Search & Sort Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="w-full sm:w-72 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol, company, sector..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1.5 text-slate-400 hover:text-slate-200 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Sort by:</span>
          <button
            onClick={() => toggleSort('points')}
            className={`px-2 py-1 rounded text-xs border ${
              sortBy === 'points'
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}
          >
            Point Contribution {sortBy === 'points' && (sortOrder === 'desc' ? '↓' : '↑')}
          </button>
          <button
            onClick={() => toggleSort('price')}
            className={`px-2 py-1 rounded text-xs border ${
              sortBy === 'price'
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}
          >
            Share Price {sortBy === 'price' && (sortOrder === 'desc' ? '↓' : '↑')}
          </button>
          <button
            onClick={() => toggleSort('weight')}
            className={`px-2 py-1 rounded text-xs border ${
              sortBy === 'weight'
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}
          >
            Price Weight % {sortBy === 'weight' && (sortOrder === 'desc' ? '↓' : '↑')}
          </button>
          <button
            onClick={() => toggleSort('changePct')}
            className={`px-2 py-1 rounded text-xs border ${
              sortBy === 'changePct'
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 font-bold'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}
          >
            % Move {sortBy === 'changePct' && (sortOrder === 'desc' ? '↓' : '↑')}
          </button>
        </div>
      </div>

      {/* 30 DJIA Constituents Table */}
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="py-2.5 px-3">Symbol</th>
              <th className="py-2.5 px-3">Company</th>
              <th className="py-2.5 px-3">Sector</th>
              <th className="py-2.5 px-3 text-right">Share Price</th>
              <th className="py-2.5 px-3 text-right">Price Weight</th>
              <th className="py-2.5 px-3 text-right">1D Move</th>
              <th className="py-2.5 px-3 text-right">Point Contribution ($\Delta P/d$)</th>
              <th className="py-2.5 px-3 text-center">Last EPS</th>
              <th className="py-2.5 px-3 text-center">Guidance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredAndSorted.map((c) => {
              const isPositive = c.pointContribution >= 0
              return (
                <tr
                  key={c.symbol}
                  className="hover:bg-slate-800/40 transition"
                >
                  <td className="py-2 px-3 font-bold text-slate-200">
                    {c.symbol}
                  </td>
                  <td className="py-2 px-3 text-slate-300 font-sans max-w-[150px] truncate" title={c.name}>
                    {c.name}
                  </td>
                  <td className="py-2 px-3 text-slate-400 text-[11px] font-sans">
                    {c.sector}
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-slate-100">
                    ${c.price.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">
                    {c.priceWeightPct.toFixed(2)}%
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-semibold ${
                      c.dayChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {c.dayChangePct >= 0 ? '+' : ''}
                    {c.dayChangePct.toFixed(2)}% (${c.dayChange >= 0 ? '+' : ''}{c.dayChange.toFixed(2)})
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-bold ${
                      isPositive ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 inline-block min-w-[70px]">
                      {isPositive ? '+' : ''}
                      {c.pointContribution.toFixed(1)} pts
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        c.lastEpsSurprise === 'BEAT'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : c.lastEpsSurprise === 'MISS'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {c.lastEpsSurprise || 'N/A'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        c.forwardGuidance === 'RAISED'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : c.forwardGuidance === 'LOWERED'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {c.forwardGuidance || 'MAINTAINED'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
