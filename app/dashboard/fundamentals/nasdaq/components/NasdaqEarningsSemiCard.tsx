'use client'

/**
 * Nasdaq earnings and semiconductor card.
 * Weights, EPS, guidance, and capex stay unavailable until a live feed prints them.
 * A share price is shown only after Yahoo returns that symbol.
 */

import React from 'react'
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
  semiCycle: _semiCycle,
  earningsCycle: _earningsCycle,
  nqPrice: _nqPrice,
}: NasdaqEarningsSemiCardProps) {
  return (
    <div className="space-y-6 mb-8">
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="pb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-slate-100">Nasdaq-100 earnings and semiconductor capex</h3>
          <p className="text-xs text-slate-400 mt-1">
            Index weights, EPS surprises, forward guidance, and hyperscaler capex are unavailable. A price appears only after Yahoo returns that symbol.
          </p>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-medium">
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Company</th>
                <th className="py-2.5 px-3 font-mono">Weight</th>
                <th className="py-2.5 px-3 font-mono">Price</th>
                <th className="py-2.5 px-3 font-mono">Change</th>
                <th className="py-2.5 px-3">EPS surprise</th>
                <th className="py-2.5 px-3">Guidance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {constituents.map((row) => (
                <tr key={row.symbol}>
                  <td className="py-2.5 px-3 font-bold font-mono text-cyan-400">{row.symbol}</td>
                  <td className="py-2.5 px-3 text-slate-300">{row.name}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-400">Unavailable</td>
                  <td className="py-2.5 px-3 font-mono text-slate-200">
                    {row.quoteLive ? `$${row.price.toFixed(2)}` : 'Unavailable'}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-200">
                    {row.quoteLive ? `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%` : 'Unavailable'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">Unavailable</td>
                  <td className="py-2.5 px-3 text-slate-400">Unavailable</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-base font-bold text-slate-100">AI and semiconductor cycle</h3>
        <p className="text-xs text-slate-400 mt-2">
          Accelerator demand, fab equipment bookings, export-control status, and the hyperscaler capex run-rate are unavailable.
        </p>
      </div>
    </div>
  )
}
