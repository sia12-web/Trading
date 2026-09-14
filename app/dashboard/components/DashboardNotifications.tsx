'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  type LeoLongTermMemory,
  type LeoMemoryNotification,
  loadLongTermMemories,
  loadMemoryNotifications,
  deleteLongTermMemory,
  markNotificationRead,
  clearAllNotifications,
} from '@/lib/trading/leoLongTermMemory'
import Link from 'next/link'

export function DashboardNotifications() {
  const [notifications, setNotifications] = useState<LeoMemoryNotification[]>([])
  const [memories, setMemories] = useState<LeoLongTermMemory[]>([])
  const [activeTab, setActiveTab] = useState<'notifications' | 'memories'>('notifications')

  const refresh = useCallback(() => {
    setNotifications(loadMemoryNotifications())
    setMemories(loadLongTermMemories())
  }, [])

  useEffect(() => {
    refresh()
    const onNotifs = () => setNotifications(loadMemoryNotifications())
    const onMems = () => setMemories(loadLongTermMemories())

    window.addEventListener('leo-notifications-updated', onNotifs)
    window.addEventListener('leo-memories-updated', onMems)
    return () => {
      window.removeEventListener('leo-notifications-updated', onNotifs)
      window.removeEventListener('leo-memories-updated', onMems)
    }
  }, [refresh])

  const unreadCount = notifications.filter((n) => !n.read).length

  const handleDismissMemory = (id: string) => {
    deleteLongTermMemory(id)
    refresh()
  }

  const handleClearNotifs = () => {
    clearAllNotifications()
    refresh()
  }

  const handleMarkRead = (id: string) => {
    markNotificationRead(id)
    refresh()
  }

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-5 space-y-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#30363d] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔔</span>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Desk Notifications &amp; Leo Long-Term Memories
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-600 text-white animate-pulse">
                  {unreadCount} new
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400">
              Live price visits to Higher Timeframe observation levels and Leo memory zones.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              className={`px-3 py-1 rounded font-semibold transition ${
                activeTab === 'notifications'
                  ? 'bg-sky-600/30 text-sky-200 font-bold'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Alerts ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('memories')}
              className={`px-3 py-1 rounded font-semibold transition ${
                activeTab === 'memories'
                  ? 'bg-purple-600/30 text-purple-200 font-bold'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              🧠 Memories ({memories.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'notifications' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Recent Level Visit Alarms</span>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={handleClearNotifs}
                className="text-[11px] text-gray-500 hover:text-gray-300 underline"
              >
                Clear all alerts
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#30363d] bg-[#0d1117]/50 p-6 text-center text-xs text-gray-500">
              No recent notifications. When live price visits any of your Leo Long-Term Memory levels, an audible TradingView chime will play and alert will appear here.
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-lg border p-3 text-xs transition ${
                    n.read
                      ? 'border-[#30363d] bg-[#0d1117]/60 text-gray-400'
                      : 'border-sky-500/50 bg-sky-950/20 text-white font-medium'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sky-400">{n.instrument}</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          Visited @ {n.price.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          (Zone: {n.priceLow.toFixed(2)} – {n.priceHigh.toFixed(2)})
                        </span>
                      </div>
                      <p className="text-gray-300 italic text-[11px]">
                        &ldquo;{n.purpose}&rdquo;
                      </p>
                      <div className="text-[10px] text-gray-500">
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {new Date(n.timestamp).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/dashboard/chart?instrument=${n.instrument}`}
                        className="rounded px-2 py-1 bg-sky-900/40 hover:bg-sky-800/60 border border-sky-700/50 text-[11px] font-semibold text-sky-200 transition"
                      >
                        Chart →
                      </Link>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={() => handleMarkRead(n.id)}
                          className="rounded px-2 py-1 bg-[#161b22] hover:bg-[#30363d] text-[11px] text-gray-400 hover:text-white transition"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Higher Timeframe Daily Long-Term Memories</span>
            <Link
              href="/dashboard/chart"
              className="text-[11px] text-purple-400 hover:text-purple-300 font-semibold"
            >
              + Draw New Range on Chart
            </Link>
          </div>

          {memories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#30363d] bg-[#0d1117]/50 p-6 text-center text-xs text-gray-500 space-y-1">
              <p>No active Long-Term Memories.</p>
              <p className="text-[11px] text-gray-600">
                To create one, switch to Daily (1D) on the chart, select Draw: Range Box, and click &ldquo;🧠 Activate Long-Term Memory&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {memories.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-purple-900/40 bg-purple-950/10 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-purple-300">{m.instrument}</span>
                        <span className="px-1.5 py-0.5 rounded bg-purple-900/50 border border-purple-700/40 text-[10px] font-semibold text-purple-200">
                          {m.timeframe}
                        </span>
                        <span className="font-mono text-white font-bold">
                          {m.priceLow.toFixed(2)} – {m.priceHigh.toFixed(2)}
                        </span>
                        {m.alarmSoundEnabled && (
                          <span className="text-[10px] text-amber-400" title="TradingView Chime Armed">
                            🔔 Alarm Active
                          </span>
                        )}
                      </div>
                      <p className="text-gray-300 mt-1 text-[11px]">
                        <strong>Purpose:</strong> {m.purpose}
                      </p>
                      {m.notes && (
                        <p className="text-gray-400 text-[10px]">
                          <strong>Notes:</strong> {m.notes}
                        </p>
                      )}
                      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-3">
                        <span>Created: {new Date(m.createdAt).toLocaleDateString()}</span>
                        {m.triggerCount > 0 && (
                          <span className="text-emerald-400 font-semibold">
                            Visited {m.triggerCount} time{m.triggerCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/dashboard/chart?instrument=${m.instrument}`}
                        className="rounded px-2 py-1 bg-purple-900/40 hover:bg-purple-800/60 border border-purple-700/50 text-[11px] font-semibold text-purple-200 transition"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDismissMemory(m.id)}
                        className="rounded px-2 py-1 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-[11px] text-rose-300 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
