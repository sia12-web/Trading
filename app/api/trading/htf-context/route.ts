/**
 * GET & POST /api/trading/htf-context
 * Returns or calculates Layer 1 HTF Context State (Excess Tails & Poor Highs/Lows).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import { computeHTFContextState } from '@/lib/trading/htfSpecialist'
import { isDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'

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

    const htfState = computeHTFContextState({
        instrument,
        candles5m,
        candles15m,
        candles1h,
        asOfUnix,
        avwapAnchors,
        vpAnchors,
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
    })
}
