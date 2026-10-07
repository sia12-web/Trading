'use client'

import React from 'react'
import type { IndustrialCycleState, GrowthInflationQuadrant } from '@/types/fundamentals'

interface DowIndustrialCycleCardProps {
  industrial: IndustrialCycleState
  quadrant: GrowthInflationQuadrant
}

export function DowIndustrialCycleCard(_props: DowIndustrialCycleCardProps) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6">
      <h2 className="text-lg font-bold text-slate-100">Industrial cycle</h2>
      <p className="text-sm text-slate-300 mt-2">
        Unavailable. ISM, new orders, and the growth/inflation quadrant are not on a live feed.
      </p>
    </div>
  )
}
