import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { getNikkeiFundamentalState } from '@/lib/fundamentals/nikkeiStateStore'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const state = await getNikkeiFundamentalState()
    return NextResponse.json(state)
  } catch (err) {
    logger.error('[Nikkei Fundamentals GET API] Failed to fetch state', err)
    return NextResponse.json({ error: 'Failed to fetch Nikkei fundamental state' }, { status: 500 })
  }
}
