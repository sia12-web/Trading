/**
 * API Response Type Definitions
 * Defines expected shapes for all critical API responses
 */

import type { Instrument } from './price-feed'

export interface LevelData {
  level: number
  status: string
  proximity: string
  distance: number
  distancePct: number
  bounceCount: number
  touchedAt: string | null
  brokenAt: string | null
  lastTouchPrice: number | null
}

export interface InstrumentDataResponse {
  instrument: Instrument
  currentPrice: number | null
  levels: LevelData[]
  timestamp: string
}

export interface HealthCheckAPIResponse {
  success: boolean
  data: InstrumentDataResponse[]
  timestamp?: string
}

export interface LevelStatusAPIResponse {
  success: boolean
  data: InstrumentDataResponse[]
  timestamp?: string
}
