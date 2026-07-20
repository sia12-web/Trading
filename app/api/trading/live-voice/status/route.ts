/**
 * GET /api/trading/live-voice/status?instrument=DOW|NASDAQ|NIKKEI
 * Slice 1: whether Live Voice shell is enabled (clock-in + prep→entry window).
 * Does not open the microphone.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import {
  deskMarketFor,
  isLiveDeskInstrument,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { getTodayAttendance } from '@/lib/trading/deskAttendance'
import { resolveLiveVoiceStatus } from '@/lib/trading/liveVoice'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          enabled: false,
          micAllowed: false,
          clockedIn: false,
          inVoiceWindow: false,
          disableCode: 'unauthorized',
          reason: 'Unauthorized — sign in or set DESK_USER_ID',
        },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const instrumentParam = searchParams.get('instrument')
    const instrument: DeskInstrument = isLiveDeskInstrument(instrumentParam || '')
      ? (instrumentParam as DeskInstrument)
      : 'DOW'

    const supabase = await createClient()
    const market = deskMarketFor(instrument)
    const attendance = await getTodayAttendance(supabase, user.id, market)
    const clockedIn = attendance?.status === 'clocked_in'

    const status = resolveLiveVoiceStatus({
      instrument,
      clockedIn,
    })

    return NextResponse.json({
      success: true,
      ...status,
    })
  } catch (error) {
    logger.error('live_voice.status_failed', { err: error })
    return NextResponse.json(
      { success: false, error: 'Failed to resolve Live Voice status', enabled: false, micAllowed: false },
      { status: 500 }
    )
  }
}
