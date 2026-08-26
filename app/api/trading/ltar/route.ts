import { NextResponse } from 'next/server'
import { computeHTFContextState } from '@/lib/trading/htfSpecialist'
import { generateDailyLTARRecord } from '@/lib/trading/ltarStore'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const instrument = searchParams.get('instrument') || 'DOW'
        const dateStr = searchParams.get('date') || undefined

        // Mock candle data generator for HTF state fallback if live feed is starting
        const basePrice = instrument === 'NASDAQ' ? 19800 : instrument === 'DOW' ? 41200 : 38900
        const now = Math.floor(Date.now() / 1000)
        const mockBars = Array.from({ length: 48 }, (_, i) => ({
            time: now - (48 - i) * 300,
            timestamp: now - (48 - i) * 300,
            open: basePrice + Math.sin(i / 3) * 30,
            high: basePrice + Math.sin(i / 3) * 30 + 15,
            low: basePrice + Math.sin(i / 3) * 30 - 15,
            close: basePrice + Math.sin((i + 1) / 3) * 30,
            volume: 1500 + Math.floor(Math.random() * 500),
        }))

        const htfState = computeHTFContextState({
            instrument,
            candles5m: mockBars,
            asOfUnix: now,
        })

        const ltarRecord = generateDailyLTARRecord(htfState, dateStr)

        return NextResponse.json({
            ok: true,
            record: ltarRecord,
        })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to generate LTAR record'
        return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }
}
