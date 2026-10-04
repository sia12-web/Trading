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
  const [viewMode, setViewMode] = useState<'STRUCTURED_JSON' | 'AUDIT_CARD'>('STRUCTURED_JSON')
  const [copiedJson, setCopiedJson] = useState(false)

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

  const handleCopyStructuredJson = () => {
    if (!lastEvaluation) return
    navigator.clipboard.writeText(JSON.stringify(lastEvaluation.structured, null, 2))
    setCopiedJson(true)
    setTimeout(() => setCopiedJson(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Event Intake Box */}
      <div className="bg-surface-800 border border-surface-600 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-surface-700 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-400" />
              Structured Oil Event Evaluator
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Outputs machine-readable JSON for agents: intraday bias, confidence, drivers, and spread confirmation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            <div className="text-[11px] font-mono text-gray-400 bg-surface-900 px-2.5 py-1 rounded border border-surface-700">
              Benchmark: <strong className="text-white">${currentTelemetry.promptPrice.toFixed(2)}</strong> · Spread: <strong className="text-brand-300">{currentTelemetry.promptSpread >= 0 ? '+' : ''}${currentTelemetry.promptSpread.toFixed(2)}</strong> ({currentTelemetry.spreadRegime})
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-surface-900 border-surface-600 text-brand-500 focus:ring-0 focus:ring-offset-0"
              />
              <span title="Automatically update the 10-pillar fundamental state if Step 10 confirms materiality">
                Auto-update state
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
              Strict JSON schema · No 5-paragraph essays · Consumable by trading bots
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
                  Processing Structured Event...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                  Evaluate Event (Structured JSON)
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Rendered Event Output */}
      {lastEvaluation && (
        <div className="bg-surface-800 border border-brand-500/50 rounded-xl p-5 shadow-lg space-y-5 animate-in fade-in duration-200">
          {/* Header of Evaluation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-surface-700 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-brand-600/30 text-brand-300 border border-brand-500/40">
                  {lastEvaluation.structured.event}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {new Date(lastEvaluation.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
              <h3 className="text-base font-bold text-white mt-1">
                {lastEvaluation.structured.summary}
              </h3>
            </div>

            {/* View Mode Toggle & Copy JSON Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode(viewMode === 'STRUCTURED_JSON' ? 'AUDIT_CARD' : 'STRUCTURED_JSON')}
                className="px-2.5 py-1 text-xs rounded-lg bg-surface-700 hover:bg-surface-650 text-gray-300 border border-surface-600 font-mono transition"
              >
                {viewMode === 'STRUCTURED_JSON' ? 'View 10-Step Audit' : 'View Agent JSON'}
              </button>

              <button
                type="button"
                onClick={handleCopyStructuredJson}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition flex items-center gap-1.5"
              >
                {copiedJson ? 'Copied JSON!' : 'Copy Agent JSON'}
              </button>
            </div>
          </div>

          {/* MODE 1: Machine-Readable Direct Agent View */}
          {viewMode === 'STRUCTURED_JSON' && (
            <div className="space-y-4">
              {/* Direct Agent Consumption KPI Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div className="bg-surface-850 p-3 rounded-xl border border-surface-700">
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">intraday</div>
                  <div className={`text-base font-bold mt-1 ${
                    lastEvaluation.structured.fundamental_effect.intraday === 'BULLISH'
                      ? 'text-emerald-400'
                      : lastEvaluation.structured.fundamental_effect.intraday === 'BEARISH'
                      ? 'text-red-400'
                      : 'text-amber-400'
                  }`}>
                    = {lastEvaluation.structured.fundamental_effect.intraday.toLowerCase()}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    st: {lastEvaluation.structured.fundamental_effect.short_term.toLowerCase()}
                  </div>
                </div>

                <div className="bg-surface-850 p-3 rounded-xl border border-surface-700">
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">confidence</div>
                  <div className="text-base font-bold text-white mt-1">
                    = {lastEvaluation.structured.confidence}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {(lastEvaluation.structured.confidence * 100).toFixed(0)}% institutional
                  </div>
                </div>

                <div className="bg-surface-850 p-3 rounded-xl border border-surface-700">
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">event importance</div>
                  <div className="text-base font-bold text-brand-300 mt-1">
                    = {lastEvaluation.structured.importance.toLowerCase()}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">market catalyst</div>
                </div>

                <div className="bg-surface-850 p-3 rounded-xl border border-surface-700">
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">market confirmation</div>
                  <div className="text-base font-bold text-emerald-400 mt-1">
                    = {lastEvaluation.structured.market_confirmation.confirmation.toLowerCase()}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    5m: {lastEvaluation.structured.market_confirmation.cl_5m_return}% · spread: +${lastEvaluation.structured.market_confirmation.front_spread_change}
                  </div>
                </div>
              </div>

              {/* Drivers Table */}
              {lastEvaluation.structured.drivers.length > 0 && (
                <div className="bg-surface-850 rounded-xl border border-surface-700 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-surface-700 bg-surface-900/60 flex items-center justify-between text-[11px] font-bold text-gray-300">
                    <span className="uppercase tracking-wider">Quantified Fundamental Drivers</span>
                    <span className="text-gray-500 font-mono">Consensus vs Actual</span>
                  </div>
                  <div className="divide-y divide-surface-700/60 font-mono text-xs">
                    {lastEvaluation.structured.drivers.map((d, idx) => (
                      <div key={idx} className="p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-white">{d.factor}</div>
                          <div className="text-[11px] text-gray-400">Unit: {d.unit}</div>
                        </div>
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <div className="text-[10px] text-gray-500 uppercase">Actual</div>
                            <div className="font-bold text-emerald-400">{d.actual}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-500 uppercase">Consensus</div>
                            <div className="text-gray-300">{d.consensus ?? 'N/A'}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            d.effect === 'BULLISH'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : d.effect === 'BEARISH'
                              ? 'bg-red-500/20 text-red-300 border-red-500/30'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}>
                            {d.effect}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw JSON Block for Machine Consumption */}
              <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span className="font-mono font-bold text-gray-300">JSON Payload For Backend / Agents:</span>
                  <span className="text-[10px] font-mono text-gray-500">application/json</span>
                </div>
                <pre className="text-xs font-mono text-brand-200 overflow-x-auto p-2 bg-surface-950 rounded border border-surface-800 leading-relaxed">
                  {JSON.stringify(lastEvaluation.structured, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* MODE 2: 10-Step Institutional Audit Card */}
          {viewMode === 'AUDIT_CARD' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Step 1: Factual Information */}
              <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                  <span className="text-brand-300">STEP 1: Factual Extraction</span>
                  <span className="text-[10px] text-gray-500 font-mono">Verified facts</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs text-gray-200">
                  {lastEvaluation.step1_factual_information.map((fact, i) => (
                    <li key={i} className="leading-relaxed">{fact}</li>
                  ))}
                </ul>
              </div>

              {/* Step 2: Original Source & Timestamp */}
              <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                  <span className="text-brand-300">STEP 2: Source & Timestamp</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Verified
                  </span>
                </div>
                <div className="text-xs text-gray-200 space-y-1 font-mono">
                  <div>Source: <strong className="text-white">{lastEvaluation.step2_source_and_timestamp.source}</strong></div>
                  <div>Time: <span className="text-gray-400">{lastEvaluation.step2_source_and_timestamp.timestamp}</span></div>
                </div>
              </div>

              {/* Step 3: Separate Facts from Estimates */}
              <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                  <span className="text-brand-300">STEP 3: Facts vs Estimates</span>
                  {lastEvaluation.step3_facts_vs_estimates.hasConflict && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">
                      Source Conflict
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-xs text-gray-200">
                  <div><strong>Facts:</strong> {lastEvaluation.step3_facts_vs_estimates.facts.join(' • ')}</div>
                  <div className="text-gray-400"><strong>Interpretation:</strong> {lastEvaluation.step3_facts_vs_estimates.estimatesAndInterpretation.join(' • ')}</div>
                </div>
              </div>

              {/* Step 9: Market Confirmation */}
              <div className="bg-surface-850 p-4 rounded-xl border border-surface-700/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                  <span className="text-brand-300">STEP 9: Market Confirmation</span>
                  <span className="text-[10px] font-bold text-emerald-400 font-mono">
                    {lastEvaluation.step9_market_confirmation.verdict}
                  </span>
                </div>
                <div className="text-xs text-gray-200 space-y-1">
                  <div>{lastEvaluation.step9_market_confirmation.priceReactionDetail}</div>
                  <div>{lastEvaluation.step9_market_confirmation.spreadReactionDetail}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
