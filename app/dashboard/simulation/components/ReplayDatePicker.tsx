'use client'

import { useState, useEffect } from 'react'
import { useReplayModeStore } from '@/lib/stores/replayModeStore'
import { AvailabilityBadge } from './AvailabilityBadge'
import {
  getLastNDays,
  formatDateDisplay,
  getDayName,
  getDaysAgo,
  isToday,
} from '@/lib/utils/dateUtils'
import type { AvailableDate } from '@/types/trading'

interface ReplayDatePickerProps {
  onDateSelected?: (date: string) => void
}

export function ReplayDatePicker({ onDateSelected }: ReplayDatePickerProps) {
  const {
    selectedDate,
    selectedInstrument,
    availableDates,
    isLoadingDates,
    lastFetchedInstrument,
    setSelectedDate,
    setAvailableDates,
    setIsLoadingDates,
    setLastFetchedInstrument,
    setError,
  } = useReplayModeStore()

  const [localError, setLocalError] = useState<string | null>(null)

  // Fetch available dates when instrument changes
  useEffect(() => {
    if (selectedInstrument === lastFetchedInstrument && availableDates.length > 0) {
      return // Already fetched for this instrument
    }

    async function fetchAvailableDates() {
      setIsLoadingDates(true)
      setLocalError(null)

      try {
        const response = await fetch(
          `/api/trading/replays/available-dates?instrument=${selectedInstrument}`
        )

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to fetch available dates')
        }

        const data = await response.json()
        setAvailableDates(data.available_dates)
        setLastFetchedInstrument(selectedInstrument)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setLocalError(message)
        setError(message)

        // Fallback: generate last 30 days assuming all available
        const lastDays = getLastNDays(30)
        const fallbackDates: AvailableDate[] = lastDays.map(date => ({
          date,
          is_available: true,
          has_session: false,
        }))
        setAvailableDates(fallbackDates)
      } finally {
        setIsLoadingDates(false)
      }
    }

    fetchAvailableDates()
  }, [selectedInstrument, lastFetchedInstrument])

  const handleDateClick = (date: string) => {
    // Validate date format before accepting
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(date)) {
      setLocalError('Invalid date format')
      return
    }

    const dateObj = availableDates.find(d => d.date === date)
    if (dateObj && !dateObj.is_available) {
      setLocalError('No market data available for this date')
      return
    }

    setSelectedDate(date)
    onDateSelected?.(date)
  }

  // If loading and no dates yet, show loading state
  if (isLoadingDates && availableDates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-2xl mb-2">⏳</div>
        <p>Loading available dates...</p>
      </div>
    )
  }

  // If no dates at all, show fallback message
  if (availableDates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-2xl mb-2">📅</div>
        <p>No dates loaded</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Error message */}
      {localError && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
          ⚠️ {localError}
        </div>
      )}

      {/* Calendar grid */}
      <div className="space-y-2">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-2 mb-2 text-xs text-gray-500 font-semibold uppercase tracking-wider">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar dates */}
        <div className="grid grid-cols-7 gap-2">
          {availableDates.map(dateObj => {
            const dayName = getDayName(dateObj.date)
            const daysAgo = getDaysAgo(dateObj.date)
            const isTodayDate = isToday(dateObj.date)
            const isSelectedDate = selectedDate === dateObj.date

            return (
              <button
                key={dateObj.date}
                onClick={() => handleDateClick(dateObj.date)}
                disabled={!dateObj.is_available}
                className={`relative aspect-square rounded-lg border-2 transition-all duration-150 ${
                  isSelectedDate
                    ? 'border-brand-500 bg-brand-600/20 shadow-lg'
                    : dateObj.is_available
                      ? 'border-surface-600 hover:border-brand-400 bg-surface-700 cursor-pointer'
                      : 'border-surface-700 bg-surface-800/50 cursor-not-allowed opacity-50'
                }`}
                title={formatDateDisplay(dateObj.date)}
              >
                {/* Date number and label */}
                <div className="flex flex-col items-center justify-center h-full text-xs font-semibold">
                  {isTodayDate ? (
                    <>
                      <span className="text-white text-sm">Today</span>
                      <span className="text-gray-500 text-xs">{dayName}</span>
                    </>
                  ) : daysAgo === 1 ? (
                    <>
                      <span className="text-white text-sm">Yest</span>
                      <span className="text-gray-500 text-xs">{dayName}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-white">{daysAgo}d ago</span>
                      <span className="text-gray-500">{dayName}</span>
                    </>
                  )}
                </div>

                {/* Availability badge */}
                <AvailabilityBadge date={dateObj} />
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-surface-600 space-y-2 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <span className="text-green-400">✅</span>
          <span>Market data available</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-orange-400">🔄</span>
          <span>Replay session already created</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600">❌</span>
          <span>No market data available</span>
        </div>
      </div>
    </div>
  )
}
