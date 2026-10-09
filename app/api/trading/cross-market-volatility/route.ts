import { NextResponse } from 'next/server'
import { getCrossMarketVolatility } from '@/lib/trading/crossMarketVolatility'
import { getLiveCrossMarketRadarReport } from '@/lib/trading/crossMarketRadar'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const volatility = await getCrossMarketVolatility()
    const radar = await getLiveCrossMarketRadarReport(volatility)

    return NextResponse.json({
      success: true,
      volatility,
      radar,
      asOfIso: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch cross-market volatility' },
      { status: 500 }
    )
  }
}

