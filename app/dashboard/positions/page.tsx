'use client'

/**
 * Position Management Dashboard
 * Real-time position display with live P&L calculations
 */

import { useEffect, useState } from 'react'
import { PositionStatusCard } from './components/PositionStatusCard'
import type { PositionStatusResponse, PositionStatus } from '@/types/positionManagement'
import type { Instrument } from '@/types/trading'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

export default function PositionsPage() {
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument>('DOW')
  const [position, setPosition] = useState<PositionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch position on mount and when instrument changes
  useEffect(() => {
    const fetchPosition = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(
          `/api/trading/positions/management-status?instrument=${selectedInstrument}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch position')
        }

        const data: PositionStatusResponse = await response.json()

        if (data.success) {
          setPosition(data.position)
        } else {
          setError(data.message)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchPosition()
  }, [selectedInstrument])

  return (
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Position Management</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Real-time position tracking with live P&L updates
          </p>
        </div>

        {/* Instrument Selector */}
        <div className="mb-8 flex gap-3">
          {INSTRUMENTS.map((instrument) => (
            <button
              key={instrument}
              onClick={() => setSelectedInstrument(instrument)}
              className={`rounded-lg px-4 py-2 font-semibold transition-colors ${
                selectedInstrument === instrument
                  ? 'bg-blue-600 text-white dark:bg-blue-500'
                  : 'bg-white text-gray-900 hover:bg-gray-100 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700'
              }`}
            >
              {instrument}
            </button>
          ))}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-center space-x-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading position data...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
            <h3 className="font-semibold text-red-900 dark:text-red-200">Error</h3>
            <p className="mt-2 text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
            >
              Retry
            </button>
          </div>
        )}

        {/* Position Card */}
        {!loading && !error && (
          <PositionStatusCard position={position} />
        )}

        {/* Info Box */}
        <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-900/20">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200">How it works</h3>
          <ul className="mt-3 space-y-2 text-sm text-blue-800 dark:text-blue-300">
            <li>
              ✓ <strong>Real-time P&L:</strong> Updated live from market prices with &lt;100ms latency
            </li>
            <li>
              ✓ <strong>Stop Loss Monitoring:</strong> Automatically closes position if price breaches SL
            </li>
            <li>
              ✓ <strong>Profit Target:</strong> Calculated based on market regime confidence
            </li>
            <li>
              ✓ <strong>Management Decisions:</strong> Record HOLD, TAKE_PROFIT, ADJUST decisions
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
