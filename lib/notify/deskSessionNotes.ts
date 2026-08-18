/**
 * Structured TradePulse Telegram desk notes — clock-in, session open/close,
 * range lock, and entry-window unlock. Keep messages scannable and consistent.
 */

import {
  NY_IB_STRATEGY_END,
  NY_IB_STRATEGY_START,
  NY_LUNCH_RANGE_ENTRY_END,
  NY_LUNCH_RANGE_ENTRY_START,
  TOKYO_LUNCH_RANGE_ENTRY_END,
  TOKYO_LUNCH_RANGE_ENTRY_START,
  TOKYO_US_RANGE_STRATEGY_END,
  TOKYO_US_RANGE_STRATEGY_START,
  deskMarketFor,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
  deskLocalRangeAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import { tradeifyScheduleRiskLine } from '@/lib/trading/tradeifyLeoBlock'

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
  now: Date = new Date(),
  _opts?: { tradeify?: boolean }
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
      TOKYO_US_RANGE_STRATEGY_START,
      TOKYO_US_RANGE_STRATEGY_END,
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
      `• OR30 locks ~${deskLocalHmsAsTraderDisplay('09:30:00', s.tz, now)} — morning entry until ${morningEnd}`,
      `• US Range window ${usWin} (prior NYC H/L — already shaped)`,
      `• Tokyo IB locks ~${deskLocalHmsAsTraderDisplay('10:00:00', s.tz, now)} (first hour) — entry ${ibWin}`,
      `• Lunch confirm ${lunchConfirm}`,
      `• Session END (cash close) ${close}`,
      `• ${tradeifyScheduleRiskLine()} · SL beyond range · TP 1.5R (1:1.5) · ±10 of H / L after active range locks`,
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
    `• OR30 locks ~${deskLocalHmsAsTraderDisplay('10:00:00', s.tz, now)} — morning entry until ${morningEnd}`,
    `• IB locks ~${deskLocalHmsAsTraderDisplay('10:30:00', s.tz, now)} · entry ${ibWin} (open until lunch-range starts)`,
    `• Lunch-range locks 13:30 · entry ${lunchWin}`,
    `• Lunch confirm ${lunchConfirm} (morning books — IB stay open past confirm)`,
    `• Session END (cash close) ${close}`,
    `• ${tradeifyScheduleRiskLine()} · SL beyond range · TP 1.5R (1:1.5) · ±10 of H / L after active range locks · OR30 optional`,
  ].join('\n')
}

export function formatClockInNote(args: {
  instrument: DeskInstrument
  market: 'NY' | 'TOKYO'
  sessionDate: string
  now?: Date
  lateJoin?: boolean
  tradeify?: boolean
  tradeifyLine?: string | null
}): DeskNotePayload {
  const now = args.now ?? new Date()
  const late = !!args.lateJoin
  const title = late
    ? `Late clock-in · ${args.instrument} (${args.market})`
    : `Clocked in · ${args.instrument} (${args.market})`
  const body = [
    `Session date ${args.sessionDate}`,
    late
      ? `Late join — live desk unlocked for ${args.instrument}. Dead books stay closed; remaining probes only under 2/2/2 + session 3.`
      : `Live desk unlocked for ${args.instrument}.`,
    '',
    formatSessionScheduleBlock(args.instrument, now, { tradeify: !!args.tradeify }),
    args.tradeifyLine ? `\n${args.tradeifyLine}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    kind: late ? 'late_clock_in' : 'clock_in',
    title,
    body,
    telegram: `${header(late ? 'LATE CLOCK IN' : 'CLOCK IN', title)}\n${body}`,
  }
}

/** Telegram Late Desk Brief — inform only; does not clock in. */
export function formatLateDeskBriefNote(args: {
  body: string
  asOfDisplay: string
  focus?: string
  tradeifyLine?: string | null
}): DeskNotePayload {
  const focus = args.focus ? ` · ${args.focus}` : ''
  const title = `Late Desk Brief${focus} · as of ${args.asOfDisplay}`
  const body = args.tradeifyLine
    ? `${args.body}\n\n${args.tradeifyLine}`
    : args.body
  return {
    kind: 'late_desk_brief',
    title,
    body,
    telegram: `${header('LATE DESK BRIEF', title)}\n${body}`,
  }
}

export function formatSessionStartNote(args: {
  instrument: DeskInstrument
  now?: Date
  tradeify?: boolean
}): DeskNotePayload {
  const now = args.now ?? new Date()
  const s = sessionFor(args.instrument)
  const open = deskLocalHmsAsTraderDisplay(s.marketOpen, s.tz, now)
  const title = `Session START · ${args.instrument}`
  const body = [
    `Cash open ${open} ${TRADER_DISPLAY_LABEL}`,
    `OR30 is forming — ±10 morning entries unlock after the first 30 minutes.`,
    '',
    formatSessionScheduleBlock(args.instrument, now, { tradeify: !!args.tradeify }),
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
  /** Optional ATR / height volatility block */
  atrLine?: string | null
}): DeskNotePayload {
  const title = `${args.instrument} · ${args.rangeLabel} LOCKED`
  const body = [
    `High ${args.high.toLocaleString()}`,
    `Low  ${args.low.toLocaleString()}`,
    `±10 bands are live around H and L only — 50% mid is not an entry.`,
    args.atrLine || null,
    args.nextHint || 'Entries allowed when this playbook window is unlocked.',
  ]
    .filter(Boolean)
    .join('\n')
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
    `You may place probes in this window (2 · progressive risk, ±10 of locked range H / L only).`,
  ]
  if (args.rangeHigh != null && args.rangeLow != null) {
    lines.push(
      `Active range H ${args.rangeHigh.toLocaleString()} · L ${args.rangeLow.toLocaleString()} (50% mid is not an entry)`
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
  proximity: { edge: 'high' | 'low' | 'mid'; center: number; label: string }
  livePrice: number
  mode: 'limit' | 'market' | 'either'
}): DeskNotePayload {
  const edgeLabel =
    args.proximity.edge === 'high'
      ? 'HIGH'
      : args.proximity.edge === 'low'
        ? 'LOW'
        : '50% MID'
  const title = `${args.instrument} · IN BAND · ${args.proximity.label} ${edgeLabel}`
  const modeHint =
    args.mode === 'market'
      ? 'Market entry is in the ±10 band (H / L).'
      : args.mode === 'limit'
        ? 'Limit entries allowed in the ±10 band (H / L).'
        : 'Limit — price is in the ±10 strategy band (H / L).'
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

/** Session-local calendar day for desk note keys (instrument TZ). */
export function deskNoteTradeDate(
  instrument: DeskInstrument,
  now: Date = new Date()
): string {
  const s = sessionFor(instrument)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: s.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Stable dedupe key: trade_date + instrument + event kind. */
export function deskNoteClaimKey(
  kind: string,
  instrument: DeskInstrument,
  now: Date = new Date()
): string {
  return `tp.deskNote.${kind}.${instrument}.${deskNoteTradeDate(instrument, now)}`
}

/** Survives remount within the same JS realm (not a full page refresh). */
const memoryDeskNoteClaims = new Map<string, number>()

function readDeskNoteClaim(key: string): number | null {
  const mem = memoryDeskNoteClaims.get(key)
  if (mem != null) return mem
  for (const store of [typeof localStorage !== 'undefined' ? localStorage : null, typeof sessionStorage !== 'undefined' ? sessionStorage : null]) {
    if (!store) continue
    try {
      const raw = store.getItem(key)
      if (!raw) continue
      const n = Number(raw)
      return Number.isFinite(n) ? n : Date.now()
    } catch {
      /* private mode / quota */
    }
  }
  return null
}

function writeDeskNoteClaim(key: string, ts: number): void {
  memoryDeskNoteClaims.set(key, ts)
  const value = String(ts)
  for (const store of [typeof localStorage !== 'undefined' ? localStorage : null, typeof sessionStorage !== 'undefined' ? sessionStorage : null]) {
    if (!store) continue
    try {
      store.setItem(key, value)
    } catch {
      /* private mode / quota — memory claim still blocks same-tab remount */
    }
  }
}

export function hasDeskNoteClaim(
  kind: string,
  instrument: DeskInstrument,
  now: Date = new Date()
): boolean {
  return readDeskNoteClaim(deskNoteClaimKey(kind, instrument, now)) != null
}

/**
 * Once-per-session-day dedupe for Telegram notes.
 * Durable across refresh via localStorage + sessionStorage; memory covers remount.
 * Returns true only on the first successful claim (caller may send).
 */
export function claimDeskNoteOnce(
  kind: string,
  instrument: DeskInstrument,
  now: Date = new Date()
): boolean {
  const key = deskNoteClaimKey(kind, instrument, now)
  if (readDeskNoteClaim(key) != null) return false
  writeDeskNoteClaim(key, Date.now())
  return true
}

/**
 * Cooldown dedupe (ms) that survives refresh — for noisy range-edge band alerts.
 * Returns true only when enough time has elapsed since the last claim.
 */
export function claimDeskNoteCooldown(
  kind: string,
  instrument: DeskInstrument,
  cooldownMs: number,
  now: Date = new Date()
): boolean {
  const key = deskNoteClaimKey(kind, instrument, now)
  const prev = readDeskNoteClaim(key)
  const ts = Date.now()
  if (prev != null && ts - prev < cooldownMs) return false
  writeDeskNoteClaim(key, ts)
  return true
}
