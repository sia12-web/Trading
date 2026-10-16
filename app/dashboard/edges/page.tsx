'use client'

import React from 'react'
import Link from 'next/link'
import { GoldEdgePanel } from './GoldEdgePanel'

export default function EdgesPage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen bg-neutral-950 text-white font-sans overflow-y-auto">
      {/* Top Banner */}
      <header className="px-6 py-4 border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚡</span>
            <h1 className="text-base font-bold font-mono tracking-wide text-amber-200">
              Institutional Edge Hub
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Gold (XAU/USD · MGC) Micro-Wyckoff
            </span>
          </div>
          <p className="text-xs text-neutral-400 font-mono mt-0.5">
            Quantitative Accumulation & Distribution Edge • Order Flow CVD Absorption & Micro-Range Mechanics
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/chart"
            className="px-3.5 py-1.5 rounded-lg bg-surface-900 hover:bg-surface-800 border border-neutral-700 text-xs font-mono font-semibold transition flex items-center gap-1.5"
          >
            <span>📊</span>
            <span>Live Chart</span>
          </Link>
          <Link
            href="/dashboard/asian-edge"
            className="px-3.5 py-1.5 rounded-lg bg-surface-900 hover:bg-surface-800 border border-neutral-700 text-xs font-mono font-semibold transition flex items-center gap-1.5"
          >
            <span>🌙</span>
            <span>Asian Edge</span>
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <GoldEdgePanel />
      </main>
    </div>
  )
}
