/**
 * Real-time Price Subscription Hook
 * Subscribes to Supabase Realtime price updates for live P&L calculation
 * Provides <100ms latency by calculating P&L on frontend from Realtime prices
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Instrument } from '@/types/trading'

interface PriceUpdate {
  instrument: Instrument
  price: number
  timestamp: string
}

export function usePositionPriceSubscription(
  instrument: Instrument | null,
  onPriceUpdate: (price: number, timestamp: string) => void
) {
  const supabaseRef = useRef(createClient())
  const [isConnected, setIsConnected] = useState(false)
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)

  useEffect(() => {
    if (!instrument) {
      setIsConnected(false)
      return
    }

    const channel = supabaseRef.current
      .channel(`price_updates:${instrument}`)
      .on<PriceUpdate>(
        'broadcast',
        { event: 'price_update' },
        (payload) => {
          const update = payload.payload

          // Validate price is valid and positive
          if (update.price > 0 && update.instrument === instrument) {
            setLastPrice(update.price)
            setLastUpdateTime(update.timestamp)
            onPriceUpdate(update.price, update.timestamp)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true)
        }
      })

    return () => {
      setIsConnected(false)
      channel.unsubscribe()
    }
  }, [instrument, onPriceUpdate])

  return {
    isConnected,
    lastPrice,
    lastUpdateTime
  }
}
