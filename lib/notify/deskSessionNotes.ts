/**
 * Structured TradePulse Telegram desk notes — clock-in, session open/close,
 * range lock, and entry-window unlock. Keep messages scannable and consistent.
 */

import {
  NY_IB_STRATEGY_END,
  NY_IB_STRATEGY_START,
  NY_LUNCH_RANGE_ENTRY_END,
  NY_LUNCH_RANGE_ENTRY_START,
  TOKYO_IB_STRATEGY_END,
  TOKYO_IB_STRATEGY_START,
  TOKYO_LUNCH_RANGE_ENTRY_END,
  TOKYO_LUNCH_RANGE_ENTRY_START,
  deskMarketFor,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
  deskLocalRangeAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'

const RULE = '────────────'

export type DeskNotePayload = {
  kind: string
  title: string
  body: string
  telegram: string
}

function hmsShort(hms: string): string {
  return hms.slice(0, 5)
}

function header(kind: string, title: string): string {
  return `TradePulse · ${kind}\n${RULE}\n${title}`
}

/** Shared session schedule block for NY or Tokyo. */
export function formatSessionScheduleBlock(
  instrument: DeskInstrument,
  now: Date = new Date()
): string {
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const tz = TRADER_DISPLAY_LABEL
  const open = deskLocalHmsAsTraderDisplay(s.marketOpen, s.tz, now)
  const close = deskLocalHmsAsTraderDisplay(s.marketClose, s.tz, now)
  const prep = deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)
  const morningEnd = deskLocalHmsAsTraderDisplay(s.entryClose, s.tz, now)
  const lunchConfirm = deskLocalHmsAsTraderDisplay(s.lunchClose, s.tz, now)

  if (market === 'TOKYO') {
    const usWin = deskLocalRangeAsTraderDisplay(
      TOKYO_IB_STRATEGY_START,
      TOKYO_IB_STRATEGY_END,
      s.tz,
      now
    )
    const ibWin = deskLocalRangeAsTraderDisplay(
      TOKYO_LUNCH_RANGE_ENTRY_START,
      TOKYO_LUNCH_RANGE_ENTRY_END,
      s.tz,
      now
    )
    return [
      `Schedule (${tz}) — NIKKEI`,
      `• Prep / clock-in from ${prep}`,
      `• Session START (cash open) ${open}`,
      `• OR30 locks ~${deskLocalHmsAsTraderDisplay('09:30:00', s.tz, now)} (first 30m)`,
      `• Morning entry ends ${morningEnd}`,
      `• US Range window ${usWin} (prior NYC H/L — already shaped)`,
      `• Tokyo IB locks ~${deskLocalHmsAsTraderDisplay('10:00:00', s.tz, now)} (first hour)`,
      `• Tokyo IB entry ${ibWin}`,
      `• Lunch confirm ${lunchConfirm}`,
      `• Session END (cash close) ${close}`,
      `• Ladder 2/2/2 @ 0.25% · ±10 only after active range locks`,
    ].join('\n')
  }

  const ibWin = deskLocalRangeAsTraderDisplay(
    NY_IB_STRATEGY_START,
    NY_IB_STRATEGY_END,
    s.tz,
    now
  )
  const lunchWin = deskLocalRangeAsTraderDisplay(
    NY_LUNCH_RANGE_ENTRY_START,
    NY_LUNCH_RANGE_ENTRY_END,
    s.tz,
    now
  )
  return [
    `Schedule (${tz}) — ${instrument}`,
    `• Prep / clock-in from ${prep}`,
    `• Session START (cash open) ${open}`,
    `• OR30 locks ~${deskLocalHmsAsTraderDisplay('10:00:00', s.tz, now)} (first 30m)`,
    `• Morning entry ends ${morningEnd}`,
    `• IB locks ~${deskLocalHmsAsTraderDisplay('10:30:00', s.tz, now)} (first hour)`,
    `• IB entry window ${ibWin}`,
    `• Lunch-range locks 13:30 · entry ${lunchWin}`,
    `• Lunch confirm ${lunchConfirm}`,
    `• Session END (cash close) ${close}`,
    `• Ladder 2/2/2 @ 0.25% · ±10 only after active range locks · OR30 optional`,
  ].join('\n')
}

export function formatClockInNote(args: {
  instrument: DeskInstrument
  market: 'NY' | 'TOKYO'
  sessionDate: string
  now?: Date
}): DeskNotePayload {
  const now = args.now ?? new Date()
  const title = `Clocked in · ${args.instrument} (${args.market})`
  const body = [
    `Session date ${args.sessionDate}`,
    `Live desk unlocked for ${args.instrument}.`,
    '',
    formatSessionScheduleBlock(args.instrument, now),
  ].join('\n')
  return {
    kind: 'clock_in',
    title,
    body,
    telegram: `${header('CLOCK IN', title)}\n${body}`,
  }
}

export function formatSessionStartNote(args: {
  instrument: DeskInstrument
  now?: Date
}): DeskNotePayload {
  const now = args.now ?? new Date()
  const s = sessionFor(args.instrument)
  const open = deskLocalHmsAsTraderDisplay(s.marketOpen, s.tz, now)
  const title = `Session START · ${args.instrument}`
  const body = [
    `Cash open ${open} ${TRADER_DISPLAY_LABEL}`,
    `OR30 is forming — ±10 entries wait until the active range locks.`,
    '',
    formatSessionScheduleBlock(args.instrument, now),
  ].join('\n')
  return {
    kind: 'session_start',
    title,
    body,
    telegram: `${header('SESSION START', title)}\n${body}`,
  }
}

export function formatSessionEndNote(args: {
  instrument: DeskInstrument
  now?: Date
}): DeskNotePayload {
  const now = args.now ?? new Date()
  const s = sessionFor(args.instrument)
  const close = deskLocalHmsAsTraderDisplay(s.marketClose, s.tz, now)
  const title = `Session END · ${args.instrument}`
  const body = [
    `Cash close ${close} ${TRADER_DISPLAY_LABEL}`,
    `Desk offline for new entries. Open books flatten / manage until flat.`,
    `Next: clock in again in the next prep window.`,
  ].join('\n')
  return {
    kind: 'session_end',
    title,
    body,
    telegram: `${header('SESSION END', title)}\n${body}`,
  }
}

export function formatRangeShapedNote(args: {
  instrument: DeskInstrument
  rangeLabel: string
  high: number
  low: number
  /** What this unlocks for the trader */
  nextHint?: string
}): DeskNotePayload {
  const title = `${args.instrument} · ${args.rangeLabel} LOCKED`
  const body = [
    `High ${args.high.toLocaleString()}`,
    `Low  ${args.low.toLocaleString()}`,
    `±10 bands are live around H and L.`,
    args.nextHint || 'Entries allowed when this playbook window is unlocked.',
  ].join('\n')
  return {
    kind: 'range_shaped',
    title,
    body,
    telegram: `${header('RANGE LOCKED', title)}\n${body}`,
  }
}

export function formatEntryPermissionNote(args: {
  instrument: DeskInstrument
  windowLabel: string
  ladderHint?: string | null
  rangeHigh?: number | null
  rangeLow?: number | null
}): DeskNotePayload {
  const title = `${args.instrument} · ENTRY OPEN · ${args.windowLabel}`
  const lines = [
    `You may place probes in this window (2 @ 0.25%, ±10 of locked range H/L).`,
  ]
  if (args.rangeHigh != null && args.rangeLow != null) {
    lines.push(
      `Active range H ${args.rangeHigh.toLocaleString()} · L ${args.rangeLow.toLocaleString()}`
    )
  }
  if (args.ladderHint) lines.push(`Ladder: ${args.ladderHint}`)
  const body = lines.join('\n')
  return {
    kind: 'entry_permission',
    title,
    body,
    telegram: `${header('ENTRY PERMISSION', title)}\n${body}`,
  }
}

/** @deprecated name kept for call sites — prefer formatEntryPermissionNote */
export function formatWindowUnlockAlertMessage(args: {
  instrument: string
  windowLabel: string
  ladderHint?: string | null
}): DeskNotePayload {
  return formatEntryPermissionNote({
    instrument: args.instrument as DeskInstrument,
    windowLabel: args.windowLabel,
    ladderHint: args.ladderHint,
  })
}

export function formatRangeEdgeAlertMessage(args: {
  instrument: string
  proximity: { edge: 'high' | 'low'; center: number; label: string }
  livePrice: number
  mode: 'limit' | 'market' | 'either'
}): DeskNotePayload {
  const edgeLabel = args.proximity.edge === 'high' ? 'HIGH' : 'LOW'
  const title = `${args.instrument} · IN BAND · ${args.proximity.label} ${edgeLabel}`
  const modeHint =
    args.mode === 'market'
      ? 'Market entry is in the ±10 band.'
      : args.mode === 'limit'
        ? 'Limit / market entries allowed in the ±10 band.'
        : 'Limit or market — price is in the ±10 strategy band.'
  const body = [
    modeHint,
    `Live ${args.livePrice.toLocaleString()} · ${edgeLabel} ${args.proximity.center.toLocaleString()} (±10)`,
  ].join('\n')
  return {
    kind: 'range_edge',
    title,
    body,
    telegram: `${header('IN BAND', title)}\n${body}`,
  }
}

/** Human schedule cheat-sheet (unused hms helper keeps imports honest for tests). */
export function scheduleHmsLabel(hms: string): string {
  return hmsShort(hms)
}

/** Once-per-session-day dedupe for Telegram notes (browser localStorage). */
export function claimDeskNoteOnce(
  kind: string,
  instrument: DeskInstrument,
  now: Date = new Date()
): boolean {
  const s = sessionFor(instrument)
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const key = `tp.deskNote.${kind}.${instrument}.${day}`
  try {
    if (typeof localStorage === 'undefined') return true
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, String(Date.now()))
    return true
  } catch {
    return true
  }
}
