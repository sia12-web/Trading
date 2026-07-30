/**
 * Structured desk audit events for Railway diagnosis.
 * Prefer these over ad-hoc console strings so log search is consistent:
 *   desk.entry_denied | desk.entry_accepted | desk.working_placed
 *   session-gate.transition | desk.alert
 */

import { logger } from '@/lib/utils/logger'

export type DeskEntryDenyReason =
  | 'session_gate'
  | 'range_edge'
  | 'stop_guard'
  | 'already_open'
  | 'already_working'
  | 'working_sl_locked'
  | 'validation'
  | 'unauthorized'
  | 'broker'
  | 'db'

export function logEntryDenied(fields: {
  route: 'open' | 'working' | 'cancel-working'
  reason: DeskEntryDenyReason
  instrument?: string | null
  message: string
  status?: number
  phase?: string | null
  canPlaceEntry?: boolean
  clockedIn?: boolean
  dayLocked?: boolean
  revengeLocked?: boolean
  ladder?: string | null
  rangeStrategy?: string | null
  entry?: number | null
  direction?: string | null
  rangeHigh?: number | null
  rangeLow?: number | null
  rangeLabel?: string | null
  entrySource?: string | null
}): void {
  logger.warn('desk.entry_denied', {
    route: fields.route,
    reason: fields.reason,
    instrument: fields.instrument ?? null,
    message: fields.message,
    status: fields.status ?? null,
    phase: fields.phase ?? null,
    canPlaceEntry: fields.canPlaceEntry ?? null,
    clockedIn: fields.clockedIn ?? null,
    dayLocked: fields.dayLocked ?? null,
    revengeLocked: fields.revengeLocked ?? null,
    ladder: fields.ladder ?? null,
    rangeStrategy: fields.rangeStrategy ?? null,
    entry: fields.entry ?? null,
    direction: fields.direction ?? null,
    rangeHigh: fields.rangeHigh ?? null,
    rangeLow: fields.rangeLow ?? null,
    rangeLabel: fields.rangeLabel ?? null,
    entrySource: fields.entrySource ?? null,
  })
}

export function logWorkingPlaced(fields: {
  workingId: string
  instrument: string
  level: number
  direction: string
  phase?: string | null
  ladder?: string | null
  rangeStrategy?: string | null
  rangeHigh?: number | null
  rangeLow?: number | null
  rangeLabel?: string | null
  entrySource?: string | null
}): void {
  logger.info('desk.working_placed', fields)
}

export function logDeskAlert(fields: {
  kind: string
  ok: boolean
  telegramConfigured: boolean
  error?: string | null
}): void {
  if (fields.ok) logger.info('desk.alert', fields)
  else logger.warn('desk.alert_failed', fields)
}

type GateSnap = {
  phase: string
  canPlaceEntry: boolean
  canManagePosition: boolean
  clockedIn: boolean
  dayLocked: boolean
  revengeLocked: boolean
  rangeStrategy: string | null
  ladder: string | null
  lockedInstrument: string | null
  openPositionId: string | null
  message: string
}

const gateLast = new Map<string, GateSnap>()
const GATE_CACHE_MAX = 64

function gateChanged(prev: GateSnap, next: GateSnap): string[] {
  const keys: (keyof GateSnap)[] = [
    'phase',
    'canPlaceEntry',
    'canManagePosition',
    'clockedIn',
    'dayLocked',
    'revengeLocked',
    'rangeStrategy',
    'ladder',
    'lockedInstrument',
    'openPositionId',
    'message',
  ]
  return keys.filter((k) => prev[k] !== next[k])
}

/**
 * Log session-gate only when the desk state changes (avoids poll spam).
 */
export function noteSessionGateTransition(args: {
  userId: string
  viewing: string | null
  snap: GateSnap
}): void {
  const key = `${args.userId}:${args.viewing ?? 'none'}`
  const prev = gateLast.get(key)
  if (prev) {
    const changed = gateChanged(prev, args.snap)
    if (changed.length === 0) return
    logger.info('session-gate.transition', {
      user: args.userId.slice(0, 8),
      viewing: args.viewing,
      changed,
      from: {
        phase: prev.phase,
        canPlaceEntry: prev.canPlaceEntry,
        clockedIn: prev.clockedIn,
        dayLocked: prev.dayLocked,
        rangeStrategy: prev.rangeStrategy,
        ladder: prev.ladder,
        message: prev.message,
      },
      to: args.snap,
    })
  } else {
    logger.info('session-gate.snapshot', {
      user: args.userId.slice(0, 8),
      viewing: args.viewing,
      ...args.snap,
    })
  }

  gateLast.set(key, args.snap)
  if (gateLast.size > GATE_CACHE_MAX) {
    const first = gateLast.keys().next().value
    if (first) gateLast.delete(first)
  }
}
