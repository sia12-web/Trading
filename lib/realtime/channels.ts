/**
 * Realtime Channels Manager
 * Handles broadcasting price updates to Supabase Realtime
 */

import { createClient } from '@/lib/supabase/server'
import type { Instrument, PriceUpdate } from '@/types/price-feed'
import type { LevelStatusUpdate } from '@/lib/services/levelStatusManager'

/**
 * Get the Realtime channel name for an instrument
 */
export function getChannelName(instrument: Instrument): string {
  return `price_updates:${instrument}`
}

/**
 * Broadcast a price update to a Realtime channel
 */
export async function broadcastPrice(instrument: Instrument, priceUpdate: PriceUpdate): Promise<void> {
  try {
    const supabase = await createClient()
    const channelName = getChannelName(instrument)

    // Create channel for broadcasting
    const channel = supabase.realtime.channel(channelName)

    // Send the broadcast message to the channel
    // This uses Realtime's broadcast feature to send messages to all subscribers
    await channel.send({
      type: 'broadcast',
      event: 'price_update',
      payload: priceUpdate,
    })

    console.debug(`[Realtime] Broadcasted to ${channelName}:`, {
      price: priceUpdate.price,
      timestamp: priceUpdate.timestamp,
    })

    // Clean up the channel after sending
    await channel.unsubscribe()
  } catch (error) {
    console.error(`[Realtime] Error broadcasting price for ${instrument}:`, error)
    throw error
  }
}

/**
 * Subscribe to price updates for an instrument (client-side)
 * This is a helper function to show how to subscribe on the frontend
 */
export function getSubscriptionExample(instrument: Instrument): string {
  const channel = getChannelName(instrument)
  return `
// Client-side subscription example:
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

const channel = supabase.realtime.channel('${channel}')
  .on('broadcast', { event: 'price_update' }, (payload) => {
    console.log('Price update:', payload)
    // Update UI with new price data
  })
  .subscribe()

// Cleanup on unmount:
channel.unsubscribe()
  `
}

/**
 * Get the Realtime channel name for level status updates
 */
export function getLevelStatusChannelName(instrument: Instrument): string {
  return `level_status:${instrument}`
}

/**
 * Broadcast level status updates to a Realtime channel
 */
export async function broadcastLevelStatus(
  update: LevelStatusUpdate
): Promise<void> {
  try {
    const supabase = await createClient()
    const channelName = getLevelStatusChannelName(update.instrument)

    // Create channel for broadcasting
    const channel = supabase.realtime.channel(channelName)

    // Send the broadcast message to the channel
    await channel.send({
      type: 'broadcast',
      event: 'status_update',
      payload: {
        instrument: update.instrument,
        currentPrice: update.currentPrice,
        changedLevels: update.changedLevels,
        timestamp: update.timestamp.toISOString(),
      },
    })

    console.debug(`[Realtime] Broadcasted level status to ${channelName}:`, {
      instrument: update.instrument,
      changedCount: update.changedLevels.length,
      timestamp: update.timestamp.toISOString(),
    })

    // Clean up the channel after sending
    await channel.unsubscribe()
  } catch (error) {
    console.error(
      `[Realtime] Error broadcasting level status for ${update.instrument}:`,
      error
    )
    throw error
  }
}

/**
 * Subscribe to level status updates for an instrument (client-side)
 * This is a helper function to show how to subscribe on the frontend
 */
export function getLevelStatusSubscriptionExample(instrument: Instrument): string {
  const channel = getLevelStatusChannelName(instrument)
  return `
// Client-side subscription example:
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

const channel = supabase.realtime.channel('${channel}')
  .on('broadcast', { event: 'status_update' }, (payload) => {
    console.log('Level status update:', payload)
    // Update UI with level status changes
    // payload.changedLevels contains levels that changed status
  })
  .subscribe()

// Cleanup on unmount:
channel.unsubscribe()
  `
}
