'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LevelCard } from './LevelCard'
import { ConnectionStatus } from './ConnectionStatus'
import { PriceChart } from './PriceChart'
import { getConnectionManager } from '@/lib/services/connectionManager'
import { getFallbackManager } from '@/lib/services/fallbackManager'
import { getHealthChecker } from '@/lib/services/healthChecker'
import { getPriceHistoryManager } from '@/lib/services/priceHistoryManager'
import { validateRealtimePayload } from '@/lib/utils/validation'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'
import type { ConnectionState } from '@/lib/services/connectionManager'
import type { FallbackMode } from '@/lib/services/fallbackManager'
import type { PricePoint } from '@/lib/services/priceHistoryManager'

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

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

const INSTRUMENT_META: Record<Instrument, { label: string; color: string; desc: string }> = {
  DOW:    { label: 'Dow Jones', color: '#3b7eff', desc: 'DJIA · US 30' },
  NASDAQ: { label: 'NASDAQ',    color: '#a78bfa', desc: 'Composite · Tech' },
  NIKKEI: { label: 'Nikkei',    color: '#34d399', desc: 'N225 · Japan' },
}

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  unvisited:  { label: 'Unvisited',  color: 'text-gray-400',   dot: 'bg-gray-500' },
  approaching:{ label: 'Approaching',color: 'text-yellow-400', dot: 'bg-yellow-400' },
  touched:    { label: 'Touched',    color: 'text-brand-400',  dot: 'bg-brand-400' },
  broken:     { label: 'Broken',     color: 'text-red-400',    dot: 'bg-red-400' },
  bounced:    { label: 'Bounced',    color: 'text-purple-400', dot: 'bg-purple-400' },
  rejected:   { label: 'Rejected',   color: 'text-orange-400', dot: 'bg-orange-400' },
}

export function LevelMonitorWidget({ initialData }: Props) {
  const [activeInstrument, setActiveInstrument] = useState<Instrument>('DOW')
  const [instrumentData, setInstrumentData] = useState<Map<Instrument, InstrumentData>>(
    new Map(initialData.map((d) => [d.instrument, d]))
  )
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [fallbackMode, setFallbackMode] = useState<FallbackMode>('realtime')
  const [dataAge, setDataAge] = useState<number | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [priceHistory, setPriceHistory] = useState<Map<Instrument, PricePoint[]>>(new Map())

  useEffect(() => {
    const supabase = createClient()
    const connectionManager = getConnectionManager()
    const fallbackManager = getFallbackManager()
    const healthChecker = getHealthChecker()

    let realtimeSubscribed = false
    const channelName = `level_status:${activeInstrument}`
    const channel = supabase.realtime.channel(channelName)

    const setupRealtimeSubscription = (): (() => void) => {
      try {
        connectionManager.markConnecting()

        channel
          .on('broadcast', { event: 'status_update' }, (payload) => {
            try {
              // Validate realtime payload
              const update = validateRealtimePayload(payload.payload)

              fallbackManager.cacheData(activeInstrument, update)

              if (!realtimeSubscribed) {
                realtimeSubscribed = true
                connectionManager.markConnected()
                setConnectionState('connected')
                setFallbackMode('realtime')
                setIsInitialLoad(false)
              }

              setInstrumentData((prev) => {
                const newData = new Map(prev)
                const current = newData.get(activeInstrument)

                if (current) {
                  const updatedLevels = current.levels.map((level) => {
                    const changedLevel = update.changedLevels?.find((cl) => cl.level === level.level)
                    return changedLevel
                      ? { ...level, status: changedLevel.status, proximity: changedLevel.proximity, distance: changedLevel.distance }
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
            } catch (err) {
              if (process.env.NODE_ENV === 'development') {
                logger.error('[LevelMonitorWidget] Invalid realtime payload:', err)
              }
              setError('Received invalid data from server')
            }
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              realtimeSubscribed = true
              connectionManager.markConnected()
              setConnectionState('connected')
              fallbackManager.recoverToRealtime()
              setFallbackMode('realtime')
            } else if (status === 'CHANNEL_ERROR') {
              connectionManager.markFailed(new Error('Channel subscription error'))
              setConnectionState('reconnecting')
              fallbackManager.activatePolling('Realtime channel error')
              setFallbackMode('polling')
              setError('Connection lost. Switching to polling...')
            }
          })

        // Subscribe to price updates for chart
        const priceChannelName = `price_updates:${activeInstrument}`
        const priceChannel = supabase.realtime.channel(priceChannelName)

        priceChannel
          .on('broadcast', { event: 'price_update' }, (payload) => {
            try {
              const priceUpdate = payload.payload as any

              // Validate price update
              if (typeof priceUpdate.price !== 'number' || priceUpdate.price <= 0) {
                logger.debug('[LevelMonitorWidget] Invalid price update:', priceUpdate)
                return
              }

              // Add to price history
              const historyManager = getPriceHistoryManager()
              historyManager.addPrice(activeInstrument, priceUpdate.price, new Date(priceUpdate.timestamp))

              // Update chart
              setPriceHistory(new Map([[activeInstrument, historyManager.getHistory(activeInstrument)]]))
            } catch (err) {
              logger.error('[LevelMonitorWidget] Error processing price update:', err)
            }
          })
          .subscribe()

        return () => {
          channel.unsubscribe()
          priceChannel.unsubscribe()
        }
      } catch (err) {
        connectionManager.markFailed(err instanceof Error ? err : new Error(String(err)))
        setConnectionState('reconnecting')
        fallbackManager.activatePolling('Realtime setup failed')
        setFallbackMode('polling')
        setError('Failed to establish connection')
        return () => {}
      }
    }

    const unsubscribeFallback = fallbackManager.onStatusChange((status) => {
      setFallbackMode(status.mode)
      const age = status.dataAge.get(activeInstrument) || 0
      setDataAge(age)
      setError(status.mode === 'error' ? 'Connection lost and fallback failed' : null)
    })

    const unsubscribeHealth = healthChecker.onFailure((instrument) => {
      if (instrument === activeInstrument && fallbackManager.getMode() === 'realtime') {
        fallbackManager.activatePolling('Health check failed')
        setFallbackMode('polling')
      }
    })

    let cleanupReconnect: (() => void) | null = null
    const unsubscribeReconnect = connectionManager.onReconnectNeeded(() => {
      if (cleanupReconnect) cleanupReconnect()
      connectionManager.markConnecting()
      setConnectionState('connecting')
      realtimeSubscribed = false
      cleanupReconnect = setupRealtimeSubscription()
    })

    healthChecker.start()
    const unsubscribeRealtime = setupRealtimeSubscription()

    return () => {
      unsubscribeRealtime()
      unsubscribeFallback()
      unsubscribeHealth()
      unsubscribeReconnect()
      if (cleanupReconnect) cleanupReconnect()
      healthChecker.stop()
    }
  }, [activeInstrument])

  const currentData = instrumentData.get(activeInstrument)

  let displayData: InstrumentData | undefined = currentData
  if (!displayData) {
    const cached = getFallbackManager().getCachedData(activeInstrument)
    if (cached) displayData = cached.data as InstrumentData
  }

  const meta = INSTRUMENT_META[activeInstrument]
  const levels = displayData?.levels ?? []
  const currentPrice = displayData?.currentPrice ?? null

  // Stats
  const criticalCount = levels.filter(l => l.status !== 'unvisited' && l.proximity !== 'far').length
  const nearestLevel = levels
    .filter(l => l.distance > 0)
    .sort((a, b) => a.distance - b.distance)[0]

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Connection banner */}
      <ConnectionStatus
        connectionState={connectionState}
        fallbackMode={fallbackMode}
        dataAge={dataAge}
        errorMessage={error}
        onRetry={connectionState === 'failed' ? () => {
          setError(null)
          getConnectionManager().markRecovering()
          getFallbackManager().recoverToRealtime()
          setConnectionState('reconnecting')
        } : undefined}
      />

      {/* Instrument tabs + price hero */}
      <div className="card p-5">
        {/* Tabs */}
        <div className="tab-bar w-fit mb-5">
          {INSTRUMENTS.map((inst) => (
            <button
              key={inst}
              onClick={() => setActiveInstrument(inst)}
              className={`tab ${activeInstrument === inst ? 'tab-active' : ''}`}
              aria-label={`Switch to ${inst}`}
              aria-current={activeInstrument === inst ? 'page' : undefined}
            >
              {inst}
            </button>
          ))}
        </div>

        {/* Price Hero */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-6">
          <div className="flex-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              {meta.desc}
            </div>
            <div className="flex items-baseline gap-3">
              {currentPrice ? (
                <>
                  <span className="text-5xl font-bold price-mono text-white" style={{ color: meta.color }}>
                    {currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </>
              ) : (
                <span className="text-3xl font-bold text-gray-600 price-mono">— Awaiting price</span>
              )}
            </div>
            {displayData?.timestamp && (
              <div className="text-xs text-gray-600 mt-2">
                Updated {new Date(displayData.timestamp).toLocaleTimeString()}
                {fallbackMode !== 'realtime' && (
                  <span className="ml-2 text-yellow-500">· {fallbackMode} mode</span>
                )}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex gap-4 flex-wrap">
            <div className="stat-block min-w-[110px]">
              <div className="stat-label">Levels tracked</div>
              <div className="stat-value text-white">{levels.length}</div>
            </div>
            <div className="stat-block min-w-[110px]">
              <div className="stat-label">Critical zones</div>
              <div className={`stat-value ${criticalCount > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                {criticalCount}
              </div>
            </div>
            {nearestLevel && (
              <div className="stat-block min-w-[130px]">
                <div className="stat-label">Nearest level</div>
                <div className="stat-value text-white price-mono">
                  {nearestLevel.level.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{nearestLevel.distancePct.toFixed(2)}% away</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Real-time price chart */}
      {currentPrice && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Price Action
          </h2>
          <PriceChart
            priceHistory={priceHistory.get(activeInstrument) || []}
            levels={levels}
            accentColor={meta.color}
            height={350}
          />
        </div>
      )}

      {/* Levels grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Key Levels</h2>
          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap">
            {Object.entries(STATUS_META).slice(0, 4).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${val.dot}`} />
                <span className="text-xs text-gray-500">{val.label}</span>
              </div>
            ))}
          </div>
        </div>

        {levels.length === 0 || !currentPrice || currentPrice <= 0 ? (
          <div className="card p-12 text-center">
            {isInitialLoad ? (
              <>
                <div className="animate-pulse text-brand-400 text-2xl mb-2">●</div>
                <div className="text-gray-600">Connecting to live feed…</div>
              </>
            ) : (
              <div className="text-gray-600">No level data yet. Waiting for price feed…</div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
            {levels.map((level) => (
              <LevelCard
                key={level.level}
                level={level}
                currentPrice={currentPrice}
                accentColor={meta.color}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="card-sm px-5 py-4 flex flex-wrap gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
          <strong className="text-gray-400">Approaching</strong> — within 5%
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
          <strong className="text-gray-400">At level</strong> — within 1%
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <strong className="text-gray-400">Breached</strong> — within 0.1%
        </div>
      </div>
    </div>
  )
}
