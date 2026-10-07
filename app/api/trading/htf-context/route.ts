/**
 * GET & POST /api/trading/htf-context
 * Returns or calculates Layer 1 HTF Context State (Excess Tails & Poor Highs/Lows).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { computeHTFContextState, type HTFBarInput } from '@/lib/trading/htfSpecialist'
import { isDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import { getYahooCandles } from '@/lib/yahoo/candles'
import type { Instrument } from '@/types/price-feed'

/** Daily sessions for the 5-day / 20-day bracket. Independent of the chart timeframe. */
async function loadDailyBracketBars(instrument: DeskInstrument): Promise<HTFBarInput[]> {
    try {
        const daily = await getYahooCandles(instrument as Instrument, '1D', 120)
        if (!daily?.candles?.length) return []
        return daily.candles
            .filter(
                (c) =>
                    Number.isFinite(c.time) &&
                    Number.isFinite(c.high) &&
                    Number.isFinite(c.low) &&
                    Number.isFinite(c.close) &&
                    c.high >= c.low
            )
            .map((c) => ({
                time: c.time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
            }))
    } catch {
        return []
    }
}

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const user = await getOrCreateUser(request)
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: {
        instrument?: unknown
        candles5m?: unknown
        candles15m?: unknown
        candles1h?: unknown
        asOfUnix?: unknown
        avwapAnchors?: unknown
        vpAnchors?: unknown
    } = {}

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const rawInstrument = String(body.instrument || 'DOW')
    const instrument: DeskInstrument = isDeskInstrument(rawInstrument)
        ? (rawInstrument as DeskInstrument)
        : 'DOW'

    const candles5m = Array.isArray(body.candles5m) ? body.candles5m : []
    const candles15m = Array.isArray(body.candles15m) ? body.candles15m : undefined
    const candles1h = Array.isArray(body.candles1h) ? body.candles1h : undefined
    const asOfUnix = typeof body.asOfUnix === 'number' ? body.asOfUnix : Math.floor(Date.now() / 1000)
    const avwapAnchors = Array.isArray(body.avwapAnchors) ? body.avwapAnchors : undefined
    const vpAnchors = Array.isArray(body.vpAnchors) ? body.vpAnchors : undefined

    const bracketBars = await loadDailyBracketBars(instrument)
    const htfState = computeHTFContextState({
        instrument,
        candles5m,
        candles15m,
        candles1h,
        asOfUnix,
        avwapAnchors,
        vpAnchors,
        bracketBars: bracketBars.length > 0 ? bracketBars : undefined,
    })

    // Optional: Persist HTF Context to Supabase htf_context_logs (non-blocking)
    try {
        const supabase = await createClient()
        await supabase.from('htf_context_logs').insert({
            user_id: user.id,
            instrument,
            as_of_unix: asOfUnix,
            status: htfState.status,
            summary_text: htfState.summaryText,
            primary_excess: htfState.primaryExcess,
            poor_extremes: htfState.poorExtremes,
        })
    } catch {
        // Non-blocking: database logging failover
    }

    return NextResponse.json({
        ok: true,
        htfState,
        state: htfState,
    })
}

export async function GET(request: NextRequest) {
    const user = await getOrCreateUser(request)
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const rawInstrument = searchParams.get('instrument') || 'DOW'
    const instrument: DeskInstrument = isDeskInstrument(rawInstrument)
        ? (rawInstrument as DeskInstrument)
        : 'DOW'

    const bracketBars = await loadDailyBracketBars(instrument)
    const htfState = computeHTFContextState({
        instrument,
        candles5m: [],
        asOfUnix: Math.floor(Date.now() / 1000),
        bracketBars,
    })

    return NextResponse.json({
        ok: true,
        state: htfState,
        htfState,
    })
}

