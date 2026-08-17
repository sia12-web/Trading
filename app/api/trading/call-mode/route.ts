/**
 * POST /api/trading/call-mode
 * After clock-in: persist CALL (true) or regular playbook ±10 (false).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  activeClockMarkets,
  setAttendanceUseCall,
} from '@/lib/trading/deskAttendance'
import {
  deskMarketFor,
  isDeskInstrument,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { useCall?: unknown; market?: unknown; instrument?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (typeof body.useCall !== 'boolean') {
    return NextResponse.json({ error: 'useCall must be true or false' }, { status: 400 })
  }

  const instrument = isDeskInstrument(String(body.instrument || ''))
    ? (body.instrument as DeskInstrument)
    : null

  let market: DeskMarket | null = null
  if (body.market === 'NY' || body.market === 'TOKYO') {
    market = body.market
  } else if (instrument) {
    market = deskMarketFor(instrument)
  } else {
    market = activeClockMarkets()[0] ?? null
  }

  if (!market) {
    return NextResponse.json({ error: 'No active desk to save CALL choice' }, { status: 403 })
  }

  const supabase = await createClient()
  const result = await setAttendanceUseCall(supabase, user.id, {
    market,
    useCall: body.useCall,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 })
  }

  return NextResponse.json({
    ok: true,
    useCall: body.useCall,
    attendance_id: result.row.id,
  })
}
