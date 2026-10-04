import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  getNasdaqFundamentalState,
  resetNasdaqFundamentalState,
  refreshNasdaqTelemetry,
  formatTodaysNasdaqFundamentalStateText,
} from '@/lib/fundamentals/nasdaqStateStore'
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

    const state = await getNasdaqFundamentalState()
    const todayText = formatTodaysNasdaqFundamentalStateText(state.today)

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
      nasdaqTelemetry: state.nasdaqTelemetry,
      drivers: state.drivers,
      breadth: state.breadth,
      semiCycle: state.semiCycle,
      earningsCycle: state.earningsCycle,
      state,
    })
  } catch (err) {
    logger.error('[Nasdaq Fundamentals API] Failed to fetch state', err)
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
      const state = resetNasdaqFundamentalState()
      const todayText = formatTodaysNasdaqFundamentalStateText(state.today)
      return NextResponse.json({
        ok: true,
        state,
        today: state.today,
        todayText,
        message: 'Nasdaq fundamental state reset to baseline.',
      })
    }

    if (body.action === 'refresh_telemetry') {
      const telemetry = await refreshNasdaqTelemetry()
      const state = await getNasdaqFundamentalState()
      const todayText = formatTodaysNasdaqFundamentalStateText(state.today)
      return NextResponse.json({ ok: true, telemetry, today: state.today, todayText, state })
    }

    const state = await getNasdaqFundamentalState()
    const todayText = formatTodaysNasdaqFundamentalStateText(state.today)
    return NextResponse.json({ ok: true, state, today: state.today, todayText })
  } catch (err) {
    logger.error('[Nasdaq Fundamentals API] Failed to process POST', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
