/**
 * POST /api/trading/live-voice/react
 * Body: { instrument, price, tipPrice, side?, source: 'pin'|'ai', verdict: 'tagged'|'held'|'broke' }
 * Rate-limited level-tag reactions during Live Voice window (cash open).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import {
  LIVE_VOICE_REACT_LIMIT,
  LIVE_VOICE_REACT_WINDOW_MS,
  checkLiveVoiceRateLimit,
} from '@/lib/trading/liveVoiceGuards'
import { isLiveDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import {
  runLiveVoiceLevelReaction,
  type LevelTagVerdict,
} from '@/lib/trading/liveVoiceReaction'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  try {
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (
      !checkLiveVoiceRateLimit(
        `react:${user.id}`,
        LIVE_VOICE_REACT_LIMIT,
        LIVE_VOICE_REACT_WINDOW_MS
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Too many level reactions — wait a minute' },
        { status: 429 }
      )
    }

    const body = (await request.json().catch(() => null)) as {
      instrument?: string
      price?: number
      tipPrice?: number
      side?: string | null
      source?: string
      verdict?: string
    } | null

    const instrumentRaw = String(body?.instrument || 'DOW')
    if (!isLiveDeskInstrument(instrumentRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid instrument' }, { status: 400 })
    }
    const instrument = instrumentRaw as DeskInstrument
    const price = Number(body?.price)
    const tipPrice = Number(body?.tipPrice)
    if (!(price > 0) || !(tipPrice > 0)) {
      return NextResponse.json({ success: false, error: 'Invalid price' }, { status: 400 })
    }

    const verdict = body?.verdict
    if (verdict !== 'tagged' && verdict !== 'held' && verdict !== 'broke') {
      return NextResponse.json({ success: false, error: 'Invalid verdict' }, { status: 400 })
    }
    const source = body?.source === 'ai' ? 'ai' : 'pin'
    const side =
      body?.side === 'BUY' || body?.side === 'SHORT'
        ? body.side
        : null

    const supabase = await createClient()
    const result = await runLiveVoiceLevelReaction({
      supabase,
      userId: user.id,
      instrument,
      event: {
        price,
        tipPrice,
        side,
        source,
        verdict: verdict as LevelTagVerdict,
      },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('live_voice.react_failed', { err: error })
    return NextResponse.json(
      { success: false, error: 'Reaction failed' },
      { status: 500 }
    )
  }
}
