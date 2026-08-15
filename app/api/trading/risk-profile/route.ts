/**
 * GET/POST /api/trading/risk-profile
 * Persist OANDA vs Tradeify $50k so Leo + Telegram crons can read it.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { parseDeskRiskProfile } from '@/lib/trading/tradeifyProfile'
import {
  persistServerRiskProfile,
  resolveDeskRiskProfileForUser,
  riskProfileCookieHeader,
} from '@/lib/trading/tradeifyProfileStore'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createClient()
  const profile = await resolveDeskRiskProfileForUser({
    supabase,
    userId: user.id,
    cookieHeader: request.headers.get('cookie'),
  })
  return NextResponse.json({ ok: true, profile })
}

export async function POST(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { profile?: string } | null
  const profile = parseDeskRiskProfile(body?.profile)
  const supabase = await createClient()
  await persistServerRiskProfile(supabase, user.id, profile)
  const res = NextResponse.json({ ok: true, profile })
  res.headers.set('Set-Cookie', riskProfileCookieHeader(profile))
  return res
}
