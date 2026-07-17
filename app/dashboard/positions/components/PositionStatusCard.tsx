'use client'

/**
 * Position Status Card Component
 * Displays current open position with live P&L from Realtime price updates
 * Updates P&L in real-time as prices change (<100ms latency)
 * Includes management decision buttons (HOLD, TAKE_PROFIT, ADJUST)
 * Displays live price chart with entry, SL, and target levels
 */

import { useEffect, useState, useCallback } from 'react'
import { usePositionPriceSubscription } from '@/lib/hooks/usePositionPriceSubscription'
import { successToast, errorToast } from '@/lib/utils/toastUtils'
import { PriceChart } from './PriceChart'
import type { PositionStatus } from '@/types/positionManagement'
import type { DecisionType } from '@/types/trading'

interface PositionStatusCardProps {
  position: PositionStatus | null
}

function calculatePnL(
  position: PositionStatus,
  currentPrice: number
): { profitLoss_dollars: number; profitLoss_percent: number } {
  let profitLoss_dollars: number

  if (position.entry_direction === 'LONG') {
    profitLoss_dollars = (currentPrice - position.entry_price) * position.position_size
  } else {
    profitLoss_dollars = (position.entry_price - currentPrice) * position.position_size
  }

  const profitLoss_percent = (profitLoss_dollars / position.risk_amount) * 100

  return {
    profitLoss_dollars: Math.round(profitLoss_dollars * 100) / 100,
    profitLoss_percent: Math.round(profitLoss_percent * 100) / 100,
  }
}

function formatPrice(price: number): string {
  return price.toFixed(2)
}

function formatCurrency(amount: number): string {
  const isNegative = amount < 0
  const absAmount = Math.abs(amount)
  const formatted = absAmount.toFixed(2)
  return isNegative ? `-$${formatted}` : `$${formatted}`
}

export function PositionStatusCard({ position }: PositionStatusCardProps) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [pnlData, setPnlData] = useState<{ profitLoss_dollars: number; profitLoss_percent: number } | null>(null)
  const [distanceToSL, setDistanceToSL] = useState<number | null>(null)
  const [distanceToTarget, setDistanceToTarget] = useState<number | null>(null)
  const [submittingDecision, setSubmittingDecision] = useState<DecisionType | null>(null)
  const [slHitRecorded, setSlHitRecorded] = useState(false)
  const [isSubmittingSlHit, setIsSubmittingSlHit] = useState(false)

  // Handle stop loss hit
  const handleStopLossHit = useCallback(
    async (hitPrice: number) => {
      if (!position || slHitRecorded || isSubmittingSlHit) return

      setIsSubmittingSlHit(true)
      try {
        const response = await fetch('/api/trading/positions/stop-loss-hit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            position_id: position.id,
            current_price: hitPrice,
            hit_timestamp: new Date().toISOString(),
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          errorToast(data.message || 'Failed to close position at stop loss')
          return
        }

        setSlHitRecorded(true)
        successToast(`Stop loss hit! Position closed. P&L: $${data.profit_loss}`)
      } catch (error) {
        errorToast('Error processing stop loss hit')
      } finally {
        setIsSubmittingSlHit(false)
      }
    },
    [position, slHitRecorded, isSubmittingSlHit]
  )

  // Handle management decision submission
  const handleDecision = useCallback(
    async (decisionType: DecisionType) => {
      if (!position) return

      setSubmittingDecision(decisionType)
      try {
        const response = await fetch('/api/trading/positions/management-decisions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            position_id: position.id,
            decision_type: decisionType,
            notes: null,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          errorToast(data.message || `Failed to record ${decisionType} decision`)
          return
        }

        successToast(`Decision recorded: ${decisionType}`)
      } catch (error) {
        errorToast('Error submitting decision')
      } finally {
        setSubmittingDecision(null)
      }
    },
    [position]
  )

  // Subscribe to price updates
  const { isConnected } = usePositionPriceSubscription(
    position?.instrument || null,
    useCallback(
      (price: number) => {
        if (!position) return

        setCurrentPrice(price)

        // Calculate P&L
        const pnl = calculatePnL(position, price)
        setPnlData(pnl)

        // Calculate distance to stop loss
        const distToSL = Math.abs((price - position.stop_loss_price) / position.stop_loss_price) * 100
        setDistanceToSL(distToSL)

        // Calculate distance to profit target
        const distToTarget = Math.abs((price - position.profit_target_price) / position.profit_target_price) * 100
        setDistanceToTarget(distToTarget)

        // Detect stop loss hit (price crossed SL)
        if (!slHitRecorded && !isSubmittingSlHit) {
          const isSLHit =
            (position.entry_direction === 'LONG' && price <= position.stop_loss_price) ||
            (position.entry_direction === 'SHORT' && price >= position.stop_loss_price)

          if (isSLHit) {
            handleStopLossHit(price)
          }
        }
      },
      [position, slHitRecorded, isSubmittingSlHit, handleStopLossHit]
    )
  )

  // Initialize with entry price if no realtime update yet
  useEffect(() => {
    if (position && !currentPrice) {
      setCurrentPrice(position.entry_price)
      const pnl = calculatePnL(position, position.entry_price)
      setPnlData(pnl)
      setDistanceToSL(0)
      setDistanceToTarget(Math.abs((position.entry_price - position.profit_target_price) / position.profit_target_price) * 100)
    }
  }, [position])

  if (!position) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p className="text-lg">No open position</p>
          <p className="text-sm">Open a position during entry window to begin trading</p>
        </div>
      </div>
    )
  }

  const positionColor =
    pnlData && pnlData.profitLoss_dollars >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  const bgColor = pnlData && pnlData.profitLoss_dollars >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'

  return (
    <div className={`rounded-lg border ${pnlData && pnlData.profitLoss_dollars >= 0 ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'} ${bgColor} p-6`}>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4 dark:border-gray-700">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {position.instrument}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {position.entry_direction === 'LONG' ? '↑ LONG' : '↓ SHORT'} • Window {position.entry_window}
          </p>
        </div>
        <div className={`text-right ${positionColor}`}>
          <div className="text-3xl font-bold">
            {pnlData ? formatCurrency(pnlData.profitLoss_dollars) : '$0.00'}
          </div>
          <div className="text-lg font-semibold">
            {pnlData ? `${pnlData.profitLoss_percent > 0 ? '+' : ''}${pnlData.profitLoss_percent}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Price Chart */}
      <PriceChart position={position} currentPrice={currentPrice} />

      {/* Connection Status */}
      {!isConnected && (
        <div className="mb-4 rounded bg-yellow-50 p-2 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
          ⚠️ Live feed disconnected - using cached data
        </div>
      )}

      {/* Price Information */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Entry Price</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            ${formatPrice(position.entry_price)}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Current Price</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            ${currentPrice ? formatPrice(currentPrice) : formatPrice(position.entry_price)}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Stop Loss</p>
          <p className="text-lg font-semibold text-red-600 dark:text-red-400">
            ${formatPrice(position.stop_loss_price)}
          </p>
          {distanceToSL !== null && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {distanceToSL.toFixed(2)}% away
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Profit Target</p>
          <p className="text-lg font-semibold text-green-600 dark:text-green-400">
            ${formatPrice(position.profit_target_price)}
          </p>
          {distanceToTarget !== null && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {distanceToTarget.toFixed(2)}% away
            </p>
          )}
        </div>
      </div>

      {/* Position Details */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Position Size</p>
          <p className="font-semibold text-gray-900 dark:text-white">
            {position.position_size.toFixed(4)} units
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Risk Amount</p>
          <p className="font-semibold text-gray-900 dark:text-white">
            ${formatPrice(position.risk_amount)}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Account Size</p>
          <p className="font-semibold text-gray-900 dark:text-white">
            ${formatPrice(position.account_size)}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Regime</p>
          <p className="font-semibold text-gray-900 dark:text-white capitalize">
            {position.regime}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Confidence</p>
          <p className="font-semibold text-gray-900 dark:text-white">
            {position.regime_confidence}%
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Entry Time</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {new Date(position.entry_timestamp).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {/* Management Decision Buttons */}
      {!slHitRecorded && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => handleDecision('HOLD')}
            disabled={submittingDecision !== null || isSubmittingSlHit}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:bg-blue-500 dark:hover:bg-blue-600 dark:disabled:bg-gray-600"
            aria-label="Record HOLD decision"
          >
            {submittingDecision === 'HOLD' ? 'Recording...' : 'HOLD'}
          </button>
          <button
            onClick={() => handleDecision('TAKE_PROFIT')}
            disabled={submittingDecision !== null || isSubmittingSlHit}
            className="flex-1 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:bg-green-500 dark:hover:bg-green-600 dark:disabled:bg-gray-600"
            aria-label="Record TAKE_PROFIT decision"
          >
            {submittingDecision === 'TAKE_PROFIT' ? 'Recording...' : 'TAKE PROFIT'}
          </button>
          <button
            onClick={() => handleDecision('ADJUST')}
            disabled={submittingDecision !== null || isSubmittingSlHit}
            className="flex-1 rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white transition-all hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-gray-400 dark:bg-orange-500 dark:hover:bg-orange-600 dark:disabled:bg-gray-600"
            aria-label="Record ADJUST decision"
          >
            {submittingDecision === 'ADJUST' ? 'Recording...' : 'ADJUST'}
          </button>
        </div>
      )}

      {/* Position Closed Message */}
      {slHitRecorded && (
        <div className="mt-6 rounded-lg border border-orange-300 bg-orange-50 p-4 dark:border-orange-700 dark:bg-orange-900/20">
          <p className="text-center text-sm font-semibold text-orange-700 dark:text-orange-400">
            ✓ Position closed by stop loss
          </p>
        </div>
      )}

      {/* Stop Loss Hit Count Warning */}
      {position.stop_loss_hit_count > 0 && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            ⚠️ Stop Loss Hit Count: {position.stop_loss_hit_count}/3
          </p>
          {position.stop_loss_hit_count >= 3 && (
            <p className="text-sm text-red-600 dark:text-red-300">
              Market disabled. No new entries allowed today.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
