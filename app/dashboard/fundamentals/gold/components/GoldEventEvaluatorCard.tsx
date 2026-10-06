'use client'

/**
 * Gold Event Evaluator Card
 * Implements Item 36: Strict Machine-Readable JSON schema
 * Implements Item 35: 11-step institutional evaluation workflow
 * Implements Prompts 4, 5, 30, 31: Confirmation vs Rejection detection
 */

import React, { useState } from 'react'
import type {
  GoldEventEvaluation,
  StructuredGoldEventOutput,
  LiveGoldHeadline,
} from '@/types/fundamentals'
import { GOLD_EVALUATION_PRESETS } from '@/lib/fundamentals/goldAnalystConfig'

interface GoldEventEvaluatorCardProps {
  onEventEvaluated: (evaluation: GoldEventEvaluation) => void
  selectedHeadline?: LiveGoldHeadline | null
  onClearHeadline?: () => void
}

export function GoldEventEvaluatorCard({
  onEventEvaluated,
  selectedHeadline,
  onClearHeadline,
}: GoldEventEvaluatorCardProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const [rawText, setRawText] = useState<string>('')
  const [sourceHint, setSourceHint] = useState<string>('')
  const [evaluating, setEvaluating] = useState(false)
  const [lastResult, setLastResult] = useState<StructuredGoldEventOutput | null>(null)
  const [jsonCopied, setJsonCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync selectedHeadline if passed from the live news wire
  React.useEffect(() => {
    if (selectedHeadline) {
      setRawText(
        `Breaking Wire Headline: ${selectedHeadline.headline}\nSource: ${selectedHeadline.source}\nTimestamp: ${new Date(selectedHeadline.datetime * 1000).toISOString()}\nSummary: ${selectedHeadline.summary || 'N/A'}`
      )
      setSourceHint(selectedHeadline.source)
      setSelectedPresetId('custom')
    }
  }, [selectedHeadline])

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id)
    if (onClearHeadline) onClearHeadline()
    const p = GOLD_EVALUATION_PRESETS.find((preset) => preset.id === id)
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
      const res = await fetch('/api/fundamentals/gold/analyze', {
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

  const getResponseQualityBadge = (quality: string) => {
    switch (quality) {
      case 'CONFIRMED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
      case 'PARTIAL_CONFIRMATION':
        return 'bg-teal-500/20 text-teal-400 border-teal-500/40'
      case 'PARTIAL_REJECTION':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case 'COMPLETE_REJECTION':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold animate-pulse'
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
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
              Gold Event Evaluator & Structured JSON Engine
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Structured evaluation
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict 11-step institutional evaluation. Outputs structured machine-readable JSON consumable by trading agents.
          </p>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="my-4">
        <label className="text-xs font-semibold text-slate-300 block mb-2">
          Sample notes (not live releases):
        </label>
        <div className="flex flex-wrap gap-2">
          {GOLD_EVALUATION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                selectedPresetId === p.id
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                  : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
              }`}
            >
              {p.title.split(':')[0]}
            </button>
          ))}
          {selectedHeadline && (
            <button
              onClick={() => setSelectedPresetId('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                selectedPresetId === 'custom'
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                  : 'bg-slate-950/70 text-slate-400 border-slate-800'
              }`}
            >
              📡 Live Wire Headline
            </button>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="md:col-span-2">
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">
            Raw Event Text / Wire Release:
          </label>
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value)
              setSelectedPresetId('custom')
            }}
            rows={5}
            placeholder="Paste economic release, FOMC statement, or market reaction..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">
            Original Source Hint:
          </label>
          <input
            type="text"
            value={sourceHint}
            onChange={(e) => setSourceHint(e.target.value)}
            placeholder="e.g. BLS, FOMC, PBOC, Reuters"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 mb-3 focus:outline-none focus:border-amber-500/50"
          />

          <button
            onClick={handleEvaluate}
            disabled={evaluating || !rawText.trim()}
            className="w-full py-2.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-md"
          >
            {evaluating ? (
              <>
                <span className="animate-spin">🔄</span>
                <span>Evaluating 11 Steps...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Run Institutional Evaluation</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Evaluation Results Card */}
      {lastResult && (
        <div className="mt-6 pt-5 border-t border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {lastResult.event}
              </span>
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                  lastResult.event_analysis.expected_gold_effect === 'BULLISH'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : lastResult.event_analysis.expected_gold_effect === 'BEARISH'
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                Expected: {lastResult.event_analysis.expected_gold_effect}
              </span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${getResponseQualityBadge(lastResult.market_response.gold_response_quality)}`}>
                Quality: {lastResult.market_response.gold_response_quality}
              </span>
            </div>

            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700 transition"
            >
              <span>{jsonCopied ? '✓ Copied JSON' : '📋 Copy JSON for Agent'}</span>
            </button>
          </div>

          {/* Institutional Summary */}
          <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-300 leading-relaxed">
            <span className="text-amber-400 font-semibold block mb-0.5">Institutional Summary:</span>
            {lastResult.summary}
          </div>

          {/* Transmission & Market Confirmation Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Transmission Mechanism */}
            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                1. Transmission Path
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Real Rates:</span>
                  <span className={`font-bold ${lastResult.transmission.real_rates === 'UP' ? 'text-rose-400' : lastResult.transmission.real_rates === 'DOWN' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {lastResult.transmission.real_rates}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Nominal Rates:</span>
                  <span className="font-bold text-slate-300">
                    {lastResult.transmission.nominal_rates}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">U.S. Dollar (DXY):</span>
                  <span className={`font-bold ${lastResult.transmission.usd === 'UP' ? 'text-rose-400' : lastResult.transmission.usd === 'DOWN' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {lastResult.transmission.usd}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Market Response & CVD */}
            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                2. GC Price & Order Flow
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Initial Reaction:</span>
                  <span className="font-bold text-slate-200">{lastResult.market_response.gc_initial}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">5-min Follow-Through:</span>
                  <span className="font-bold text-slate-200">{lastResult.market_response.gc_5m}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">15-min Market Action:</span>
                  <span className={`font-bold ${lastResult.market_response.gc_15m === 'RECLAIMING' ? 'text-emerald-400' : lastResult.market_response.gc_15m === 'REVERSING' ? 'text-rose-400' : 'text-slate-300'}`}>
                    {lastResult.market_response.gc_15m}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Standardized Surprise (Item 8) */}
            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                3. Normalized Surprise (Z-Score)
              </div>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Surprise Type:</span>
                  <span className="font-bold text-amber-300">{lastResult.event_analysis.surprise}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Raw Surprise:</span>
                  <span className="text-slate-200">
                    {lastResult.event_analysis.raw_surprise !== undefined && lastResult.event_analysis.raw_surprise !== null
                      ? `${lastResult.event_analysis.raw_surprise > 0 ? '+' : ''}${lastResult.event_analysis.raw_surprise}`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Std Surprise (Z):</span>
                  <span className="font-bold text-sky-400">
                    {lastResult.event_analysis.standardized_surprise !== undefined && lastResult.event_analysis.standardized_surprise !== null
                      ? `${lastResult.event_analysis.standardized_surprise > 0 ? '+' : ''}${lastResult.event_analysis.standardized_surprise} σ`
                      : 'Non-Scheduled'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Machine-Readable Structured JSON Viewer */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-slate-400">
              <span>Structured output</span>
              <span className="text-[10px] text-emerald-400 font-bold">Agents Consume: {lastResult.market_response.gold_response_quality}</span>
            </div>
            <pre className="text-emerald-400 whitespace-pre-wrap overflow-x-auto max-h-96">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
