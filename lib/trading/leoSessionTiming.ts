/**
 * Fresh wall-clock + explicit OR30 / IB / lunch (or Nikkei US Range / Tokyo IB)
 * status sentences for Leo. Built every Live Voice request — never cached.
 */

import {
  attemptLadderFromCounts,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'
import {
  TRADER_DISPLAY_LABEL,
  TRADER_DISPLAY_TZ,
  deskLocalHmsAsTraderDisplay,
  timeInTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import {
  deskMarketFor,
  ibStrategyEndHms,
  ibStrategyStartHms,
  isOr30MorningEntryWindowOpen,
  lunchRangeEntryEndHms,
  lunchRangeEntryStartHms,
  or30LockHms,
  or30LockSecFromOpen,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'
import { resolveDeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'

export type LeoOr30Status = 'not_yet' | 'forming' | 'locked' | 'finished'
/** NY IB · Tokyo US Range (slot 2) */
export type LeoMidSlotStatus = 'not_yet' | 'open' | 'closed'
/** NY lunch-range · Tokyo IB (slot 3) */
export type LeoLateSlotStatus = 'not_yet' | 'open' | 'closed'

export type LeoSessionTiming = {
  asOfIso: string
  montrealTime: string
  montrealLabel: string
  deskLocalTime: string
  deskTz: string
  deskTzLabel: string
  instrument: DeskInstrument
  market: DeskMarket
  playbookMode: string
  or30: {
    status: LeoOr30Status
    sentence: string
  }
  mid: {
    /** IB (NY) or US Range (Nikkei) */
    label: string
    status: LeoMidSlotStatus
    sentence: string
  }
  late: {
    /** Lunch-range (NY) or Tokyo IB (Nikkei) */
    label: string
    status: LeoLateSlotStatus
    sentence: string
  }
  /** Ground-truth lines Leo must not invent past. */
  facts: string[]
}

function timeInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

function deskTzLabel(market: DeskMarket): string {
  return market === 'TOKYO' ? 'Tokyo desk clock' : 'NY desk clock'
}

function resolveOr30(
  instrument: DeskInstrument,
  now: Date,
  ladder: AttemptLadder
): { status: LeoOr30Status; sentence: string } {
  const s = sessionFor(instrument)
  const market = deskMarketFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  const entryClose = parseTimeToSeconds(s.entryClose)
  const lockSec = or30LockSecFromOpen(open)
  const lockMtl = deskLocalHmsAsTraderDisplay(or30LockHms(market), s.tz, now)
  const closeMtl = deskLocalHmsAsTraderDisplay(s.entryClose, s.tz, now)

  if (t < open) {
    return {
      status: 'not_yet',
      sentence: `OR30 not started — forms at cash open; locks ~${lockMtl} ${TRADER_DISPLAY_LABEL}.`,
    }
  }
  if (t < lockSec) {
    return {
      status: 'forming',
      sentence: `OR30 is FORMING — entry CLOSED until lock at ${lockMtl} ${TRADER_DISPLAY_LABEL}.`,
    }
  }
  // Finished when morning entry window over, probes exhausted, or morning bucket released (IB handoff).
  const windowOpen = isOr30MorningEntryWindowOpen(instrument, now)
  if (!windowOpen || t > entryClose || !ladder.morningEligible) {
    return {
      status: 'finished',
      sentence: `OR30 entry is CLOSED (finished) — morning ±10 ended at ${closeMtl} ${TRADER_DISPLAY_LABEL}; do not call OR30 open.`,
    }
  }
  return {
    status: 'locked',
    sentence: `OR30 is LOCKED — entry OPEN until ${closeMtl} ${TRADER_DISPLAY_LABEL} (±10 of H / L).`,
  }
}

function resolveMid(
  instrument: DeskInstrument,
  now: Date,
  ladder: AttemptLadder
): { label: string; status: LeoMidSlotStatus; sentence: string } {
  const tokyo = instrument === 'NIKKEI'
  const label = tokyo ? 'US Range' : 'IB'
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const startHms = ibStrategyStartHms(market)
  const endHms = ibStrategyEndHms(market)
  const start = parseTimeToSeconds(startHms)
  const end = parseTimeToSeconds(endHms)
  const startMtl = deskLocalHmsAsTraderDisplay(startHms, s.tz, now)
  const endMtl = deskLocalHmsAsTraderDisplay(endHms, s.tz, now)
  const untilHint = tokyo
    ? `open until ${endMtl} ${TRADER_DISPLAY_LABEL}`
    : `open until lunch-range at ${endMtl} ${TRADER_DISPLAY_LABEL}`

  if (t < start) {
    return {
      label,
      status: 'not_yet',
      sentence: tokyo
        ? `US Range not open yet — opens at cash open (${startMtl} ${TRADER_DISPLAY_LABEL}).`
        : `IB not open yet — opens when first-hour IB locks at ${startMtl} ${TRADER_DISPLAY_LABEL}.`,
    }
  }
  if (t >= end) {
    return {
      label,
      status: 'closed',
      sentence: tokyo
        ? `US Range entry is CLOSED (ended ${endMtl} ${TRADER_DISPLAY_LABEL}).`
        : `IB entry is CLOSED — lunch-range owns the book from ${endMtl} ${TRADER_DISPLAY_LABEL}.`,
    }
  }
  // Clock says mid window is open (NY IB 10:30–13:30 · Nikkei US Range 09:00–10:45).
  const ladderNote =
    !ladder.ibEligible
      ? ' Ladder probes not eligible yet — still treat the clock as open/closed correctly.'
      : ''
  return {
    label,
    status: 'open',
    sentence: tokyo
      ? `US Range is OPEN (${untilHint}) — prior NYC H/L; ±10 H/L only (no mid).${ladderNote}`
      : `IB is OPEN until lunch (${untilHint}) — ±10 of H / L.${ladderNote}`,
  }
}

function resolveLate(
  instrument: DeskInstrument,
  now: Date,
  ladder: AttemptLadder
): { label: string; status: LeoLateSlotStatus; sentence: string } {
  const tokyo = instrument === 'NIKKEI'
  const label = tokyo ? 'Tokyo IB' : 'Lunch-range'
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const startHms = lunchRangeEntryStartHms(market)
  const endHms = lunchRangeEntryEndHms(market)
  const start = parseTimeToSeconds(startHms)
  const end = parseTimeToSeconds(endHms)
  const startMtl = deskLocalHmsAsTraderDisplay(startHms, s.tz, now)
  const endMtl = deskLocalHmsAsTraderDisplay(endHms, s.tz, now)

  if (t < start) {
    return {
      label,
      status: 'not_yet',
      sentence: tokyo
        ? `Tokyo IB not open yet — unlocks at first-hour lock ${startMtl} ${TRADER_DISPLAY_LABEL}.`
        : `Lunch-range not open until ${startMtl} ${TRADER_DISPLAY_LABEL} — do not call lunch open.`,
    }
  }
  if (t >= end) {
    return {
      label,
      status: 'closed',
      sentence: tokyo
        ? `Tokyo IB entry is CLOSED (ended ${endMtl} ${TRADER_DISPLAY_LABEL}).`
        : `Lunch-range entry is CLOSED (ended ${endMtl} ${TRADER_DISPLAY_LABEL}).`,
    }
  }
  const ladderNote =
    !ladder.lunchEligible
      ? ' Ladder probes not eligible yet — still treat the clock as open.'
      : ''
  return {
    label,
    status: 'open',
    sentence: tokyo
      ? `Tokyo IB is OPEN until cash close (${endMtl} ${TRADER_DISPLAY_LABEL}) — ±10 of H / L.${ladderNote}`
      : `Lunch-range is OPEN until ${endMtl} ${TRADER_DISPLAY_LABEL} — ±10 of H / L.${ladderNote}`,
  }
}

/**
 * Pure timing snapshot for Leo — call with `new Date()` on every request.
 */
export function buildLeoSessionTiming(args: {
  instrument: DeskInstrument | string
  now?: Date
  ladder?: AttemptLadder
  morningAttempts?: number
  ibAttempts?: number
  lunchAttempts?: number
}): LeoSessionTiming {
  const now = args.now ?? new Date()
  const instrument: DeskInstrument =
    args.instrument === 'NASDAQ' || args.instrument === 'NIKKEI'
      ? args.instrument
      : 'DOW'
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const ladder =
    args.ladder ??
    attemptLadderFromCounts({
      morningAttempts: args.morningAttempts ?? 0,
      ibAttempts: args.ibAttempts ?? 0,
      lunchAttempts: args.lunchAttempts ?? 0,
      now,
      instrument,
    })

  const or30 = resolveOr30(instrument, now, ladder)
  const mid = resolveMid(instrument, now, ladder)
  const late = resolveLate(instrument, now, ladder)
  const playbookMode = resolveDeskPlaybookMode({
    instrument,
    now,
    ladder,
  })

  const montrealTime = timeInTraderDisplay(now)
  const deskLocalTime = timeInTz(now, s.tz)

  const facts = [
    `Wall clock NOW: ${montrealTime} ${TRADER_DISPLAY_LABEL} · desk local ${deskLocalTime} (${deskTzLabel(market)}).`,
    or30.sentence,
    mid.sentence,
    late.sentence,
    `Active playbook mode from clocks: ${playbookMode}.`,
  ]

  return {
    asOfIso: now.toISOString(),
    montrealTime,
    montrealLabel: TRADER_DISPLAY_LABEL,
    deskLocalTime,
    deskTz: s.tz,
    deskTzLabel: deskTzLabel(market),
    instrument,
    market,
    playbookMode,
    or30,
    mid,
    late,
    facts,
  }
}

/** Compact block for the Live Voice LLM user message. */
export function formatLeoSessionTimingForPrompt(timing: LeoSessionTiming): string {
  return [
    'SESSION CLOCK STATUS (fresh wall-clock — ground truth; never invent past these lines):',
    `As-of ISO: ${timing.asOfIso}`,
    `Montreal now: ${timing.montrealTime} ${timing.montrealLabel}`,
    `Desk local now: ${timing.deskLocalTime} (${timing.deskTzLabel} · ${timing.deskTz})`,
    `OR30 status=${timing.or30.status} — ${timing.or30.sentence}`,
    `${timing.mid.label} status=${timing.mid.status} — ${timing.mid.sentence}`,
    `${timing.late.label} status=${timing.late.status} — ${timing.late.sentence}`,
    ...timing.facts.slice(4),
  ].join('\n')
}

/** Re-export display TZ for tests / callers. */
export const LEO_DISPLAY_TZ = TRADER_DISPLAY_TZ
