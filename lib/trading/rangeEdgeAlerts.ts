/**
 * Desk alerts — price enters ±10 of active playbook range while entries are unlocked.
 * Message templates live in deskSessionNotes (structured Telegram notes).
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
