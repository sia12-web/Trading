/**
 * Afternoon chart prints until cash close; freeze after close; next session full history.
 * VWAP lookback stays 5 trading days prior (sessionVwap).
 * Run: npx tsx __tests__/afternoon_chart_stream.test.ts
 */

import {
  isLunchFreezeActive,
  isLiveBarsAllowed,
  isChartStreamAllowed,
  clipAfternoonBars,
  resolveSessionGate,
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
assert(gate.canPlaceEntry === false, 'no entries after lunch')
assert(/cash close|background/i.test(gate.message), `gate: ${gate.message}`)

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
