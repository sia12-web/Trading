/**
 * GET /api/trading/replays/[id]
 * Fetch a single replay session by ID
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'

function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<any>> {
  try {
    const { id } = params

    // Validate UUID format
    if (!isValidUUID(id)) {
      logger.error('GET /api/trading/replays/[id]: Invalid UUID format', { id })
      return NextResponse.json(
        { error: 'Invalid replay session ID format' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.error('GET /api/trading/replays/[id]: Unauthorized', { error: authError })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch replay session (RLS ensures user can only access their own)
    const { data: session, error: queryError } = await supabase
      .from('simulation_replays')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (queryError) {
      if (queryError.code === 'PGRST116') {
        // No row found
        logger.error('GET /api/trading/replays/[id]: Session not found', { id })
        return NextResponse.json(
          { error: 'Replay session not found' },
          { status: 404 }
        )
      }
      logger.error('GET /api/trading/replays/[id]: Query failed', { error: queryError })
      return NextResponse.json(
        { error: 'Failed to fetch replay session' },
        { status: 500 }
      )
    }

    if (!session) {
      logger.error('GET /api/trading/replays/[id]: Session not found', { id })
      return NextResponse.json(
        { error: 'Replay session not found' },
        { status: 404 }
      )
    }

    logger.log('GET /api/trading/replays/[id]: Session fetched', { id })

    return NextResponse.json(session, { status: 200 })
  } catch (error) {
    logger.error('GET /api/trading/replays/[id]: Unexpected error', { error })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
