/**
 * Replay Mode State Management
 * Manages: trading mode (live/replay), selected date, available dates
 * Persists to localStorage and URL query params
 */

import { create } from 'zustand'
import type { TradingMode, AvailableDate, Instrument } from '@/types/trading'

interface ReplayModeStore {
  // State
  mode: TradingMode
  selectedDate: string | null
  selectedInstrument: Instrument
  availableDates: AvailableDate[]
  isLoadingDates: boolean
  lastFetchedInstrument: Instrument | null
  error: string | null

  // Actions
  setMode: (mode: TradingMode) => void
  setSelectedDate: (date: string | null) => void
  setSelectedInstrument: (instrument: Instrument) => void
  setAvailableDates: (dates: AvailableDate[]) => void
  setIsLoadingDates: (loading: boolean) => void
  setLastFetchedInstrument: (instrument: Instrument | null) => void
  setError: (error: string | null) => void
  loadFromLocalStorage: () => void
  saveToLocalStorage: () => void
  reset: () => void
}

const STORAGE_KEY_MODE = 'trading_mode'
const STORAGE_KEY_DATE = 'replay_selected_date'
const STORAGE_KEY_INSTRUMENT = 'replay_selected_instrument'

const initialState = {
  mode: 'live' as TradingMode,
  selectedDate: null,
  selectedInstrument: 'DOW' as Instrument,
  availableDates: [],
  isLoadingDates: false,
  lastFetchedInstrument: null,
  error: null,
}

export const useReplayModeStore = create<ReplayModeStore>((set, get) => ({
  ...initialState,

  setMode: (mode: TradingMode) => {
    set({ mode })
    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_MODE, mode)
    }
  },

  setSelectedDate: (date: string | null) => {
    set({ selectedDate: date })
    if (typeof window !== 'undefined' && date) {
      localStorage.setItem(STORAGE_KEY_DATE, date)
    }
  },

  setSelectedInstrument: (instrument: Instrument) => {
    set({ selectedInstrument: instrument })
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_INSTRUMENT, instrument)
    }
  },

  setAvailableDates: (dates: AvailableDate[]) => {
    set({ availableDates: dates })
  },

  setIsLoadingDates: (loading: boolean) => {
    set({ isLoadingDates: loading })
  },

  setLastFetchedInstrument: (instrument: Instrument | null) => {
    set({ lastFetchedInstrument: instrument })
  },

  setError: (error: string | null) => {
    set({ error })
  },

  loadFromLocalStorage: () => {
    if (typeof window === 'undefined') return

    const VALID_MODES: TradingMode[] = ['live', 'replay']
    const VALID_INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

    const savedMode = localStorage.getItem(STORAGE_KEY_MODE)
    const savedDate = localStorage.getItem(STORAGE_KEY_DATE)
    const savedInstrument = localStorage.getItem(STORAGE_KEY_INSTRUMENT)

    set({
      mode:
        savedMode && VALID_MODES.includes(savedMode as TradingMode)
          ? (savedMode as TradingMode)
          : 'live',
      selectedDate: savedDate || null,
      selectedInstrument:
        savedInstrument && VALID_INSTRUMENTS.includes(savedInstrument as Instrument)
          ? (savedInstrument as Instrument)
          : 'DOW',
    })
  },

  saveToLocalStorage: () => {
    if (typeof window === 'undefined') return

    const { mode, selectedDate, selectedInstrument } = get()
    localStorage.setItem(STORAGE_KEY_MODE, mode)
    if (selectedDate) {
      localStorage.setItem(STORAGE_KEY_DATE, selectedDate)
    }
    localStorage.setItem(STORAGE_KEY_INSTRUMENT, selectedInstrument)
  },

  reset: () => {
    set(initialState)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_MODE)
      localStorage.removeItem(STORAGE_KEY_DATE)
      localStorage.removeItem(STORAGE_KEY_INSTRUMENT)
    }
  },
}))
