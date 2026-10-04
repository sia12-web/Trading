'use client'

/**
 * Nasdaq Event Evaluator Card
 * Implements Item 34: Strict Machine-Readable JSON schema
 * Implements Item 35: Abnormal Behavior Detection
 * Implements Item 33: 14-step institutional evaluation workflow
 * Prompts: Rates engine, Guidance vs Beat, Capex, Breadth, Cross-Asset Relative Strength
 */

import React, { useState } from 'react'
import type {
  NasdaqEventEvaluation,
  StructuredNasdaqEventOutput,
  LiveNasdaqHeadline,
} from '@/types/fundamentals'
import { NASDAQ_EVALUATION_PRESETS } from '@/lib/fundamentals/nasdaqAnalystConfig'

interface NasdaqEventEvaluatorCardProps {
  onEventEvaluated: (evaluation: NasdaqEventEvaluation) => void
  selectedHeadline?: LiveNasdaqHeadline | null
  onClearHeadline?: () => void
}

export function NasdaqEventEvaluatorCard({
  onEventEvaluated,
  selectedHeadline,
  onClearHeadline,
}: NasdaqEventEvaluatorCardProps) {
  const defaultPreset = NASDAQ_EVALUATION_PRESETS[0]
  const [selectedPresetId, setSelectedPresetId] = useState<string>(defaultPreset?.id || 'preset-hot-cpi-rejection')
  const [rawText, setRawText] = useState<string>(defaultPreset?.rawText || '')
  const [sourceHint, setSourceHint] = useState<string>(defaultPreset?.source || '')
  const [evaluating, setEvaluating] = useState(false)
  const [lastResult, setLastResult] = useState<StructuredNasdaqEventOutput | null>(null)
  const [jsonCopied, setJsonCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<'structured' | 'json'>('structured')

  // Sync selectedHeadline if passed from the live tech news wire
  React.useEffect(() => {
    if (selectedHeadline) {
      setRawText(
        `Breaking Tech/Macro Wire Headline: ${selectedHeadline.headline}\nSource: ${selectedHeadline.source}\nTimestamp: ${new Date(selectedHeadline.datetime * 1000).toISOString()}\nSummary: ${selectedHeadline.summary || 'N/A'}`
      )
      setSourceHint(selectedHeadline.source)
      setSelectedPresetId('custom')
    }
  }, [selectedHeadline])

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id)
    if (onClearHeadline) onClearHeadline()
    const p = NASDAQ_EVALUATION_PRESETS.find((preset) => preset.id === id)
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
      const res = await fetch('/api/fundamentals/nasdaq/analyze', {
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
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
      case 'MODERATE':
        return 'bg-teal-500/20 text-teal-400 border-teal-500/40'
      case 'WEAK':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case 'CONTRADICTED':
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
              Nasdaq Event Evaluator (14-Step Institutional Engine)
            </h2>
            <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
              NQ · Structured Output
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Evaluates CPI, FOMC, Mega-Cap Guidance, Semis &amp; Breadth. Emits strict machine-readable JSON with abnormal behavior detection.
          </p>
        </div>

        {lastResult && (
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs">
              <button
                onClick={() => setViewTab('structured')}
                className={`px-3 py-1 rounded-md transition font-medium ${
                  viewTab === 'structured'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dashboard View
              </button>
              <button
                onClick={() => setViewTab('json')}
                className={`px-3 py-1 rounded-md transition font-mono ${
                  viewTab === 'json'
                    ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Raw JSON
              </button>
            </div>
            <button
              onClick={handleCopyJson}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
            >
              <span>{jsonCopied ? '✓' : '📋'}</span>
              {jsonCopied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        )}
      </div>

      {/* Preset Scenario Selector */}
      <div className="my-4">
        <label className="text-xs font-semibold text-slate-300 block mb-2">
          Select Institutional Scenario Preset:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {NASDAQ_EVALUATION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectPreset(p.id)}
              className={`text-left p-2.5 rounded-lg border text-xs transition ${
                selectedPresetId === p.id
                  ? 'bg-cyan-950/40 border-cyan-500/60 text-cyan-200 font-medium'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="font-semibold text-slate-200 line-clamp-1">{p.title}</div>
              <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                {p.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Event Text / Macro Release / Tape Reading &amp; Market Reaction:</span>
            {selectedPresetId === 'custom' && (
              <span className="text-amber-400 font-medium">Custom Headline Selected</span>
            )}
          </div>
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value)
              setSelectedPresetId('custom')
            }}
            rows={5}
            placeholder="Paste CPI release, FOMC decision, mega-cap earnings 10-Q guidance, or tape CVD absorption notes..."
            className="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:w-1/2">
            <input
              type="text"
              value={sourceHint}
              onChange={(e) => setSourceHint(e.target.value)}
              placeholder="Source hint (e.g. BLS / SEC EDGAR / CME Globex)"
              className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
            />
          </div>
          <button
            onClick={handleEvaluate}
            disabled={evaluating || !rawText.trim()}
            className="w-full sm:w-1/2 py-2 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-cyan-950/50"
          >
            {evaluating ? (
              <>
                <span className="animate-spin">🔄</span>
                <span>Executing 14-Step Nasdaq Analysis...</span>
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
        <div className="p-3 my-4 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Results Presentation */}
      {lastResult && (
        <div className="mt-6 pt-5 border-t border-slate-800 space-y-4">
          {/* Header Badges */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold uppercase px-2.5 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700">
                {lastResult.event}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                {lastResult.market}
              </span>
              <span
                className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                  lastResult.importance === 'HIGH'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : lastResult.importance === 'MEDIUM'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                }`}
              >
                Importance: {lastResult.importance}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <span className={`px-2 py-0.5 rounded border ${getConfirmationBadge(lastResult.market_confirmation.confirmation)}`}>
                Confirmation: {lastResult.market_confirmation.confirmation}
              </span>
              <span className="text-slate-400">
                Confidence: <strong className="text-slate-200 font-bold">{(lastResult.confidence * 100).toFixed(0)}%</strong>
              </span>
            </div>
          </div>

          {/* Abnormal Behavior Alert Banner (Prompt 35) */}
          {lastResult.abnormal_behavior?.detected && (
            <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-600/70 text-rose-200 text-xs">
              <div className="flex items-center gap-2 font-bold text-rose-300 mb-1">
                <span className="text-base">🚨</span>
                <span>ABNORMAL BEHAVIOR DETECTED: {lastResult.abnormal_behavior.type}</span>
              </div>
              <p className="leading-relaxed pl-6 text-rose-100">
                {lastResult.abnormal_behavior.description}
              </p>
            </div>
          )}

          {/* View Tab Switcher: Structured or JSON */}
          {viewTab === 'json' ? (
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs overflow-x-auto text-emerald-400">
              <pre>{JSON.stringify(lastResult, null, 2)}</pre>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Institutional Summary */}
              <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 text-xs leading-relaxed text-slate-200">
                <div className="text-cyan-400 font-semibold mb-1">Institutional Summary:</div>
                <p>{lastResult.summary}</p>
              </div>

              {/* Fundamental Effect across Horizons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center">
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">
                    Intraday Stance
                  </div>
                  <div className={`text-base font-bold font-mono ${
                    lastResult.fundamental_effect.intraday === 'BULLISH' ? 'text-emerald-400' :
                    lastResult.fundamental_effect.intraday === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {lastResult.fundamental_effect.intraday}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center">
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">
                    Short-Term Stance
                  </div>
                  <div className={`text-base font-bold font-mono ${
                    lastResult.fundamental_effect.short_term === 'BULLISH' ? 'text-emerald-400' :
                    lastResult.fundamental_effect.short_term === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {lastResult.fundamental_effect.short_term}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-center">
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">
                    Medium-Term Stance
                  </div>
                  <div className={`text-base font-bold font-mono ${
                    lastResult.fundamental_effect.medium_term === 'BULLISH' ? 'text-emerald-400' :
                    lastResult.fundamental_effect.medium_term === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {lastResult.fundamental_effect.medium_term}
                  </div>
                </div>
              </div>

              {/* Drivers Breakdown */}
              {lastResult.drivers && lastResult.drivers.length > 0 && (
                <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
                  <div className="text-slate-300 font-semibold mb-2">Evaluated Drivers &amp; Standardized Surprises:</div>
                  <div className="space-y-2">
                    {lastResult.drivers.map((d, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/60 text-xs gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-cyan-300 font-semibold">{d.factor}</span>
                          {d.standardized_surprise !== undefined && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                              Z-Score: {d.standardized_surprise > 0 ? '+' : ''}{d.standardized_surprise.toFixed(2)}σ
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-300 font-mono">
                            Actual: <strong className="text-white">{d.actual}</strong> / Cons: {d.consensus} {d.unit}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-mono font-bold ${
                              d.effect === 'BULLISH'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : d.effect === 'BEARISH'
                                ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {d.effect}
                          </span>
                        </div>
                        {d.capex_guidance_nuance && (
                          <div className="text-[11px] text-amber-300 w-full sm:w-auto">
                            ⚠️ {d.capex_guidance_nuance}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Market Reaction & Transmission Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                  <div className="text-[10px] text-slate-400">NQ 5m Reaction</div>
                  <div className={`font-mono font-bold text-sm ${lastResult.market_confirmation.cl_5m_return >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {lastResult.market_confirmation.cl_5m_return >= 0 ? '+' : ''}
                    {lastResult.market_confirmation.cl_5m_return.toFixed(2)}%
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                  <div className="text-[10px] text-slate-400">2Y Yield Change</div>
                  <div className="font-mono font-bold text-sm text-cyan-300">
                    {(lastResult.market_confirmation.us2y_bps_change ?? 0) >= 0 ? '+' : ''}
                    {(lastResult.market_confirmation.us2y_bps_change ?? 0).toFixed(1)} bps
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                  <div className="text-[10px] text-slate-400">10Y Yield Change</div>
                  <div className="font-mono font-bold text-sm text-cyan-300">
                    {(lastResult.market_confirmation.us10y_bps_change ?? 0) >= 0 ? '+' : ''}
                    {(lastResult.market_confirmation.us10y_bps_change ?? 0).toFixed(1)} bps
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                  <div className="text-[10px] text-slate-400">Advance / Decline</div>
                  <div className="font-mono font-bold text-sm text-amber-300">
                    {lastResult.market_confirmation.advance_decline_ratio ? `${lastResult.market_confirmation.advance_decline_ratio.toFixed(2)}:1` : 'N/A'}
                  </div>
                </div>
              </div>

              {/* Safeguards Audit */}
              <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800/80 text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                <span className="text-emerald-400 font-semibold">✓ 14-Step Safeguards Passed:</span>
                <span>• No invented data</span>
                <span>• Rate cut ≠ auto-bullish</span>
                <span>• Earnings beat ≠ auto-bullish</span>
                <span>• Deduplicated wire</span>
                <span>• Wyckoff/CVD confirmation</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
