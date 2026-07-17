'use client'

/**
 * LLM Usage — tokens, cost estimates, proposer/verifier mix.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type UsagePayload = {
  ok: boolean
  days: number
  config: {
    proposer: { provider: string; model: string; configured: boolean }
    verifier: { enabled: boolean; provider: string; model: string; configured: boolean }
  }
  summary: {
    calls: number
    failures: number
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
  }
  by_provider: Record<string, { calls: number; input: number; output: number; cost: number }>
  by_model: Record<string, { calls: number; input: number; output: number; cost: number }>
  by_route: Record<string, { calls: number; cost: number }>
  recent: Array<{
    id: string
    created_at: string
    provider: string
    model: string
    role: string
    route: string
    instrument: string | null
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
    success: boolean
    levels_proposed: number | null
    levels_accepted: number | null
    levels_rejected: number | null
    error_message: string | null
  }>
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function LlmUsagePage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<UsagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/llm/usage?days=${days}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load usage')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-surface-900 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">LLM Usage</h1>
            <p className="text-sm text-gray-500 mt-1">
              Proposer + verifier calls, tokens, and estimated cost. Anti-hallucination grounding runs
              in code on every level find.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  days === d
                    ? 'bg-brand-600/20 border-brand-700/40 text-brand-300'
                    : 'border-surface-600 text-gray-500 hover:text-gray-200'
                }`}
              >
                {d}d
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1.5 rounded-lg text-xs border border-surface-600 text-gray-400 hover:text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && (
          <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Calls', value: String(data.summary.calls) },
                { label: 'Failures', value: String(data.summary.failures) },
                {
                  label: 'Tokens in/out',
                  value: `${data.summary.input_tokens.toLocaleString()} / ${data.summary.output_tokens.toLocaleString()}`,
                },
                {
                  label: 'Est. cost',
                  value: `$${data.summary.estimated_cost_usd.toFixed(4)}`,
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl border border-surface-600 bg-surface-800/60 px-4 py-3"
                >
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">{c.label}</div>
                  <div className="text-lg font-semibold text-white mt-1">{c.value}</div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl border border-surface-600 bg-surface-800/40 p-4">
                <h2 className="text-sm font-medium text-gray-300 mb-3">Active models</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Proposer</dt>
                    <dd className="text-right text-gray-200">
                      {data.config.proposer.provider} · {data.config.proposer.model}
                      {!data.config.proposer.configured && (
                        <span className="text-amber-400 ml-2">not configured</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Verifier</dt>
                    <dd className="text-right text-gray-200">
                      {data.config.verifier.enabled
                        ? `${data.config.verifier.provider} · ${data.config.verifier.model}`
                        : 'off (code grounding only)'}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-gray-600 mt-3">
                  Set <code className="text-gray-400">LLM_PROPOSER_MODEL</code>,{' '}
                  <code className="text-gray-400">GEMINI_API_KEY</code>,{' '}
                  <code className="text-gray-400">LLM_VERIFIER=off</code> in env.
                </p>
              </div>

              <div className="rounded-xl border border-surface-600 bg-surface-800/40 p-4">
                <h2 className="text-sm font-medium text-gray-300 mb-3">By provider</h2>
                {Object.keys(data.by_provider).length === 0 ? (
                  <p className="text-sm text-gray-500">No calls in this window yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {Object.entries(data.by_provider).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-3">
                        <span className="text-gray-400">{k}</span>
                        <span className="text-gray-200">
                          {v.calls} calls · ${(v.cost || 0).toFixed(4)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-surface-600 overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-surface-600 bg-surface-800/80 text-sm font-medium text-gray-300">
                Recent calls
              </div>
              {data.recent.length === 0 ? (
                <div className="px-4 py-8 text-sm text-gray-500">
                  No LLM calls logged yet. Run auto-levels or find-levels to populate this table.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-gray-500 border-b border-surface-700">
                      <tr>
                        <th className="px-3 py-2 font-medium">When (ET)</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Route</th>
                        <th className="px-3 py-2 font-medium">Inst</th>
                        <th className="px-3 py-2 font-medium">Tokens</th>
                        <th className="px-3 py-2 font-medium">Levels</th>
                        <th className="px-3 py-2 font-medium">$</th>
                        <th className="px-3 py-2 font-medium">OK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((r) => (
                        <tr key={r.id} className="border-b border-surface-800/80 text-gray-300">
                          <td className="px-3 py-2 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                          <td className="px-3 py-2">{r.role}</td>
                          <td className="px-3 py-2 max-w-[140px] truncate" title={r.model}>
                            {r.model}
                          </td>
                          <td className="px-3 py-2">{r.route}</td>
                          <td className="px-3 py-2">{r.instrument || '—'}</td>
                          <td className="px-3 py-2">
                            {r.input_tokens}/{r.output_tokens}
                          </td>
                          <td className="px-3 py-2">
                            {r.levels_accepted != null
                              ? `${r.levels_accepted}/${r.levels_proposed ?? '—'}`
                              : '—'}
                            {r.levels_rejected != null && r.levels_rejected > 0
                              ? ` (−${r.levels_rejected})`
                              : ''}
                          </td>
                          <td className="px-3 py-2">${Number(r.estimated_cost_usd).toFixed(4)}</td>
                          <td className="px-3 py-2">
                            {r.success ? (
                              <span className="text-emerald-400">yes</span>
                            ) : (
                              <span className="text-red-400" title={r.error_message || ''}>
                                no
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-600">
              Back to{' '}
              <Link href="/dashboard/chart" className="text-brand-400 hover:underline">
                Live Trading
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
