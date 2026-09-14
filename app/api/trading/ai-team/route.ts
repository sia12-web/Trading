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

    // Prioritize real candles from chart context if available
    let candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = []

    if (chartContext?.recentCandles && chartContext.recentCandles.length > 0) {
      candles = chartContext.recentCandles.map((c) => ({
        time: c.time,
        open: Number(c.open.toFixed(2)),
        high: Number(c.high.toFixed(2)),
        low: Number(c.low.toFixed(2)),
        close: Number(c.close.toFixed(2)),
        volume: c.volume ?? 1,
      }))
    } else {
      // Derive pseudo-candles from chart context data points or baseline
      const dataPoints = chartContext?.dataPoints || chartContext?.selectedDataPoints || []
      candles = dataPoints
        .filter((p) => p.category === 'POC' || p.category === 'VWAP' || p.category === 'EXTREME')
        .map((p, idx) => {
          const val = typeof p.value === 'number' ? p.value : parseFloat(String(p.value)) || livePrice
          return {
            time: Math.floor(Date.now() / 1000) - (20 - idx) * 300,
            open: Number(val.toFixed(2)),
            high: Number((val * 1.002).toFixed(2)),
            low: Number((val * 0.998).toFixed(2)),
            close: Number(val.toFixed(2)),
            volume: typeof p.volume === 'number' ? p.volume : 500,
          }
        })

      // If still no candles in context, construct 20-bar baseline around livePrice
      if (candles.length === 0) {
        for (let i = 0; i < 20; i++) {
          const delta = Math.sin(i / 3) * (livePrice * 0.003)
          const close = Number((livePrice + delta).toFixed(2))
          candles.push({
            time: Math.floor(Date.now() / 1000) - (20 - i) * 300,
            open: Number((close - 2).toFixed(2)),
            high: Number((close + (livePrice * 0.002)).toFixed(2)),
            low: Number((close - (livePrice * 0.002)).toFixed(2)),
            close,
            volume: 800 + i * 20,
          })
        }
      }
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
