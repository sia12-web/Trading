'use client'

/**
 * Dow Event Evaluator Card
 * Implements Item 38: Strict Machine-Readable JSON schema
 * Implements Item 35: Abnormal Behavior Detection (Prompt 27)
 * Implements Item 37: 14-step institutional evaluation workflow for YM
 * Prompts: Price weighting, Cyclical rotation, Credit spreads, ISM industrial demand, Goldilocks sweet spot
 */

import React, { useState } from 'react'
import type {
  DowEventEvaluation,
  StructuredDowEventOutput,
  LiveDowHeadline,
} from '@/types/fundamentals'
import { DOW_EVALUATION_PRESETS } from '@/lib/fundamentals/dowAnalystConfig'

interface DowEventEvaluatorCardProps {
  onEventEvaluated: (evaluation: DowEventEvaluation) => void
  selectedHeadline?: LiveDowHeadline | null
  onClearHeadline?: () => void
}

export function DowEventEvaluatorCard({
  onEventEvaluated,
  selectedHeadline,
  onClearHeadline,
}: DowEventEvaluatorCardProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const [rawText, setRawText] = useState<string>('')
  const [sourceHint, setSourceHint] = useState<string>('')
  const [evaluating, setEvaluating] = useState(false)
  const [lastResult, setLastResult] = useState<StructuredDowEventOutput | null>(null)
  const [jsonCopied, setJsonCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<'structured' | 'json'>('structured')

  // Sync selectedHeadline if passed from the live Dow news wire
  React.useEffect(() => {
    if (selectedHeadline) {
      setRawText(
        `Breaking Dow/Industrial Wire Headline: ${selectedHeadline.headline}\nSource: ${selectedHeadline.source}\nTimestamp: ${new Date(selectedHeadline.datetime * 1000).toISOString()}\nSummary: ${selectedHeadline.summary || 'N/A'}`
      )
      setSourceHint(selectedHeadline.source)
      setSelectedPresetId('custom')
    }
  }, [selectedHeadline])

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id)
    if (onClearHeadline) onClearHeadline()
    const p = DOW_EVALUATION_PRESETS.find((preset) => preset.id === id)
    if (p) {
      setRawText(p.rawText)
      setSourceHint(p.source)
    }
  }

  const handleEvaluate = async () => {
    if (!rawText.trim()) return
    setEvaluating(true)
    setError(null)
    try {
      const res = await fetch('/api/fundamentals/dow/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          sourceHint,
          autoCommitIfMaterial: true,
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()
      if (data.ok && data.structured) {
        setLastResult(data.structured)
        onEventEvaluated(data.evaluation)
      } else {
        throw new Error(data.error || 'Evaluation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  const handleCopyJson = () => {
    if (!lastResult) return
    navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2))
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 2000)
  }

  const getConfirmationBadge = (conf: string) => {
    switch (conf) {
      case 'STRONG':
      case 'CONFIRMED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
      case 'MODERATE':
      case 'PARTIALLY_CONFIRMED':
        return 'bg-teal-500/20 text-teal-400 border-teal-500/40'
      case 'WEAK':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case 'CONTRADICTED':
      case 'REJECTED':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold animate-pulse'
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
    }
  }

  const getStanceColor = (bias: string) => {
    switch (bias) {
      case 'BULLISH':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      case 'BEARISH':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30'
      case 'MIXED':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      case 'NEUTRAL':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30'
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Title & Description */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h2 className="text-lg font-bold text-slate-100">
              Dow Event Evaluator (14-Step Institutional Engine)
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
              YM · Price-Weighted
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Evaluates ISM Manufacturing, Earnings point contribution ($\Delta P/d$), Sector rotation, Credit spreads, and abnormal behavior.
          </p>
        </div>

        {lastResult && (
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs">
              <button
                onClick={() => setViewTab('structured')}
                className={`px-3 py-1 rounded-md transition font-medium ${
                  viewTab === 'structured'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dashboard View
              </button>
              <button
                onClick={() => setViewTab('json')}
                className={`px-3 py-1 rounded-md transition font-medium ${
                  viewTab === 'json'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Structured JSON
              </button>
            </div>
            {viewTab === 'json' && (
              <button
                onClick={handleCopyJson}
                className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
              >
                {jsonCopied ? '✓ Copied' : 'Copy JSON'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Preset Selector */}
      <div className="mt-4">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
          Sample notes (not live releases):
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {DOW_EVALUATION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset.id)}
              className={`text-left p-2.5 rounded-lg border text-xs transition ${
                selectedPresetId === preset.id
                  ? 'bg-blue-950/40 border-blue-500/60 text-blue-200 font-medium'
                  : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <div className="font-semibold text-slate-200 truncate mb-0.5">
                {preset.title}
              </div>
              <div className="text-[11px] text-slate-400 line-clamp-2">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Raw Event Input & Action */}
      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Raw Event Text &amp; Market Tape Reaction:</span>
            <span className="font-mono text-[11px] text-slate-400">
              Source: {sourceHint || 'Direct Input'}
            </span>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value)
              setSelectedPresetId('custom')
            }}
            rows={4}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 transition resize-y leading-relaxed"
            placeholder="Paste ISM report, earnings release, credit spread update, or tape reaction..."
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-[11px] text-slate-400">
            Strict safeguards active: Never uses cap-weighting, evaluates $\Delta P/d$, rates yield driver, checks credit.
          </div>
          <button
            onClick={handleEvaluate}
            disabled={evaluating || !rawText.trim()}
            className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-blue-950/50"
          >
            <span>{evaluating ? '🔄' : '⚡'}</span>
            <span>{evaluating ? 'Executing 14-Step Dow Engine...' : 'Evaluate Event with Dow Agent'}</span>
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* Evaluation Results Display */}
      {lastResult && (
        <div className="mt-6 pt-6 border-t border-slate-800">
          {viewTab === 'json' ? (
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto">
              <pre className="text-xs font-mono text-slate-200 whitespace-pre leading-relaxed">
                {JSON.stringify(lastResult, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Top Banner: Event Name, Category, Importance, Confidence */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-100">
                      {lastResult.event}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                      {lastResult.event_analysis?.category || 'MACRO'}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                        lastResult.importance === 'HIGH'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : lastResult.importance === 'MEDIUM'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {lastResult.importance} IMPORTANCE
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Timestamp: {lastResult.timestamp}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">EVALUATION CONFIDENCE</span>
                    <span className="text-base font-mono font-bold text-emerald-400">
                      {Math.round(lastResult.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Abnormal Behavior Alert Banner (Prompt 27) */}
              {lastResult.abnormal_behavior?.detected && (
                <div className="bg-amber-950/40 border border-amber-500/50 rounded-lg p-3 text-xs flex items-start gap-2.5">
                  <span className="text-base">⚠️</span>
                  <div>
                    <div className="font-bold text-amber-300 font-mono uppercase tracking-wide">
                      Abnormal Market Behavior Detected: {lastResult.abnormal_behavior.type}
                    </div>
                    <p className="text-amber-200 mt-0.5 font-mono text-[11px] leading-relaxed">
                      {lastResult.abnormal_behavior.description}
                    </p>
                  </div>
                </div>
              )}

              {/* Fundamental Stance & Market Response */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Expected Fundamental Effect */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Expected Fundamental Stance (YM)
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block mb-1">Intraday</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${getStanceColor(lastResult.fundamental_state?.intraday || 'NEUTRAL')}`}>
                        {lastResult.fundamental_state?.intraday}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block mb-1">Short-Term</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${getStanceColor(lastResult.fundamental_state?.short_term || 'NEUTRAL')}`}>
                        {lastResult.fundamental_state?.short_term}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block mb-1">Medium-Term</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold border ${getStanceColor(lastResult.fundamental_state?.medium_term || 'NEUTRAL')}`}>
                        {lastResult.fundamental_state?.medium_term}
                      </span>
                    </div>
                  </div>
                  {lastResult.event_analysis?.estimated_dow_point_impact != null && (
                    <div className="text-[11px] text-slate-300 font-mono pt-1">
                      Estimated Point Impact: <span className="font-bold text-blue-400">{lastResult.event_analysis.estimated_dow_point_impact >= 0 ? '+' : ''}{lastResult.event_analysis.estimated_dow_point_impact} Dow points</span>
                    </div>
                  )}
                </div>

                {/* Market Reaction & Confirmation */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Market Tape Confirmation
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${getConfirmationBadge(lastResult.market_response?.confirmation || 'MODERATE')}`}>
                      {lastResult.market_response?.confirmation}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono text-center">
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">YM Initial</span>
                      <span className="font-bold text-slate-200">{lastResult.market_response?.ym_initial}</span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">YM 5-Min</span>
                      <span className="font-bold text-slate-200">{lastResult.market_response?.ym_5m}</span>
                    </div>
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">YM 15-Min</span>
                      <span className="font-bold text-slate-200">{lastResult.market_response?.ym_15m}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>Industrials: <strong className="text-slate-200">{lastResult.market_response?.industrials}</strong></span>
                    <span>Financials: <strong className="text-slate-200">{lastResult.market_response?.financials}</strong></span>
                    <span>NQ Relative: <strong className="text-slate-200">{lastResult.market_response?.nq_relative}</strong></span>
                  </div>
                </div>
              </div>

              {/* Transmission Matrix & Breadth */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">GROWTH EXPECTATION</span>
                  <span className="font-bold text-slate-200">{lastResult.transmission?.growth_expectations}</span>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">YIELD MOVE DRIVER</span>
                  <span className="font-bold text-emerald-400">{lastResult.transmission?.yield_move_driver || 'UNKNOWN'}</span>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">SECTOR ROTATION</span>
                  <span className="font-bold text-blue-400">{lastResult.transmission?.sector_rotation}</span>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">CREDIT CONDITIONS</span>
                  <span className="font-bold text-slate-200">{lastResult.transmission?.credit_conditions || 'STABLE'}</span>
                </div>
              </div>

              {/* Crisp Institutional Summary */}
              <div className="bg-blue-950/20 border border-blue-800/40 rounded-lg p-3">
                <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider block mb-1">
                  Analyst summary
                </span>
                <p className="text-xs text-slate-100 font-mono leading-relaxed">
                  {lastResult.summary}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
