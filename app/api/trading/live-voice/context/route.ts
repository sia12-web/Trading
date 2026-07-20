/**
 * GET /api/trading/live-voice/context?instrument=DOW|NASDAQ|NIKKEI
 * Slice 2: desk context snapshot for the co-pilot (auth + clock-in required).
 * Never invents levels — AI history + regime_cache + session gate only.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { isLiveDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import { buildLiveVoiceDeskContext } from '@/lib/trading/liveVoiceContext'
import { dedupeWatchLevels } from '@/lib/trading/liveVoiceReactionCore'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrumentParam = searchParams.get('instrument')
    const instrument: DeskInstrument = isLiveDeskInstrument(instrumentParam || '')
      ? (instrumentParam as DeskInstrument)
      : 'DOW'

    const supabase = await createClient()
    const context = await buildLiveVoiceDeskContext(supabase, user.id, instrument)

    if (!context.voice.clockedIn) {
      return NextResponse.json(
        {
          success: false,
          error: 'Clock in required',
          reason: 'Clock in (“Today I trade”) to load Live Voice context',
          voice: context.voice,
        },
        { status: 403 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        context,
        summary: {
          enabled: context.voice.enabled,
          phase: context.session.phase,
          instrument: context.voice.instrument,
          levelCount: context.levels.count,
          levelsSource: context.levels.source,
          focusSide: context.levels.focusSide,
          overnightReady: context.overnight.ready,
          regime: context.overnight.regime,
          attemptsUsed: context.session.attemptsUsed,
          maxAttempts: context.session.maxAttempts,
          avwap: context.avwap.bandNote,
          pinCount: context.userPins.length,
          pins: context.userPins.map((p) => ({
            price: p.price,
            side: p.side,
            reason: p.reason,
          })),
          watchLevels: dedupeWatchLevels([
            ...context.userPins.map((p) => ({
              price: p.price,
              side: p.side,
              source: 'pin' as const,
            })),
            ...context.levels.items.map((l) => ({
              price: l.price,
              side: l.side,
              source: 'ai' as const,
            })),
          ]),
          voiceSessionId: context.voiceSessionId,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (error) {
    logger.error('live_voice.context_failed', { err: error })
    return NextResponse.json(
      { success: false, error: 'Failed to build Live Voice context' },
      { status: 500 }
    )
  }
}
