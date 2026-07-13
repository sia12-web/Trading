'use client'

import { useState, useEffect } from 'react'

type TradingMode = 'paper' | 'live'

export default function SettingsPage() {
  const [mode, setMode] = useState<TradingMode | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/trading-mode')
      .then(r => r.json())
      .then(d => { setMode(d.trading_mode); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function save(newMode: TradingMode) {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/settings/trading-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      const json = await res.json()
      if (res.ok) {
        setMode(json.trading_mode)
        setMsg({ ok: true, text: `Switched to ${json.trading_mode} mode` })
      } else {
        setMsg({ ok: false, text: json.error ?? 'Update failed' })
      }
    } catch {
      setMsg({ ok: false, text: 'Network error' })
    }
    setSaving(false)
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your trading preferences</p>
      </div>

      {/* Trading Mode */}
      <div className="card p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-white">Trading Mode</h2>
          <p className="text-sm text-gray-500 mt-1">
            Paper mode uses simulated executions. Live mode executes real orders via OANDA.
          </p>
        </div>

        {loading ? (
          <div className="animate-pulse h-20 bg-surface-700 rounded-xl" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* Paper */}
            <button
              onClick={() => save('paper')}
              disabled={saving || mode === 'paper'}
              className={`relative p-5 rounded-xl border-2 text-left transition-all duration-200 ${
                mode === 'paper'
                  ? 'border-brand-500 bg-brand-600/10'
                  : 'border-surface-500 hover:border-surface-400 bg-surface-700/50'
              }`}
            >
              <div className="text-2xl mb-2">📄</div>
              <div className="font-bold text-white">Paper Trading</div>
              <div className="text-xs text-gray-500 mt-1">Simulated · No real money</div>
              {mode === 'paper' && (
                <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-brand-400" />
              )}
            </button>

            {/* Live */}
            <button
              onClick={() => save('live')}
              disabled={saving || mode === 'live'}
              className={`relative p-5 rounded-xl border-2 text-left transition-all duration-200 ${
                mode === 'live'
                  ? 'border-red-500 bg-red-600/10'
                  : 'border-surface-500 hover:border-surface-400 bg-surface-700/50'
              }`}
            >
              <div className="text-2xl mb-2">🔴</div>
              <div className="font-bold text-white">Live Trading</div>
              <div className="text-xs text-gray-500 mt-1">Real orders via OANDA</div>
              {mode === 'live' && (
                <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              )}
            </button>
          </div>
        )}

        {msg && (
          <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg ${
            msg.ok ? 'bg-green-900/30 text-green-400 border border-green-700/40'
                   : 'bg-red-900/30 text-red-400 border border-red-700/40'
          }`}>
            {msg.ok ? '✓' : '✕'} {msg.text}
          </div>
        )}

        {mode === 'live' && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-900/20 border border-red-700/40 text-sm text-red-300">
            <span className="text-lg mt-0.5">⚠️</span>
            <div>
              <div className="font-semibold text-red-400 mb-1">Live mode active</div>
              Positions created will execute real orders via your OANDA practice account.
              Make sure your OANDA API key is configured correctly.
            </div>
          </div>
        )}
      </div>

      {/* API Config info */}
      <div className="card p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">API Configuration</h2>
        <div className="space-y-3">
          {[
            { label: 'OANDA Environment', value: 'Practice (Paper)', status: 'ok' },
            { label: 'Supabase', value: 'Connected', status: 'ok' },
            { label: 'Claude AI (Level Finder)', value: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Key required in .env.local' : 'Key required', status: 'warn' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-2 border-b border-surface-600 last:border-0">
              <span className="text-sm text-gray-400">{row.label}</span>
              <span className={`badge ${row.status === 'ok' ? 'badge-up' : 'badge-warn'}`}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
