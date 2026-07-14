'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useReplayModeStore } from '@/lib/stores/replayModeStore'
import { ModeToggle } from './components/ModeToggle'
import { ReplayDatePicker } from './components/ReplayDatePicker'
import { formatDateDisplay } from '@/lib/utils/dateUtils'
import type { Instrument, CreateReplaySessionRequest } from '@/types/trading'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
const PLAYBACK_SPEEDS = [1, 2, 4, 16] as const

export default function SimulationPage() {
  const router = useRouter()
  const {
    mode,
    selectedDate,
    selectedInstrument,
    setSelectedInstrument,
    loadFromLocalStorage,
  } = useReplayModeStore()

  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 4 | 16>(1)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Load persisted state on mount
  useEffect(() => {
    loadFromLocalStorage()
  }, [loadFromLocalStorage])

  const handleInstrumentChange = (instrument: Instrument) => {
    setSelectedInstrument(instrument)
  }

  const handlePlayReplay = async () => {
    if (!selectedDate) {
      setMessage({ type: 'error', text: 'Please select a date to replay' })
      return
    }

    if (mode !== 'replay') {
      setMessage({ type: 'error', text: 'Switch to Replay mode first' })
      return
    }

    setIsCreatingSession(true)
    setMessage(null)

    try {
      const request: CreateReplaySessionRequest = {
        instrument: selectedInstrument,
        replay_date: selectedDate,
        playback_speed: playbackSpeed,
      }

      const response = await fetch('/api/trading/replays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const data = await response.json()

      if (!response.ok) {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to create replay session',
        })
        setIsCreatingSession(false)
        return
      }

      // Success
      setMessage({
        type: 'success',
        text: `Replay session created! Starting replay of ${selectedInstrument} on ${formatDateDisplay(selectedDate)} at ${playbackSpeed}x speed...`,
      })

      // Reset loading state and redirect to replay player after short delay
      setIsCreatingSession(false)
      setTimeout(() => {
        router.push(`/dashboard/simulation/replay/${data.id}`)
      }, 1500)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setMessage({ type: 'error', text: message })
      setIsCreatingSession(false)
    }
  }

  const isLiveMode = mode === 'live'

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Market Simulation</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isLiveMode
            ? 'Practice with real-time live market data'
            : 'Replay historical market data and train on past days'}
        </p>
      </div>

      {/* Mode Selector */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Trading Mode
            </h2>
            <p className="text-xs text-gray-600">
              {isLiveMode
                ? 'Currently trading with live market data'
                : 'Replaying historical market data'}
            </p>
          </div>
          <ModeToggle />
        </div>
      </div>

      {/* Live Mode Content */}
      {isLiveMode && (
        <div className="card p-6 border-l-4 border-brand-500">
          <div className="flex items-start gap-4">
            <div className="text-3xl">🔴</div>
            <div className="flex-1">
              <h3 className="font-bold text-white mb-2">Live Trading Mode</h3>
              <p className="text-sm text-gray-400 mb-4">
                Your system is connected to live market feeds. Position management and trading
                decisions are active. Follow your discipline rules:
              </p>
              <ul className="text-sm text-gray-400 space-y-2 ml-4">
                <li>• Three 15-min entry windows (9:30-10:15 AM EST)</li>
                <li>• Maximum 5% risk per trade</li>
                <li>• Two-attempt stop loss system</li>
                <li>• Auto-position management until lunch close (~11:30 AM)</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Replay Mode Content */}
      {!isLiveMode && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Date Picker - 2/3 width */}
          <div className="lg:col-span-2">
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                📅 Select Replay Date
              </h2>
              <ReplayDatePicker
                onDateSelected={(date) => {
                  setMessage({
                    type: 'info',
                    text: `Ready to replay ${selectedInstrument} on ${formatDateDisplay(date)}. Choose speed and click Play.`,
                  })
                }}
              />
            </div>
          </div>

          {/* Replay Controls - 1/3 width */}
          <div className="space-y-4">
            {/* Instrument Selector */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Instrument
              </h3>
              <div className="space-y-2">
                {INSTRUMENTS.map(inst => (
                  <button
                    key={inst}
                    onClick={() => handleInstrumentChange(inst)}
                    className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
                      selectedInstrument === inst
                        ? 'bg-brand-600 text-white shadow-lg'
                        : 'bg-surface-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>

            {/* Playback Speed */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Playback Speed
              </h3>
              <div className="space-y-2">
                {PLAYBACK_SPEEDS.map(speed => (
                  <button
                    key={speed}
                    onClick={() => setPlaybackSpeed(speed)}
                    className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
                      playbackSpeed === speed
                        ? 'bg-brand-600 text-white shadow-lg'
                        : 'bg-surface-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {speed}x Speed
                  </button>
                ))}
              </div>
            </div>

            {/* Play Button */}
            <button
              onClick={handlePlayReplay}
              disabled={isCreatingSession || !selectedDate}
              className={`w-full py-3 rounded-lg font-bold text-sm transition ${
                isCreatingSession || !selectedDate
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700 active:scale-95'
              }`}
            >
              {isCreatingSession ? '⏳ Creating session...' : selectedDate ? '▶️ Play Replay' : '📅 Pick a date'}
            </button>
          </div>
        </div>
      )}

      {/* Message display */}
      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm transition-all ${
            message.type === 'success'
              ? 'bg-green-900/20 border-green-700/50 text-green-300'
              : message.type === 'error'
                ? 'bg-red-900/20 border-red-700/50 text-red-300'
                : 'bg-blue-900/20 border-blue-700/50 text-blue-300'
          }`}
        >
          {message.type === 'success' && '✓ '}
          {message.type === 'error' && '✕ '}
          {message.type === 'info' && 'ℹ️ '}
          {message.text}
        </div>
      )}
    </div>
  )
}
