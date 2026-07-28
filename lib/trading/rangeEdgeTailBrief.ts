/**
 * Server-side brief of the latest good/strong range-edge tail for Leo.
 * Soft-fails to null when OANDA candles or shaped range are unavailable.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import {
  computeOr30Range,
} from '@/lib/chart/openingRange30'
import {
  computeInitialBalance,
} from '@/lib/trading/deskLevels'
import {
  computeNycLunchRange,
  isNycLunchInstrument,
} from '@/lib/chart/nycLunchSessionRange'
import {
  currentNikkeiUsRangeForChart,
} from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  computeRangeEdgeTails,
  latestQualityTail,
  type RangeEdgeTailTier,
  type ShapedRangeForTails,
} from '@/lib/chart/rangeEdgeTails'
import { activeRangeForPlaybook } from '@/lib/trading/strategyRiskGeometry'
import {
  resolveDeskPlaybookMode,
} from '@/lib/trading/deskPlaybookMode'
import {
  sessionFor,
  type DeskInstrument,
  type RangeStrategy,
} from '@/lib/trading/sessionGate'
import {
  attemptLadderFromCounts,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Instrument } from '@/types/price-feed'

export type RangeEdgeTailBrief = {
  present: boolean
  edge: 'high' | 'low' | null
  tier: RangeEdgeTailTier | null
  ratio: number | null
  label: string | null
  text: string | null
  ageSec: number | null
  wickPts: number | null
  bodyPts: number | null
}

function emptyBrief(): RangeEdgeTailBrief {
  return {
    present: false,
    edge: null,
    tier: null,
    label: null,
    text: null,
    ratio: null,
    ageSec: null,
    wickPts: null,
    bodyPts: null,
  }
}

export async function buildRangeEdgeTailBrief(args: {
  instrument: DeskInstrument
  now?: Date
  ladder?: AttemptLadder
  rangeStrategy?: RangeStrategy | null
  morningAttempts?: number
}): Promise<RangeEdgeTailBrief> {
  const now = args.now ?? new Date()
  const nowUnix = Math.floor(now.getTime() / 1000)
  try {
    const packed = await getOandaCandles(args.instrument as Instrument, '5', 2)
    const candles = packed?.candles ?? []
    if (!candles.length) return emptyBrief()

    const deskBars = candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))

    const sess = sessionFor(args.instrument)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: sess.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const [oh, om] = sess.marketOpen.split(':').map(Number)
    const openUnix =
      args.instrument === 'NIKKEI'
        ? tokyoDateTimeToUnix(todayLocal, oh!, om || 0)
        : nyDateTimeToUnix(todayLocal, oh!, om || 0)

    const or30 = computeOr30Range(deskBars, openUnix, nowUnix)
    const ib = computeInitialBalance(deskBars, openUnix, nowUnix, 60)
    const lunch =
      isNycLunchInstrument(args.instrument)
        ? computeNycLunchRange(deskBars, todayLocal, nowUnix)
        : null
    const us =
      args.instrument === 'NIKKEI'
        ? currentNikkeiUsRangeForChart(deskBars, nowUnix)
        : null

    const ladder =
      args.ladder ??
      attemptLadderFromCounts({
        morningAttempts: args.morningAttempts ?? 0,
        now,
        instrument: args.instrument,
      })
    const playbookMode = resolveDeskPlaybookMode({
      instrument: args.instrument,
      now,
      rangeStrategy: args.rangeStrategy ?? null,
      ladder,
    })
    const strategyRange = activeRangeForPlaybook({
      playbookMode,
      instrument: args.instrument,
      or30,
      ib,
      usRange: us,
      lunchRange: lunch,
      morningAttempts: ladder.morningAttempts,
    })
    if (!strategyRange) return emptyBrief()

    let shaped: ShapedRangeForTails | null = null
    if (
      or30?.complete &&
      or30.high === strategyRange.high &&
      or30.low === strategyRange.low
    ) {
      shaped = { ...strategyRange, complete: true, lockedUnix: or30.endUnix }
    } else if (
      ib &&
      ib.high === strategyRange.high &&
      ib.low === strategyRange.low
    ) {
      shaped = { ...strategyRange, complete: true, lockedUnix: ib.endUnix }
    } else if (
      lunch?.complete &&
      lunch.high === strategyRange.high &&
      lunch.low === strategyRange.low
    ) {
      shaped = {
        ...strategyRange,
        complete: true,
        lockedUnix: lunch.lunchEndUnix,
      }
    } else if (
      us?.complete &&
      us.high === strategyRange.high &&
      us.low === strategyRange.low
    ) {
      shaped = { ...strategyRange, complete: true, lockedUnix: us.toTime }
    }
    if (!shaped) return emptyBrief()

    const tails = computeRangeEdgeTails(deskBars, shaped)
    const quality = latestQualityTail(tails, 'good')
    if (!quality) return emptyBrief()

    return {
      present: true,
      edge: quality.edge,
      tier: quality.tier,
      ratio: quality.ratio,
      label: quality.label,
      text: quality.text,
      ageSec: Math.max(0, nowUnix - quality.time),
      wickPts: quality.wickPts,
      bodyPts: quality.bodyPts,
    }
  } catch {
    return emptyBrief()
  }
}
