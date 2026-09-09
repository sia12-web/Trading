/**
 * GET/POST /api/trading/desk-cooldown
 * NYC close reprint (5d bars → 5M VWAP → yesterday FRVP) and overnight inventory.
 */

import { NextResponse } from 'next/server'
import { assertCronOrDeskUser } from '@/lib/utils/devAuth'
import { deskPhaseAt, isDeskCooled, isOvernightInventoryWindow } from '@/lib/trading/deskClockPhase'
import {
  getDeskReprintSnapshot,
  reprintAllLiveDesks,
  tickDeskCooldown,
} from '@/lib/trading/deskReprint'
import { LIVE_DESK_NAMES } from '@/lib/trading/systematicDesk'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  if (!(await assertCronOrDeskUser(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const result = await tickDeskCooldown(now)
  const snapshots = LIVE_DESK_NAMES.map((inst) => {
    const s = getDeskReprintSnapshot(inst)
    if (!s) return { instrument: inst, ready: false }
    return {
      instrument: inst,
      ready: true,
      sessionYmd: s.sessionYmd,
      reprintedAt: s.reprintedAt,
      barCount: s.barCount,
      yPoc: s.yesterdayNyc?.poc ?? null,
      onPoc: s.overnight?.overnight?.poc ?? null,
      vwap: s.avwap5m?.vwap ?? null,
      source: s.source,
    }
  })
  return NextResponse.json({
    ok: true,
    phase: deskPhaseAt(now),
    cooled: isDeskCooled(now),
    inventoryWindow: isOvernightInventoryWindow(now),
    reprinted: result.reprinted,
    inventory: result.inventory,
    snapshots,
  })
}

export async function POST(request: Request) {
  if (!(await assertCronOrDeskUser(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'
  const now = new Date()
  const result = force
    ? { phase: deskPhaseAt(now), reprinted: (await reprintAllLiveDesks()).map((s) => s.instrument), inventory: [] }
    : await tickDeskCooldown(now)
  return NextResponse.json({ ok: true, ...result, phase: deskPhaseAt(now) })
}
