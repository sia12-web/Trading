/**
 * Live NY desk is always CALL ON (Slice 1).
 * Tickets only when CALL agrees (side + legal ±10).
 * Stored `use_call: false` on attendance is ignored.
 * Sim still stores a CALL/regular choice in sessionStorage until Slice 5.
 */

export const DESK_CALL_MODE_JOURNAL_KEY = 'use_call'

/** Live tickets are always CALL-gated. */
export const LIVE_DESK_USE_CALL = true as const

export const CALL_MODE_UNSET_MESSAGE =
  'Clock in before placing. Live desk is always CALL ON.'

export const LIVE_CALL_REGULAR_REFUSED =
  'Desk is always CALL ON — tickets only on CALL-legal ±10.'

export function parseDeskCallMode(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}

/** Live attendance is always CALL ON. Journal false/null does not open Regular ±10. */
export function attendanceCallMode(
  _journal?: Record<string, unknown> | null
): true {
  return LIVE_DESK_USE_CALL
}

export function deskCallModeHoverPrefix(useCall: boolean | null): string {
  if (useCall == null) {
    return 'Clock in before placing. Live desk is always CALL ON.\n\n'
  }
  if (!useCall) {
    return 'CALL setup is still live (advise). Tickets use any painted playbook ±10 — CALL does not block.\n\n'
  }
  return 'CALL must agree — tickets only on CALL-legal ±10.\n\n'
}

const SIM_CALL_MODE_PREFIX = 'desk-call-mode:'

export function simCallModeStorageKey(instrument: string, replayDate: string): string {
  return `${SIM_CALL_MODE_PREFIX}${instrument}:${replayDate}`
}

export function readSimCallMode(instrument: string, replayDate: string): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    return parseDeskCallMode(sessionStorage.getItem(simCallModeStorageKey(instrument, replayDate)))
  } catch {
    return null
  }
}

export function writeSimCallMode(
  instrument: string,
  replayDate: string,
  useCall: boolean
): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(simCallModeStorageKey(instrument, replayDate), useCall ? '1' : '0')
  } catch {
    /* ignore */
  }
}
