/**
 * Desk time logic — DOW / NASDAQ (ET) vs NIKKEI (JST).
 * Trading morning-only; chart streams until cash close; freeze after close.
 * Run: npx tsx __tests__/desk_session_time_logic.test.ts
 */

import {
  NY_SESSION,
  TOKYO_SESSION,
  TOKYO_CASH_LUNCH_END,
  nikkeiCashLunchMontrealLabel,
  sessionFor,
  deskMarketFor,
  isLunchFreezeActive,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  isDeskHoursNow,
  clipAfternoonBars,
  resolveSessionGate,
  resolveSimMorningGate,
} from '../lib/trading/sessionGate'
import {
  AVWAP_LOOKBACK_TRADING_DAYS,
  deskClockFor,
  cashOpenUnixForYmd,
  lastNTradingSessions,
  nthTradingDayBefore,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** America/New_York in July = EDT (UTC-4) */
function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

/** Asia/Tokyo = UTC+9 */
function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

function etUnix(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(etDate(y, m, d, h, min).getTime() / 1000)
}

function jstUnix(y: number, m: number, d: number, h: number, min: number): number {
  return Math.floor(jstDate(y, m, d, h, min).getTime() / 1000)
}

// ── Session constants ────────────────────────────────────────────────────────
assert(NY_SESSION.tz === 'America/New_York', 'NY tz')
assert(NY_SESSION.marketOpen === '09:30:00', 'NY open 9:30')
assert(NY_SESSION.lunchClose === '11:30:00', 'NY lunch 11:30')
assert(NY_SESSION.marketClose === '16:00:00', 'NY close 16:00')

assert(TOKYO_SESSION.tz === 'Asia/Tokyo', 'Tokyo tz')
assert(TOKYO_SESSION.analyzeStart === '08:45:00', 'Tokyo prep 8:45')
assert(TOKYO_SESSION.marketOpen === '09:00:00', 'Tokyo open 9:00')
assert(TOKYO_SESSION.entryClose === '09:45:00', 'Tokyo entry close 9:45')
assert(TOKYO_SESSION.lunchClose === '11:30:00', 'Tokyo lunch 11:30')
assert(TOKYO_CASH_LUNCH_END === '12:30:00', 'TSE cash lunch ends 12:30 JST')
// EDT: 11:30–12:30 JST → 22:30–23:30 Montreal
assert(
  nikkeiCashLunchMontrealLabel(new Date('2026-08-03T00:00:00Z')) ===
    'Lunch 22:30–23:30 Montreal',
  'Nikkei cash lunch Montreal label'
)
assert(TOKYO_SESSION.marketClose === '15:00:00', 'Tokyo close 15:00')

assert(sessionFor('DOW') === NY_SESSION, 'DOW → NY')
assert(sessionFor('NASDAQ') === NY_SESSION, 'NASDAQ → NY')
assert(sessionFor('NIKKEI') === TOKYO_SESSION, 'NIKKEI → Tokyo')
assert(deskMarketFor('DOW') === 'NY' && deskMarketFor('NASDAQ') === 'NY', 'US market')
assert(deskMarketFor('NIKKEI') === 'TOKYO', 'Tokyo market')

assert(deskClockFor('DOW').cashOpenHour === 9.5, 'DOW AVWAP 9:30')
assert(deskClockFor('NASDAQ').cashOpenHour === 9.5, 'NASDAQ AVWAP 9:30')
assert(deskClockFor('NIKKEI').cashOpenHour === 9, 'NIKKEI AVWAP 9:00')
assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI VWAP TZ')

// Wednesday 2026-07-15 used throughout (weekday both desks)
const Y = 2026
const M = 7
const D = 15

type Inst = 'DOW' | 'NASDAQ' | 'NIKKEI'

function expectPhase(
  instrument: Inst,
  now: Date,
  expect: {
    lunchFreeze: boolean
    trade: boolean
    chart: boolean
    deskHours?: boolean
  },
  label: string
) {
  assert(isLunchFreezeActive(instrument, now) === expect.lunchFreeze, `${label}: freeze`)
  assert(isLiveBarsAllowed(instrument, now).open === expect.trade, `${label}: trade`)
  assert(isChartStreamAllowed(instrument, now).open === expect.chart, `${label}: chart`)
  if (expect.deskHours != null) {
    assert(isDeskHoursNow(now, instrument).open === expect.deskHours, `${label}: deskHours`)
  }
}

// ── DOW + NASDAQ share ET clock ──────────────────────────────────────────────
for (const inst of ['DOW', 'NASDAQ'] as const) {
  // Tip only from focus −30m (09:00 ET) — not midnight / early morning
  expectPhase(inst, etDate(Y, M, D, 8, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, `${inst} 08:00 pre-focus`)
  expectPhase(inst, etDate(Y, M, D, 9, 0), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, `${inst} 09:00 focus start`)
  expectPhase(inst, etDate(Y, M, D, 9, 20), { lunchFreeze: false, trade: false, chart: true, deskHours: true }, `${inst} 09:20 prep`)
  expectPhase(inst, etDate(Y, M, D, 9, 30), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, `${inst} 09:30 open`)
  expectPhase(inst, etDate(Y, M, D, 10, 0), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, `${inst} 10:00 entry`)
  expectPhase(inst, etDate(Y, M, D, 10, 30), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, `${inst} 10:30 flat window`)
  expectPhase(inst, etDate(Y, M, D, 11, 29), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, `${inst} 11:29 last trade minute`)
  expectPhase(inst, etDate(Y, M, D, 11, 30), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, `${inst} 11:30 lunch`)
  expectPhase(inst, etDate(Y, M, D, 14, 0), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, `${inst} 14:00 afternoon print`)
  expectPhase(inst, etDate(Y, M, D, 15, 59), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, `${inst} 15:59 before close`)
  expectPhase(inst, etDate(Y, M, D, 16, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, `${inst} 16:00 cash close freeze`)
  expectPhase(inst, etDate(Y, M, D, 20, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, `${inst} 20:00 overnight freeze`)
}

// Next NY session morning — chart live again
expectPhase(
  'DOW',
  etDate(Y, M, 16, 9, 45),
  { lunchFreeze: false, trade: true, chart: true, deskHours: true },
  'DOW next day 09:45'
)

// Weekend NY closed
expectPhase(
  'NASDAQ',
  etDate(Y, M, 18, 10, 0), // Saturday
  { lunchFreeze: false, trade: false, chart: false },
  'NASDAQ Saturday'
)

// ── NIKKEI JST clock (independent of ET) ─────────────────────────────────────
expectPhase('NIKKEI', jstDate(Y, M, D, 8, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, 'NIKKEI 08:00 pre-focus')
expectPhase('NIKKEI', jstDate(Y, M, D, 8, 30), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, 'NIKKEI 08:30 focus start')
expectPhase('NIKKEI', jstDate(Y, M, D, 8, 50), { lunchFreeze: false, trade: false, chart: true, deskHours: true }, 'NIKKEI 08:50 prep')
expectPhase('NIKKEI', jstDate(Y, M, D, 9, 0), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, 'NIKKEI 09:00 open')
expectPhase('NIKKEI', jstDate(Y, M, D, 9, 30), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, 'NIKKEI 09:30 entry')
expectPhase('NIKKEI', jstDate(Y, M, D, 10, 0), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, 'NIKKEI 10:00')
expectPhase('NIKKEI', jstDate(Y, M, D, 11, 29), { lunchFreeze: false, trade: true, chart: true, deskHours: true }, 'NIKKEI 11:29')
expectPhase('NIKKEI', jstDate(Y, M, D, 11, 30), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, 'NIKKEI 11:30 lunch')
expectPhase('NIKKEI', jstDate(Y, M, D, 13, 0), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, 'NIKKEI 13:00 afternoon print')
expectPhase('NIKKEI', jstDate(Y, M, D, 14, 59), { lunchFreeze: false, trade: false, chart: true, deskHours: false }, 'NIKKEI 14:59')
expectPhase('NIKKEI', jstDate(Y, M, D, 15, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, 'NIKKEI 15:00 cash close freeze')
expectPhase('NIKKEI', jstDate(Y, M, D, 22, 0), { lunchFreeze: false, trade: false, chart: false, deskHours: false }, 'NIKKEI 22:00 overnight freeze')

// ── Cross-market independence at one UTC instant ─────────────────────────────
// Wed 2026-07-15 14:00 ET = 18:00 UTC = Thu 03:00 JST Jul 16
{
  const sameUtc = etDate(Y, M, D, 14, 0)
  assert(isChartStreamAllowed('DOW', sameUtc).open === true, '14:00 ET DOW still printing')
  assert(isLiveBarsAllowed('DOW', sameUtc).open === false, '14:00 ET DOW not trading')
  // 03:00 JST Thursday — before Tokyo focus (08:30) — tip frozen
  assert(isChartStreamAllowed('NIKKEI', sameUtc).open === false, '03:00 JST NIKKEI tip frozen')
  assert(isLiveBarsAllowed('NIKKEI', sameUtc).open === false, '03:00 JST NIKKEI not trading')
}

// Wed 10:00 JST = Tue 21:00 ET previous calendar day... Jul 15 10:00 JST = Jul 15 01:00 UTC = Jul 14 21:00 ET
{
  const tokyoMorning = jstDate(Y, M, D, 10, 0)
  assert(isLiveBarsAllowed('NIKKEI', tokyoMorning).open === true, '10:00 JST NIKKEI trading')
  assert(isChartStreamAllowed('NIKKEI', tokyoMorning).open === true, '10:00 JST NIKKEI chart')
  // Same UTC: DOW is Jul 14 21:00 ET — after Mon? Jul 14 is Tuesday. 21:00 after 16:00 close → frozen
  assert(isChartStreamAllowed('DOW', tokyoMorning).open === false, '21:00 ET DOW frozen while Tokyo morning')
  assert(isLiveBarsAllowed('DOW', tokyoMorning).open === false, '21:00 ET DOW not trading')
}

// ── Afternoon bars never clipped (lunch freeze off) ──────────────────────────
{
  const afternoonEt = etDate(Y, M, D, 14, 0)
  const bars = [
    { time: etUnix(Y, M, D, 10, 0), open: 1, high: 2, low: 0, close: 1 },
    { time: etUnix(Y, M, D, 14, 0), open: 1, high: 2, low: 0, close: 1 },
  ]
  assert(clipAfternoonBars(bars, 'DOW', afternoonEt).length === 2, 'DOW afternoon kept')
  assert(clipAfternoonBars(bars, 'NASDAQ', afternoonEt).length === 2, 'NASDAQ afternoon kept')

  const afternoonJst = jstDate(Y, M, D, 13, 0)
  const nikkeiBars = [
    { time: jstUnix(Y, M, D, 10, 0), open: 1, high: 2, low: 0, close: 1 },
    { time: jstUnix(Y, M, D, 13, 0), open: 1, high: 2, low: 0, close: 1 },
  ]
  assert(clipAfternoonBars(nikkeiBars, 'NIKKEI', afternoonJst).length === 2, 'NIKKEI afternoon kept')
  // Next Tokyo session still has prior afternoon
  assert(
    clipAfternoonBars(nikkeiBars, 'NIKKEI', jstDate(Y, M, 16, 9, 30)).length === 2,
    'next NIKKEI session retains prior afternoon prints'
  )
}

// ── Gate: after lunch — lunch-range unlock when eligible; clocked-out blocks place ─
for (const inst of ['DOW', 'NASDAQ'] as const) {
  const gate = resolveSessionGate({
    now: etDate(Y, M, D, 14, 0),
    lockedInstrument: inst,
    viewingInstrument: inst,
    clockedIn: false,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  // 0 fills → lunch-range unlock message (place blocked while clocked out)
  assert(gate.phase === 'ENTRY', `${inst} lunch-range phase ENTRY`)
  assert(gate.canPlaceEntry === false, `${inst} clocked-out blocks place`)
  assert(gate.canManagePosition === false, `${inst} no manage when flat`)
  assert(!!gate.message?.includes('Lunch-range'), `${inst} lunch-range copy`)
  // Flat + clocked-out clears rangeStrategy in finish(); re-clock restores unlock
  assert(gate.rangeStrategy === null, `${inst} rangeStrategy cleared while clocked out flat`)
  assert(gate.market === 'NY', `${inst} market NY`)
}

{
  const gate = resolveSessionGate({
    now: jstDate(Y, M, D, 13, 0),
    lockedInstrument: 'NIKKEI',
    viewingInstrument: 'NIKKEI',
    clockedIn: false,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.market === 'NY', 'live NIKKEI lock ignored — stays NY')
  assert(gate.lockedInstrument !== 'NIKKEI', 'NIKKEI lock dropped')
  assert(!gate.allowedInstruments.includes('NIKKEI'), 'no live NIKKEI')
}

// Morning entry still works when clocked in
{
  const gate = resolveSessionGate({
    now: etDate(Y, M, D, 10, 5),
    lockedInstrument: 'NASDAQ',
    viewingInstrument: 'NASDAQ',
    clockedIn: true,
    attendedToday: true,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(gate.phase === 'ENTRY', `NASDAQ morning ENTRY got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'NASDAQ can place in entry window')
}

{
  const gate = resolveSimMorningGate({
    now: jstDate(Y, M, D, 9, 20),
    instrument: 'NIKKEI',
    hasOpenPosition: false,
    attemptsUsed: 0,
    stopHits: 0,
  })
  assert(gate.phase === 'ENTRY', `NIKKEI sim morning ENTRY got ${gate.phase}`)
  assert(gate.canPlaceEntry === true, 'NIKKEI sim can place in entry window')
  assert(gate.market === 'TOKYO', 'sim NIKKEI stays Tokyo')
}

// Sim afternoon: lunch-range unlock when morning + IB skipped
{
  const sim = resolveSimMorningGate({
    now: etDate(Y, M, D, 14, 0),
    instrument: 'DOW',
    hasOpenPosition: false,
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 0,
    stopHits: 0,
  })
  assert(sim.phase === 'ENTRY', 'sim afternoon lunch-range ENTRY')
  assert(sim.canPlaceEntry === true, 'sim lunch-range can place')
  assert(sim.rangeStrategy === 'lunch_range', 'lunch_range strategy')
}

// Sim afternoon: morning fill does not kill lunch-range (Option B)
{
  const sim = resolveSimMorningGate({
    now: etDate(Y, M, D, 14, 0),
    instrument: 'DOW',
    hasOpenPosition: false,
    morningAttempts: 1,
    stopHits: 0,
  })
  assert(sim.canPlaceEntry === true, 'sim lunch-range still open after morning fill')
  assert(sim.rangeStrategy === 'lunch_range', 'lunch_range strategy after morning fill')
}

// ── VWAP: 5 trading days prior, per-desk cash open ───────────────────────────
assert(AVWAP_LOOKBACK_TRADING_DAYS === 5, 'lookback 5')
{
  // Thu Jul 16 → 5 NY sessions prior = Thu Jul 9
  const tip = '2026-07-16'
  assert(nthTradingDayBefore(tip, 5, 'America/New_York') === '2026-07-09', 'NY 5 prior')
  const tipOpen = cashOpenUnixForYmd(tip, deskClockFor('DOW'))
  const days = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']
  const candles = days.map((d) => {
    const t = cashOpenUnixForYmd(d, deskClockFor('DOW')) + 900
    return { time: t, open: 1, high: 2, low: 0, close: 1, volume: 10 }
  })
  const scoped = lastNTradingSessions(candles, 5, deskClockFor('NASDAQ'), tipOpen)
  assert(scoped[0]!.time >= cashOpenUnixForYmd('2026-07-09', deskClockFor('NASDAQ')), 'NY VWAP start')
}
{
  // Mon Jul 13 → 5 Tokyo sessions prior = Mon Jul 6
  const tip = '2026-07-13'
  assert(nthTradingDayBefore(tip, 5, 'Asia/Tokyo') === '2026-07-06', 'Tokyo 5 prior')
  const tipOpen = cashOpenUnixForYmd(tip, deskClockFor('NIKKEI'))
  const nyOpenSameDay = cashOpenUnixForYmd('2026-07-06', deskClockFor('DOW'))
  const tokyoOpen = cashOpenUnixForYmd('2026-07-06', deskClockFor('NIKKEI'))
  assert(tokyoOpen !== nyOpenSameDay, 'Nikkei 9:00 JST ≠ NY 9:30 ET')
  const candles = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-13'].map(
    (d) => {
      const t = cashOpenUnixForYmd(d, deskClockFor('NIKKEI')) + 600
      return { time: t, open: 38000, high: 38100, low: 37900, close: 38050, volume: 10 }
    }
  )
  const scoped = lastNTradingSessions(candles, 5, deskClockFor('NIKKEI'), tipOpen)
  assert(scoped[0]!.time >= tokyoOpen, 'Nikkei VWAP starts at 9:00 JST five sessions prior')
}

console.log('desk_session_time_logic: all passed (DOW / NASDAQ / NIKKEI)')
