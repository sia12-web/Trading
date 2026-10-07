'use client'

import React, { useEffect, useState } from 'react'
import type { NikkeiEventEvaluation, NikkeiFundamentalDashboardState, StructuredNikkeiEventOutput } from '@/types/fundamentals'
import { NIKKEI_EVALUATION_PRESETS } from '@/lib/fundamentals/nikkeiAnalystConfig'
import { confidencePercent, displaySampleTitle } from '@/lib/fundamentals/honesty'

interface NikkeiEventEvaluatorCardProps {
  onEventEvaluated: (evaluation: NikkeiEventEvaluation, nextState?: NikkeiFundamentalDashboardState) => void
  prefillText?: string
  prefillSource?: string
  prefillNonce?: number
}

export function NikkeiEventEvaluatorCard({ onEventEvaluated, prefillText, prefillSource, prefillNonce = 0 }: NikkeiEventEvaluatorCardProps) {
  const [rawText, setRawText] = useState(prefillText || '')
  const [sourceHint, setSourceHint] = useState(prefillSource || '')

  useEffect(() => {
    if (prefillText) {
      setRawText(prefillText)
      setSourceHint(prefillSource || '')
    }
  }, [prefillText, prefillSource, prefillNonce])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentResult, setCurrentResult] = useState<StructuredNikkeiEventOutput | null>(null)

  const handleSelectPreset = (presetId: string) => {
    const preset = NIKKEI_EVALUATION_PRESETS.find((p) => p.id === presetId)
    if (preset) {
      setRawText(preset.rawText)
      setSourceHint(preset.source)
    }
  }

  const handleEvaluate = async () => {
    if (!rawText.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/fundamentals/nikkei/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: rawText.trim(),
          sourceHint: sourceHint.trim() || undefined,
          autoCommitIfMaterial: true,
        }),
      })

      if (!res.ok) {
        throw new Error(`Evaluation failed (HTTP ${res.status})`)
      }

      const data = await res.json()
      if (data.ok && data.structured) {
        setCurrentResult(data.structured)
        if (data.evaluation) {
          onEventEvaluated(data.evaluation, data.state)
        }
      } else {
        throw new Error(data.error || 'Failed to parse evaluation')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>🧠</span>
          <span>14-Step Institutional Event & News Evaluator</span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Evaluate Bank of Japan statements, USD/JPY shocks, semiconductor orders, and Tokyo cash session flow
        </p>
      </div>

      {/* Preset Selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Sample notes (not live releases):
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {NIKKEI_EVALUATION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset.id)}
              className="text-left p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition text-xs group"
            >
              <div className="text-[10px] font-mono text-cyan-400 uppercase font-semibold">
                {preset.category}
              </div>
              <div className="font-semibold text-slate-200 group-hover:text-white line-clamp-2 mt-0.5">
                {displaySampleTitle(preset.title)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Source Hint (e.g. Bank of Japan Statement, Reuters Tokyo, JPX Tape)"
            value={sourceHint}
            onChange={(e) => setSourceHint(e.target.value)}
            className="w-full sm:w-1/2 px-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <textarea
          rows={5}
          placeholder="Paste breaking news headline, BoJ statement, USD/JPY intervention alert, or Tokyo opening auction wire..."
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          className="w-full p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans leading-relaxed"
        />

        <div className="flex justify-end">
          <button
            onClick={handleEvaluate}
            disabled={loading || !rawText.trim()}
            className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs tracking-wider uppercase transition shadow-lg shadow-cyan-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin">🔄</span>
                <span>Executing 14-Step Model...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Evaluate Nikkei Impact</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* Evaluation Results Card */}
      {currentResult && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono font-bold">
                {currentResult.category}
              </span>
              <span className="text-sm font-bold text-white font-mono">
                {currentResult.event}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Confidence:</span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {confidencePercent(currentResult.confidence)}%
              </span>
            </div>
          </div>

          {/* Stances & Point Impact */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Intraday Stance</div>
              <div className="text-sm font-bold text-white mt-1">
                {currentResult.market_stance.intraday}
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Short-Term Stance</div>
              <div className="text-sm font-bold text-white mt-1">
                {currentResult.market_stance.short_term}
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Est. NKD Point Impact</div>
              <div
                className={`text-sm font-bold font-mono mt-1 ${
                  currentResult.estimated_nkd_point_impact == null
                    ? 'text-slate-400'
                    : currentResult.estimated_nkd_point_impact >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {currentResult.estimated_nkd_point_impact == null
                  ? 'Unavailable'
                  : `${currentResult.estimated_nkd_point_impact >= 0 ? '+' : ''}${currentResult.estimated_nkd_point_impact} pts`}
              </div>
            </div>

            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">5M Continuation</div>
              <div className="text-sm font-bold text-amber-400 font-mono mt-1">
                {currentResult.market_reaction.nkd_5m_continuation}
              </div>
            </div>
          </div>

          {/* Abnormal Behavior Alert */}
          {currentResult.abnormal_behavior.detected && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 space-y-1">
              <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase font-mono">
                <span>⚠️</span>
                <span>Abnormal Market Behavior Detected: {currentResult.abnormal_behavior.type}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {currentResult.abnormal_behavior.explanation}
              </p>
            </div>
          )}

          {/* Synthesis & Actionable Plan */}
          <div className="space-y-2 pt-2">
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Executive Fundamental Summary:
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {currentResult.summary}
              </p>
            </div>

            <div className="p-3 bg-cyan-950/20 border border-cyan-800/30 rounded-xl">
              <div className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <span>🎯</span>
                <span>Actionable Desk Execution Rule:</span>
              </div>
              <p className="text-xs text-cyan-100 font-mono leading-relaxed">
                {currentResult.actionable_takeaway}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
