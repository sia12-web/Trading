/**
 * GET/POST /api/trading/risk-profile
 * Desk is Tradeify Growth $50k only — POST cannot switch to OANDA.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { TRADEIFY_PROFILE_ID } from '@/lib/trading/tradeifyGrowth50k'
import { persistServerRiskProfile, riskProfileCookieHeader } from '@/lib/trading/tradeifyProfileStore'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createClient()
  await persistServerRiskProfile(supabase, user.id, TRADEIFY_PROFILE_ID)
  const res = NextResponse.json({ ok: true, profile: TRADEIFY_PROFILE_ID })
  res.headers.set('Set-Cookie', riskProfileCookieHeader(TRADEIFY_PROFILE_ID))
  return res
}

export async function POST(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  await request.json().catch(() => null)
  const supabase = await createClient()
  await persistServerRiskProfile(supabase, user.id, TRADEIFY_PROFILE_ID)
  const res = NextResponse.json({ ok: true, profile: TRADEIFY_PROFILE_ID })
  res.headers.set('Set-Cookie', riskProfileCookieHeader(TRADEIFY_PROFILE_ID))
  return res
}
