/**
 * Level Status Calculations
 * Determines the status of trading levels based on current price
 */

import type { LevelStatus } from '@/types/trading'

/**
 * Calculate distance percentage between current price and level
 * @param currentPrice - Current market price
 * @param levelPrice - Target level price
 * @returns Distance as percentage (e.g., 0.12 for 0.12%)
 */
export function calculateDistancePercent(
  currentPrice: number,
  levelPrice: number
): number {
  if (levelPrice === 0) return 0
  return Math.abs((currentPrice - levelPrice) / levelPrice) * 100
}

/**
 * Determine if price is broken through a level
 * @param currentPrice - Current market price
 * @param levelPrice - Level price
 * @param previousPrice - Previous price (to detect crossover)
 * @returns true if price crossed the level
 */
export function isLevelBroken(
  currentPrice: number,
  levelPrice: number,
  previousPrice?: number
): boolean {
  // If we have previous price, check if we crossed
  if (previousPrice !== undefined) {
    return (
      (previousPrice <= levelPrice && currentPrice > levelPrice) ||
      (previousPrice >= levelPrice && currentPrice < levelPrice)
    )
  }

  // Without previous price, we can't determine broken status definitively
  // In Realtime updates, this will be sent by backend
  return false
}

/**
 * Determine level status based on current price and distance
 * @param currentPrice - Current market price
 * @param levelPrice - Level price
 * @param previousPrice - Previous price (optional, for break detection)
 * @returns Level status: 'safe', 'approaching', 'broken'
 */
export function getLevelStatus(
  currentPrice: number,
  levelPrice: number,
  previousPrice?: number
): LevelStatus {
  // Check if broken (crossed)
  if (isLevelBroken(currentPrice, levelPrice, previousPrice)) {
    return 'broken'
  }

  // Calculate distance to level
  const distancePct = calculateDistancePercent(currentPrice, levelPrice)

  // Approaching: within 0.5% of level
  if (distancePct <= 0.5) {
    return 'approaching'
  }

  // Safe: more than 0.5% away
  return 'safe'
}

/**
 * Determine if price is approaching from a direction
 * @param currentPrice - Current market price
 * @param levelPrice - Level price
 * @param previousPrice - Previous price
 * @returns 'approaching' | 'receding' | 'broken'
 */
export function getApproachDirection(
  currentPrice: number,
  levelPrice: number,
  previousPrice: number
): 'approaching' | 'receding' | 'broken' {
  // Check if broken (crossed)
  if (isLevelBroken(currentPrice, levelPrice, previousPrice)) {
    return 'broken'
  }

  const currentDistance = Math.abs(currentPrice - levelPrice)
  const previousDistance = Math.abs(previousPrice - levelPrice)

  // Approaching: distance decreasing
  if (currentDistance < previousDistance) {
    return 'approaching'
  }

  // Receding: distance increasing
  return 'receding'
}

/**
 * Format price for display
 * @param price - Price to format
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted price string
 */
export function formatPrice(price: number, decimals: number = 2): string {
  return price.toFixed(decimals)
}

/**
 * Format distance percentage for display
 * @param distancePct - Distance as percentage
 * @returns Formatted string (e.g., "0.12%")
 */
export function formatDistancePercent(distancePct: number): string {
  return `${Math.abs(distancePct).toFixed(3)}%`
}

/**
 * Get color class for level status (Tailwind)
 * @param status - Level status
 * @returns Tailwind CSS class name
 */
export function getStatusColor(status: LevelStatus): string {
  switch (status) {
    case 'safe':
      return 'bg-green-900/20 border-green-700 text-green-300'
    case 'approaching':
      return 'bg-yellow-900/20 border-yellow-700 text-yellow-300'
    case 'broken':
      return 'bg-red-900/20 border-red-700 text-red-300'
    case 'recovered':
      return 'bg-blue-900/20 border-blue-700 text-blue-300'
    default:
      return 'bg-gray-900/20 border-gray-700 text-gray-300'
  }
}

/**
 * Get icon emoji for level status
 * @param status - Level status
 * @returns Emoji icon
 */
export function getStatusIcon(status: LevelStatus): string {
  switch (status) {
    case 'safe':
      return '🟢'
    case 'approaching':
      return '🟡'
    case 'broken':
      return '🔴'
    case 'recovered':
      return '🔵'
    default:
      return '⚪'
  }
}

/**
 * Get data freshness indicator
 * @param lastUpdateTime - Last update timestamp (ISO string)
 * @returns 'live' | 'fresh' | 'stale'
 */
export function getDataFreshness(lastUpdateTime: string | null): 'live' | 'fresh' | 'stale' {
  if (!lastUpdateTime) return 'stale'

  const now = new Date()
  const lastUpdate = new Date(lastUpdateTime)
  const secondsAgo = (now.getTime() - lastUpdate.getTime()) / 1000

  if (secondsAgo < 1) return 'live'
  if (secondsAgo < 5) return 'fresh'
  return 'stale'
}

/**
 * Format time elapsed since last update
 * @param lastUpdateTime - Last update timestamp (ISO string)
 * @returns Formatted string (e.g., "2s ago", "1m ago")
 */
export function formatTimeSinceUpdate(lastUpdateTime: string | null): string {
  if (!lastUpdateTime) return 'unknown'

  const now = new Date()
  const lastUpdate = new Date(lastUpdateTime)
  const secondsAgo = Math.floor((now.getTime() - lastUpdate.getTime()) / 1000)

  if (secondsAgo < 1) return 'now'
  if (secondsAgo < 60) return `${secondsAgo}s ago`

  const minutesAgo = Math.floor(secondsAgo / 60)
  if (minutesAgo < 60) return `${minutesAgo}m ago`

  const hoursAgo = Math.floor(minutesAgo / 60)
  return `${hoursAgo}h ago`
}
