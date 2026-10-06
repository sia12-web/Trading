import { NextResponse } from 'next/server'
import { getLiveCrossMarketSnapshot } from '@/lib/trading/crossMarketFeed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const { volatility, radar } = await getLiveCrossMarketSnapshot()

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
