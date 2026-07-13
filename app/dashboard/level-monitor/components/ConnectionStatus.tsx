'use client'

import React from 'react'
import type { ConnectionState } from '@/lib/services/connectionManager'
import type { FallbackMode } from '@/lib/services/fallbackManager'

interface ConnectionStatusProps {
  connectionState: ConnectionState
  fallbackMode: FallbackMode
  dataAge: number | null
  errorMessage: string | null
  onRetry?: () => void
}

export const ConnectionStatus = React.memo(function ConnectionStatus({
  connectionState,
  fallbackMode,
  dataAge,
  errorMessage,
  onRetry,
}: ConnectionStatusProps) {
  // Fully live – hide the banner entirely to keep UI clean
  if (connectionState === 'connected' && fallbackMode === 'realtime') return null

  const ageDisplay = (() => {
    if (!dataAge) return ''
    const s = Math.floor(dataAge / 1000)
    return s < 60 ? `${s}s old` : `${Math.floor(s / 60)}m old`
  })()

  const configs = {
    connecting:   { label: 'Connecting…',          dot: 'bg-blue-400 animate-pulse', bar: 'bg-blue-900/30 border-blue-700/40 text-blue-400' },
    reconnecting: { label: 'Reconnecting…',         dot: 'bg-yellow-400 animate-pulse', bar: 'bg-yellow-900/20 border-yellow-700/40 text-yellow-400' },
    offline:      { label: 'Offline',               dot: 'bg-red-400', bar: 'bg-red-900/20 border-red-700/40 text-red-400' },
    failed:       { label: 'Connection failed',     dot: 'bg-red-500', bar: 'bg-red-900/20 border-red-700/40 text-red-400' },
    disconnected: { label: 'Disconnected',          dot: 'bg-gray-500', bar: 'bg-surface-700 border-surface-500 text-gray-400' },
    connected:    { label: `Using ${fallbackMode}`, dot: 'bg-orange-400', bar: 'bg-orange-900/20 border-orange-700/40 text-orange-400' },
  }

  const cfg = configs[connectionState] ?? configs.disconnected

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm ${cfg.bar}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className="font-medium flex-1">
        {cfg.label}
        {ageDisplay && <span className="ml-2 opacity-70 text-xs">· Data {ageDisplay}</span>}
        {errorMessage && <span className="ml-2 opacity-70 text-xs">· {errorMessage}</span>}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-auto text-xs font-semibold px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition"
          aria-label="Retry connection"
        >
          Retry
        </button>
      )}
    </div>
  )
})
