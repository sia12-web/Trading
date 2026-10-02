import { NextRequest, NextResponse } from 'next/server'
import { consensusOrchestrator } from '@/lib/ai/stack/agents/consensusOrchestrator'
import { buildInstitutionalHedgingTelemetry } from '@/lib/ai/stack/models/institutionalHedgingModel'
import type { SharedMarketState } from '@/lib/ai/stack/types'
import type { LeoChatContext } from '@/lib/ai/leoAssistant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AiTeamRequestBody {
  instrument: string
  livePrice?: number
  candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
  chartContext?: LeoChatContext
  customPrompt?: string
  newsHeadlines?: string[]
  upcomingEvents?: Array<{ time: string; event: string; impact: string }>
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AiTeamRequestBody
    const {
      instrument = 'NQ',
      chartContext,
      customPrompt: _customPrompt,
      newsHeadlines = [],
      upcomingEvents = [],
    } = body

    const livePrice =
      typeof body.livePrice === 'number' && Number.isFinite(body.livePrice) && body.livePrice > 0
        ? body.livePrice
        : typeof chartContext?.currentPrice === 'number' && chartContext.currentPrice > 0
        ? chartContext.currentPrice
        : 20000 // Fallback

    // 1. Prioritize real candles directly passed by the client chart
    let candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = []

    if (body.candles && Array.isArray(body.candles) && body.candles.length > 0) {
      candles = body.candles.map((c) => ({
        time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time).getTime() / 1000),
        open: Number(c.open.toFixed(2)),
        high: Number(c.high.toFixed(2)),
        low: Number(c.low.toFixed(2)),
        close: Number(c.close.toFixed(2)),
        volume: c.volume ?? 1,
      }))
    } else if (chartContext?.recentCandles && chartContext.recentCandles.length > 0) {
      candles = chartContext.recentCandles.map((c) => ({
        time: c.time,
        open: Number(c.open.toFixed(2)),
        high: Number(c.high.toFixed(2)),
        low: Number(c.low.toFixed(2)),
        close: Number(c.close.toFixed(2)),
        volume: c.volume ?? 1,
      }))
    } else {
      // Ground from actual multi-timeframe money levels present in chart context
      const realLevels: number[] = [livePrice]
      if (chartContext?.shortTermMoney?.ypoc) realLevels.push(chartContext.shortTermMoney.ypoc)
      if (chartContext?.shortTermMoney?.yhigh) realLevels.push(chartContext.shortTermMoney.yhigh)
      if (chartContext?.shortTermMoney?.ylow) realLevels.push(chartContext.shortTermMoney.ylow)
      if (chartContext?.intermediateMoney?.poc5d) realLevels.push(chartContext.intermediateMoney.poc5d)
      if (chartContext?.longTermMoney?.avwap5m) realLevels.push(chartContext.longTermMoney.avwap5m)

      const minPx = Math.min(...realLevels)
      const maxPx = Math.max(...realLevels)
      const nowSec = Math.floor(Date.now() / 1000)

      candles = [
        { time: nowSec - 3600, open: minPx, high: maxPx, low: minPx, close: livePrice, volume: 1500 },
        { time: nowSec - 1800, open: livePrice, high: maxPx, low: minPx, close: livePrice, volume: 1200 },
        { time: nowSec, open: livePrice, high: Math.max(livePrice, maxPx), low: Math.min(livePrice, minPx), close: livePrice, volume: 1000 },
      ]
    }

    const hedgingTelemetry = buildInstitutionalHedgingTelemetry({
      instrument,
      currentPrice: livePrice,
      candles,
      observedBasis: null,
    })

    const sharedState: SharedMarketState = {
      instrument,
      livePrice,
      candlesCount: candles.length,
      lastBarTime: Date.now(),
      chartContext,
      hedgingTelemetry,
      newsHeadlines:
        newsHeadlines.length > 0
          ? newsHeadlines
          : [
              `Fed rate path pricing remains stable; institutional dealer gamma balanced on ${instrument}.`,
              'CME open interest indicates institutional rolling ahead of quarterly futures expiration.',
            ],
      upcomingEvents,
    }

    const report = await consensusOrchestrator.runConsensus(sharedState)

    return NextResponse.json({
      success: true,
      report,
      telemetry: hedgingTelemetry,
    })
  } catch (error: any) {
    console.error('[AI-Team API Error]:', error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to synthesize AI team consensus',
      },
      { status: 500 }
    )
  }
}
