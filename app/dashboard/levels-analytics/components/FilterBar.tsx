'use client'

import type { Instrument } from '@/types/analytics'

interface FilterBarProps {
  instrument: Instrument
  days: number
  onInstrumentChange: (instrument: Instrument) => void
  onDaysChange: (days: number) => void
  disabled: boolean
}

export function FilterBar({
  instrument,
  days,
  onInstrumentChange,
  onDaysChange,
  disabled,
}: FilterBarProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
      <div className="flex flex-col md:flex-row gap-6 items-end">
        {/* Instrument Selector */}
        <div className="flex-1">
          <label htmlFor="instrument" className="block text-sm font-medium text-gray-700 mb-2">
            Instrument
          </label>
          <select
            id="instrument"
            value={instrument}
            onChange={(e) => onInstrumentChange(e.target.value as Instrument)}
            disabled={disabled}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          >
            <option value="DOW">DOW</option>
            <option value="NASDAQ">NASDAQ</option>
            <option value="NIKKEI">NIKKEI</option>
          </select>
        </div>

        {/* Days Range */}
        <div className="flex-1">
          <label htmlFor="days" className="block text-sm font-medium text-gray-700 mb-2">
            Days ({days})
          </label>
          <input
            id="days"
            type="range"
            min="1"
            max="90"
            value={days}
            onChange={(e) => onDaysChange(parseInt(e.target.value))}
            disabled={disabled}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1 day</span>
            <span>90 days</span>
          </div>
        </div>

        {/* Days Input */}
        <div className="flex-1">
          <label htmlFor="days-input" className="block text-sm font-medium text-gray-700 mb-2">
            Or enter days
          </label>
          <input
            id="days-input"
            type="number"
            min="1"
            max="90"
            value={days}
            onChange={(e) => {
              const val = parseInt(e.target.value)
              if (val >= 1 && val <= 90) {
                onDaysChange(val)
              }
            }}
            disabled={disabled}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  )
}
