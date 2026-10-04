'use client'

import React, { useState } from 'react'
import type { OilEventEvaluation, DirectionalBias } from '@/types/fundamentals'

interface EvaluatedEventsHistoryProps {
  events: OilEventEvaluation[]
}

export function EvaluatedEventsHistory({ events }: EvaluatedEventsHistoryProps) {
  const [filterDirection, setFilterDirection] = useState<'ALL' | DirectionalBias>('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = events.filter((ev) => {
    if (filterDirection === 'ALL') return true
    return ev.step6_direction === filterDirection
  })

  if (events.length === 0) {
    return (
      <div className="bg-surface-800 border border-surface-600 rounded-xl p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-surface-700 mx-auto flex items-center justify-center text-gray-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-200">No Evaluated Events Yet</h3>
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          Submit breaking oil wires, EIA reports, or OPEC communiques in the Event Evaluator to build an audited ledger of fundamental events.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface-800 border border-surface-600 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Evaluated Events Ledger
          </span>
          <span className="text-xs text-gray-500 font-mono">({filtered.length} logged)</span>
        </div>

        <div className="flex items-center gap-1.5">
          {(['ALL', 'BULLISH', 'BEARISH', 'MIXED', 'NEUTRAL'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setFilterDirection(d)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                filterDirection === d
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-700/60 text-gray-400 hover:text-gray-200'
              }`}
            >
              {d === 'ALL' ? 'All' : d}
            </button>
          ))}
        </div>
      </div>

      {/* Events Timeline / List */}
      <div className="space-y-3">
        {filtered.map((ev) => {
          const isExpanded = expandedId === ev.id
          const isBullish = ev.step6_direction === 'BULLISH'
          const isBearish = ev.step6_direction === 'BEARISH'

          const badgeClasses = isBullish
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            : isBearish
            ? 'bg-red-500/20 text-red-300 border-red-500/30'
            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'

          return (
            <div
              key={ev.id}
              className="bg-surface-800 border border-surface-600 rounded-xl p-4 transition hover:border-surface-500 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-start sm:items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeClasses}`}>
                    {ev.step6_direction}
                  </span>
                  <h4 className="text-sm font-bold text-white">{ev.title}</h4>
                  {ev.step10_materiality.isMaterial && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-brand-600/30 text-brand-300 border border-brand-500/30">
                      Material
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="font-mono">
                    {new Date(ev.evaluatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>•</span>
                  <span>{ev.step2_source_and_timestamp.source}</span>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                    className="ml-2 text-xs font-medium text-brand-400 hover:text-brand-300 underline"
                  >
                    {isExpanded ? 'Collapse' : '10-Step Audit'}
                  </button>
                </div>
              </div>

              {/* Quick Summary Line */}
              <p className="text-xs text-gray-300">
                {ev.step1_factual_information[0] || ev.rawInput.slice(0, 160)}
              </p>

              {/* Tags and Ratings Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-surface-700/60 text-[11px] text-gray-400">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Pillars:</span>
                  {ev.step5_affected_categories.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-surface-700 text-gray-300 font-mono text-[10px]">
                      {c}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <span>
                    Spread: <strong className="text-gray-200">{ev.step9_market_confirmation.verdict}</strong>
                  </span>
                  <span>
                    Reliability: <strong className="text-gray-200">{ev.step8_ratings.reliability}/10</strong>
                  </span>
                  <span>
                    Magnitude: <strong className="text-gray-200">{ev.step8_ratings.magnitude}/10</strong>
                  </span>
                </div>
              </div>

              {/* Expanded 10-Step Breakdown */}
              {isExpanded && (
                <div className="pt-3 border-t border-surface-700 space-y-3 bg-surface-850 p-4 rounded-lg">
                  <div className="text-xs space-y-2">
                    <div>
                      <strong className="text-brand-300">Step 1 (Facts):</strong>{' '}
                      <span className="text-gray-200">{ev.step1_factual_information.join(' • ')}</span>
                    </div>
                    <div>
                      <strong className="text-brand-300">Step 3 (Facts vs Estimates):</strong>{' '}
                      <span className="text-gray-300">
                        Facts: {ev.step3_facts_vs_estimates.facts.join('; ')} | Estimates:{' '}
                        {ev.step3_facts_vs_estimates.estimatesAndInterpretation.join('; ')}
                      </span>
                    </div>
                    {ev.step3_facts_vs_estimates.conflicts.length > 0 && (
                      <div className="text-red-300">
                        <strong>Source Conflict:</strong> {ev.step3_facts_vs_estimates.conflicts.join('; ')}
                      </div>
                    )}
                    <div>
                      <strong className="text-brand-300">Step 9 (Market Confirmation):</strong>{' '}
                      <span className="text-gray-200">
                        {ev.step9_market_confirmation.priceReactionDetail} |{' '}
                        {ev.step9_market_confirmation.spreadReactionDetail}
                      </span>
                    </div>
                    <div>
                      <strong className="text-brand-300">Step 10 (Materiality):</strong>{' '}
                      <span className="text-gray-200">{ev.step10_materiality.rationale}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
