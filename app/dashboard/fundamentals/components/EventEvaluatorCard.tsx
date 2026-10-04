'use client'

import React, { useState } from 'react'
import type { OilEventEvaluation, WtiTelemetry } from '@/types/fundamentals'
import { PRESET_EVENTS_FOR_EVALUATION } from '@/lib/fundamentals/oilAnalystConfig'

interface EventEvaluatorCardProps {
  onEvaluate: (params: {
    rawText: string
    sourceHint?: string
    timestampHint?: string
    autoCommitIfMaterial: boolean
  }) => Promise<OilEventEvaluation | null>
  currentTelemetry: WtiTelemetry
  onStateUpdated?: () => void
}

export function EventEvaluatorCard({
  onEvaluate,
  currentTelemetry,
  onStateUpdated,
}: EventEvaluatorCardProps) {
  const [inputText, setInputText] = useState('')
  const [sourceHint, setSourceHint] = useState('')
  const [timestampHint, setTimestampHint] = useState('')
  const [autoCommit, setAutoCommit] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastEvaluation, setLastEvaluation] = useState<OilEventEvaluation | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleLoadPreset = (presetId: string) => {
    const found = PRESET_EVENTS_FOR_EVALUATION.find((p) => p.id === presetId)
    if (found) {
      setInputText(found.rawText)
      setSourceHint(found.source)
      setTimestampHint(found.timestamp)
      setErrorMsg(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || isSubmitting) return

    setIsSubmitting(true)
    setErrorMsg(null)

    try {
      const evaluation = await onEvaluate({
        rawText: inputText.trim(),
        sourceHint: sourceHint.trim() || undefined,
        timestampHint: timestampHint.trim() || undefined,
        autoCommitIfMaterial: autoCommit,
      })

      if (evaluation) {
        setLastEvaluation(evaluation)
        onStateUpdated?.()
      } else {
        setErrorMsg('Evaluation did not return a valid result. Check connection and logs.')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Evaluation failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Event Intake Box */}
      <div className="bg-surface-800 border border-surface-600 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-surface-700 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-400" />
              Event Intake & Institutional 10-Step Evaluator
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Submit raw wire headlines, EIA/API releases, OPEC statements, or trade reports for rigorous 10-step auditing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            <div className="text-[11px] font-mono text-gray-400 bg-surface-900 px-2.5 py-1 rounded border border-surface-700">
              Active Benchmark: <strong className="text-white">${currentTelemetry.promptPrice.toFixed(2)}</strong> · Spread: <strong className="text-brand-300">{currentTelemetry.promptSpread >= 0 ? '+' : ''}${currentTelemetry.promptSpread.toFixed(2)}</strong> ({currentTelemetry.spreadRegime})
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-surface-900 border-surface-600 text-brand-500 focus:ring-0 focus:ring-offset-0"
              />
              <span title="Automatically update the 10-pillar fundamental state if Step 10 confirms materiality">
                Auto-update state if material
              </span>
            </label>
          </div>
        </div>

        {/* Quick Test Presets Bar */}
        <div>
          <span className="text-[11px] font-semibold uppercase text-gray-500 tracking-wider">
            Quick Test Presets:
          </span>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {PRESET_EVENTS_FOR_EVALUATION.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleLoadPreset(p.id)}
                className="px-2.5 py-1 text-xs rounded-lg bg-surface-700/80 hover:bg-surface-700 text-gray-300 hover:text-white border border-surface-600 transition"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Event Text / Wire Headline / Official Release
            </label>
            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste EIA Petroleum Status release, OPEC+ communique, breaking maritime headline, or inventory report..."
              className="w-full bg-surface-900 border border-surface-600 rounded-lg p-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">Original Source (Optional)</label>
              <input
                type="text"
                value={sourceHint}
                onChange={(e) => setSourceHint(e.target.value)}
                placeholder="e.g. EIA, API, OPEC Secretariat, Reuters, Platts"
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">Timestamp / Publication Time (Optional)</label>
              <input
                type="text"
                value={timestampHint}
                onChange={(e) => setTimestampHint(e.target.value)}
                placeholder="e.g. Wednesday 10:30 AM ET"
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-gray-500">
              Evaluates through 10-step institutional rubric · Checks price and spread confirmation
            </span>

            <button
              type="submit"
              disabled={isSubmitting || !inputText.trim()}
              className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 disabled:opacity-50 transition shadow-sm flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 animate-spin">
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="16" />
                  </svg>
                  Evaluating 10-Step Framework...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                  Run 10-Step Institutional Analysis
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Rendered 10-Step Institutional Evaluation Report */}
      {lastEvaluation && (
        <div className="bg-surface-800 border border-brand-500/50 rounded-xl p-5 shadow-lg space-y-5 animate-in fade-in duration-200">
          {/* Header of Evaluation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-surface-700 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-brand-600/30 text-brand-300 border border-brand-500/40">
                  Institutional 10-Step Audit
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {new Date(lastEvaluation.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
              <h3 className="text-base font-bold text-white mt-1">{lastEvaluation.title}</h3>
            </div>

            {/* Direction & Horizon Badges */}
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${
                  lastEvaluation.step6_direction === 'BULLISH'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : lastEvaluation.step6_direction === 'BEARISH'
                    ? 'bg-red-500/20 text-red-300 border-red-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                Step 6: {lastEvaluation.step6_direction} FOR WTI
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-700 text-gray-300 border border-surface-600">
                Step 7: {lastEvaluation.step7_relevant_horizon}
              </span>
            </div>
          </div>

          {/* 10-Step Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Step 1: Factual Information */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="text-brand-300">STEP 1: Factual Extraction</span>
                <span className="text-[10px] text-gray-500 font-mono">Verified facts only</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-gray-200">
                {lastEvaluation.step1_factual_information.map((fact, i) => (
                  <li key={i} className="leading-relaxed">
                    {fact}
                  </li>
                ))}
              </ul>
            </div>

            {/* Step 2: Original Source & Timestamp */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="text-brand-300">STEP 2: Source & Timestamp</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    lastEvaluation.step2_source_and_timestamp.verified
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {lastEvaluation.step2_source_and_timestamp.verified ? 'Verified Official' : 'Wire / Unverified'}
                </span>
              </div>
              <div className="text-xs text-gray-200 space-y-1 font-mono">
                <div>
                  Source: <strong className="text-white">{lastEvaluation.step2_source_and_timestamp.source}</strong>
                </div>
                <div>
                  Time: <span className="text-gray-400">{lastEvaluation.step2_source_and_timestamp.timestamp}</span>
                </div>
                <div>
                  Channel:{' '}
                  <span className="text-gray-400">
                    {lastEvaluation.step2_source_and_timestamp.channelType || 'WIRE_SERVICE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Step 3: Separate Facts from Estimates & Source Conflict */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="text-brand-300">STEP 3: Facts vs Estimates</span>
                {lastEvaluation.step3_facts_vs_estimates.hasConflict && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">
                    ⚠️ Source Conflict Detected
                  </span>
                )}
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-400">Hard Facts:</span>
                  <div className="text-gray-200 mt-0.5">
                    {lastEvaluation.step3_facts_vs_estimates.facts.join(' • ') || 'None verified'}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-400">Estimates / Interpretation:</span>
                  <div className="text-gray-300 mt-0.5">
                    {lastEvaluation.step3_facts_vs_estimates.estimatesAndInterpretation.join(' • ') || 'None identified'}
                  </div>
                </div>
                {lastEvaluation.step3_facts_vs_estimates.conflicts.length > 0 && (
                  <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-300 text-[11px]">
                    <strong>Conflict Report:</strong> {lastEvaluation.step3_facts_vs_estimates.conflicts.join('; ')}
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Scheduled Data Comparison */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                <span className="text-brand-300">STEP 4: Scheduled Data vs Consensus</span>
                <span className="text-[10px] text-gray-500 font-mono">Consensus delta</span>
              </div>
              {lastEvaluation.step4_scheduled_data_comparison ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="bg-surface-900 p-2 rounded border border-surface-700">
                    <div className="text-[10px] text-gray-500 uppercase">Actual</div>
                    <div className="font-bold text-emerald-400 mt-0.5">
                      {lastEvaluation.step4_scheduled_data_comparison.actual}
                    </div>
                  </div>
                  <div className="bg-surface-900 p-2 rounded border border-surface-700">
                    <div className="text-[10px] text-gray-500 uppercase">Consensus</div>
                    <div className="text-gray-300 mt-0.5">
                      {lastEvaluation.step4_scheduled_data_comparison.consensus || 'N/A'}
                    </div>
                  </div>
                  <div className="bg-surface-900 p-2 rounded border border-surface-700">
                    <div className="text-[10px] text-gray-500 uppercase">Previous</div>
                    <div className="text-gray-300 mt-0.5">
                      {lastEvaluation.step4_scheduled_data_comparison.previous || 'N/A'}
                    </div>
                  </div>
                  <div className="bg-surface-900 p-2 rounded border border-surface-700">
                    <div className="text-[10px] text-gray-500 uppercase">Surprise</div>
                    <div className="font-bold text-brand-300 mt-0.5 truncate" title={lastEvaluation.step4_scheduled_data_comparison.surpriseDelta || ''}>
                      {lastEvaluation.step4_scheduled_data_comparison.surpriseDelta || 'In-line'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500 italic py-2">
                  No scheduled consensus table for this unscheduled wire / geopolitical event.
                </div>
              )}
            </div>

            {/* Step 5: Affected Categories */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <span className="text-xs font-bold text-brand-300 block">STEP 5: Affected Categories</span>
              <div className="flex flex-wrap gap-1.5">
                {lastEvaluation.step5_affected_categories.map((cat, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-brand-600/20 text-brand-300 border border-brand-500/30"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>

            {/* Step 8: Multi-Factor Ratings */}
            <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
              <span className="text-xs font-bold text-brand-300 block">STEP 8: Multi-Factor Ratings (1-10)</span>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-surface-900 p-1.5 rounded border border-surface-700">
                  <div className="text-[10px] text-gray-400">Reliability</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {lastEvaluation.step8_ratings.reliability}/10
                  </div>
                </div>
                <div className="bg-surface-900 p-1.5 rounded border border-surface-700">
                  <div className="text-[10px] text-gray-400">Magnitude</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {lastEvaluation.step8_ratings.magnitude}/10
                  </div>
                </div>
                <div className="bg-surface-900 p-1.5 rounded border border-surface-700">
                  <div className="text-[10px] text-gray-400">Novelty</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {lastEvaluation.step8_ratings.novelty}/10
                  </div>
                </div>
                <div className="bg-surface-900 p-1.5 rounded border border-surface-700">
                  <div className="text-[10px] text-gray-400">Confidence</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {lastEvaluation.step8_ratings.confidence}/10
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 italic">
                {lastEvaluation.step8_ratings.rationale}
              </p>
            </div>
          </div>

          {/* Step 9: Market Confirmation (WTI Price & Front Calendar Spread) */}
          <div className="bg-surface-850 p-4 rounded-xl border border-surface-700 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs font-bold text-brand-300">
                STEP 9: Market Confirmation Check (WTI Price & Front Calendar Spread)
              </span>
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${
                  lastEvaluation.step9_market_confirmation.verdict === 'CONFIRMED'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : lastEvaluation.step9_market_confirmation.verdict === 'CONTRADICTED'
                    ? 'bg-red-500/20 text-red-300 border-red-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                Verdict: {lastEvaluation.step9_market_confirmation.verdict}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-surface-900 p-3 rounded-lg border border-surface-700">
                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  NYMEX WTI Prompt Price Reaction
                </span>
                <p className="text-gray-200 mt-1">
                  {lastEvaluation.step9_market_confirmation.priceReactionDetail ||
                    `Prompt WTI trading at $${lastEvaluation.step9_market_confirmation.wtiPrice.toFixed(2)}.`}
                </p>
              </div>

              <div className="bg-surface-900 p-3 rounded-lg border border-surface-700">
                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  Front Calendar Spread (M1-M2) Reaction
                </span>
                <p className="text-gray-200 mt-1">
                  {lastEvaluation.step9_market_confirmation.spreadReactionDetail ||
                    `Front spread at $${lastEvaluation.step9_market_confirmation.calendarSpread.toFixed(2)}/bbl (${lastEvaluation.step9_market_confirmation.spreadRegime}).`}
                </p>
              </div>
            </div>
          </div>

          {/* Step 10: Materiality Decision & Fundamental State Update */}
          <div className="bg-surface-850 p-4 rounded-xl border border-surface-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-brand-300">
                STEP 10: Materiality & Fundamental State Update
              </span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                  lastEvaluation.step10_materiality.isMaterial
                    ? 'bg-brand-600/30 text-brand-200 border border-brand-500/40'
                    : 'bg-surface-700 text-gray-400'
                }`}
              >
                {lastEvaluation.step10_materiality.isMaterial
                  ? 'Material Event (State Updated)'
                  : 'Immaterical Event (State Preserved)'}
              </span>
            </div>
            <p className="text-xs text-gray-300">{lastEvaluation.step10_materiality.rationale}</p>
            <div className="text-[11px] text-gray-400 font-mono">
              Impacted Pillars:{' '}
              <strong className="text-brand-300">
                {lastEvaluation.step10_materiality.pillarsImpacted.join(', ')}
              </strong>
            </div>
          </div>

          {/* Safeguards Warning Banner */}
          <div className="p-3 rounded-lg bg-surface-900 border border-surface-700/80 text-[11px] text-gray-400 space-y-1">
            <div className="text-amber-400 font-semibold flex items-center gap-1.5">
              <span>⚠️</span> Institutional Safeguards & Integrity Checklist
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-gray-400 pl-1">
              <li>
                <strong>Missing Data:</strong>{' '}
                {lastEvaluation.safeguards.missingData.length > 0
                  ? lastEvaluation.safeguards.missingData.join('; ')
                  : 'None. No data was invented.'}
              </li>
              <li>
                <strong>Correlation != Causation:</strong>{' '}
                {lastEvaluation.safeguards.correlationCausationWarnings[0] ||
                  'Never assume correlation implies causation.'}
              </li>
              <li>
                <strong>Trade Execution Guard:</strong> {lastEvaluation.safeguards.headlineTradeWarning}
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
