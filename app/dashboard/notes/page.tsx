'use client'

/**
 * Desk Notes & Alarms Page
 * Surfaces Desk Notifications & Leo Long-Term Memories, active level alarms,
 * and triggered notifications created via Leo voice/chat commands or level tags.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  loadLongTermMemories,
  saveLongTermMemory,
  deleteLongTermMemory,
  loadMemoryNotifications,
  clearAllNotifications,
  type LeoLongTermMemory,
  type LeoMemoryNotification,
} from '@/lib/trading/leoLongTermMemory'
import { DashboardNotifications } from '../components/DashboardNotifications'

type MarketFilter = 'ALL' | 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'

export default function NotesPage() {
  const [market, setMarket] = useState<MarketFilter>('ALL')
  const [memories, setMemories] = useState<LeoLongTermMemory[]>([])
  const [notifications, setNotifications] = useState<LeoMemoryNotification[]>([])
  const [newInst, setNewInst] = useState<'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE'>('NASDAQ')
  const [newPxLow, setNewPxLow] = useState('')
  const [newPxHigh, setNewPxHigh] = useState('')
  const [newPurpose, setNewPurpose] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const refreshData = () => {
    setMemories(loadLongTermMemories())
    setNotifications(loadMemoryNotifications())
  }

  useEffect(() => {
    refreshData()
    const handleUpdate = () => refreshData()
    window.addEventListener('leo-memories-updated', handleUpdate)
    window.addEventListener('leo-notifications-updated', handleUpdate)
    return () => {
      window.removeEventListener('leo-memories-updated', handleUpdate)
      window.removeEventListener('leo-notifications-updated', handleUpdate)
    }
  }, [])

  const filteredMemories = memories.filter((m) => {
    if (market === 'ALL') return true
    return m.instrument.toUpperCase() === market
  })

  const filteredNotifs = notifications.filter((n) => {
    if (market === 'ALL') return true
    return n.instrument.toUpperCase() === market
  })

  const handleCreateAlarm = (e: React.FormEvent) => {
    e.preventDefault()
    const low = parseFloat(newPxLow)
    const high = parseFloat(newPxHigh || newPxLow)
    if (!Number.isFinite(low) || low <= 0) return

    const mem: LeoLongTermMemory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      instrument: newInst,
      timeframe: '1D',
      priceLow: Math.min(low, high),
      priceHigh: Math.max(low, high),
      purpose: newPurpose.trim() || 'Level observation alarm',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      triggerCount: 0,
      alarmSoundEnabled: true,
      isLongTerm: true,
    }

    saveLongTermMemory(mem)
    setNewPxLow('')
    setNewPxHigh('')
    setNewPurpose('')
    setShowAddForm(false)
    refreshData()
  }

  const handleDelete = (id: string) => {
    deleteLongTermMemory(id)
    refreshData()
  }

  const handleClearNotifs = () => {
    clearAllNotifications()
    refreshData()
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-surface-600 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Desk Notes & Alarms</h1>
            <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-mono font-semibold text-amber-300 border border-amber-500/30">
              {filteredMemories.length} Active Alarm{filteredMemories.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-400 max-w-xl leading-relaxed">
            Live price visit alarms, HTF memory notes, and notifications created when asking Leo for an alert across markets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-brand-500 transition"
          >
            {showAddForm ? 'Cancel' : '+ New Alarm Note'}
          </button>
          <Link
            href="/dashboard/chart"
            className="rounded-lg border border-sky-600/40 bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 hover:text-white transition"
          >
            Go to Chart →
          </Link>
        </div>
      </div>

      {/* Primary Component: Desk Notifications & Leo Long-Term Memories */}
      <section>
        <DashboardNotifications />
      </section>

      {/* Market Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {(['ALL', 'DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition ${
              market === m
                ? 'border-brand-500/50 bg-brand-600/30 text-brand-100'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {m === 'ALL' ? 'All Markets' : m}
          </button>
        ))}
      </div>

      {/* Add New Alarm Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateAlarm}
          className="rounded-xl border border-brand-500/30 bg-surface-800/90 p-4 space-y-4"
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-300">
            Add Alarm Note for Leo
          </h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">
                Market
              </label>
              <select
                value={newInst}
                onChange={(e) => setNewInst(e.target.value as any)}
                className="w-full rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                <option value="DOW">DOW</option>
                <option value="NASDAQ">NASDAQ</option>
                <option value="GOLD">GOLD</option>
                <option value="CRUDE">CRUDE</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">
                Price / Low Target
              </label>
              <input
                type="number"
                step="any"
                required
                placeholder="e.g. 29500"
                value={newPxLow}
                onChange={(e) => setNewPxLow(e.target.value)}
                className="w-full rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">
                High Target (Optional Range)
              </label>
              <input
                type="number"
                step="any"
                placeholder="Optional range high"
                value={newPxHigh}
                onChange={(e) => setNewPxHigh(e.target.value)}
                className="w-full rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-semibold text-gray-400 mb-1">
                Alarm Purpose / Note
              </label>
              <input
                type="text"
                placeholder="e.g. Sound chime on test of y-VAL"
                value={newPurpose}
                onChange={(e) => setNewPurpose(e.target.value)}
                className="w-full rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-surface-600 px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
            >
              Save Alarm Note
            </button>
          </div>
        </form>
      )}

      {/* Active Alarm Notes List */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
          Active Alarm Notes ({filteredMemories.length})
        </h2>

        {filteredMemories.length === 0 ? (
          <div className="rounded-xl border border-surface-600/60 bg-surface-800/40 p-8 text-center text-sm text-gray-500">
            No active alarm notes for this market. Ask Leo in chat or voice:
            <p className="mt-1 text-xs text-gray-400 italic">
              &quot;Leo, notify me when NASDAQ tests 29,500&quot; or &quot;Leo, sound alarm at Yesterday POC&quot;
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredMemories.map((mem) => {
              const isTriggered = mem.status === 'TRIGGERED'
              const low = Math.min(mem.priceLow, mem.priceHigh)
              const high = Math.max(mem.priceLow, mem.priceHigh)
              const rangeStr = low === high ? low.toLocaleString() : `${low.toLocaleString()} – ${high.toLocaleString()}`

              return (
                <div
                  key={mem.id}
                  className={`rounded-xl border p-4 transition space-y-2 ${
                    isTriggered
                      ? 'border-amber-500/50 bg-amber-950/20'
                      : 'border-surface-600 bg-surface-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-brand-500/20 px-2 py-0.5 text-xs font-bold text-brand-300 font-mono border border-brand-500/30">
                        {mem.instrument}
                      </span>
                      <span className="text-sm font-bold text-white font-mono">{rangeStr}</span>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isTriggered
                          ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40 animate-pulse'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {isTriggered ? '🔔 Triggered' : 'Active Alarm'}
                    </span>
                  </div>

                  <p className="text-xs text-gray-300 leading-snug">{mem.purpose}</p>

                  <div className="flex items-center justify-between pt-2 border-t border-surface-600/50 text-[10px] text-gray-500 font-mono">
                    <span>Triggers: {mem.triggerCount || 0}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(mem.id)}
                      className="text-red-400 hover:text-red-300 font-medium transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Alarm Notification Log */}
      {filteredNotifs.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-surface-600">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
              Alarm Activity Log ({filteredNotifs.length})
            </h2>
            <button
              type="button"
              onClick={handleClearNotifs}
              className="text-[10px] font-mono text-gray-500 hover:text-gray-300"
            >
              Clear Log
            </button>
          </div>

          <div className="space-y-2">
            {filteredNotifs.slice(0, 10).map((n) => (
              <div
                key={n.id}
                className="rounded-lg border border-surface-600/60 bg-surface-800/40 px-3 py-2 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-amber-400 font-bold">🔔 {n.instrument}</span>
                  <span className="text-white">Price hit {n.price.toLocaleString()}</span>
                  <span className="text-gray-500 text-[11px]">({n.purpose})</span>
                </div>
                <span className="text-[10px] font-mono text-gray-500">
                  {new Date(n.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
