/**
 * After clock-in the trader chooses CALL or regular playbook ±10.
 * Stored on desk_attendance.morning_journal.use_call (live) or sessionStorage (sim).
 *
 * true  — CALL must agree (side + legal edge). Ticket gate on.
 * false — regular playbook ±10. CALL still computes the setup (advise).
 * null  — not answered yet; no tickets.
 * Switch anytime after the first choice.
 */

export const DESK_CALL_MODE_JOURNAL_KEY = 'use_call'

export const CALL_MODE_UNSET_MESSAGE =
  'Choose CALL or regular after clock-in before placing.'

export function parseDeskCallMode(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}

export function attendanceCallMode(
  journal: Record<string, unknown> | null | undefined
): boolean | null {
  if (!journal) return null
  return parseDeskCallMode(journal[DESK_CALL_MODE_JOURNAL_KEY])
}

export function deskCallModeHoverPrefix(useCall: boolean | null): string {
  if (useCall == null) {
    return 'Choose CALL or regular after clock-in before placing.\n\n'
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
