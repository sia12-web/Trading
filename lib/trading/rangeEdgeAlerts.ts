/**
 * Desk alerts — price enters ±10 of active playbook range (H / 50% / L)
 * while entries are unlocked. Message templates live in deskSessionNotes.
 */

import {
  RANGE_EDGE_BAND_POINTS,
  isEntryWithinRangeEdgeBand,
  nearestRangeEdge,
  rangeMidpoint,
  type RangeEdgeKind,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'

export type RangeEdgeProximity = {
  edge: RangeEdgeKind
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
  const mid = rangeMidpoint(range)
  const center =
    edge === 'high' ? range.high : edge === 'low' ? range.low : mid != null ? mid : range.low
  return {
    edge,
    center,
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

export {
  formatRangeEdgeAlertMessage,
  formatWindowUnlockAlertMessage,
  formatEntryPermissionNote,
  formatRangeShapedNote,
  formatClockInNote,
  formatSessionStartNote,
  formatSessionEndNote,
  formatSessionScheduleBlock,
  claimDeskNoteOnce,
  claimDeskNoteCooldown,
  hasDeskNoteClaim,
  deskNoteClaimKey,
  deskNoteTradeDate,
} from '@/lib/notify/deskSessionNotes'
