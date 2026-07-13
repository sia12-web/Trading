'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Position {
  id: string
  symbol: string
  side: 'BUY' | 'SHORT'
  entry_level: number
  stop_loss: number
  take_profit: number
  entry_price: number | null
  exit_price: number | null
  quantity: number
  status: 'open' | 'closed'
  pnl_pips: number | null
  pnl_dollars: number | null
  is_paper_trading: boolean
  created_at: string
  closed_at: string | null
}

const INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI']

function rr(entry: number, sl: number, tp: number) {
  const risk = Math.abs(entry - sl)
  const reward = Math.abs(tp - entry)
  return risk > 0 ? (reward / risk).toFixed(1) : '—'
}

function PnlBadge({ val, label }: { val: number | null; label: string }) {
  if (val === null) return <span className="text-gray-600 text-xs">—</span>
  const positive = val >= 0
  return (
    <span className={`price-mono text-xs font-bold ${positive ? 'text-green-400' : 'text-red-400'}`}>
      {positive ? '+' : ''}{label === '$' ? `$${val.toFixed(2)}` : `${val.toFixed(1)} pips`}
    </span>
  )
}

export default function PositionsPage() {
  const [form, setForm] = useState({
    session_id: '', symbol: 'DOW', side: 'BUY' as 'BUY' | 'SHORT',
    entry_level: '', stop_loss: '', take_profit: '', quantity: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed'>('all')

  async function loadPositions() {
    setLoadingPositions(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setLoadingPositions(false)
    if (!error && data) setPositions(data)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/positions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: form.session_id,
          symbol: form.symbol,
          side: form.side,
          entry_level: parseFloat(form.entry_level),
          stop_loss: parseFloat(form.stop_loss),
          take_profit: parseFloat(form.take_profit),
          quantity: parseFloat(form.quantity),
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult({ ok: true, msg: `Position created · ${json.trading_mode} mode` })
        setForm(f => ({ ...f, entry_level: '', stop_loss: '', take_profit: '', quantity: '' }))
        loadPositions()
      } else {
        setResult({ ok: false, msg: json.error ?? 'Failed to create position' })
      }
    } catch {
      setResult({ ok: false, msg: 'Network error' })
    }
    setSubmitting(false)
  }

  const displayed = positions.filter(p =>
    filterStatus === 'all' ? true : p.status === filterStatus
  )

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Positions</h1>
        <p className="text-sm text-gray-500 mt-1">Create and track paper / live trading positions</p>
      </div>

      {/* Create position form */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">New Position</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="stat-label block mb-1">Session ID</label>
            <input
              className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 transition"
              placeholder="session-uuid"
              value={form.session_id}
              onChange={e => setForm(f => ({ ...f, session_id: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="stat-label block mb-1">Symbol</label>
            <select
              className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 transition"
              value={form.symbol}
              onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
            >
              {INSTRUMENTS.map(i => <option key={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="stat-label block mb-1">Direction</label>
            <div className="flex gap-2">
              {(['BUY', 'SHORT'] as const).map(s => (
                <button
                  key={s} type="button"
                  onClick={() => setForm(f => ({ ...f, side: s }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                    form.side === s
                      ? s === 'BUY' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                      : 'bg-surface-700 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {s === 'BUY' ? '↑ BUY' : '↓ SHORT'}
                </button>
              ))}
            </div>
          </div>

          {[
            { key: 'entry_level', label: 'Entry Level' },
            { key: 'stop_loss',   label: 'Stop Loss' },
            { key: 'take_profit', label: 'Take Profit' },
            { key: 'quantity',    label: 'Quantity (lots)' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="stat-label block mb-1">{label}</label>
              <input
                type="number" step="any" required
                className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white price-mono focus:outline-none focus:border-brand-500 transition"
                value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}

          {/* R:R preview */}
          {form.entry_level && form.stop_loss && form.take_profit && (
            <div className="flex items-end">
              <div className="card-sm px-4 py-2 w-full">
                <div className="stat-label">Risk : Reward</div>
                <div className="text-lg font-bold price-mono text-white mt-0.5">
                  1 : {rr(+form.entry_level, +form.stop_loss, +form.take_profit)}
                </div>
              </div>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-4">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Creating…' : 'Create Position'}
            </button>
            {result && (
              <span className={`text-sm ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                {result.ok ? '✓' : '✕'} {result.msg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Positions table */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Position Log</h2>
          <div className="flex items-center gap-2">
            <div className="tab-bar">
              {(['all', 'open', 'closed'] as const).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`tab text-xs capitalize ${filterStatus === s ? 'tab-active' : ''}`}>
                  {s}
                </button>
              ))}
            </div>
            <button onClick={loadPositions} disabled={loadingPositions} className="btn-ghost text-xs">
              {loadingPositions ? '…' : '⟳ Load'}
            </button>
          </div>
        </div>

        {displayed.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-600">
            <div className="text-4xl mb-3">📊</div>
            <p>No positions yet. Click "Load" to fetch or create your first position above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-dark">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-600 text-xs text-gray-500 uppercase tracking-wide">
                  {['Symbol','Side','Entry','SL','TP','R:R','Qty','P&L (pips)','P&L ($)','Mode','Status','Created'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((pos, i) => (
                  <tr key={pos.id}
                    className={`border-b border-surface-700/50 hover:bg-surface-700/30 transition ${i % 2 === 0 ? '' : 'bg-surface-800/30'}`}>
                    <td className="px-4 py-3 font-semibold text-white">{pos.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${pos.side === 'BUY' ? 'badge-up' : 'badge-down'}`}>
                        {pos.side === 'BUY' ? '↑' : '↓'} {pos.side}
                      </span>
                    </td>
                    <td className="px-4 py-3 price-mono text-gray-300">{pos.entry_level.toLocaleString()}</td>
                    <td className="px-4 py-3 price-mono text-red-400">{pos.stop_loss.toLocaleString()}</td>
                    <td className="px-4 py-3 price-mono text-green-400">{pos.take_profit.toLocaleString()}</td>
                    <td className="px-4 py-3 price-mono text-gray-400">1:{rr(pos.entry_level, pos.stop_loss, pos.take_profit)}</td>
                    <td className="px-4 py-3 price-mono text-gray-300">{pos.quantity}</td>
                    <td className="px-4 py-3"><PnlBadge val={pos.pnl_pips} label="pips" /></td>
                    <td className="px-4 py-3"><PnlBadge val={pos.pnl_dollars} label="$" /></td>
                    <td className="px-4 py-3">
                      <span className={`badge ${pos.is_paper_trading ? 'badge-neutral' : 'badge-warn'}`}>
                        {pos.is_paper_trading ? '📄 Paper' : '🔴 Live'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${pos.status === 'open' ? 'badge-up' : 'badge-neutral'}`}>
                        {pos.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {new Date(pos.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
