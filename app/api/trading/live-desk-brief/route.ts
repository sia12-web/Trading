/**
 * GET /api/trading/live-desk-brief
 * Ranked DOW / NASDAQ late / live desk brief for the chart overlay.
 * Always recomputes (stale-brief mitigation — asOf timestamp on payload).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { loadLiveDeskBrief } from '@/lib/trading/liveDeskBriefServer'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const focus = request.nextUrl.searchParams.get('focus')
    const focusMarket =
      focus === 'NY' || focus === 'TOKYO' || focus === 'ALL' ? focus : 'ALL'

    const brief = await loadLiveDeskBrief({ focusMarket })
    return NextResponse.json({ ok: true, brief })
  } catch (error) {
    logger.error('live_desk_brief.failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
