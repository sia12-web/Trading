'use client'

import { TeamTapeCard } from '../components/TeamTapeCard'
import { QuestradeBookCard } from '../components/QuestradeBookCard'

export default function TeamTapePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-xl font-bold text-white">Team tape</h1>
      <p className="mt-1 text-sm text-gray-400">
        Famous US stocks from the NYC desk. You only see the tape. Nothing auto-places
        on Questrade or Tradovate. If you copy, it is a Tradeify day trade on DOW or
        NASDAQ — one index, same side, $400 → $250 → $150, close at 1.5R or flatten
        16:59 ET. Their share count is not your size.
      </p>
      <div className="mt-6 space-y-6">
        <TeamTapeCard />
        <QuestradeBookCard />
      </div>
    </div>
  )
}
