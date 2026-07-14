/**
 * Entry Discipline Store
 * Manages state for entry detection, position opening, and management
 * Zustand store with localStorage persistence
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  EntryDisciplineState,
  Instrument,
  EntryWindow,
  PendingEntry,
  TradePosition,
  Regime,
} from '@/types/trading'

interface EntryDisciplineStoreState extends EntryDisciplineState {
  // Setters
  setInstrument: (instrument: Instrument) => void
  setCurrentWindow: (window: EntryWindow | null) => void
  setEntryDetected: (detected: boolean, entry?: PendingEntry) => void
  setOpenPosition: (position: TradePosition | null) => void
  setCurrentRegime: (regime: Regime, confidence: number) => void
  setMarketDisabled: (disabled: boolean) => void
  setWindowExtremes: (highest: number, lowest: number, hTime: Date, lTime: Date) => void
  setIsLoadingEntry: (loading: boolean) => void
  setError: (error: string | null) => void
  clearEntry: () => void
  reset: () => void

  // Computed getters
  hasOpenPosition: () => boolean
  isInEntryWindow: () => boolean
  canEntry: () => boolean
  isRegimeDataStale: () => boolean
  clearStaleData: () => void

  // Internal tracking (not persisted)
  _regimeLoadDate: string | null
}

const initialState: EntryDisciplineState = {
  instrument: null,
  currentWindow: null,
  entryDetected: false,
  pendingEntry: null,
  openPosition: null,
  currentRegime: null,
  regimeConfidence: null,
  marketDisabled: false,
  windowHighest: null,
  windowLowest: null,
  windowHighestTime: null,
  windowLowestTime: null,
  isLoadingEntry: false,
  entryError: null,
}

export const useEntryDisciplineStore = create<EntryDisciplineStoreState>()(
  persist(
    (set, get) => ({
      ...initialState,

      // CRITICAL FIX: Track when regime data was loaded to detect stale data
      _regimeLoadDate: null as string | null,

      setInstrument: (instrument: Instrument) => {
        set({ instrument })
      },

      setCurrentWindow: (window: EntryWindow | null) => {
        set({ currentWindow: window })
      },

      setEntryDetected: (detected: boolean, entry?: PendingEntry) => {
        set({
          entryDetected: detected,
          pendingEntry: entry || null,
        })
      },

      setOpenPosition: (position: TradePosition | null) => {
        set({
          openPosition: position,
          entryDetected: false,
          pendingEntry: null,
        })
      },

      setCurrentRegime: (regime: Regime, confidence: number) => {
        // CRITICAL FIX: Track load date to detect stale data across days
        set({
          currentRegime: regime,
          regimeConfidence: confidence,
          _regimeLoadDate: new Date().toDateString(),
        })
      },

      // CRITICAL FIX: Detect stale regime data (from previous trading day)
      isRegimeDataStale: () => {
        const state = get()
        const today = new Date().toDateString()
        return state._regimeLoadDate !== today || state.currentRegime === null
      },

      // CRITICAL FIX: Clear stale data if it's from a different day
      clearStaleData: () => {
        const today = new Date().toDateString()
        const state = get()
        if (state._regimeLoadDate !== today) {
          set({
            currentRegime: null,
            regimeConfidence: null,
            marketDisabled: false,
            _regimeLoadDate: null,
          })
        }
      },

      setMarketDisabled: (disabled: boolean) => {
        set({ marketDisabled: disabled })
      },

      setWindowExtremes: (highest: number, lowest: number, hTime: Date, lTime: Date) => {
        set({
          windowHighest: highest,
          windowLowest: lowest,
          windowHighestTime: hTime,
          windowLowestTime: lTime,
        })
      },

      setIsLoadingEntry: (loading: boolean) => {
        set({ isLoadingEntry: loading })
      },

      setError: (error: string | null) => {
        set({ entryError: error })
      },

      clearEntry: () => {
        set({
          entryDetected: false,
          pendingEntry: null,
          entryError: null,
        })
      },

      reset: () => {
        set(initialState)
      },

      hasOpenPosition: () => {
        return get().openPosition !== null
      },

      isInEntryWindow: () => {
        const window = get().currentWindow
        return window !== null && window <= 3
      },

      canEntry: () => {
        const state = get()
        return (
          state.isInEntryWindow() &&
          !state.marketDisabled &&
          state.currentRegime !== 'choppy' &&
          !state.hasOpenPosition()
        )
      },
    }),
    {
      name: 'entry-discipline-store',
      // CRITICAL FIX: Don't persist regime data - it's daily and changes every trading session
      // Only persist instrument selection
      partialize: (state) => ({
        instrument: state.instrument,
        // Don't persist: currentRegime, regimeConfidence, marketDisabled, _regimeLoadDate
        // These are daily values that must be reloaded from backend
      }),
    }
  )
)
