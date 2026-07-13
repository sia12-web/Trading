import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ArchiveRequest, ArchiveResponse } from '@/lib/services/levelFinderAgent/types'

const DUPLICATE_THRESHOLD_PIPS = 50

/**
 * Validates archive request structure and values
 */
function validateArchiveRequest(body: any): { valid: true; data: ArchiveRequest } | { valid: false; error: string } {
  const { session_id, instrument, levels } = body

  // Validate required fields
  if (!session_id || !instrument || !levels) {
    return { valid: false, error: 'Missing required fields: session_id, instrument, levels' }
  }

  // Validate session_id is UUID
  if (typeof session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)) {
    return { valid: false, error: 'Invalid session_id format' }
  }

  // Validate instrument
  if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
    return { valid: false, error: 'Invalid instrument (must be DOW, NASDAQ, or NIKKEI)' }
  }

  // Validate levels array
  if (!Array.isArray(levels)) {
    return { valid: false, error: 'Levels must be an array' }
  }

  if (levels.length === 0) {
    return { valid: false, error: 'Levels array cannot be empty' }
  }

  // Validate each level
  for (const level of levels) {
    if (typeof level.level !== 'number' || level.level <= 0) {
      return { valid: false, error: 'Each level must have level > 0' }
    }

    if (!['support', 'resistance', 'vwap'].includes(level.type)) {
      return { valid: false, error: 'Invalid level type (must be support, resistance, or vwap)' }
    }

    if (typeof level.conviction !== 'number' || level.conviction < 1 || level.conviction > 10) {
      return { valid: false, error: 'Conviction must be between 1 and 10' }
    }

    if (typeof level.reasoning !== 'string' || level.reasoning.length === 0) {
      return { valid: false, error: 'Each level must have non-empty reasoning' }
    }

    if (!['D', '4H', 'H1'].includes(level.timeframe)) {
      return { valid: false, error: 'Invalid timeframe (must be D, 4H, or H1)' }
    }
  }

  return { valid: true, data: body as ArchiveRequest }
}

/**
 * Verifies session exists and belongs to user
 */
async function verifySessionOwnership(supabase: any, sessionId: string, userId: string): Promise<{ valid: true } | { valid: false; error: string }> {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (sessionError || !session) {
    return { valid: false, error: 'Invalid session or unauthorized access' }
  }

  return { valid: true }
}

/**
 * Finds duplicate levels within threshold distance
 * Uses epsilon comparison to handle floating-point precision issues
 */
function findDuplicateLevel(existingLevels: any[], newLevel: number, threshold: number = DUPLICATE_THRESHOLD_PIPS): any | null {
  const EPSILON = 0.01 // Floating-point tolerance
  return existingLevels.find((existing) => {
    const distance = Math.abs(existing.level - newLevel)
    // Account for floating-point precision issues with epsilon comparison
    return distance <= (threshold + EPSILON)
  })
}

/**
 * POST /api/levels/archive
 * Archives identified levels to level_history after a session completes
 * Performs duplicate detection (50-pip threshold) and updates tested_count
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Validate archive request
    const validation = validateArchiveRequest(body)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Verify session ownership
    const sessionCheck = await verifySessionOwnership(supabase, validation.data.session_id, user.id)
    if (!sessionCheck.valid) {
      return NextResponse.json({ error: sessionCheck.error }, { status: 403 })
    }

    // Fetch existing levels for user + instrument to detect duplicates
    const { data: existingLevels, error: fetchError } = await supabase
      .from('level_history')
      .select('id, level')
      .eq('user_id', user.id)
      .eq('instrument', validation.data.instrument)

    if (fetchError) {
      console.error('[Archive API] Error fetching existing levels:', fetchError)
      return NextResponse.json({ error: 'Failed to check for duplicate levels' }, { status: 500 })
    }

    const existingLevelsList = existingLevels || []
    let archivedCount = 0
    let duplicateCount = 0
    const levelHistoryIds: string[] = []

    // Process each level: check for duplicates and insert/update
    for (const levelData of validation.data.levels) {
      const duplicate = findDuplicateLevel(existingLevelsList, levelData.level)

      if (duplicate) {
        // Duplicate found: increment tested_count and update last_tested_date
        duplicateCount++

        const { error: updateError } = await supabase
          .from('level_history')
          .update({
            tested_count: duplicate.tested_count + 1,
            last_tested_date: new Date().toISOString(),
          })
          .eq('id', duplicate.id)

        if (updateError) {
          console.error('[Archive API] Error updating duplicate level:', updateError)
        }

        levelHistoryIds.push(duplicate.id)
      } else {
        // New level: insert to level_history
        const { data: inserted, error: insertError } = await supabase
          .from('level_history')
          .insert({
            user_id: user.id,
            session_id: validation.data.session_id,
            instrument: validation.data.instrument,
            level: levelData.level,
            type: levelData.type,
            conviction: levelData.conviction,
            reasoning: levelData.reasoning,
            timeframe: levelData.timeframe,
            tested_count: 1,
            success_count: 0,
            last_tested_date: null,
          })
          .select('id')

        if (insertError) {
          console.error('[Archive API] Error inserting level:', insertError)
          return NextResponse.json({ error: 'Failed to archive level' }, { status: 500 })
        }

        if (inserted && inserted.length > 0) {
          archivedCount++
          levelHistoryIds.push(inserted[0].id)
        }
      }
    }

    // Return success response
    return NextResponse.json(
      {
        archived_count: archivedCount,
        duplicate_count: duplicateCount,
        level_history_ids: levelHistoryIds,
      } as ArchiveResponse,
      { status: 201 }
    )
  } catch (error) {
    console.error('[Archive API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
