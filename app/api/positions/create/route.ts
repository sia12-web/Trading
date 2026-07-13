import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PositionCreateRequest, TradeDirection, TradeStatus } from '@/types/database'

/**
 * POST /api/positions/create
 * Create a new trading position with paper/live mode inherited from user preference
 */
export async function POST(request: NextRequest) {
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
    let body: PositionCreateRequest
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { session_id, symbol, side, entry_level, stop_loss, take_profit, quantity } = body

    // Validate required fields
    if (!session_id || !symbol || !side || entry_level === undefined || stop_loss === undefined || take_profit === undefined || !quantity) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate side parameter
    if (!['BUY', 'SHORT'].includes(side)) {
      return NextResponse.json(
        { error: 'Invalid side. Must be "BUY" or "SHORT"' },
        { status: 400 }
      )
    }

    // Validate numeric fields
    if (typeof entry_level !== 'number' || typeof stop_loss !== 'number' || typeof take_profit !== 'number' || typeof quantity !== 'number') {
      return NextResponse.json(
        { error: 'Invalid numeric values' },
        { status: 400 }
      )
    }

    // Validate price ranges (all must be positive)
    if (entry_level <= 0 || stop_loss <= 0 || take_profit <= 0) {
      return NextResponse.json(
        { error: 'All prices must be positive' },
        { status: 400 }
      )
    }

    if (quantity <= 0) {
      return NextResponse.json(
        { error: 'Quantity must be positive' },
        { status: 400 }
      )
    }

    // Validate trade structure: entry level must be between SL and TP
    if (side === 'BUY') {
      if (entry_level <= stop_loss || entry_level >= take_profit) {
        return NextResponse.json(
          { error: 'Invalid BUY setup: entry must be above SL and below TP' },
          { status: 400 }
        )
      }
    } else {
      // SHORT
      if (entry_level >= stop_loss || entry_level <= take_profit) {
        return NextResponse.json(
          { error: 'Invalid SHORT setup: entry must be below SL and above TP' },
          { status: 400 }
        )
      }
    }

    // Verify session belongs to user
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', session_id)
      .eq('user_id', user.id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Invalid session or unauthorized access' },
        { status: 400 }
      )
    }

    // Fetch user's trading mode preference
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('trading_mode')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Failed to retrieve user settings' },
        { status: 500 }
      )
    }

    // Determine is_paper_trading based on user's mode preference
    const isPaperTrading = profile.trading_mode === 'paper'

    // Create position
    const { data: position, error: insertError } = await supabase
      .from('positions')
      .insert({
        user_id: user.id,
        session_id,
        symbol,
        side: side as TradeDirection,
        entry_level,
        stop_loss,
        take_profit,
        quantity,
        status: 'open' as TradeStatus,
        is_paper_trading: isPaperTrading
      })
      .select()
      .single()

    if (insertError || !position) {
      console.error('[API Error] Failed to create position:', insertError)
      return NextResponse.json(
        { error: 'Failed to create position' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: position,
      trading_mode: profile.trading_mode
    }, { status: 201 })
  } catch (error) {
    console.error('[API Error] POST /api/positions/create:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
