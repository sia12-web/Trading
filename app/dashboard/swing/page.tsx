'use client'

import { TeamTapeCard } from '../components/TeamTapeCard'
import { QuestradeBookCard } from '../components/QuestradeBookCard'

export default function TeamTapePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📡</span> Team Tape &amp; Live Fills
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Interactive desk orders &amp; CME futures exchange pricing — active positions, working limit orders, and past trade outcomes.
          </p>
        </div>
      </div>
      <div className="mt-6 space-y-6">
        <TeamTapeCard />
        <QuestradeBookCard />
      </div>
    </div>
  )
}
