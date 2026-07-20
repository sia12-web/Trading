/**
 * GET /api/trading/live-voice/transcript?days=14&instrument=DOW
 * Journal feed: sessions with turns + pins for the desk user.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { parseTranscriptDays } from '@/lib/trading/liveVoiceGuards'
import { isLiveDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import { listLiveVoiceTranscripts } from '@/lib/trading/liveVoiceSession'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = parseTranscriptDays(searchParams.get('days'))
    const instrumentParam = searchParams.get('instrument')
    const instrument =
      instrumentParam && isLiveDeskInstrument(instrumentParam)
        ? (instrumentParam as DeskInstrument)
        : null

    const supabase = await createClient()
    const sessions = await listLiveVoiceTranscripts(supabase, user.id, {
      days,
      instrument,
      limit: 30,
    })

    return NextResponse.json({
      success: true,
      sessions,
      summary: {
        sessions: sessions.length,
        turns: sessions.reduce((n, s) => n + s.turns.length, 0),
        pins: sessions.reduce((n, s) => n + s.pins.length, 0),
        days,
      },
    })
  } catch (error) {
    logger.error('live_voice.transcript_failed', { err: error })
    return NextResponse.json(
      { success: false, error: 'Failed to load Live Voice transcripts' },
      { status: 500 }
    )
  }
}
