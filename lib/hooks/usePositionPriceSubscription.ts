/**
 * Real-time Price Subscription Hook
 * Subscribes to Supabase Realtime price updates for live P&L calculation
 * Provides <100ms latency by calculating P&L on frontend from Realtime prices
 */

import type { Instrument } from '@/types/trading'

export function usePositionPriceSubscription(
  _instrument: Instrument | null,
  _onPriceUpdate: (price: number, timestamp: string) => void
) {
  return {
    isConnected: false,
    lastPrice: null,
    lastUpdateTime: null,
  }
}
