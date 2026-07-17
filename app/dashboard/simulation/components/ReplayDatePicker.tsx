'use client'

import { useCallback, useEffect, useState } from 'react'
import { useReplayModeStore } from '@/lib/stores/replayModeStore'
import {
  getLastNNycTradingDays,
  getLastNTokyoTradingDays,
  formatDateDisplay,
  getDayName,
} from '@/lib/utils/dateUtils'
import type { AvailableDate, AvailableDatesResponse } from '@/types/trading'

function AvailabilityBadge({ date }: { date: AvailableDate }) {
  if (date.has_session) {
    return (
      <span className="text-[10px] text-orange-400 font-medium" title="Session already exists">
        resume
      </span>
    )
  }
  if (date.is_available) {
    return (
      <span className="text-[10px] text-green-400 font-medium" title="Ready to replay">
        ready
      </span>
    )
  }
  return (
    <span className="text-[10px] text-gray-600 font-medium" title="No data">
      n/a
    </span>
  )
}

interface ReplayDatePickerProps {
  onDateSelected?: (date: string) => void
}

export function ReplayDatePicker({ onDateSelected }: ReplayDatePickerProps) {
  const { selectedDate, selectedInstrument, setSelectedDate } = useReplayModeStore()
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [isLoadingDates, setIsLoadingDates] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)

  const instrument =
    selectedInstrument === 'NASDAQ'
      ? 'NASDAQ'
      : selectedInstrument === 'NIKKEI'
        ? 'NIKKEI'
        : 'DOW'

  const loadDates = useCallback(async () => {
    setIsLoadingDates(true)
    setLocalError(null)
    try {
      const response = await fetch(
        `/api/trading/replays/available-dates?instrument=${instrument}`,
        { cache: 'no-store' }
      )
      if (!response.ok) {
        throw new Error('Failed to load available dates')
      }
      const data: AvailableDatesResponse = await response.json()
      setAvailableDates(data.available_dates ?? [])
    } catch {
      const lastDays =
        instrument === 'NIKKEI' ? getLastNTokyoTradingDays(5) : getLastNNycTradingDays(5)
      setAvailableDates(
        lastDays.map((date) => ({
          date,
          is_available: true,
          has_session: false,
        }))
      )
      setLocalError(
        instrument === 'NIKKEI'
          ? 'Using local Tokyo calendar (API unavailable)'
          : 'Using local NYC calendar (API unavailable)'
      )
    } finally {
      setIsLoadingDates(false)
    }
  }, [instrument])

  useEffect(() => {
    void loadDates()
  }, [loadDates])

  const handleDateClick = (date: string) => {
    setLocalError(null)
    const dateObj = availableDates.find((d) => d.date === date)
    if (dateObj && !dateObj.is_available) {
      setLocalError('No market data available for this date')
      return
    }
    setSelectedDate(date)
    onDateSelected?.(date)
  }

  if (isLoadingDates && availableDates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        Loading last 5 NYC trading days…
      </div>
    )
  }

  if (availableDates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No trading days available
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {localError && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2 text-xs text-amber-300">
          {localError}
        </div>
      )}

      <div className="space-y-2">
        {availableDates.map((dateObj, idx) => {
          const isSelected = selectedDate === dateObj.date
          return (
            <button
              key={dateObj.date}
              type="button"
              onClick={() => handleDateClick(dateObj.date)}
              disabled={!dateObj.is_available}
              className={`w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition ${
                isSelected
                  ? 'border-brand-500 bg-brand-600/20'
                  : dateObj.is_available
                    ? 'border-surface-600 bg-surface-700/60 hover:border-brand-400'
                    : 'border-surface-800 bg-surface-900/40 opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    #{idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {formatDateDisplay(dateObj.date)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {getDayName(dateObj.date)} · opens 9:30 AM ET
                </p>
              </div>
              <AvailabilityBadge date={dateObj} />
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-600 pt-2 border-t border-surface-700">
        Only completed NYC sessions (Mon–Fri). Today is excluded until the day closes.
      </p>
    </div>
  )
}
