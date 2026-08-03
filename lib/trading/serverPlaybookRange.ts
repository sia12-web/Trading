/**
 * Server-side locked playbook range for ±10 entry checks (H / 50% mid / L;
 * US Range is H / L only).
 * Recomputes OR30 / IB / US Range / Lunch from OANDA candles so clients
 * cannot spoof range_high / range_low.
 *
 * Entries are attributed to the SPECIFIC range the price sits in (±10 of its
 * H / 50% / L, or H / L for US Range) — never just the single sequential
 * "active" range — so an IB click stays billed to IB even once the desk clock
 * has moved the default highlight on to Lunch-range (and vice versa). See
 * assertBucketEntryEligible.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import { computeOr30Range } from '@/lib/chart/openingRange30'
import { computeInitialBalance } from '@/lib/trading/deskLevels'
import {
  computeNycLunchRange,
  isNycLunchInstrument,
} from '@/lib/chart/nycLunchSessionRange'
import { currentNikkeiUsRangeForChart } from '@/lib/chart/nikkeiUsRangeBreakout'
import { activeRangeForPlaybook, shapedPlaybookRanges } from '@/lib/trading/strategyRiskGeometry'
import { resolveDeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
import {
  sessionFor,
  deskMarketFor,
  type DeskInstrument,
  type RangeStrategy,
} from '@/lib/trading/sessionGate'
import {
  attemptLadderFromCounts,
  assertBucketEntryEligible,
  deskClockSeconds,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Instrument } from '@/types/price-feed'
import type { StrategyRangeEdges } from '@/lib/trading/strategyRiskGeometry'
import {
  assertRangeEdgeEntry,
  findRangeEdgeBandHit,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'
import { logger } from '@/lib/utils/logger'

/**
 * Calendar days of M5 history for server ±10 gates.
 *
 * Must clear the Friday NYC → Monday Tokyo gap: a 2-day window from Monday
 * morning JST (Sunday evening ET) starts *after* Friday 16:00 ET, so the prior
 * NYC session is missing while the live chart (12d) still paints US H/L/mid.
 * Five days covers that weekend hole plus a holiday cushion.
 */
export const SERVER_PLAYBOOK_CANDLE_DAYS = 5

export type ServerPlaybookBundle = {
  active: StrategyRangeEdges | null
  shaped: {
    or30: StrategyRangeEdges | null
    ib: StrategyRangeEdges | null
    usRange: StrategyRangeEdges | null
    lunchRange: StrategyRangeEdges | null
  }
  ladder: AttemptLadder
}

async function resolveServerPlaybookBundle(args: {
  instrument: DeskInstrument
  now?: Date
  ladder?: AttemptLadder
  rangeStrategy?: RangeStrategy | null
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
}): Promise<ServerPlaybookBundle | null> {
  const now = args.now ?? new Date()
  const nowUnix = Math.floor(now.getTime() / 1000)
  try {
    const packed = await getOandaCandles(
      args.instrument as Instrument,
      '5',
      SERVER_PLAYBOOK_CANDLE_DAYS
    )
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

    const shaped = shapedPlaybookRanges({
      instrument: args.instrument,
      or30,
      ib,
      usRange: us,
      lunchRange: lunch,
    })

    const active = activeRangeForPlaybook({
      playbookMode,
      instrument: args.instrument,
      or30,
      ib,
      usRange: us,
      lunchRange: lunch,
      morningAttempts: ladder.morningAttempts,
    })

    return { active, shaped, ladder }
  } catch (err) {
    logger.warn('server_playbook_range.failed', { err, instrument: args.instrument })
    return null
  }
}

/** @deprecated Prefer resolveServerPlaybookBundle — kept for any external callers. */
export async function resolveServerPlaybookRange(args: {
  instrument: DeskInstrument
  now?: Date
  ladder?: AttemptLadder
  rangeStrategy?: RangeStrategy | null
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
}): Promise<StrategyRangeEdges | null> {
  const bundle = await resolveServerPlaybookBundle(args)
  return bundle?.active ?? null
}

/**
 * Server range is the sole authority for ±10 entry checks (H / 50% mid / L;
 * US Range H / L only).
 * Client H/L is ignored for pass/fail (chart live-tip merge / stale paint /
 * Yahoo fallback can differ from OANDA by more than 1pt without spoofing).
 * Spoofed client ranges cannot widen the band — entry is always checked vs server.
 */
export function gateEntryAgainstAuthoritativeRange(args: {
  entry: number
  serverRange: RangeEdgeLevels | null
  clientRange: RangeEdgeLevels | null
}): { ok: true; range: RangeEdgeLevels } | { ok: false; message: string } {
  if (args.serverRange) {
    return assertRangeEdgeEntry({ entry: args.entry, range: args.serverRange })
  }
  return assertRangeEdgeEntry({ entry: args.entry, range: args.clientRange })
}

/**
 * Attribute an entry to a shaped playbook range (pure — used by the server gate
 * and unit-tested for the Monday weekend-gap US Range soft-fallback).
 *
 * Order:
 * 1. Price hit on a server-shaped ±10 band (never trusts client label)
 * 2. Client label match among server-shaped candidates
 * 3. Client US Range soft-fallback when server could not shape US (weekend gap)
 *    — must run *before* sequential `active`, otherwise OR30/IB as active
 *    swallows US mid and the fallback never fires
 * 4. Sequential active highlight
 */
export function attributeServerPlaybookEntry(args: {
  entry: number
  shaped: ServerPlaybookBundle['shaped']
  active: StrategyRangeEdges | null
  clientRange: { high: number; low: number; label?: string | null } | null
}): { range: StrategyRangeEdges | null; usedUsClientFallback: boolean } {
  const candidates = [
    args.shaped.or30,
    args.shaped.ib,
    args.shaped.usRange,
    args.shaped.lunchRange,
  ].filter((r): r is StrategyRangeEdges => !!r)

  const hit = findRangeEdgeBandHit(args.entry, candidates)
  let attributed: StrategyRangeEdges | null =
    hit?.range ??
    (args.clientRange
      ? candidates.find((r) => r.label === args.clientRange!.label) ?? null
      : null)

  let usedUsClientFallback = false
  // Weekend gap: server shaped OR30/IB from *today* but history missed Friday
  // NYC — chart still paints US H/L. Accept client US Range only when the
  // server could not shape one (never overrides a server US Range). Must not
  // wait until after `active` — morning OR30 as active would block this path.
  if (
    !attributed &&
    !args.shaped.usRange &&
    args.clientRange &&
    args.clientRange.label === 'US Range'
  ) {
    const clientUs: StrategyRangeEdges = {
      label: 'US Range',
      high: Number(args.clientRange.high),
      low: Number(args.clientRange.low),
    }
    const trial = assertRangeEdgeEntry({ entry: args.entry, range: clientUs })
    if (trial.ok) {
      attributed = clientUs
      usedUsClientFallback = true
    }
  }

  if (!attributed) attributed = args.active
  return { range: attributed, usedUsClientFallback }
}

/**
 * Prefer server-computed locked ranges; fall back to client only if OANDA is
 * down. Attribution: the entry is billed against whichever SHAPED range's
 * ±10 band the price actually sits in (server-authoritative, price-based) —
 * not the client's claimed label and not the single sequential "active"
 * range. This is what keeps IB clicks billed to IB (and Lunch to Lunch) even
 * once the desk clock's default highlight has moved on.
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
  now?: Date
}): Promise<{ ok: true; range: RangeEdgeLevels } | { ok: false; message: string }> {
  const bundle = await resolveServerPlaybookBundle({
    instrument: args.instrument,
    rangeStrategy: args.rangeStrategy,
    morningAttempts: args.morningAttempts,
    ibAttempts: args.ibAttempts,
    lunchAttempts: args.lunchAttempts,
    ladder: args.ladder,
    now: args.now,
  })

  if (!bundle) {
    // OANDA unreachable — fall back to the old single-range client check.
    return gateEntryAgainstAuthoritativeRange({
      entry: args.entry,
      serverRange: null,
      clientRange: args.clientRange,
    })
  }

  const { shaped, active, ladder } = bundle
  const candidates = [shaped.or30, shaped.ib, shaped.usRange, shaped.lunchRange].filter(
    (r): r is StrategyRangeEdges => !!r
  )

  // OANDA returned bars but nothing shaped (weekend lookback still short, or
  // sparse history) — treat like OANDA-down and allow the chart's locked
  // client range through the same ±10 check. When any server range is shaped,
  // client H/L cannot widen or substitute.
  if (candidates.length === 0) {
    return gateEntryAgainstAuthoritativeRange({
      entry: args.entry,
      serverRange: null,
      clientRange: args.clientRange,
    })
  }

  const { range: attributed, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: args.entry,
    shaped,
    active,
    clientRange: args.clientRange,
  })

  if (usedUsClientFallback && attributed) {
    logger.info('server_playbook_range.us_range_client_fallback', {
      instrument: args.instrument,
      high: attributed.high,
      low: attributed.low,
      entry: args.entry,
    })
  }

  if (args.clientRange && attributed) {
    const dh = Math.abs(Number(args.clientRange.high) - attributed.high)
    const dl = Math.abs(Number(args.clientRange.low) - attributed.low)
    if (dh > 1 || dl > 1 || args.clientRange.label !== attributed.label) {
      logger.info('server_playbook_range.client_stale', {
        instrument: args.instrument,
        serverLabel: attributed.label,
        serverHigh: attributed.high,
        serverLow: attributed.low,
        clientHigh: args.clientRange.high,
        clientLow: args.clientRange.low,
        clientLabel: args.clientRange.label ?? null,
        dh,
        dl,
      })
    }
  }

  const edge = assertRangeEdgeEntry({ entry: args.entry, range: attributed })
  if (!edge.ok) return edge

  const market = deskMarketFor(args.instrument)
  const nowSec = deskClockSeconds(args.instrument, args.now ?? new Date())
  const bucketCheck = assertBucketEntryEligible({
    instrument: args.instrument,
    market,
    timeSec: nowSec,
    ladder,
    rangeLabel: attributed?.label ?? null,
  })
  if (!bucketCheck.ok) {
    return { ok: false, message: bucketCheck.message }
  }

  return { ok: true, range: attributed as RangeEdgeLevels }
}
