/**
 * Runtime Validation and Type Guards
 * Validates critical data structures at runtime to prevent corruption
 */

import type { Instrument } from '@/types/price-feed'

// Type guards for runtime validation
export function isInstrument(value: unknown): value is Instrument {
  return typeof value === 'string' && ['DOW', 'NASDAQ', 'NIKKEI'].includes(value)
}

export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value)
}

export function isValidProximity(value: unknown): value is 'far' | 'approaching' | 'at' | 'breached' {
  return typeof value === 'string' && ['far', 'approaching', 'at', 'breached'].includes(value)
}

export function isValidLevelStatus(value: unknown): value is 'unvisited' | 'approaching' | 'touched' | 'broken' | 'bounced' | 'rejected' {
  return typeof value === 'string' && ['unvisited', 'approaching', 'touched', 'broken', 'bounced', 'rejected'].includes(value)
}

export function isLevelData(value: unknown): value is {
  level: number
  status: string
  proximity: string
  distance: number
  distancePct: number
  bounceCount: number
  touchedAt: string | null
  brokenAt: string | null
  lastTouchPrice: number | null
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  return (
    isValidNumber(obj.level) &&
    typeof obj.status === 'string' &&
    typeof obj.proximity === 'string' &&
    isValidNumber(obj.distance) &&
    isValidNumber(obj.distancePct) &&
    typeof obj.bounceCount === 'number' &&
    (obj.touchedAt === null || typeof obj.touchedAt === 'string') &&
    (obj.brokenAt === null || typeof obj.brokenAt === 'string') &&
    (obj.lastTouchPrice === null || isValidNumber(obj.lastTouchPrice))
  )
}

export function isInstrumentData(value: unknown): value is {
  instrument: Instrument
  currentPrice: number | null
  levels: Array<{
    level: number
    status: string
    proximity: string
    distance: number
    distancePct: number
    bounceCount: number
    touchedAt: string | null
    brokenAt: string | null
    lastTouchPrice: number | null
  }>
  timestamp: string
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  return (
    isInstrument(obj.instrument) &&
    (obj.currentPrice === null || isValidNumber(obj.currentPrice)) &&
    Array.isArray(obj.levels) &&
    obj.levels.every(isLevelData) &&
    typeof obj.timestamp === 'string'
  )
}

export function isChangedLevel(value: unknown): value is {
  level: number
  status: string
  proximity: string
  distance: number
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  return (
    isValidNumber(obj.level) &&
    typeof obj.status === 'string' &&
    typeof obj.proximity === 'string' &&
    isValidNumber(obj.distance)
  )
}

export function isLevelStatusUpdate(value: unknown): value is {
  changedLevels?: Array<{
    level: number
    status: string
    proximity: string
    distance: number
  }>
  currentPrice: number
  timestamp: string
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  return (
    isValidNumber(obj.currentPrice) &&
    typeof obj.timestamp === 'string' &&
    (obj.changedLevels === undefined || (Array.isArray(obj.changedLevels) && obj.changedLevels.every(isChangedLevel)))
  )
}

export function isHealthCheckResponse(value: unknown): value is {
  success: boolean
  data: Array<{
    instrument: Instrument
    currentPrice: number | null
    levels: Array<{
      level: number
      status: string
      proximity: string
      distance: number
      distancePct: number
      bounceCount: number
      touchedAt: string | null
      brokenAt: string | null
      lastTouchPrice: number | null
    }>
    timestamp: string
  }>
} {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  return (
    typeof obj.success === 'boolean' &&
    Array.isArray(obj.data) &&
    obj.data.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const instrument = (item as Record<string, unknown>).instrument
      return isInstrumentData(item) || isInstrument(instrument)
    })
  )
}

// Validation functions that throw descriptive errors

export function validateRealtimePayload(payload: unknown): {
  changedLevels?: Array<{
    level: number
    status: string
    proximity: string
    distance: number
  }>
  currentPrice: number
  timestamp: string
} {
  if (!isLevelStatusUpdate(payload)) {
    throw new Error(`Invalid realtime payload structure: ${JSON.stringify(payload).slice(0, 100)}`)
  }

  if (payload.currentPrice <= 0) {
    throw new Error(`Invalid currentPrice: must be > 0, got ${payload.currentPrice}`)
  }

  if (payload.changedLevels) {
    payload.changedLevels.forEach((cl, idx) => {
      if (!isValidNumber(cl.level) || cl.level <= 0) {
        throw new Error(`Invalid level at index ${idx}: must be > 0, got ${cl.level}`)
      }
      if (!isValidNumber(cl.distance)) {
        throw new Error(`Invalid distance at index ${idx}: must be a number, got ${cl.distance}`)
      }
      if (!isValidProximity(cl.proximity)) {
        throw new Error(`Invalid proximity at index ${idx}: must be one of 'far'|'approaching'|'at'|'breached', got '${cl.proximity}'`)
      }
    })
  }

  return payload
}

export function validateCachedData(data: unknown): {
  instrument: Instrument
  currentPrice: number | null
  levels: Array<{
    level: number
    status: string
    proximity: string
    distance: number
    distancePct: number
    bounceCount: number
    touchedAt: string | null
    brokenAt: string | null
    lastTouchPrice: number | null
  }>
  timestamp: string
} {
  if (!isInstrumentData(data)) {
    throw new Error(`Invalid cached data structure: ${JSON.stringify(data).slice(0, 100)}`)
  }

  if (data.currentPrice !== null && data.currentPrice <= 0) {
    throw new Error(`Invalid currentPrice in cache: must be > 0 or null, got ${data.currentPrice}`)
  }

  if (!Array.isArray(data.levels)) {
    throw new Error('Cached data missing levels array')
  }

  data.levels.forEach((level, idx) => {
    if (!isValidNumber(level.level) || level.level <= 0) {
      throw new Error(`Cached level ${idx} has invalid price: must be > 0, got ${level.level}`)
    }
    if (!isValidLevelStatus(level.status)) {
      throw new Error(`Cached level ${idx} has invalid status: '${level.status}'`)
    }
    if (!isValidNumber(level.bounceCount) || level.bounceCount < 0) {
      throw new Error(`Cached level ${idx} has invalid bounceCount: must be >= 0, got ${level.bounceCount}`)
    }
  })

  return data
}

export function validateHealthCheckResponse(data: unknown): {
  success: boolean
  data: Array<{
    instrument: Instrument
    currentPrice: number | null
    levels: Array<{
      level: number
      status: string
      proximity: string
      distance: number
      distancePct: number
      bounceCount: number
      touchedAt: string | null
      brokenAt: string | null
      lastTouchPrice: number | null
    }>
    timestamp: string
  }>
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Health check response is not an object')
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.success !== 'boolean') {
    throw new Error('Health check response missing success field')
  }

  if (!Array.isArray(obj.data)) {
    throw new Error('Health check response data is not an array')
  }

  if (obj.data.length === 0) {
    throw new Error('Health check response data array is empty')
  }

  obj.data.forEach((item: unknown, idx: number) => {
    if (!isInstrumentData(item)) {
      throw new Error(`Health check response data[${idx}] has invalid structure: ${JSON.stringify(item).slice(0, 100)}`)
    }
  })

  return obj as {
    success: boolean
    data: Array<{
      instrument: Instrument
      currentPrice: number | null
      levels: Array<{
        level: number
        status: string
        proximity: string
        distance: number
        distancePct: number
        bounceCount: number
        touchedAt: string | null
        brokenAt: string | null
        lastTouchPrice: number | null
      }>
      timestamp: string
    }>
  }
}
