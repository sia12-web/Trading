/**
 * Level Monitor State Management
 * Manages: current price, levels, level statuses, connection status
 * Real-time updates from Supabase Realtime price_updates channel
 * No localStorage persistence (ephemeral state)
 */

import { create } from 'zustand'
import type {
  TradingLevel,
  LevelStatusDetail,
  ConnectionStatus,
  Instrument,
} from '@/types/trading'

interface LevelMonitorStore {
  // State
  currentInstrument: Instrument | null
  currentPrice: number | null
  levels: TradingLevel[]
  levelStatuses: Record<string, LevelStatusDetail>
  connectionStatus: ConnectionStatus
  lastPriceUpdate: Date | null
  isLoadingLevels: boolean
  error: string | null

  // Actions
  setCurrentInstrument: (instrument: Instrument | null) => void
  setCurrentPrice: (price: number) => void
  setLevels: (levels: TradingLevel[]) => void
  updateLevelStatus: (levelId: string, status: LevelStatusDetail) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setLastPriceUpdate: (date: Date | null) => void
  setIsLoadingLevels: (loading: boolean) => void
  setError: (error: string | null) => void

  // Helpers
  getLevelsByInstrument: (instrument: Instrument) => TradingLevel[]
  getLevelStatus: (levelId: string) => LevelStatusDetail | undefined
  getAllApproachingLevels: () => TradingLevel[]
  getAllBrokenLevels: () => TradingLevel[]
  reset: () => void
}

const initialState = {
  currentInstrument: null,
  currentPrice: null,
  levels: [],
  levelStatuses: {},
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastPriceUpdate: null,
  isLoadingLevels: false,
  error: null,
}

export const useLevelMonitorStore = create<LevelMonitorStore>((set, get) => ({
  ...initialState,

  setCurrentInstrument: (instrument) => {
    set({ currentInstrument: instrument })
  },

  setCurrentPrice: (price) => {
    set({ currentPrice: price })
  },

  setLevels: (levels) => {
    set({ levels })
  },

  updateLevelStatus: (levelId, status) => {
    set((state) => ({
      levelStatuses: {
        ...state.levelStatuses,
        [levelId]: status,
      },
    }))
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status })
  },

  setLastPriceUpdate: (date) => {
    set({ lastPriceUpdate: date })
  },

  setIsLoadingLevels: (loading) => {
    set({ isLoadingLevels: loading })
  },

  setError: (error) => {
    set({ error })
  },

  // Helper: Get levels for specific instrument (active only)
  getLevelsByInstrument: (instrument) => {
    const { levels } = get()
    return levels.filter((l) => l.instrument === instrument && l.is_active)
  },

  // Helper: Get status for specific level
  getLevelStatus: (levelId) => {
    const { levelStatuses } = get()
    return levelStatuses[levelId]
  },

  // Helper: Get all levels currently approaching
  getAllApproachingLevels: () => {
    const { levels, levelStatuses } = get()
    return levels.filter((level) => {
      const status = levelStatuses[level.id]
      return status?.status === 'approaching'
    })
  },

  // Helper: Get all levels that have been broken
  getAllBrokenLevels: () => {
    const { levels, levelStatuses } = get()
    return levels.filter((level) => {
      const status = levelStatuses[level.id]
      return status?.status === 'broken'
    })
  },

  reset: () => {
    set(initialState)
  },
}))
