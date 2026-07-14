'use client'

import { useReplayModeStore } from '@/lib/stores/replayModeStore'
import type { TradingMode } from '@/types/trading'

export function ModeToggle() {
  const { mode, setMode } = useReplayModeStore()

  const handleToggle = (newMode: TradingMode) => {
    if (newMode !== mode) {
      setMode(newMode)
    }
  }

  return (
    <div className="flex items-center gap-2 bg-surface-800 border border-surface-600 rounded-lg p-1">
      <button
        onClick={() => handleToggle('live')}
        className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 ${
          mode === 'live'
            ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50'
            : 'text-gray-400 hover:text-gray-200'
        }`}
        aria-label="Switch to Live Trading mode"
        aria-pressed={mode === 'live'}
      >
        🔴 Live Trading
      </button>
      <button
        onClick={() => handleToggle('replay')}
        className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 ${
          mode === 'replay'
            ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50'
            : 'text-gray-400 hover:text-gray-200'
        }`}
        aria-label="Switch to Replay Past Day mode"
        aria-pressed={mode === 'replay'}
      >
        ⏮️ Replay Past Day
      </button>
    </div>
  )
}
