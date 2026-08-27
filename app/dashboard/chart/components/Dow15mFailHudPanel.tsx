'use client'

import type { Dow15mFailHud } from '@/lib/trading/auctionVolumeBreak'

export function Dow15mFailHudPanel({ hud }: { hud: Dow15mFailHud }) {
  return (
    <div className="pointer-events-none absolute top-2 left-2 z-20 min-w-[16.5rem] overflow-hidden rounded-lg border border-white/15 bg-black/80 text-[10px] shadow-xl backdrop-blur-sm">
      <table className="relative w-full border-collapse">
        <thead>
          <tr className="bg-zinc-700/90">
            <th className="px-2 py-1 text-left font-semibold text-white">Dow 15M fail</th>
            <th className="px-2 py-1 text-left font-semibold text-white">State</th>
          </tr>
        </thead>
        <tbody className="text-white">
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Market</td>
            <td className={`px-2 py-0.5 ${hud.marketOk ? 'text-cyan-300' : 'text-red-400'}`}>
              {hud.marketOk ? 'DOW OK' : 'BLOCKED — use MYM/YM'}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Timeframe</td>
            <td className={`px-2 py-0.5 ${hud.timeframeOk ? 'text-green-400' : 'text-red-400'}`}>
              {hud.timeframeOk ? '5m' : 'SWITCH TO 5m'}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">15M range</td>
            <td className={`px-2 py-0.5 ${hud.rangeArm ? 'text-green-400' : 'text-zinc-400'}`}>
              {hud.rangeStatus}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Volume bar</td>
            <td className={`px-2 py-0.5 ${hud.setupOn ? 'text-yellow-300' : 'text-zinc-400'}`}>
              {hud.setupText}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Mode</td>
            <td className="px-2 py-0.5">{hud.mode}</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Daily</td>
            <td
              className={`px-2 py-0.5 ${
                hud.dailySignals >= hud.maxDaily ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {hud.dailySignals} / {hud.maxDaily}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="px-2 py-0.5">Risk</td>
            <td className="px-2 py-0.5">
              ${hud.riskDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}  1.5R
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
