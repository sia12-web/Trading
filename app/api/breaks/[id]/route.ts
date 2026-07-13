/**
 * Break Detail API Endpoint
 * GET /api/breaks/[id] - Get a single break by ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { LevelBreak } from '@/types/database'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { id } = params

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Invalid break ID' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('level_breaks')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Break not found' },
          { status: 404 }
        )
      }
      console.error('[Break Detail API] Database error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch break' },
        { status: 500 }
      )
    }

    // Transform database response
    const breakRecord: LevelBreak = {
      id: data.id,
      instrument: data.instrument,
      level: data.level,
      direction: data.direction,
      confidence: data.confidence,
      entryPrice: data.entry_price,
      breakPrice: data.break_price,
      volume: data.volume,
      reasoning: data.reasoning,
      scoreBreakdown: data.score_breakdown,
      breakTimestamp: data.break_timestamp,
      createdAt: data.created_at,
    }

    return NextResponse.json(breakRecord, { status: 200 })
  } catch (error) {
    console.error('[Break Detail API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
