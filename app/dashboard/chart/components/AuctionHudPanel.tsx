'use client'

import type { AuctionHud } from '@/lib/trading/auctionStrategy'

export function AuctionHudPanel({ hud }: { hud: AuctionHud }) {
  return (
    <div
      className={`pointer-events-none absolute top-2 right-2 z-20 min-w-[17.5rem] overflow-hidden rounded-lg border border-white/15 bg-black/80 text-[10px] shadow-xl backdrop-blur-sm ${
        hud.isLunch ? 'ring-1 ring-orange-400/40' : ''
      }`}
    >
      {hud.isLunch && <div className="absolute inset-0 bg-orange-500/[0.12]" />}
      <table className="relative w-full border-collapse">
        <thead>
          <tr className="bg-zinc-700/90">
            <th className="px-2 py-1 text-left font-semibold text-white">Auction Metric</th>
            <th className="px-2 py-1 text-left font-semibold text-white">Current State</th>
          </tr>
        </thead>
        <tbody className="text-white">
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Opening State</td>
            <td className="px-2 py-0.5 text-yellow-300">{hud.openType}</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Active Range Gate</td>
            <td className={`px-2 py-0.5 ${hud.canTradeWindow ? 'text-cyan-300' : 'text-zinc-400'}`}>
              {hud.rangeTag}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Execution Window</td>
            <td
              className={`px-2 py-0.5 ${
                hud.isLunch
                  ? 'text-orange-300'
                  : hud.canTradeWindow
                    ? 'text-green-400'
                    : 'text-zinc-400'
              }`}
            >
              {hud.windowLabel}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Active Engine</td>
            <td className="px-2 py-0.5">{hud.engine}</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Intraday Bias</td>
            <td
              className={`px-2 py-0.5 ${
                hud.bias.startsWith('Bullish')
                  ? 'text-green-400'
                  : hud.bias.startsWith('Bearish')
                    ? 'text-red-400'
                    : 'text-orange-300'
              }`}
            >
              {hud.bias}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Daily Trades Taken</td>
            <td
              className={`px-2 py-0.5 ${
                hud.dailySignals >= hud.maxDaily ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {hud.dailySignals} / {hud.maxDaily}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Risk Allocation</td>
            <td className="px-2 py-0.5">
              ${hud.riskDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })} (1%)
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
