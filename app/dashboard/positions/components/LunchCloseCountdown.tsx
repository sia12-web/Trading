'use client'

/**
 * Lunch Close Countdown Component
 * Shows time remaining until 11:30 AM EST market close
 * Displays market disabled status
 */

import { useEffect, useState } from 'react'

interface LunchCloseCountdownProps {
  marketDisabled: boolean
  stopLossHitCount: number
}

export function LunchCloseCountdown({ marketDisabled, stopLossHitCount }: LunchCloseCountdownProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const [isMarketClosed, setIsMarketClosed] = useState(false)

  useEffect(() => {
    const calculateTimeRemaining = () => {
      // Get current time in EST
      const now = new Date()
      const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))

      // Lunch close at 11:30 AM EST
      const lunchClose = new Date(estTime)
      lunchClose.setHours(11, 30, 0, 0)

      // Trading hours: 9:30 AM - 11:30 AM EST
      const marketOpen = new Date(estTime)
      marketOpen.setHours(9, 30, 0, 0)

      // Check if market is still open for trading
      if (estTime < marketOpen || estTime > lunchClose) {
        setIsMarketClosed(true)
        setTimeRemaining('Market closed')
        return
      }

      setIsMarketClosed(false)

      const diff = lunchClose.getTime() - estTime.getTime()
      if (diff > 0) {
        const minutes = Math.floor(diff / 60000)
        const seconds = Math.floor((diff % 60000) / 1000)
        setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)
      } else {
        setTimeRemaining('Closing...')
      }
    }

    calculateTimeRemaining()
    const interval = setInterval(calculateTimeRemaining, 1000)

    return () => clearInterval(interval)
  }, [])

  if (isMarketClosed) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-100 p-4 dark:border-gray-600 dark:bg-gray-800">
        <p className="text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
          📊 Market closed - trading window completed for today
        </p>
      </div>
    )
  }

  if (marketDisabled) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
        <p className="text-center font-semibold text-red-700 dark:text-red-400">
          🔴 MARKET DISABLED - No new entries allowed
        </p>
        <p className="mt-2 text-center text-sm text-red-600 dark:text-red-300">
          {stopLossHitCount >= 2 && 'Stop loss hit twice. Market disabled for rest of session.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-blue-900 dark:text-blue-200">
          Time until lunch close (11:30 AM EST)
        </p>
        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
          {timeRemaining}
        </p>
      </div>
      <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
        Position must be closed by lunch close. Stop loss hit count: {stopLossHitCount}/2
      </p>
    </div>
  )
}
