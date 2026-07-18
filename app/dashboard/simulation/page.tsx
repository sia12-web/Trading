'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useReplayModeStore } from '@/lib/stores/replayModeStore'
import { ReplayDatePicker } from './components/ReplayDatePicker'
import { formatDateDisplay } from '@/lib/utils/dateUtils'
import type { CreateReplaySessionRequest } from '@/types/trading'

const INSTRUMENTS: Array<'DOW' | 'NASDAQ' | 'NIKKEI'> = ['DOW', 'NASDAQ', 'NIKKEI']
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 16] as const
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export default function SimulationPage() {
  const router = useRouter()
  const {
    selectedDate,
    selectedInstrument,
    setSelectedInstrument,
    setSelectedDate,
    setMode,
    loadFromLocalStorage,
  } = useReplayModeStore()

  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  )
  const [lastInstrument, setLastInstrument] = useState<string | null>(null)

  useEffect(() => {
    loadFromLocalStorage()
    setMode('replay')
  }, [loadFromLocalStorage, setMode])

  useEffect(() => {
    if (
      selectedInstrument !== 'DOW' &&
      selectedInstrument !== 'NASDAQ' &&
      selectedInstrument !== 'NIKKEI'
    ) {
      setSelectedInstrument('DOW')
    }
  }, [selectedInstrument, setSelectedInstrument])

  // Clear stale date when switching NY ↔ Tokyo calendars
  useEffect(() => {
    if (lastInstrument == null) {
      setLastInstrument(selectedInstrument)
      return
    }
    if (lastInstrument !== selectedInstrument) {
      setSelectedDate(null)
      setLastInstrument(selectedInstrument)
    }
  }, [selectedInstrument, lastInstrument, setSelectedDate])

  const deskInstrument: 'DOW' | 'NASDAQ' | 'NIKKEI' =
    selectedInstrument === 'NASDAQ'
      ? 'NASDAQ'
      : selectedInstrument === 'NIKKEI'
        ? 'NIKKEI'
        : 'DOW'
  const openLabel = deskInstrument === 'NIKKEI' ? '9:00 AM JST' : '9:30 AM ET'

  const handlePlayReplay = async () => {
    if (!selectedDate) {
      setMessage({
        type: 'error',
        text:
          deskInstrument === 'NIKKEI'
            ? 'Please select one of the last 5 Tokyo trading days'
            : 'Please select one of the last 5 NYC trading days',
      })
      return
    }

    setIsCreatingSession(true)
    setMessage({
      type: 'info',
      text: `Opening ${deskInstrument} on ${formatDateDisplay(selectedDate)} at ${openLabel}…`,
    })

    const request: CreateReplaySessionRequest = {
      instrument: deskInstrument,
      replay_date: selectedDate,
      playback_speed: playbackSpeed,
    }

    try {
      const res = await fetch('/api/trading/replays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: json.error || 'Could not start replay session',
        })
        return
      }
      if (json.persisted === false) {
        setMessage({
          type: 'info',
          text: 'Desk opening (session not persisted — badges may not update)',
        })
      }
      const qs = new URLSearchParams({
        instrument: deskInstrument,
        date: selectedDate,
        speed: String(playbackSpeed),
      })
      router.push(`/dashboard/simulation/replay/desk?${qs.toString()}`)
    } catch {
      setMessage({ type: 'error', text: 'Network error starting replay' })
    } finally {
      setIsCreatingSession(false)
    }
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Simulation</h1>
        <p className="text-sm text-gray-500 mt-1">
          Replay a past morning session only (open → lunch). Paper trades stay on this desk — they
          are never written to the live Trade Journal. Morning/EOD journaling is live clock-in only.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Trading day
            </h2>
            <p className="text-[11px] text-gray-600 mb-4">
              Last 5 completed sessions. Opens at {openLabel}.
            </p>
            <ReplayDatePicker
              onDateSelected={(date) => {
                setMessage({
                  type: 'info',
                  text: `Ready: ${deskInstrument} on ${formatDateDisplay(date)} from ${openLabel}.`,
                })
              }}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Instrument
            </h3>
            <div className="space-y-2">
              {INSTRUMENTS.map((inst) => (
                <button
                  key={inst}
                  type="button"
                  onClick={() => setSelectedInstrument(inst)}
                  className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
                    deskInstrument === inst
                      ? 'bg-brand-600 text-white shadow-lg'
                      : 'bg-surface-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {inst}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Playback speed
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {PLAYBACK_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPlaybackSpeed(s)}
                  className={`py-2 rounded-lg text-sm font-semibold transition ${
                    playbackSpeed === s
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4 text-[11px] text-gray-500 space-y-1.5 leading-relaxed">
            <p className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
              Session flow
            </p>
            <p>1. Opens at cash open with levels on the chart</p>
            <p>2. Click a level → size + place limit</p>
            <p>3. Play → wait for fill</p>
            <p>4. Manage SL / TP / close</p>
          </div>

          <button
            type="button"
            onClick={handlePlayReplay}
            disabled={isCreatingSession || !selectedDate}
            className={`w-full py-3 rounded-lg font-bold text-sm transition ${
              isCreatingSession || !selectedDate
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700 active:scale-95'
            }`}
          >
            {isCreatingSession
              ? 'Opening…'
              : selectedDate
                ? `▶ Start at ${openLabel}`
                : 'Pick a trading day'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-green-900/20 border-green-700/50 text-green-300'
              : message.type === 'error'
                ? 'bg-red-900/20 border-red-700/50 text-red-300'
                : 'bg-blue-900/20 border-blue-700/50 text-blue-300'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}
