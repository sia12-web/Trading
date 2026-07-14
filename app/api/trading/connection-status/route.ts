/**
 * GET /api/trading/connection-status
 * Get current Realtime connection status and last price update timestamps
 *
 * Query params:
 * - instrument: optional, if provided returns status for that instrument only
 *
 * Returns:
 * {
 *   overall_status: 'connected' | 'reconnecting' | 'disconnected',
 *   instruments: {
 *     DOW: { connection_status, last_price, last_price_update, data_freshness, reconnect_attempts },
 *     ...
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ConnectionStatusResponse, ConnectionStatus } from '@/types/trading'
import { getDataFreshness } from '@/lib/utils/levelCalculations'

const INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI'] as const

export async function GET(request: NextRequest) {
  try {
    // Validate auth
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const instrumentFilter = searchParams.get('instrument')

    // Fetch monitoring status for all instruments
    const { data: statuses, error: dbError } = await supabase
      .from('level_monitor_status')
      .select('*')
      .eq('user_id', user.id)

    if (dbError) {
      console.error('Error fetching connection status:', dbError)
      return NextResponse.json({ error: 'Failed to fetch connection status' }, { status: 500 })
    }

    // Build response with all instruments
    const instrumentsStatus: Record<
      string,
      {
        connection_status: ConnectionStatus
        last_price: number | null
        last_price_update: string | null
        data_freshness: 'live' | 'fresh' | 'stale'
        reconnect_attempts: number
      }
    > = {}

    // Initialize all instruments with disconnected status
    for (const instrument of INSTRUMENTS) {
      instrumentsStatus[instrument] = {
        connection_status: 'disconnected',
        last_price: null,
        last_price_update: null,
        data_freshness: 'stale',
        reconnect_attempts: 0,
      }
    }

    // Update with actual statuses from database
    if (statuses && statuses.length > 0) {
      for (const status of statuses) {
        instrumentsStatus[status.instrument] = {
          connection_status: status.connection_status as ConnectionStatus,
          last_price: status.last_price,
          last_price_update: status.last_price_update,
          data_freshness: getDataFreshness(status.last_price_update),
          reconnect_attempts: status.reconnect_attempts || 0,
        }
      }
    }

    // Filter to specific instrument if requested
    let filteredInstruments: Record<
      string,
      {
        connection_status: ConnectionStatus
        last_price: number | null
        last_price_update: string | null
        data_freshness: 'live' | 'fresh' | 'stale'
        reconnect_attempts: number
      }
    > = instrumentsStatus

    if (instrumentFilter && INSTRUMENTS.includes(instrumentFilter as any)) {
      const instrument = instrumentFilter
      const statusValue = instrumentsStatus[instrument]
      if (statusValue) {
        filteredInstruments = {
          [instrument]: statusValue,
        }
      }
    }

    // Determine overall status
    const allConnected = Object.values(filteredInstruments).every((s) => s.connection_status === 'connected')
    const anyConnecting = Object.values(filteredInstruments).some(
      (s) => s.connection_status === 'reconnecting'
    )

    const overallStatus: ConnectionStatus = allConnected
      ? 'connected'
      : anyConnecting
        ? 'reconnecting'
        : 'disconnected'

    const response: ConnectionStatusResponse = {
      overall_status: overallStatus,
      instruments: filteredInstruments,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('Error in GET /api/trading/connection-status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
