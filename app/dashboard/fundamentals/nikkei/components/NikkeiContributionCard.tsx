'use client'

import React from 'react'
import type { NikkeiContributionState } from '@/types/fundamentals'
import { DEFAULT_NIKKEI_CONSTITUENTS, NIKKEI_DIVISOR } from '@/lib/fundamentals/nikkeiAnalystConfig'

interface NikkeiContributionCardProps {
  contribution: NikkeiContributionState | null
}

export function NikkeiContributionCard({ contribution }: NikkeiContributionCardProps) {
  if (!contribution) return null

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>⚖️</span>
            <span>Price-Weighted Point Leverage & Stock Concentration</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Nikkei 225 Divisor ({NIKKEI_DIVISOR}) mathematics and constituent point sensitivity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Concentration Regime:</span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold">
            {contribution.weightingConcentration}
          </span>
        </div>
      </div>

      {/* Point Leverage Explainer Banner */}
      <div className="bg-slate-950/70 border border-amber-500/20 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>💡</span>
            <span>The Nikkei Price-Weighting Rule</span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Unlike cap-weighted indices (TOPIX, S&P 500), the Nikkei 225 divides the simple sum of stock prices by the Divisor (~30.15). A ¥1,000 price move in <strong className="text-white">Fast Retailing (9983)</strong> moves the Nikkei by <strong className="text-amber-400 font-mono">+33.2 points</strong>, whereas a ¥1,000 move in <strong className="text-white">Toyota (7203)</strong> requires a massive +36% surge.
          </p>
        </div>
        <div className="bg-slate-900/90 px-4 py-2.5 rounded-xl border border-slate-800 text-center shrink-0">
          <div className="text-[10px] uppercase font-mono text-slate-400">Top 3 Index Concentration</div>
          <div className="text-xl font-bold text-amber-400 font-mono mt-0.5">{contribution.top3ContributionPct}%</div>
          <div className="text-[10px] text-slate-400">Fast Retailing + Tokyo Electron + Advantest</div>
        </div>
      </div>

      {/* Concentration Metric Blocks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
          <div className="text-[10px] uppercase font-mono text-slate-400">Fast Retailing (Uniqlo)</div>
          <div className="text-base font-bold text-white font-mono mt-1">{contribution.fastRetailingWeightPct}%</div>
          <div className="text-[10px] text-cyan-400 mt-0.5">Highest-priced constituent</div>
        </div>

        <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
          <div className="text-[10px] uppercase font-mono text-slate-400">Tokyo Electron</div>
          <div className="text-base font-bold text-white font-mono mt-1">{contribution.tokyoElectronWeightPct}%</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">Semiconductor equipment</div>
        </div>

        <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
          <div className="text-[10px] uppercase font-mono text-slate-400">Advantest</div>
          <div className="text-base font-bold text-white font-mono mt-1">{contribution.advantestWeightPct}%</div>
          <div className="text-[10px] text-amber-400 mt-0.5">AI GPU test equipment</div>
        </div>

        <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
          <div className="text-[10px] uppercase font-mono text-slate-400">Total Semi Cluster</div>
          <div className="text-base font-bold text-indigo-400 font-mono mt-1">{contribution.semiconductorSharePct}%</div>
          <div className="text-[10px] text-slate-400 mt-0.5">SOX beta correlation</div>
        </div>
      </div>

      {/* Constituent Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-3">Ticker / Company</th>
              <th className="py-2.5 px-3">Sector</th>
              <th className="py-2.5 px-3 text-right">Share Price (JPY)</th>
              <th className="py-2.5 px-3 text-right">Index Weight</th>
              <th className="py-2.5 px-3 text-right">USD/JPY Beta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {DEFAULT_NIKKEI_CONSTITUENTS.map((c) => (
              <tr key={c.symbol} className="hover:bg-slate-800/30 transition">
                <td className="py-2.5 px-3 font-semibold text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {c.symbol}
                    </span>
                    <span>{c.name}</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-slate-400 font-sans">{c.sector}</td>
                <td className="py-2.5 px-3 text-right text-slate-200">
                  ¥{c.priceJpy.toLocaleString()}
                </td>
                <td className="py-2.5 px-3 text-right font-bold text-amber-400">
                  {c.weightPct}%
                </td>
                <td className="py-2.5 px-3 text-right text-slate-300">
                  {c.betaToUsdJpy >= 0 ? '+' : ''}{c.betaToUsdJpy.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
