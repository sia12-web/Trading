import { NextResponse } from 'next/server'
import { getCrossMarketVolatility } from '@/lib/trading/crossMarketVolatility'
import { buildCrossMarketRadarReport, loadLiveRadarInputs } from '@/lib/trading/crossMarketRadar'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const [volatility, inputs] = await Promise.all([
      getCrossMarketVolatility(),
      loadLiveRadarInputs(),
    ])
    const radar = buildCrossMarketRadarReport(volatility, inputs)

    return NextResponse.json({
      success: true,
      volatility,
      radar,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch cross-market volatility' },
      { status: 500 }
    )
  }
}
