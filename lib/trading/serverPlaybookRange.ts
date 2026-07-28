/**
 * Server-side locked playbook range for ±10 entry checks.
 * Recomputes OR30 / IB / US Range / Lunch from OANDA candles so clients
 * cannot spoof range_high / range_low.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import { computeOr30Range } from '@/lib/chart/openingRange30'
import { computeInitialBalance } from '@/lib/trading/deskLevels'
import {
  computeNycLunchRange,
  isNycLunchInstrument,
} from '@/lib/chart/nycLunchSessionRange'
import { currentNikkeiUsRangeForChart } from '@/lib/chart/nikkeiUsRangeBreakout'
import { activeRangeForPlaybook } from '@/lib/trading/strategyRiskGeometry'
import { resolveDeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
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
import type { StrategyRangeEdges } from '@/lib/trading/strategyRiskGeometry'
import {
  assertRangeEdgeEntry,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'
import { logger } from '@/lib/utils/logger'

export async function resolveServerPlaybookRange(args: {
  instrument: DeskInstrument
  now?: Date
  ladder?: AttemptLadder
  rangeStrategy?: RangeStrategy | null
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
}): Promise<StrategyRangeEdges | null> {
  const now = args.now ?? new Date()
  const nowUnix = Math.floor(now.getTime() / 1000)
  try {
    const packed = await getOandaCandles(args.instrument as Instrument, '5', 2)
    const candles = packed?.candles ?? []
    if (!candles.length) return null

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
    const lunch = isNycLunchInstrument(args.instrument)
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
        ibAttempts: args.ibAttempts ?? 0,
        lunchAttempts: args.lunchAttempts ?? 0,
        now,
        instrument: args.instrument,
      })

    const playbookMode = resolveDeskPlaybookMode({
      instrument: args.instrument,
      now,
      rangeStrategy: args.rangeStrategy ?? null,
      ladder,
    })

    return activeRangeForPlaybook({
      playbookMode,
      instrument: args.instrument,
      or30,
      ib,
      usRange: us,
      lunchRange: lunch,
      morningAttempts: ladder.morningAttempts,
    })
  } catch (err) {
    logger.warn('server_playbook_range.failed', { err, instrument: args.instrument })
    return null
  }
}

/**
 * Prefer server-computed locked range; fall back to client only if OANDA is down.
 * When both exist and disagree beyond 1 pt, reject (possible spoof / stale chart).
 */
export async function assertServerRangeEdgeEntry(args: {
  instrument: DeskInstrument
  entry: number
  clientRange: { high: number; low: number; label?: string | null } | null
  rangeStrategy?: RangeStrategy | null
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
  ladder?: AttemptLadder
}): Promise<{ ok: true; range: RangeEdgeLevels } | { ok: false; message: string }> {
  const server = await resolveServerPlaybookRange({
    instrument: args.instrument,
    rangeStrategy: args.rangeStrategy,
    morningAttempts: args.morningAttempts,
    ibAttempts: args.ibAttempts,
    lunchAttempts: args.lunchAttempts,
    ladder: args.ladder,
  })

  if (server) {
    if (args.clientRange) {
      const dh = Math.abs(Number(args.clientRange.high) - server.high)
      const dl = Math.abs(Number(args.clientRange.low) - server.low)
      if (dh > 1 || dl > 1) {
        return {
          ok: false,
          message: `Range mismatch — server ${server.label ?? 'strategy'} H ${server.high} / L ${server.low}. Refresh the chart and retry.`,
        }
      }
    }
    return assertRangeEdgeEntry({ entry: args.entry, range: server })
  }

  // Soft-fail: OANDA unavailable — still require client shaped range
  return assertRangeEdgeEntry({ entry: args.entry, range: args.clientRange })
}
