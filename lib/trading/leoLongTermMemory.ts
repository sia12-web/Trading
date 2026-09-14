/**
 * Leo Long-Term Memory Architecture & Notifications
 *
 * Persists HTF daily level memories and price observation zones.
 * Triggers TradingView-style audio/visual alarms and dashboard notifications
 * when live price visits the designated memory range.
 */

export interface LeoLongTermMemory {
  id: string
  instrument: string // 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE' | 'RUSSELL'
  timeframe: string // '1D' | '30m' | '5m' | '1m'
  priceLow: number
  priceHigh: number
  purpose: string // e.g. "Keep eyes on this level when price visits to see if support or resistance"
  notes?: string
  status: 'ACTIVE' | 'TRIGGERED' | 'DISMISSED'
  createdAt: string
  lastTriggeredAt?: string
  triggerCount: number
  sourceDrawingId?: string
  alarmSoundEnabled: boolean
}

export interface LeoMemoryNotification {
  id: string
  memoryId: string
  instrument: string
  price: number
  priceLow: number
  priceHigh: number
  purpose: string
  timestamp: string
  read: boolean
}

const MEMORIES_STORAGE_KEY = 'leo_long_term_memories_v1'
const NOTIFICATIONS_STORAGE_KEY = 'leo_memory_notifications_v1'

/**
 * Load all saved long-term memories from localStorage.
 */
export function loadLongTermMemories(): LeoLongTermMemory[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(MEMORIES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('[LeoMemory] Failed to load memories from localStorage:', err)
    return []
  }
}

/**
 * Save or update a long-term memory.
 */
export function saveLongTermMemory(memory: LeoLongTermMemory): LeoLongTermMemory[] {
  if (typeof window === 'undefined') return []
  try {
    const current = loadLongTermMemories()
    const index = current.findIndex((m) => m.id === memory.id)
    let updated: LeoLongTermMemory[]
    if (index >= 0) {
      updated = [...current]
      updated[index] = memory
    } else {
      updated = [memory, ...current]
    }
    localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('leo-memories-updated', { detail: updated }))
    return updated
  } catch (err) {
    console.warn('[LeoMemory] Failed to save memory to localStorage:', err)
    return []
  }
}

/**
 * Delete a long-term memory by ID.
 */
export function deleteLongTermMemory(id: string): LeoLongTermMemory[] {
  if (typeof window === 'undefined') return []
  try {
    const current = loadLongTermMemories()
    const updated = current.filter((m) => m.id !== id)
    localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('leo-memories-updated', { detail: updated }))
    return updated
  } catch (err) {
    console.warn('[LeoMemory] Failed to delete memory:', err)
    return []
  }
}

/**
 * Load all notifications from localStorage.
 */
export function loadMemoryNotifications(): LeoMemoryNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('[LeoMemory] Failed to load notifications:', err)
    return []
  }
}

/**
 * Record a new notification when price visits a memory level.
 */
export function recordMemoryNotification(notif: Omit<LeoMemoryNotification, 'id' | 'timestamp' | 'read'>): LeoMemoryNotification {
  const newNotif: LeoMemoryNotification = {
    ...notif,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    read: false,
  }

  if (typeof window !== 'undefined') {
    try {
      const current = loadMemoryNotifications()
      const updated = [newNotif, ...current].slice(0, 50) // keep last 50
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated))
      window.dispatchEvent(new CustomEvent('leo-notifications-updated', { detail: updated }))
    } catch (err) {
      console.warn('[LeoMemory] Failed to record notification:', err)
    }
  }

  return newNotif
}

/**
 * Mark a notification as read.
 */
export function markNotificationRead(id: string): LeoMemoryNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const current = loadMemoryNotifications()
    const updated = current.map((n) => (n.id === id ? { ...n, read: true } : n))
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('leo-notifications-updated', { detail: updated }))
    return updated
  } catch (err) {
    console.warn('[LeoMemory] Failed to mark notification read:', err)
    return []
  }
}

/**
 * Clear all notifications.
 */
export function clearAllNotifications(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY)
    window.dispatchEvent(new CustomEvent('leo-notifications-updated', { detail: [] }))
  } catch (err) {
    console.warn('[LeoMemory] Failed to clear notifications:', err)
  }
}

/**
 * Checks live price against active memories for an instrument.
 * Returns triggered memories (with cooldown to prevent ringing on every tick).
 */
export function evaluatePriceAgainstMemories(args: {
  instrument: string
  currentPrice: number
  cooldownSeconds?: number
}): {
  triggered: LeoLongTermMemory[]
  updatedMemories: LeoLongTermMemory[]
} {
  const { instrument, currentPrice, cooldownSeconds = 120 } = args
  const memories = loadLongTermMemories()
  const triggered: LeoLongTermMemory[] = []
  const now = Date.now()
  const cooldownMs = cooldownSeconds * 1000

  const updatedMemories = memories.map((mem) => {
    if (mem.instrument.toUpperCase() !== instrument.toUpperCase()) return mem
    if (mem.status === 'DISMISSED') return mem

    const inRange = currentPrice >= mem.priceLow && currentPrice <= mem.priceHigh
    if (!inRange) return mem

    const lastTriggered = mem.lastTriggeredAt ? new Date(mem.lastTriggeredAt).getTime() : 0
    if (now - lastTriggered < cooldownMs) {
      // Cooldown active, don't re-trigger alarm yet
      return mem
    }

    const updated: LeoLongTermMemory = {
      ...mem,
      status: 'TRIGGERED',
      lastTriggeredAt: new Date(now).toISOString(),
      triggerCount: (mem.triggerCount || 0) + 1,
    }
    triggered.push(updated)
    return updated
  })

  if (triggered.length > 0) {
    try {
      localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories))
      window.dispatchEvent(new CustomEvent('leo-memories-updated', { detail: updatedMemories }))
    } catch {
      /* ignore */
    }
  }

  return { triggered, updatedMemories }
}
