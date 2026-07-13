'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LevelCard } from './LevelCard'
import { EmptyState } from './States'
import { ConnectionStatus } from './ConnectionStatus'
import { getConnectionManager } from '@/lib/services/connectionManager'
import { getFallbackManager } from '@/lib/services/fallbackManager'
import { getHealthChecker } from '@/lib/services/healthChecker'
import type { Instrument, ChangedLevel } from '@/types/price-feed'
import type { ConnectionState } from '@/lib/services/connectionManager'
import type { FallbackMode } from '@/lib/services/fallbackManager'

interface LevelData {
  level: number
  status: string
  proximity: string
  distance: number
  distancePct: number
  bounceCount: number
  touchedAt: string | null
  brokenAt: string | null
  lastTouchPrice: number | null
}

interface InstrumentData {
  instrument: Instrument
  currentPrice: number | null
  levels: LevelData[]
  timestamp: string
}

interface Props {
  initialData: InstrumentData[]
}

export function LevelMonitorWidget({ initialData }: Props) {
  const [activeInstrument, setActiveInstrument] = useState<Instrument>('DOW')
  const [instrumentData, setInstrumentData] = useState<Map<Instrument, InstrumentData>>(
    new Map(initialData.map((data) => [data.instrument, data]))
  )
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [fallbackMode, setFallbackMode] = useState<FallbackMode>('realtime')
  const [dataAge, setDataAge] = useState<number | null>(null)

  // Subscribe to Realtime updates with fallback and connection management
  useEffect(() => {
    const supabase = createClient()
    const connectionManager = getConnectionManager()
    const fallbackManager = getFallbackManager()
    const healthChecker = getHealthChecker()

    let realtimeSubscribed = false
    const channelName = `level_status:${activeInstrument}`
    const channel = supabase.realtime.channel(channelName)

    // Handle Realtime subscription
    const setupRealtimeSubscription = (): (() => void) => {
      try {
        connectionManager.markConnecting()

        channel
          .on('broadcast', { event: 'status_update' }, (payload) => {
            const update = payload.payload

            // Cache data for fallback
            fallbackManager.cacheData(activeInstrument, update)

            // Mark connection as healthy
            if (!realtimeSubscribed) {
              realtimeSubscribed = true
              connectionManager.markConnected()
              setConnectionState('connected')
              setFallbackMode('realtime')
            }

            setInstrumentData((prev) => {
              const newData = new Map(prev)
              const current = newData.get(activeInstrument)

              if (current) {
                // Update the levels that changed
                const updatedLevels = current.levels.map((level) => {
                  const changedLevel = update.changedLevels.find(
                    (cl: ChangedLevel) => cl.level === level.level
                  )
                  return changedLevel
                    ? {
                        ...level,
                        status: changedLevel.status,
                        proximity: changedLevel.proximity,
                        distance: changedLevel.distance,
                      }
                    : level
                })

                newData.set(activeInstrument, {
                  ...current,
                  currentPrice: update.currentPrice,
                  levels: updatedLevels,
                  timestamp: update.timestamp,
                })
              }

              return newData
            })
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.debug(`[LevelMonitor] Subscribed to ${activeInstrument}`)
              realtimeSubscribed = true
              connectionManager.markConnected()
              setConnectionState('connected')
              fallbackManager.recoverToRealtime()
              setFallbackMode('realtime')
            } else if (status === 'CHANNEL_ERROR') {
              console.error(`[LevelMonitor] Channel error for ${activeInstrument}`)
              connectionManager.markFailed(new Error('Channel subscription error'))
              setConnectionState('reconnecting')
              fallbackManager.activatePolling('Realtime channel error')
              setFallbackMode('polling')
              setError('Connection lost. Switching to polling...')
            }
          })

        return () => {
          channel.unsubscribe()
        }
      } catch (err) {
        console.error('[LevelMonitor] Realtime setup failed:', err)
        connectionManager.markFailed(err instanceof Error ? err : new Error(String(err)))
        setConnectionState('reconnecting')
        fallbackManager.activatePolling('Realtime setup failed')
        setFallbackMode('polling')
        setError('Failed to establish connection')

        return () => {} // Return empty cleanup function on error
      }
    }

    // Listen to fallback status changes
    const unsubscribeFallback = fallbackManager.onStatusChange((status) => {
      setFallbackMode(status.mode)
      const currentData = status.dataAge.get(activeInstrument) || 0
      setDataAge(currentData)

      if (status.mode === 'error') {
        setError('Connection lost and fallback failed')
      } else if (status.mode !== 'realtime') {
        setError(null)
      }
    })

    // Listen to health check failures
    const unsubscribeHealth = healthChecker.onFailure((instrument) => {
      if (instrument === activeInstrument) {
        console.warn(`[LevelMonitor] Health check failed for ${instrument}`)
        // Trigger fallback if health check fails
        if (fallbackManager.getMode() === 'realtime') {
          fallbackManager.activatePolling('Health check failed')
          setFallbackMode('polling')
        }
      }
    })

    // Start health checks
    healthChecker.start()

    // Setup Realtime subscription
    const unsubscribeRealtime = setupRealtimeSubscription()

    return () => {
      unsubscribeRealtime()
      unsubscribeFallback()
      unsubscribeHealth()
      healthChecker.stop()
    }
  }, [activeInstrument])

  const currentData = instrumentData.get(activeInstrument)
  const fallbackManager = getFallbackManager()

  // Try to use fallback data if Realtime data unavailable
  let displayData = currentData
  if (!displayData && fallbackMode !== 'realtime') {
    const cached = fallbackManager.getCachedData(activeInstrument)
    if (cached) {
      displayData = cached.data
    }
  }

  if (!displayData) {
    return <EmptyState message="No level data available for this instrument" />
  }

  const hasCriticalLevels = displayData.levels.some(
    (l) => l.status !== 'unvisited' && l.proximity !== 'far'
  )

  const handleRetry = () => {
    setError(null)
    fallbackManager.recoverToRealtime()
    setConnectionState('reconnecting')
  }

  return (
    <div className="space-y-6">
      {/* Connection Status Indicator */}
      <ConnectionStatus
        connectionState={connectionState}
        fallbackMode={fallbackMode}
        dataAge={dataAge}
        errorMessage={error}
        onRetry={connectionState === 'failed' ? handleRetry : undefined}
      />

      {/* Instrument Tabs */}
      <div className="flex gap-2 border-b border-gray-200 bg-white rounded-t-lg p-4">
        {(['DOW', 'NASDAQ', 'NIKKEI'] as const).map((instrument) => (
          <button
            key={instrument}
            onClick={() => setActiveInstrument(instrument)}
            className={`px-4 py-2 font-semibold transition-all rounded-t-lg border-b-2 ${
              activeInstrument === instrument
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {instrument}
          </button>
        ))}
      </div>

      {/* Current Price Display */}
      {displayData.currentPrice && (
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-8 rounded-lg shadow-lg">
          <div className="text-sm font-semibold opacity-90 mb-2">Current Price</div>
          <div className="text-5xl font-bold mb-4">
            {displayData.currentPrice.toFixed(2)}
          </div>
          <div className="text-xs opacity-75">
            Last updated: {new Date(displayData.timestamp).toLocaleTimeString()}
            {fallbackMode !== 'realtime' && ` • ${fallbackMode} mode`}
          </div>
        </div>
      )}

      {/* Levels List */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-800">Key Levels</h2>
          <div className="text-sm text-gray-500">
            {displayData.levels.length} levels tracked
          </div>
        </div>

        {!hasCriticalLevels && displayData.levels.length === 0 ? (
          <EmptyState message="No level data yet. Monitoring will start when price data arrives." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {displayData.levels.map((level) => (
              <LevelCard
                key={level.level}
                level={level}
                currentPrice={displayData.currentPrice || 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <div className="font-semibold mb-2">Real-time Monitoring Active</div>
        <div className="opacity-90">
          Updates arrive instantly as price changes. Levels are categorized by proximity:
          <ul className="list-disc list-inside mt-2 space-y-1 opacity-75">
            <li>
              <span className="font-medium">Approaching:</span> Within 5% of level
            </li>
            <li>
              <span className="font-medium">At:</span> Within 1% of level
            </li>
            <li>
              <span className="font-medium">Breached:</span> Within 0.1% of level
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
