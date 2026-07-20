/**
 * Desk clock-in / clock-out.
 * Clock-in = trader commits to today's session → live chart unlocks + level
 * reaction AI runs. Lunch auto clock-out. Journals attach to the attendance row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deskMarketFor,
  isDeskInstrument,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { getESTDateString, parseTimeToSeconds } from '@/lib/utils/timeUtils'

export type AttendanceStatus = 'clocked_in' | 'clocked_out' | 'missed'

export type DeskAttendanceRow = {
  id: string
  user_id: string
  market: DeskMarket
  session_date: string
  instrument: DeskInstrument | null
  status: AttendanceStatus
  clock_in_at: string
  clock_out_at: string | null
  clock_out_reason: 'lunch' | 'manual' | 'eod' | null
  traded_instrument: DeskInstrument | null
  morning_journal: Record<string, unknown>
  afternoon_levels: unknown[]
  eod_journal: Record<string, unknown>
}

function localDateInTz(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function timeInTz(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

function weekdayInTz(now: Date, timeZone: string): boolean {
  const d = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return d !== 'Sat' && d !== 'Sun'
}

/**
 * Markets in the clock-in window right now.
 * Prep only: analyzeStart → cash open. Late after open = missed session (no clock-in).
 */
export function activeClockMarkets(now = new Date()): DeskMarket[] {
  const out: DeskMarket[] = []
  for (const market of ['NY', 'TOKYO'] as DeskMarket[]) {
    const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
    const s = sessionFor(probe)
    if (!weekdayInTz(now, s.tz)) continue
    const t = parseTimeToSeconds(timeInTz(now, s.tz))
    const start = parseTimeToSeconds(s.analyzeStart)
    const open = parseTimeToSeconds(s.marketOpen)
    if (t >= start && t < open) out.push(market)
  }
  return out
}

export function sessionDateForMarket(market: DeskMarket, now = new Date()): string {
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  return localDateInTz(sessionFor(probe).tz, now)
}

/** Journal / attempt-book date for an instrument (ET for NY, JST for NIKKEI). */
export function tradeDateForInstrument(
  instrument: string | null | undefined,
  now = new Date()
): string {
  return sessionDateForMarket(deskMarketFor(instrument), now)
}

export function canClockInNow(
  market: DeskMarket,
  now = new Date()
): { ok: boolean; reason: string } {
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  const s = sessionFor(probe)
  if (!weekdayInTz(now, s.tz)) {
    return { ok: false, reason: 'Weekend — desk closed' }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const start = parseTimeToSeconds(s.analyzeStart)
  const open = parseTimeToSeconds(s.marketOpen)
  if (t < start) {
    return {
      ok: false,
      reason:
        market === 'TOKYO'
          ? 'Clock-in opens 8:45 JST (15 min before Tokyo cash open)'
          : 'Clock-in opens 9:15 ET (15 min before NY cash open)',
    }
  }
  if (t >= open) {
    return {
      ok: false,
      reason:
        'Cash open already passed — late clock-in closed. This session is skipped (no AI / no trades).',
    }
  }
  return { ok: true, reason: 'Clock-in window open (prep until cash open)' }
}

export async function getTodayAttendance(
  supabase: SupabaseClient,
  userId: string,
  market: DeskMarket,
  now = new Date()
): Promise<DeskAttendanceRow | null> {
  const sessionDate = sessionDateForMarket(market, now)
  const { data } = await supabase
    .from('desk_attendance')
    .select('*')
    .eq('user_id', userId)
    .eq('market', market)
    .eq('session_date', sessionDate)
    .maybeSingle()
  return (data as DeskAttendanceRow | null) ?? null
}

/** True if user is currently clocked in for this market today. */
export async function isClockedIn(
  supabase: SupabaseClient,
  userId: string,
  market: DeskMarket,
  now = new Date()
): Promise<boolean> {
  const row = await getTodayAttendance(supabase, userId, market, now)
  return row?.status === 'clocked_in'
}

/** Clocked in for any market whose desk is active right now (or today's NY/Tokyo row). */
export async function isClockedInForInstrument(
  supabase: SupabaseClient,
  userId: string,
  instrument: string | null | undefined,
  now = new Date()
): Promise<boolean> {
  const market = deskMarketFor(instrument)
  return isClockedIn(supabase, userId, market, now)
}

/** Re-clock after early manual out — until lunch (they already committed today). */
export function canReClockInNow(
  market: DeskMarket,
  now = new Date()
): { ok: boolean; reason: string } {
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  const s = sessionFor(probe)
  if (!weekdayInTz(now, s.tz)) {
    return { ok: false, reason: 'Weekend — desk closed' }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const start = parseTimeToSeconds(s.analyzeStart)
  const lunch = parseTimeToSeconds(s.lunchClose)
  if (t < start) {
    return { ok: false, reason: 'Desk prep not open yet' }
  }
  if (t >= lunch) {
    return { ok: false, reason: 'Morning session ended at lunch — re-clock closed' }
  }
  return { ok: true, reason: 'Re-clock window open until lunch' }
}

export async function clockIn(
  supabase: SupabaseClient,
  userId: string,
  args: { market: DeskMarket; instrument?: DeskInstrument | null }
): Promise<{ ok: true; row: DeskAttendanceRow } | { ok: false; error: string }> {
  const sessionDate = sessionDateForMarket(args.market)
  const instrument =
    args.instrument && isDeskInstrument(args.instrument) ? args.instrument : null

  const existing = await getTodayAttendance(supabase, userId, args.market)
  if (existing?.status === 'clocked_in') {
    return { ok: true, row: existing }
  }
  if (existing?.status === 'clocked_out') {
    // Already attended today — may re-enter until lunch (not a late first clock-in)
    const re = canReClockInNow(args.market)
    if (!re.ok) return { ok: false, error: re.reason }
    const { data, error } = await supabase
      .from('desk_attendance')
      .update({
        status: 'clocked_in',
        clock_in_at: new Date().toISOString(),
        clock_out_at: null,
        clock_out_reason: null,
        instrument: instrument ?? existing.instrument,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error || !data) return { ok: false, error: error?.message || 'Failed to re-clock-in' }
    return { ok: true, row: data as DeskAttendanceRow }
  }

  // First clock-in of the day — prep only (before cash open)
  const check = canClockInNow(args.market)
  if (!check.ok) return { ok: false, error: check.reason }

  const { data, error } = await supabase
    .from('desk_attendance')
    .insert({
      user_id: userId,
      market: args.market,
      session_date: sessionDate,
      instrument,
      status: 'clocked_in',
      clock_in_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message || 'Failed to clock in' }
  }
  return { ok: true, row: data as DeskAttendanceRow }
}

export async function clockOut(
  supabase: SupabaseClient,
  userId: string,
  args: {
    market: DeskMarket
    reason: 'lunch' | 'manual' | 'eod'
    tradedInstrument?: DeskInstrument | null
  }
): Promise<{ ok: true; row: DeskAttendanceRow | null } | { ok: false; error: string }> {
  const existing = await getTodayAttendance(supabase, userId, args.market)
  if (!existing) return { ok: true, row: null }
  if (existing.status !== 'clocked_in') return { ok: true, row: existing }

  const { data, error } = await supabase
    .from('desk_attendance')
    .update({
      status: 'clocked_out',
      clock_out_at: new Date().toISOString(),
      clock_out_reason: args.reason,
      traded_instrument: args.tradedInstrument ?? existing.traded_instrument,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select('*')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, row: (data as DeskAttendanceRow) ?? existing }
}

/** Auto lunch clock-out for markets past lunchClose. */
export async function autoLunchClockOut(
  supabase: SupabaseClient,
  userId: string,
  now = new Date()
): Promise<DeskMarket[]> {
  const closed: DeskMarket[] = []
  for (const market of ['NY', 'TOKYO'] as DeskMarket[]) {
    const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
    const s = sessionFor(probe)
    if (!weekdayInTz(now, s.tz)) continue
    const t = parseTimeToSeconds(timeInTz(now, s.tz))
    const lunch = parseTimeToSeconds(s.lunchClose)
    if (t < lunch) continue

    const row = await getTodayAttendance(supabase, userId, market, now)
    if (row?.status !== 'clocked_in') continue

    // Prefer instrument that had a filled trade today.
    // Trades currently store EST calendar dates; Tokyo session_date is JST — check both.
    let traded: DeskInstrument | null = null
    const sessionDate = sessionDateForMarket(market, now)
    const estDate = getESTDateString(now)
    const dateFilter =
      market === 'TOKYO' && estDate !== sessionDate
        ? [sessionDate, estDate]
        : [sessionDate]
    const { data: trade } = await supabase
      .from('trades_journal')
      .select('instrument')
      .eq('user_id', userId)
      .in('trade_date', dateFilter)
      .eq('fill_status', 'filled')
      .in('instrument', market === 'TOKYO' ? ['NIKKEI'] : ['DOW', 'NASDAQ'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (trade?.instrument && isDeskInstrument(trade.instrument)) {
      traded = trade.instrument
    }

    await clockOut(supabase, userId, {
      market,
      reason: 'lunch',
      tradedInstrument: traded,
    })
    closed.push(market)
  }
  return closed
}

export async function saveMorningJournal(
  supabase: SupabaseClient,
  attendanceId: string,
  journal: Record<string, unknown>,
  afternoonLevels: unknown[]
): Promise<void> {
  await supabase
    .from('desk_attendance')
    .update({
      morning_journal: journal,
      afternoon_levels: afternoonLevels,
      updated_at: new Date().toISOString(),
    })
    .eq('id', attendanceId)
}

export async function saveEodJournal(
  supabase: SupabaseClient,
  attendanceId: string,
  journal: Record<string, unknown>
): Promise<void> {
  await supabase
    .from('desk_attendance')
    .update({
      eod_journal: journal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', attendanceId)
}
