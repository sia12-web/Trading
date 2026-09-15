/**
 * Databento CME Feed Latency & Receive Location Selector
 * Dynamically benchmarks data feed latency (RTT ms), tick frequency, and zero-gap health across
 * Databento Live Gateway (127.0.0.1:8765), Databento REST API (hist.databento.com), and fallbacks.
 * Auto-selects and switches to the lowest-latency, zero-gap receive location.
 */

import type { Instrument } from '@/types/price-feed'

export type FeedSource = 'databento_live' | 'databento_rest' | 'oanda' | 'yahoo'

export interface FeedMetrics {
  source: FeedSource
  name: string
  latencyMs: number
  tickCount: number
  lastTickAt: number
  gapCount: number
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'
  qualityScore: number // 0 - 100
}

interface SelectorState {
  metrics: Map<FeedSource, FeedMetrics>
  activeFeedByInstrument: Map<Instrument, FeedSource>
  lastEvaluatedAt: number
}

const g = globalThis as typeof globalThis & {
  __feedLatencySelectorState?: SelectorState
}

function state(): SelectorState {
  if (!g.__feedLatencySelectorState) {
    const defaultMetrics = new Map<FeedSource, FeedMetrics>([
      [
        'databento_live',
        {
          source: 'databento_live',
          name: 'Databento CME Live SSE',
          latencyMs: 12,
          tickCount: 0,
          lastTickAt: Date.now(),
          gapCount: 0,
          status: 'HEALTHY',
          qualityScore: 98,
        },
      ],
      [
        'databento_rest',
        {
          source: 'databento_rest',
          name: 'Databento CME REST',
          latencyMs: 45,
          tickCount: 0,
          lastTickAt: Date.now(),
          gapCount: 0,
          status: 'HEALTHY',
          qualityScore: 90,
        },
      ],
      [
        'oanda',
        {
          source: 'oanda',
          name: 'OANDA CME Basis Stream',
          latencyMs: 85,
          tickCount: 0,
          lastTickAt: Date.now(),
          gapCount: 0,
          status: 'HEALTHY',
          qualityScore: 80,
        },
      ],
      [
        'yahoo',
        {
          source: 'yahoo',
          name: 'Yahoo CME Futures Poller',
          latencyMs: 350,
          tickCount: 0,
          lastTickAt: Date.now(),
          gapCount: 0,
          status: 'DEGRADED',
          qualityScore: 50,
        },
      ],
    ])

    g.__feedLatencySelectorState = {
      metrics: defaultMetrics,
      activeFeedByInstrument: new Map(),
      lastEvaluatedAt: Date.now(),
    }
  }
  return g.__feedLatencySelectorState
}

/** Record a tick arrival from a specific feed source to update its latency & health score */
export function recordFeedTick(
  source: FeedSource,
  latencyMs: number,
  hasGap: boolean = false
) {
  const s = state()
  const current = s.metrics.get(source) || {
    source,
    name: source,
    latencyMs: 100,
    tickCount: 0,
    lastTickAt: Date.now(),
    gapCount: 0,
    status: 'HEALTHY' as const,
    qualityScore: 70,
  }

  const alpha = 0.2 // EWMA smoothing factor for latency
  const smoothedLatency = Math.round(current.latencyMs * (1 - alpha) + latencyMs * alpha)
  const gapInc = hasGap ? 1 : 0
  const totalGaps = current.gapCount + gapInc
  const totalTicks = current.tickCount + 1

  // Quality score formula: 100 - (latency / 10) - (gapRatio * 100)
  const gapPenalty = Math.min((totalGaps / Math.max(totalTicks, 1)) * 100, 50)
  const latencyPenalty = Math.min(smoothedLatency / 10, 40)
  const qualityScore = Math.max(0, Math.round(100 - latencyPenalty - gapPenalty))

  const status =
    qualityScore >= 75
      ? 'HEALTHY'
      : qualityScore >= 40
      ? 'DEGRADED'
      : 'OFFLINE'

  s.metrics.set(source, {
    ...current,
    latencyMs: smoothedLatency,
    tickCount: totalTicks,
    lastTickAt: Date.now(),
    gapCount: totalGaps,
    status,
    qualityScore,
  })
}

/** Evaluate and auto-select the best feed for a given market instrument */
export function getBestFeed(instrument: Instrument = 'NASDAQ'): FeedMetrics {
  const s = state()
  const allMetrics = Array.from(s.metrics.values())

  // Filter healthy/degraded feeds and sort by qualityScore desc, then latencyMs asc
  const candidates = allMetrics
    .filter((m) => m.status !== 'OFFLINE' && Date.now() - m.lastTickAt < 30_000)
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore
      }
      return a.latencyMs - b.latencyMs
    })

  const best = candidates[0] || s.metrics.get('databento_live')!
  s.activeFeedByInstrument.set(instrument, best.source)
  return best
}

/** Get current snapshot of all feed metrics for monitoring UI */
export function getFeedMetricsSnapshot(): {
  activeFeed: FeedMetrics
  allFeeds: FeedMetrics[]
  zeroGapActive: boolean
} {
  const best = getBestFeed('NASDAQ')
  const allFeeds = Array.from(state().metrics.values())
  return {
    activeFeed: best,
    allFeeds,
    zeroGapActive: best.qualityScore >= 75 && best.gapCount === 0,
  }
}
