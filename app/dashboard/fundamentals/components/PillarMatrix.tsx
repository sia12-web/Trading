'use client'

import React, { useState } from 'react'
import type {
  FundamentalPillarId,
  FundamentalPillarState,
  DirectionalBias,
} from '@/types/fundamentals'

interface PillarMatrixProps {
  pillars: Record<FundamentalPillarId, FundamentalPillarState>
  onSelectPillar?: (id: FundamentalPillarId) => void
}

const PILLAR_ORDER: FundamentalPillarId[] = [
  'crude_supply',
  'petroleum_demand',
  'inventories',
  'refinery_activity',
  'imports_exports',
  'opec_policy',
  'geopolitical_risk',
  'curve_structure',
  'speculative_positioning',
  'macro_drivers',
]

export function PillarMatrix({ pillars, onSelectPillar }: PillarMatrixProps) {
  const [filterBias, setFilterBias] = useState<'ALL' | DirectionalBias>('ALL')
  const [selectedPillarId, setSelectedPillarId] = useState<FundamentalPillarId | null>(null)

  const pillarList = PILLAR_ORDER.map((id) => pillars[id]).filter(Boolean)

  const filteredPillars = pillarList.filter((p) => {
    if (filterBias === 'ALL') return true
    return p.bias === filterBias
  })

  const selectedPillar = selectedPillarId ? pillars[selectedPillarId] : null

  return (
    <div className="space-y-4">
      {/* Matrix Controls & Filter Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface-800 border border-surface-600 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            10 Fundamental Pillars Matrix
          </span>
          <span className="text-xs text-gray-500">
            ({filteredPillars.length} of 10) Pillar barrels, rigs, and CFTC totals are not a live print.
          </span>
        </div>

        {/* Bias Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setFilterBias(b)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                filterBias === b
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-surface-700/60 text-gray-400 hover:text-gray-200 hover:bg-surface-700'
              }`}
            >
              {b === 'ALL' ? 'All Pillars' : b}
            </button>
          ))}
        </div>
      </div>

      {/* 10-Pillar Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {filteredPillars.map((pillar) => {
          const isBullish = pillar.bias === 'BULLISH'
          const isBearish = pillar.bias === 'BEARISH'
          const isSelected = selectedPillarId === pillar.id

          const badgeClasses = isBullish
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            : isBearish
            ? 'bg-red-500/20 text-red-300 border-red-500/30'
            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'

          return (
            <div
              key={pillar.id}
              onClick={() => {
                setSelectedPillarId(pillar.id)
                onSelectPillar?.(pillar.id)
              }}
              className={`group bg-surface-800 border rounded-xl p-4 flex flex-col justify-between transition cursor-pointer hover:border-brand-500/50 hover:bg-surface-750 ${
                isSelected
                  ? 'border-brand-500 shadow-md shadow-brand-950/40 bg-surface-750'
                  : 'border-surface-600'
              }`}
            >
              {/* Pillar Header */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-brand-300 transition flex items-center gap-1.5">
                      {pillar.name}
                      {pillar.isMateriallyShifted && (
                        <span className="w-2 h-2 rounded-full bg-brand-400 animate-ping" title="Materially shifted by recent event" />
                      )}
                    </h3>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-1">
                      {pillar.subtitle}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeClasses}`}
                    >
                      {pillar.bias}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-surface-700 text-gray-400 border border-surface-600">
                      {pillar.horizon === 'DAYS_WEEKS' ? 'D/W' : pillar.horizon}
                    </span>
                  </div>
                </div>

                {/* Key Metrics Chips */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {pillar.metrics.slice(0, 4).map((m, idx) => (
                    <div
                      key={idx}
                      className="bg-surface-850/80 border border-surface-700/80 rounded-lg px-2.5 py-1.5"
                    >
                      <div className="text-[10px] text-gray-400 truncate">{m.label}</div>
                      <div className="text-xs font-mono font-bold text-gray-100 flex items-baseline gap-1 mt-0.5">
                        <span>{m.value}</span>
                        {m.unit && <span className="text-[10px] font-normal text-gray-500">{m.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Status Summary */}
                <p className="mt-3 text-xs text-gray-300 leading-relaxed line-clamp-3">
                  {pillar.statusSummary}
                </p>
              </div>

              {/* Bottom Footer Info */}
              <div className="mt-3.5 pt-3 border-t border-surface-700/80 flex items-center justify-between text-[10px] text-gray-500">
                <div className="flex items-center gap-2">
                  <span title="Analyst Confidence Score">
                    Conf: <strong className="text-gray-300 font-mono">{pillar.confidence}/10</strong>
                  </span>
                  <span>•</span>
                  <span title="Source Reliability">
                    Rel: <strong className="text-gray-300 font-mono">{pillar.reliability}/10</strong>
                  </span>
                </div>
                <div className="truncate max-w-[130px]" title={pillar.primarySource}>
                  {pillar.primarySource}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Selected Pillar Drill-Down Detail Drawer / Modal */}
      {selectedPillar && (
        <div className="bg-surface-800 border border-brand-500/40 rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">{selectedPillar.name}</h3>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${
                    selectedPillar.bias === 'BULLISH'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : selectedPillar.bias === 'BEARISH'
                      ? 'bg-red-500/20 text-red-300 border-red-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {selectedPillar.bias}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  Horizon: {selectedPillar.horizon}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{selectedPillar.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPillarId(null)}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-surface-700"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-3">
              <div className="bg-surface-850 p-3.5 rounded-lg border border-surface-700">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  Current Physical State & Analysis
                </span>
                <p className="text-xs text-gray-200 mt-1 leading-relaxed">
                  {selectedPillar.statusSummary}
                </p>
              </div>

              <div className="bg-surface-850 p-3.5 rounded-lg border border-surface-700">
                <span className="text-[10px] uppercase font-bold text-brand-300 tracking-wider">
                  Analyst Key Takeaway for WTI
                </span>
                <p className="text-xs text-gray-200 mt-1 leading-relaxed font-medium">
                  {selectedPillar.keyTakeaway}
                </p>
              </div>
            </div>

            <div className="bg-surface-850 p-3.5 rounded-lg border border-surface-700 space-y-2.5">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                Audited Metrics
              </span>
              <div className="space-y-2">
                {selectedPillar.metrics.map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{m.label}</span>
                    <span className="font-mono font-bold text-white">
                      {m.value} {m.unit || ''}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-surface-700/80 text-[11px] text-gray-400 space-y-1">
                <div>
                  Primary Source: <span className="text-gray-300">{selectedPillar.primarySource}</span>
                </div>
                <div>
                  Last Updated:{' '}
                  <span className="text-gray-300 font-mono">
                    {new Date(selectedPillar.lastUpdated).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
