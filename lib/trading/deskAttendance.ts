/**
 * Desk clock-in / clock-out.
 * Clock-in = trader commits to today's session → live chart unlocks + level
 * reaction AI runs. Lunch auto clock-out. Journals attach to the attendance row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildAttemptLadder,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'
import {
  deskMarketFor,
  isDeskInstrument,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import {
  DESK_CALL_MODE_JOURNAL_KEY,
  attendanceCallMode,
} from '@/lib/trading/deskCallMode'
import { assertLiveClockIn, LIVE_CLOCK_REFUSE } from '@/lib/trading/liveDeskBook'

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
  /** First clock-in after cash open (late join). Does not unlock dead books. */
  late_join: boolean
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
 * True when first clock-in would be after cash open (still inside cash session).
 * Late join unlocks remaining probes only — dead OR30/IB books stay closed.
 */
export function isLateJoinClockIn(
  market: DeskMarket,
  now = new Date()
): boolean {
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  const s = sessionFor(probe)
  if (!weekdayInTz(now, s.tz)) return false
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  const close = parseTimeToSeconds(s.marketClose)
  return t >= open && t < close
}

/**
 * Markets in the clock-in window right now.
 * Cash session: analyzeStart → cash close (prep + late join after open).
 */
export function activeClockMarkets(now = new Date()): DeskMarket[] {
  const out: DeskMarket[] = []
  for (const market of ['NY'] as DeskMarket[]) {
    const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
    const s = sessionFor(probe)
    if (!weekdayInTz(now, s.tz)) continue
    const t = parseTimeToSeconds(timeInTz(now, s.tz))
    const start = parseTimeToSeconds(s.analyzeStart)
    const close = parseTimeToSeconds(s.marketClose)
    if (t >= start && t < close) out.push(market)
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
  if (market === 'TOKYO') {
    return { ok: false, reason: LIVE_CLOCK_REFUSE }
  }
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  const s = sessionFor(probe)
  if (!weekdayInTz(now, s.tz)) {
    return { ok: false, reason: 'Weekend — desk closed' }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const start = parseTimeToSeconds(s.analyzeStart)
  const open = parseTimeToSeconds(s.marketOpen)
  const close = parseTimeToSeconds(s.marketClose)
  if (t < start) {
    return {
      ok: false,
      reason: `Clock-in opens ${deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)} ${TRADER_DISPLAY_LABEL} (15 min before cash open)`,
    }
  }
  if (t >= close) {
    return {
      ok: false,
      reason: `Cash close — clock-in closed until next prep (${deskLocalHmsAsTraderDisplay(s.analyzeStart, s.tz, now)} ${TRADER_DISPLAY_LABEL}).`,
    }
  }
  if (t >= open) {
    return {
      ok: true,
      reason:
        'Late clock-in open — remaining probes only (dead OR30/IB books stay closed)',
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
  if (!data) return null
  const row = data as DeskAttendanceRow
  return { ...row, late_join: !!row.late_join }
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

/** Re-clock after early manual/auto out — until cash close (already committed today). */
export function canReClockInNow(
  market: DeskMarket,
  now = new Date()
): { ok: boolean; reason: string } {
  if (market === 'TOKYO') {
    return { ok: false, reason: LIVE_CLOCK_REFUSE }
  }
  const probe = market === 'TOKYO' ? 'NIKKEI' : 'DOW'
  const s = sessionFor(probe)
  if (!weekdayInTz(now, s.tz)) {
    return { ok: false, reason: 'Weekend — desk closed' }
  }
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const start = parseTimeToSeconds(s.analyzeStart)
  const close = parseTimeToSeconds(s.marketClose)
  if (t < start) {
    return { ok: false, reason: 'Desk prep not open yet' }
  }
  if (t >= close) {
    return { ok: false, reason: 'Cash close — re-clock closed for today' }
  }
  return { ok: true, reason: 'Re-clock window open until cash close' }
}

/**
 * Keep desk clocked in through lunch while session fills remain (< 3).
 * Do not auto clock-out merely because IB/LN window probes look closed —
 * trader stays for manage / leftover session slots until the hard 3-fill cap.
 */
export function shouldRetainClockInAtLunch(ladder: AttemptLadder): boolean {
  return !ladder.dayLocked
}

export async function clockIn(
  supabase: SupabaseClient,
  userId: string,
  args: { market: DeskMarket; instrument?: DeskInstrument | null }
): Promise<{ ok: true; row: DeskAttendanceRow } | { ok: false; error: string }> {
  const live = assertLiveClockIn({
    market: args.market,
    instrument: args.instrument ?? null,
  })
  if (!live.ok) return { ok: false, error: live.error }
  const instrument = live.instrument

  const sessionDate = sessionDateForMarket(args.market)

  const existing = await getTodayAttendance(supabase, userId, args.market)
  if (existing?.status === 'clocked_in') {
    const switchLock = assertLiveClockIn({
      market: args.market,
      instrument,
      existingInstrument: existing.instrument,
      alreadyClockedIn: true,
    })
    if (!switchLock.ok) return { ok: false, error: switchLock.error }
    return { ok: true, row: existing }
  }
  if (existing?.status === 'clocked_out') {
    // Already attended today — may re-enter until cash close (not a late first clock-in)
    const re = canReClockInNow(args.market)
    if (!re.ok) return { ok: false, error: re.reason }

    // Session 3/3 → no “Today I trade” re-entry (day locked)
    const sessionDate = sessionDateForMarket(args.market)
    const instruments = args.market === 'TOKYO' ? ['NIKKEI'] : ['DOW', 'NASDAQ']
    const { data: fills } = await supabase
      .from('trades_journal')
      .select('instrument, exit_reason, entry_timestamp, created_at, range_bucket')
      .eq('user_id', userId)
      .eq('trade_date', sessionDate)
      .eq('fill_status', 'filled')
      .in('instrument', instruments)
    const ladder = buildAttemptLadder(
      (fills || []).map((t) => ({
        instrument: t.instrument as string,
        entryTimestamp: t.entry_timestamp || t.created_at || null,
        exitReason: (t.exit_reason as string) || null,
        rangeBucket:
          (t as { range_bucket?: string | null }).range_bucket as
            | 'morning'
            | 'ib'
            | 'lunch_range'
            | 'other'
            | null
            | undefined,
      })),
      args.market === 'TOKYO' ? 'NIKKEI' : 'DOW',
      new Date()
    )
    if (ladder.dayLocked) {
      return {
        ok: false,
        error: `Session ${ladder.dayAttempts}/${ladder.maxDayAttempts} — day locked. No re-clock / new entries.`,
      }
    }

    if (
      existing.instrument &&
      existing.instrument !== instrument
    ) {
      return {
        ok: false,
        error: `Already clocked into ${existing.instrument} — name is locked for this session.`,
      }
    }

    const { data, error } = await supabase
      .from('desk_attendance')
      .update({
        status: 'clocked_in',
        clock_in_at: new Date().toISOString(),
        clock_out_at: null,
        clock_out_reason: null,
        instrument: existing.instrument ?? instrument,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error || !data) return { ok: false, error: error?.message || 'Failed to re-clock-in' }
    return { ok: true, row: data as DeskAttendanceRow }
  }

  // First clock-in of the day — prep or late join during cash session
  const check = canClockInNow(args.market)
  if (!check.ok) return { ok: false, error: check.reason }

  const lateJoin = isLateJoinClockIn(args.market)

  const { data, error } = await supabase
    .from('desk_attendance')
    .insert({
      user_id: userId,
      market: args.market,
      session_date: sessionDate,
      instrument,
      status: 'clocked_in',
      clock_in_at: new Date().toISOString(),
      late_join: lateJoin,
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

/** Auto lunch clock-out for markets past lunchClose.
 * Skips when an open book still needs manage, or when session fills remain and a
 * later entry window is still eligible (e.g. Nikkei IB prep after 11:30 JST lunch).
 */
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

    // Ladder must match session-gate (desk session date only). Do not merge EST
    // calendar day — that double-counts Nikkei fills near the JST/ET boundary.
    const sessionDate = sessionDateForMarket(market, now)
    const instruments = market === 'TOKYO' ? ['NIKKEI'] : ['DOW', 'NASDAQ']

    const { data: openPos } = await supabase
      .from('trades_journal')
      .select('id, instrument')
      .eq('user_id', userId)
      .eq('trade_date', sessionDate)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .in('instrument', instruments)
      .limit(1)
      .maybeSingle()

    // Open book → stay clocked in so MANAGE / confirm-close / cash-flat works
    if (openPos) continue

    const { data: fills } = await supabase
      .from('trades_journal')
      .select('instrument, exit_reason, entry_timestamp, created_at, range_bucket')
      .eq('user_id', userId)
      .eq('trade_date', sessionDate)
      .eq('fill_status', 'filled')
      .in('instrument', instruments)

    const ladder = buildAttemptLadder(
      (fills || []).map((t) => ({
        instrument: t.instrument as string,
        entryTimestamp: t.entry_timestamp || t.created_at || null,
        exitReason: (t.exit_reason as string) || null,
        rangeBucket:
          (t as { range_bucket?: string | null }).range_bucket as
            | 'morning'
            | 'ib'
            | 'lunch_range'
            | 'other'
            | null
            | undefined,
      })),
      market === 'TOKYO' ? 'NIKKEI' : 'DOW',
      now
    )

    // Session slots or later windows remain → stay clocked in
    if (shouldRetainClockInAtLunch(ladder)) continue

    let traded: DeskInstrument | null = null
    const { data: trade } = await supabase
      .from('trades_journal')
      .select('instrument')
      .eq('user_id', userId)
      .eq('trade_date', sessionDate)
      .eq('fill_status', 'filled')
      .in('instrument', instruments)
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

export { attendanceCallMode }

/**
 * Persist the post clock-in CALL / regular choice on today's attendance.
 * First answer is required; later switches are allowed (ticket gate only).
 */
export async function setAttendanceUseCall(
  supabase: SupabaseClient,
  userId: string,
  args: { market: DeskMarket; useCall: boolean }
): Promise<{ ok: true; row: DeskAttendanceRow } | { ok: false; error: string }> {
  const existing = await getTodayAttendance(supabase, userId, args.market)
  if (!existing || existing.status !== 'clocked_in') {
    return { ok: false, error: 'Clock in first' }
  }
  const current = attendanceCallMode(existing.morning_journal)
  if (current === args.useCall) {
    return { ok: true, row: existing }
  }
  const journal = {
    ...existing.morning_journal,
    [DESK_CALL_MODE_JOURNAL_KEY]: args.useCall,
  }
  const { data, error } = await supabase
    .from('desk_attendance')
    .update({
      morning_journal: journal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message || 'Failed to save CALL choice' }
  }
  return { ok: true, row: data as DeskAttendanceRow }
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
