import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TradingModeResponse, UpdateTradingModeRequest, TradingMode } from '@/types/database'

/**
 * GET /api/settings/trading-mode
 * Retrieve current user's trading mode preference
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch user's trading mode from profiles
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('trading_mode, updated_at')
      .eq('id', user.id)
      .single()

    if (fetchError || !profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      )
    }

    const response: TradingModeResponse = {
      trading_mode: profile.trading_mode as TradingMode,
      is_live_trading_enabled: profile.trading_mode === 'live',
      updated_at: profile.updated_at
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API Error] GET /api/settings/trading-mode:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/settings/trading-mode
 * Update user's trading mode preference (paper | live)
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    let body: UpdateTradingModeRequest
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    // Validate mode parameter
    const { mode } = body
    if (!mode || !['paper', 'live'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid trading mode. Must be "paper" or "live"' },
        { status: 400 }
      )
    }

    // Update trading mode in profiles table
    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({
        trading_mode: mode as TradingMode,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select('trading_mode, updated_at')
      .single()

    if (updateError || !updated) {
      console.error('[API Error] Failed to update trading mode:', updateError)
      return NextResponse.json(
        { error: 'Failed to update trading mode' },
        { status: 500 }
      )
    }

    const response: TradingModeResponse = {
      trading_mode: updated.trading_mode as TradingMode,
      is_live_trading_enabled: updated.trading_mode === 'live',
      updated_at: updated.updated_at
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API Error] PATCH /api/settings/trading-mode:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
