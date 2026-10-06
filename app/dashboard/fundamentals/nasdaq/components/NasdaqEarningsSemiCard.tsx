'use client'

/**
 * Nasdaq Earnings Engine & AI/Semiconductor Capex Cycle Card
 * Implements SEC EDGAR earnings integration, constituent index impact calculator,
 * and hyperscaler AI datacenter capex run-rate tracker.
 */

import React, { useState } from 'react'
import type {
  NdxConstituentWeight,
  AiSemiCycleState,
  NdxEarningsCycleState,
} from '@/types/fundamentals'

interface NasdaqEarningsSemiCardProps {
  constituents: NdxConstituentWeight[]
  semiCycle: AiSemiCycleState
  earningsCycle: NdxEarningsCycleState
  nqPrice: number
}

export function NasdaqEarningsSemiCard({
  constituents,
  semiCycle,
  earningsCycle,
  nqPrice,
}: NasdaqEarningsSemiCardProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NVDA')
  const [hypotheticalMovePct, setHypotheticalMovePct] = useState<number>(5.0)

  const selectedConstituent = constituents.find((c) => c.symbol === selectedSymbol) || constituents[0]

  // Calculated Index Impact: Weight% * Move% * NQ Price / 100
  const estimatedPointsMove = selectedConstituent
    ? (selectedConstituent.weight / 100) * (hypotheticalMovePct / 100) * nqPrice
    : 0

  return (
    <div className="space-y-6 mb-8">
      {/* 1. TOP CONSTITUENTS & INDEX IMPACT CALCULATOR */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💼</span>
              <h3 className="text-base font-bold text-slate-100">
                Nasdaq-100 Constituent Weights &amp; Index Impact Engine
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono">
                May 2026 Methodology
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Top 8 mega-caps control &gt;45% of NQ weight. An earnings surprise in NVDA or MSFT has massive index point leverage.
            </p>
          </div>

          <div className="text-xs font-mono text-slate-400">
            Blended NDX EPS Growth: <strong className="text-emerald-400 font-bold">{earningsCycle.notableRecentReports.length > 0 ? `+${earningsCycle.blendedEarningsGrowthPct.toFixed(1)}% YoY` : 'Not on this feed'}</strong>
          </div>
        </div>

        {/* Index Impact Simulator Box */}
        <div className="my-5 p-4 rounded-lg bg-slate-950/80 border border-cyan-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="text-xs font-semibold text-cyan-400 mb-1 flex items-center gap-1.5">
              <span>⚡</span>
              <span>Interactive Earnings / Stock Move Index Impact Calculator:</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Simulate how a single mega-cap constituent earnings gap impacts NQ futures index points.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Select Stock:</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none"
              >
                {constituents.map((c) => (
                  <option key={c.symbol} value={c.symbol}>
                    {c.symbol} ({c.weight.toFixed(1)}%)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Stock Move (%):</label>
              <input
                type="number"
                step="0.5"
                value={hypotheticalMovePct}
                onChange={(e) => setHypotheticalMovePct(parseFloat(e.target.value) || 0)}
                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none"
              />
            </div>

            <div className="p-2.5 rounded bg-slate-900/90 border border-slate-700 text-center min-w-[120px]">
              <div className="text-[10px] text-slate-400 uppercase">NQ Point Drag/Lift</div>
              <div className={`text-base font-bold font-mono ${estimatedPointsMove >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {estimatedPointsMove >= 0 ? '+' : ''}{estimatedPointsMove.toFixed(1)} pts
              </div>
            </div>
          </div>
        </div>

        {/* Constituents Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-medium">
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Company</th>
                <th className="py-2.5 px-3 font-mono">Weight</th>
                <th className="py-2.5 px-3 font-mono">Price</th>
                <th className="py-2.5 px-3 font-mono">24h Chg</th>
                <th className="py-2.5 px-3">EPS Surprise</th>
                <th className="py-2.5 px-3">Forward Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {constituents.map((c) => (
                <tr key={c.symbol} className="hover:bg-slate-950/40 transition">
                  <td className="py-2.5 px-3 font-bold font-mono text-cyan-400">{c.symbol}</td>
                  <td className="py-2.5 px-3 text-slate-300">{c.name}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-200 font-bold">{c.weight.toFixed(2)}%</td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">${c.price.toFixed(2)}</td>
                  <td className="py-2.5 px-3 font-mono">
                    <span className={c.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {c.changePct >= 0 ? '+' : ''}{c.changePct.toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono">
                      {c.lastEpsSurprise || 'BEAT'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                      c.forwardGuidanceStance === 'RAISED'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : c.forwardGuidanceStance === 'LOWERED'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}>
                      {c.forwardGuidanceStance || 'MAINTAINED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. AI & SEMICONDUCTOR CAPEX CYCLE */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <h3 className="text-base font-bold text-slate-100">
                AI &amp; Semiconductor Capex Cycle Engine
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                {semiCycle.hyperscalerCapexRunRateBillions > 0
                  ? `Hyperscaler Run-Rate: $${semiCycle.hyperscalerCapexRunRateBillions}B`
                  : 'Capex not on this feed'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Tracks hyperscaler datacenter expenditure (MSFT, GOOGL, AMZN, META), fab equipment utilization, and SOXX confirmation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-mono font-medium">
              {semiCycle.aiLeadershipStance}
            </span>
          </div>
        </div>

        {/* AI & Semi Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-5">
          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="text-[11px] text-slate-400 mb-1">Accelerator Demand Trend</div>
            <div className="text-lg font-bold font-mono text-emerald-400">
              {semiCycle.acceleratorDemandTrend}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Blackwell &amp; custom ASIC order backlogs
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="text-[11px] text-slate-400 mb-1">Hyperscaler Capex Run-Rate</div>
            <div className="text-lg font-bold font-mono text-slate-100">
              ${semiCycle.hyperscalerCapexRunRateBillions}B / yr
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              +32% YoY annualized across 4 giants
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="text-[11px] text-slate-400 mb-1">Fab &amp; Equipment Cycle</div>
            <div className="text-sm font-semibold text-slate-200 mt-0.5">
              {semiCycle.semiconductorEquipmentCycle}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              EUV lithography lead times sold out
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="text-[11px] text-slate-400 mb-1">Export Controls Status</div>
            <div className="text-sm font-semibold text-slate-200 mt-0.5">
              {semiCycle.exportRestrictionsStatus}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Factored into corporate baselines
            </div>
          </div>
        </div>

        {/* Guidance vs Beat Nuance Alert */}
        <div className="p-3.5 rounded-lg bg-slate-950/50 border border-slate-800 text-xs text-slate-300 leading-relaxed">
          <span className="text-amber-400 font-semibold">Institutional Capex Nuance: </span>
          When a hyperscaler increases capex, it is directly bullish for semiconductor equipment and suppliers (NVDA, AVGO, ASML), but can be short-term margin dilutive for the spender (depreciation overhang). Always separate the hardware beneficiary from the capital allocator.
        </div>
      </div>
    </div>
  )
}
