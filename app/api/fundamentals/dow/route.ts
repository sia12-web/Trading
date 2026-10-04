import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  getDowFundamentalState,
  resetDowFundamentalState,
  refreshDowTelemetry,
  formatTodaysDowFundamentalStateText,
} from '@/lib/fundamentals/dowStateStore'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format')

    const state = await getDowFundamentalState()
    const todayText = formatTodaysDowFundamentalStateText(state.today)

    if (format === 'text') {
      return new Response(todayText, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    return NextResponse.json({
      ok: true,
      today: state.today,
      todayText,
      feeds: state.feeds,
      dowTelemetry: state.dowTelemetry,
      contributions: state.contribution,
      rotation: state.rotation,
      credit: state.credit,
      industrialCycle: state.industrial,
      drivers: state.drivers,
      state,
    })
  } catch (err) {
    logger.error('[Dow Fundamentals API] Failed to fetch state', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: 'reset' | 'refresh_telemetry'
    }

    if (body.action === 'reset') {
      const state = resetDowFundamentalState()
      const todayText = formatTodaysDowFundamentalStateText(state.today)
      return NextResponse.json({
        ok: true,
        state,
        today: state.today,
        todayText,
        message: 'Dow fundamental state reset to baseline.',
      })
    }

    if (body.action === 'refresh_telemetry') {
      const telemetry = await refreshDowTelemetry()
      const state = await getDowFundamentalState()
      const todayText = formatTodaysDowFundamentalStateText(state.today)
      return NextResponse.json({ ok: true, telemetry, today: state.today, todayText, state })
    }

    const state = await getDowFundamentalState()
    const todayText = formatTodaysDowFundamentalStateText(state.today)
    return NextResponse.json({ ok: true, state, today: state.today, todayText })
  } catch (err) {
    logger.error('[Dow Fundamentals API] Failed to process POST', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
