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
  // Connected via Realtime
  if (connectionState === 'connected' && fallbackMode === 'realtime') {
    return (
      <div className="bg-green-50 border border-green-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-sm font-medium text-green-700">Live updates active</span>
        </div>
      </div>
    )
  }

  // Connecting
  if (connectionState === 'connecting') {
    return (
      <div className="bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-spin"></span>
          <span className="text-sm font-medium text-blue-700">Connecting...</span>
        </div>
      </div>
    )
  }

  // Reconnecting
  if (connectionState === 'reconnecting') {
    return (
      <div className="bg-yellow-50 border border-yellow-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-yellow-500 rounded-full animate-spin"></span>
          <span className="text-sm font-medium text-yellow-700">Reconnecting...</span>
        </div>
      </div>
    )
  }

  // Polling mode (fallback)
  if (fallbackMode === 'polling') {
    const ageSeconds = dataAge ? Math.floor(dataAge / 1000) : 0
    const ageDisplay = ageSeconds < 60 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`

    return (
      <div className="bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full"></span>
          <span className="text-sm font-medium text-blue-700">
            Polling mode • Data {ageDisplay} old
          </span>
        </div>
      </div>
    )
  }

  // Cached data mode (fallback)
  if (fallbackMode === 'cached') {
    const ageSeconds = dataAge ? Math.floor(dataAge / 1000) : 0
    const ageDisplay = ageSeconds < 60 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`

    return (
      <div className="bg-orange-50 border border-orange-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-orange-500 rounded-full"></span>
          <span className="text-sm font-medium text-orange-700">
            Using cached data • {ageDisplay} old
          </span>
        </div>
      </div>
    )
  }

  // Offline
  if (connectionState === 'offline') {
    return (
      <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-block w-2 h-2 bg-red-500 rounded-full"></span>
          <span className="text-sm font-medium text-red-700">You appear to be offline</span>
        </div>
      </div>
    )
  }

  // Failed
  if (connectionState === 'failed') {
    return (
      <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 bg-red-500 rounded-full"></span>
            <span className="text-sm font-medium text-red-700">Connection failed</span>
          </div>
          {errorMessage && (
            <div className="text-xs text-red-600 ml-4">{errorMessage}</div>
          )}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="bg-red-600 text-white px-3 py-1 rounded text-xs font-semibold hover:bg-red-700 transition flex-shrink-0"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  // Disconnected (intentional)
  return (
    <div className="bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 flex items-center gap-3">
      <div className="flex items-center gap-2 flex-1">
        <span className="inline-block w-2 h-2 bg-gray-500 rounded-full"></span>
        <span className="text-sm font-medium text-gray-700">Disconnected</span>
      </div>
    </div>
  )
})
