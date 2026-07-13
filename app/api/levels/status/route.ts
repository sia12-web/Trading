import { NextRequest, NextResponse } from 'next/server'
import { getLevelStatusManager } from '@/lib/services/levelStatusManager'
import type { Instrument } from '@/types/price-feed'

/**
 * GET /api/levels/status
 * Get current level status for one or more instruments
 *
 * Query params:
 *   - instruments: Comma-separated list (DOW,NASDAQ,NIKKEI). Required.
 *   - critical_only: Boolean (optional). If true, only return approaching/touched/broken levels.
 */
export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const instrumentsParam = request.nextUrl.searchParams.get('instruments')
    const criticalOnly = request.nextUrl.searchParams.get('critical_only') === 'true'

    if (!instrumentsParam) {
      return NextResponse.json(
        { error: 'Missing instruments parameter (required: DOW,NASDAQ,NIKKEI)' },
        { status: 400 }
      )
    }

    // Parse and validate instruments
    const parsed = instrumentsParam.split(',').filter((i) => i.trim())
    const instruments = parsed.filter((i) =>
      ['DOW', 'NASDAQ', 'NIKKEI'].includes(i)
    ) as Instrument[]

    if (instruments.length === 0) {
      return NextResponse.json(
        { error: 'Invalid instruments parameter. Must be DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const levelStatusManager = getLevelStatusManager()
    const results = []

    for (const instrument of instruments) {
      const levels = criticalOnly
        ? levelStatusManager.getCriticalLevels(instrument)
        : levelStatusManager.getLevels(instrument)

      const currentPrice = levelStatusManager.getCurrentPrice(instrument)

      results.push({
        instrument,
        currentPrice,
        levels: levels.map((level) => ({
          level: level.level,
          status: level.status,
          proximity: level.currentDistance.proximity,
          distance: parseFloat(level.currentDistance.distance.toFixed(2)),
          distancePct: parseFloat(level.currentDistance.distancePct.toFixed(4)),
          touchedAt: level.touchedAt?.toISOString() || null,
          brokenAt: level.brokenAt?.toISOString() || null,
          bounceCount: level.bounceCount,
          lastTouchPrice: level.lastTouchPrice,
        })),
        timestamp: new Date().toISOString(),
      })
    }

    return NextResponse.json(
      {
        success: true,
        data: results,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Levels Status API] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
