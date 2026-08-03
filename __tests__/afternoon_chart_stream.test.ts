/**
 * Afternoon chart prints until cash close; freeze after close; next session full history.
 * VWAP lookback stays 5 trading days prior (sessionVwap).
 * Run: npx tsx __tests__/afternoon_chart_stream.test.ts
 */

import {
  isLunchFreezeActive,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  isLiveTipStreamAllowed,
  clipAfternoonBars,
  resolveSessionGate,
  attemptLadderFromCounts,
} from '../lib/trading/sessionGate'
import {
  AVWAP_LOOKBACK_TRADING_DAYS,
  NY_DESK_CLOCK,
  cashOpenUnixForYmd,
  lastNTradingSessions,
  nthTradingDayBefore,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Wednesday 2026-07-15 14:00 ET = 18:00 UTC (afternoon, before cash close)
const afternoonEt = new Date('2026-07-15T18:00:00.000Z')
// After NY cash close 16:00 ET = 20:00 UTC
const afterCloseEt = new Date('2026-07-15T20:30:00.000Z')
// Next session morning 09:45 ET = 13:45 UTC Thursday
const nextMorningEt = new Date('2026-07-16T13:45:00.000Z')

assert(isLunchFreezeActive('DOW', afternoonEt) === false, 'no lunch freeze')
assert(isLunchFreezeActive('NIKKEI', afternoonEt) === false, 'no lunch freeze NIKKEI')

assert(isLiveBarsAllowed('DOW', afternoonEt).open === false, 'trading locked after lunch')
assert(isChartStreamAllowed('DOW', afternoonEt).open === true, 'chart prints afternoon')
assert(isChartStreamAllowed('DOW', afterCloseEt).open === false, 'frozen after cash close')
assert(isChartStreamAllowed('DOW', nextMorningEt).open === true, 'stream open next session')
assert(
  isLiveTipStreamAllowed('DOW', afternoonEt, { attendedToday: false }).open === false,
  'afternoon tip needs attendance'
)
assert(
  isLiveTipStreamAllowed('DOW', afternoonEt, { attendedToday: true }).open === true,
  'afternoon tip ok when attended'
)
assert(
  isChartStreamAllowed('DOW', new Date('2026-07-15T12:00:00.000Z')).open === false,
  'pre-focus 08:00 ET tip frozen'
)
// After cash open without clock-in → session skipped (no tip)
const afterOpenMiss = new Date('2026-07-15T14:00:00.000Z') // 10:00 ET
assert(
  isLiveTipStreamAllowed('DOW', afterOpenMiss, { attendedToday: false }).open === false,
  'missed clock-in → tip off after open'
)
assert(
  isLiveTipStreamAllowed('DOW', afterOpenMiss, { clockedIn: true }).open === true,
  'clocked in → tip on after open'
)

const lunchUnix = Math.floor(new Date('2026-07-15T15:30:00.000Z').getTime() / 1000)
const afternoonBar = Math.floor(new Date('2026-07-15T18:00:00.000Z').getTime() / 1000)
const bars = [
  { time: lunchUnix - 600, open: 1, high: 2, low: 0, close: 1 },
  { time: afternoonBar, open: 1, high: 2, low: 0, close: 1 },
]
assert(
  clipAfternoonBars(bars, 'DOW', afternoonEt).length === 2,
  'afternoon bars kept while streaming'
)
assert(
  clipAfternoonBars(bars, 'DOW', nextMorningEt).length === 2,
  'next session still has prior afternoon prints (no permanent clip)'
)

const gate = resolveSessionGate({
  now: afternoonEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
// Clocked out → no place even if lunch-range window is open
assert(gate.canPlaceEntry === false, 'no entries when clocked out')
assert(gate.canViewLiveChart === true, 'attended → afternoon chart ok')
assert(
  gate.phase === 'ENTRY' || gate.phase === 'DONE',
  `afternoon phase: ${gate.phase}`
)
assert(
  /lunch-range|Lunch-range|cash close|manage|Day /i.test(gate.message),
  `gate: ${gate.message}`
)

// Open book after lunch clock-out → still manage (never lock the trader out of an open position)
{
  const manage = resolveSessionGate({
    now: afternoonEt,
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    clockedIn: false,
    attendedToday: true,
    attemptsUsed: 1,
    stopLossHitCount: 0,
    hasOpenPosition: true,
  })
  assert(manage.phase === 'MANAGE', 'open book → MANAGE')
  assert(manage.canManagePosition === true, 'open book still manageable when clocked out')
  assert(manage.canPlaceEntry === false, 'open book → no new entries')
  assert(manage.canViewLiveChart === true, 'open book keeps live chart')
  assert(manage.canFetchLiveBars === true, 'open book keeps live bars')
  assert(/Position open|Manage only/i.test(manage.message), `manage msg: ${manage.message}`)
}

// Used 1 morning fill → lunch-range still open after clocks (Option B)
const stillLunch = resolveSessionGate({
  now: afternoonEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: true,
  attendedToday: true,
  attemptsUsed: 1,
  stopLossHitCount: 0,
})
assert(stillLunch.canPlaceEntry === true, '1 morning fill → lunch-range still open after clocks')
assert(stillLunch.rangeStrategy === 'lunch_range', 'lunch-range after morning probe')

// Morning + IB skipped → lunch-range open
const lunchOpen = resolveSessionGate({
  now: afternoonEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: true,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
assert(lunchOpen.canPlaceEntry === true, '0 fills → lunch-range open')
assert(lunchOpen.rangeStrategy === 'lunch_range', 'lunch_range when skipped')

// IB probe → lunch still open after clocks (Option B)
const afterIb = resolveSessionGate({
  now: afternoonEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: true,
  attendedToday: true,
  attemptLadder: attemptLadderFromCounts({
    ibAttempts: 1,
    now: afternoonEt,
    instrument: 'DOW',
  }),
})
assert(afterIb.canPlaceEntry === true, 'IB probe → lunch still open after clocks')
assert(afterIb.rangeStrategy === 'lunch_range', 'lunch strategy after IB probe')
assert(/Lunch-range playbook unlocked/i.test(afterIb.message), `after IB msg: ${afterIb.message}`)

// Never clocked in → afternoon chart locked until late clock-in (or cash close)
for (const [inst, now] of [
  ['DOW', afternoonEt],
  ['NASDAQ', afternoonEt],
  ['NIKKEI', new Date('2026-07-15T04:00:00.000Z')], // 13:00 JST
] as const) {
  const missed = resolveSessionGate({
    now,
    lockedInstrument: inst,
    viewingInstrument: inst,
    clockedIn: false,
    attendedToday: false,
    attemptsUsed: 0,
    stopLossHitCount: 0,
  })
  assert(
    missed.phase === 'DONE' || missed.phase === 'ENTRY',
    `${inst} afternoon phase ${missed.phase}`
  )
  assert(missed.canPlaceEntry === false, `${inst} no place without clock-in`)
  assert(missed.canViewLiveChart === false, `${inst} no chart without clock-in`)
  assert(missed.attendedToday === false, `${inst} not attended`)
  assert(missed.canClockIn === true, `${inst} late clock-in still open`)
  assert(
    /late clock-in|remaining probes/i.test(missed.message),
    `${inst}: ${missed.message}`
  )
}

const gateClosed = resolveSessionGate({
  now: afterCloseEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'DOW',
  clockedIn: false,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
assert(gateClosed.phase === 'CLOSED', `after close phase: ${gateClosed.phase}`)
assert(/cash closed/i.test(gateClosed.message), `after close: ${gateClosed.message}`)
assert(!/afternoon watch/i.test(gateClosed.message), 'no afternoon copy after cash close')
assert(gateClosed.market === 'NY', 'DOW tab → NY market copy')
assert(/NY desk|9:15 Montreal/i.test(gateClosed.message), `NY copy: ${gateClosed.message}`)

// Same wall time, NIKKEI tab → Tokyo desk messaging (not sticky NY copy)
const gateNikkeiBrowse = resolveSessionGate({
  now: afterCloseEt,
  lockedInstrument: 'DOW',
  viewingInstrument: 'NIKKEI',
  clockedIn: false,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
assert(gateNikkeiBrowse.market === 'TOKYO', 'NIKKEI tab → TOKYO market')
assert(
  /Tokyo|Montreal|NIKKEI/i.test(gateNikkeiBrowse.message),
  `Tokyo copy: ${gateNikkeiBrowse.message}`
)
assert(!/Next NY desk|9:15 Montreal/i.test(gateNikkeiBrowse.message), 'no NY next-desk on NIKKEI tab')

assert(AVWAP_LOOKBACK_TRADING_DAYS === 5, 'VWAP lookback = 5')
{
  const tipOpen = cashOpenUnixForYmd('2026-07-16', NY_DESK_CLOCK)
  const startDay = nthTradingDayBefore('2026-07-16', 5, 'America/New_York')
  assert(startDay === '2026-07-09', `5 days prior to Thu 16 = ${startDay}`)
  const history = [
    '2026-07-08',
    '2026-07-09',
    '2026-07-10',
    '2026-07-13',
    '2026-07-14',
    '2026-07-15',
    '2026-07-16',
  ].map((d) => {
    const t = cashOpenUnixForYmd(d, NY_DESK_CLOCK) + 600
    return { time: t, open: 100, high: 101, low: 99, close: 100, volume: 10 }
  })
  const scoped = lastNTradingSessions(history, 5, NY_DESK_CLOCK, tipOpen)
  const cutoff = cashOpenUnixForYmd('2026-07-09', NY_DESK_CLOCK)
  assert(scoped[0]!.time >= cutoff, 'VWAP window starts 5 sessions prior cash open')
  assert(
    scoped.some((c) => c.time === history[5]!.time),
    'prior afternoon session day included in VWAP window when present'
  )
}

console.log('afternoon_chart_stream: all passed')
