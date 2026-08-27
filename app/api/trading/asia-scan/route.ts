/**
 * POST/GET /api/trading/asia-scan
 * OANDA M5 scan of locked Gold/Dow Asia recipes → persist overlay + Telegram.
 * Cron, Railway watch, or Trade Pulse client while the overnight window is open.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { assertCronOrDeskUser, getOrCreateUser, resolveDeskUser } from '@/lib/utils/devAuth'
import { runAsiaDeskScan } from '@/lib/trading/asiaDeskScan'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request) {
  try {
    if (!(await assertCronOrDeskUser(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = (await getOrCreateUser(request)) ?? (await resolveDeskUser())
    if (!user) {
      return NextResponse.json({ error: 'No desk user' }, { status: 401 })
    }
    const supabase = createAdminClient() ?? (await createClient())
    const result = await runAsiaDeskScan({
      supabase,
      userId: user.id,
      notify: true,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    logger.error('asia_scan.failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
