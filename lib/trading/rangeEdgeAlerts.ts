/**
 * Desk alerts — price enters ±10 of active playbook range while entries are unlocked.
 */

import {
  RANGE_EDGE_BAND_POINTS,
  isEntryWithinRangeEdgeBand,
  nearestRangeEdge,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'

export type RangeEdgeProximity = {
  edge: 'high' | 'low'
  center: number
  label: string
}

export function rangeEdgeProximity(
  livePrice: number | null | undefined,
  range: RangeEdgeLevels | null | undefined,
  bandPoints: number = RANGE_EDGE_BAND_POINTS
): RangeEdgeProximity | null {
  if (livePrice == null || !Number.isFinite(livePrice) || livePrice <= 0) return null
  if (!range || !isEntryWithinRangeEdgeBand(livePrice, range, bandPoints)) return null
  const edge = nearestRangeEdge(livePrice, range)
  if (!edge) return null
  return {
    edge,
    center: edge === 'high' ? range.high : range.low,
    label: range.label ? String(range.label) : 'strategy range',
  }
}

/** Rising edge: was outside band → now inside. */
export function shouldFireRangeEdgeAlert(
  wasInBand: boolean,
  nowInBand: boolean
): boolean {
  return !wasInBand && nowInBand
}

export function formatRangeEdgeAlertMessage(args: {
  instrument: string
  proximity: RangeEdgeProximity
  livePrice: number
  mode: 'limit' | 'market' | 'either'
}): { title: string; body: string; telegram: string } {
  const edgeLabel = args.proximity.edge === 'high' ? 'HIGH' : 'LOW'
  const title = `${args.instrument} at ${args.proximity.label} ${edgeLabel}`
  const modeHint =
    args.mode === 'market'
      ? 'Market entry is in the ±10 band.'
      : args.mode === 'limit'
        ? 'Limit / market entries allowed in the ±10 band.'
        : 'Limit or market — price is in the ±10 strategy band.'
  const body = `${modeHint} Live ${args.livePrice.toLocaleString()} · ${edgeLabel} ${args.proximity.center.toLocaleString()} (±${RANGE_EDGE_BAND_POINTS})`
  const telegram = `TradePulse · ${title}\n${body}`
  return { title, body, telegram }
}

export function formatWindowUnlockAlertMessage(args: {
  instrument: string
  windowLabel: string
  ladderHint?: string | null
}): { title: string; body: string; telegram: string } {
  const title = `${args.instrument} · ${args.windowLabel} unlocked`
  const body = args.ladderHint
    ? `Entries open — ${args.ladderHint}`
    : 'Entries open for this playbook window.'
  return { title, body, telegram: `TradePulse · ${title}\n${body}` }
}
