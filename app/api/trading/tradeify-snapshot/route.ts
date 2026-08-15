/**
 * GET /api/trading/tradeify-snapshot
 * Cross-desk Tradeify Growth $50k session + dashboard payload.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  buildTradeifyDashboardPayload,
  loadTradeifySessionSnapshot,
} from '@/lib/trading/tradeifySessionState'
import { deskLocalHmsAsTraderDisplay } from '@/lib/chart/traderDisplayTz'
import { TRADEIFY_FLATTEN_ET } from '@/lib/trading/tradeifyGrowth50k'
import { tradeifyAccountName } from '@/lib/trading/tradeifyEnv'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createClient()
  const now = new Date()
  const snap = await loadTradeifySessionSnapshot(supabase, user.id, now)
  const payload = buildTradeifyDashboardPayload(snap, now)
  const flattenMontreal = `${deskLocalHmsAsTraderDisplay(TRADEIFY_FLATTEN_ET, 'America/New_York', now)} Montreal`
  return NextResponse.json({
    ...payload,
    flattenMontreal,
    accountName: tradeifyAccountName(),
  })
}
