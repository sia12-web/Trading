import { NextRequest, NextResponse } from 'next/server'
import {
  analyzeAndBacktestBox,
  type BoxBacktestRequest,
  type BoxMarket,
  type BoxTimeframe,
} from '@/lib/trading/boxRangeBacktester'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const market: BoxMarket = (body.market?.toUpperCase() || 'GOLD') as BoxMarket
    const timeframe: BoxTimeframe = (body.timeframe || '1D') as BoxTimeframe

    // Parse dates or timestamps
    let startTime = body.startTime
    if (typeof startTime === 'string') {
      startTime = Math.floor(new Date(startTime).getTime() / 1000)
    }
    if (!startTime || isNaN(startTime)) {
      // Default to January 26, 2026 00:00:00 UTC
      startTime = 1769385600
    }

    let endTime = body.endTime
    if (typeof endTime === 'string') {
      endTime = Math.floor(new Date(endTime).getTime() / 1000)
    }
    if (!endTime || isNaN(endTime)) {
      endTime = Math.floor(Date.now() / 1000)
    }

    const request: BoxBacktestRequest = {
      market,
      timeframe,
      startTime,
      endTime,
      highPrice: body.highPrice != null ? parseFloat(body.highPrice) : undefined,
      lowPrice: body.lowPrice != null ? parseFloat(body.lowPrice) : undefined,
      label: body.label || `${market} ${timeframe} Box Analysis`,
    }

    const result = analyzeAndBacktestBox(request)

    return NextResponse.json({
      success: true,
      analysis: result,
    })
  } catch (error: any) {
    console.error('Error running box backtest:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to analyze and backtest box',
      },
      { status: 500 }
    )
  }
}
