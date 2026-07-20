/**
 * Live Voice — Slice 1 status window + Slice 3 mic when enabled.
 */

import {
  deskMarketFor,
  isLiveDeskInstrument,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export type LiveVoiceDisableReason =
  | 'unauthorized'
  | 'weekend'
  | 'before_prep'
  | 'after_entry'
  | 'not_clocked_in'

export type LiveVoiceStatus = {
  enabled: boolean
  /** True only when enabled — Slice 1 never requests the mic. */
  micAllowed: boolean
  clockedIn: boolean
  inVoiceWindow: boolean
  /** True when LIVE_VOICE_DEV_BYPASS=true — window/weekend gates relaxed for local testing. */
  devBypass: boolean
  instrument: DeskInstrument
  market: DeskMarket
  reason: string | null
  disableCode: LiveVoiceDisableReason | null
  window: {
    start: string
    end: string
    tz: string
    tzLabel: string
  }
  localTime: string
  tradeDate: string
}

function localDateInTz(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
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

function isWeekdayInTz(date: Date, timeZone: string): boolean {
  const d = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
  return d !== 'Sat' && d !== 'Sun'
}

function hhmm(hms: string): string {
  return hms.slice(0, 5)
}

/**
 * Opt-in only: set LIVE_VOICE_DEV_BYPASS=true in .env.local to test outside the weekday window.
 * Always off in production — never honor the flag on Railway.
 */
export function liveVoiceDevBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.LIVE_VOICE_DEV_BYPASS === 'true'
}

/**
 * Pure window + clock-in gate for Live Voice.
 * Window: analyzeStart ≤ local time < entryClose (first ~45 min ends here).
 */
export function resolveLiveVoiceStatus(input: {
  now?: Date
  instrument: string | null | undefined
  clockedIn: boolean
}): LiveVoiceStatus {
  const now = input.now ?? new Date()
  const instrument: DeskInstrument = isLiveDeskInstrument(input.instrument || '')
    ? (input.instrument as DeskInstrument)
    : 'DOW'
  const market = deskMarketFor(instrument)
  const sess = sessionFor(instrument)
  const tzLabel = market === 'TOKYO' ? 'JST' : 'ET'
  const localTime = timeInTz(now, sess.tz)
  const tradeDate = localDateInTz(sess.tz, now)
  const window = {
    start: hhmm(sess.analyzeStart),
    end: hhmm(sess.entryClose),
    tz: sess.tz,
    tzLabel,
  }
  const bypass = liveVoiceDevBypassEnabled()

  const base = {
    micAllowed: false,
    clockedIn: !!input.clockedIn,
    devBypass: bypass,
    instrument,
    market,
    window,
    localTime,
    tradeDate,
  }

  if (!isWeekdayInTz(now, sess.tz) && !bypass) {
    return {
      ...base,
      enabled: false,
      inVoiceWindow: false,
      disableCode: 'weekend',
      reason: 'Weekend — Live Voice closed',
    }
  }

  const t = parseTimeToSeconds(localTime)
  const start = parseTimeToSeconds(sess.analyzeStart)
  const end = parseTimeToSeconds(sess.entryClose)
  const inVoiceWindow = bypass || (t >= start && t < end)

  if (!inVoiceWindow) {
    const before = t < start
    return {
      ...base,
      enabled: false,
      inVoiceWindow: false,
      disableCode: before ? 'before_prep' : 'after_entry',
      reason: before
        ? `Live Voice opens at ${window.start} ${tzLabel} (prep)`
        : `Live Voice closed after ${window.end} ${tzLabel} (entry window ended)`,
    }
  }

  if (!input.clockedIn) {
    return {
      ...base,
      enabled: false,
      inVoiceWindow: true,
      disableCode: 'not_clocked_in',
      reason: 'Clock in (“Today I trade”) to talk',
    }
  }

  return {
    ...base,
    enabled: true,
    micAllowed: true,
    inVoiceWindow: true,
    disableCode: null,
    reason: null,
  }
}
