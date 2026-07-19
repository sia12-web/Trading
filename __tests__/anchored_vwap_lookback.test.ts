/**
 * AVWAP anchors at cash open of 5 trading days prior to the tip session.
 * Run: npx tsx __tests__/anchored_vwap_lookback.test.ts
 */

import {
  AVWAP_LOOKBACK_TRADING_DAYS,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  cashOpenUnixForYmd,
  computeAnchoredVwap,
  deskClockFor,
  lastNTradingSessions,
  nthTradingDayBefore,
  type SessionBar,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(AVWAP_LOOKBACK_TRADING_DAYS === 5, 'lookback is 5 trading days')

{
  // Friday 2026-07-17 → 5 trading days prior = Friday 2026-07-10
  const prior = nthTradingDayBefore('2026-07-17', 5, 'America/New_York')
  assert(prior === '2026-07-10', `expected 2026-07-10 got ${prior}`)
}

{
  // Tokyo: Monday 2026-07-13 → 5 trading days prior = Monday 2026-07-06
  const prior = nthTradingDayBefore('2026-07-13', 5, 'Asia/Tokyo')
  assert(prior === '2026-07-06', `expected 2026-07-06 got ${prior}`)
}

function bar(ymd: string, hourEt: number, price: number): SessionBar {
  const open = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  // hourEt as hours after midnight ET on that day via cash open offset from 9.5
  const t = open + (hourEt - 9.5) * 3600
  return {
    time: Math.floor(t),
    open: price,
    high: price + 1,
    low: price - 1,
    close: price,
    volume: 100,
  }
}

{
  // Overnight before first RTH must not become the AVWAP start
  const overnight = bar('2026-07-10', 16, 100) // 16:00 ET — post close
  const rth = bar('2026-07-13', 10, 110) // Monday RTH
  const bands = computeAnchoredVwap([overnight, rth], NY_DESK_CLOCK)
  assert(bands != null, 'bands exist')
  assert(bands!.vwap[0]!.time === rth.time, 'AVWAP starts at first RTH bar, not overnight')
}

{
  // Window: tip Friday → include from prior Friday 9:30
  const tipOpen = cashOpenUnixForYmd('2026-07-17', NY_DESK_CLOCK)
  const candles: SessionBar[] = []
  // Build sparse history Mon Jul 6 → Fri Jul 17
  for (const d of [
    '2026-07-06',
    '2026-07-07',
    '2026-07-08',
    '2026-07-09',
    '2026-07-10',
    '2026-07-13',
    '2026-07-14',
    '2026-07-15',
    '2026-07-16',
    '2026-07-17',
  ]) {
    candles.push(bar(d, 10, 100))
  }
  const scoped = lastNTradingSessions(candles, 5, NY_DESK_CLOCK, tipOpen)
  const startDayOpen = cashOpenUnixForYmd('2026-07-10', NY_DESK_CLOCK)
  assert(scoped[0]!.time >= startDayOpen, 'first kept bar at/after prior Friday cash open')
  assert(
    scoped.every((c) => c.time >= startDayOpen),
    'no bars before 5-trading-day-prior cash open'
  )
  assert(
    !scoped.some((c) => c.time < startDayOpen),
    'Jul 6–9 excluded'
  )
  const bands = computeAnchoredVwap(scoped, NY_DESK_CLOCK)
  assert(bands != null && bands.vwap.length > 0, 'vwap from scoped window')
  assert(
    (bands!.vwap[0]!.time as number) >= startDayOpen,
    'drawn AVWAP starts at/after 5-day-prior cash open'
  )
}

{
  // NIKKEI is not NY 9:30 — anchor at Nikkei cash open 09:00 JST, 5 Tokyo sessions prior
  assert(deskClockFor('NIKKEI').cashOpenHour === 9, 'Nikkei open = 9:00')
  assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'Nikkei TZ = Tokyo')
  assert(deskClockFor('DOW').cashOpenHour === 9.5, 'NY open = 9:30')

  const tip = cashOpenUnixForYmd('2026-07-13', TOKYO_DESK_CLOCK) // Mon
  const start = cashOpenUnixForYmd('2026-07-06', TOKYO_DESK_CLOCK) // Mon, 5 sessions prior
  const nySameCivil = cashOpenUnixForYmd('2026-07-06', NY_DESK_CLOCK)
  assert(start !== nySameCivil, 'Nikkei 9:00 JST ≠ NY 9:30 ET on same civil date')

  const candles: SessionBar[] = []
  for (const d of [
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-06',
    '2026-07-07',
    '2026-07-08',
    '2026-07-09',
    '2026-07-10',
    '2026-07-13',
  ]) {
    const t = cashOpenUnixForYmd(d, TOKYO_DESK_CLOCK) + 600 // 09:10 JST RTH
    candles.push({
      time: t,
      open: 38000,
      high: 38100,
      low: 37900,
      close: 38050,
      volume: 10,
    })
  }
  const scoped = lastNTradingSessions(candles, 5, TOKYO_DESK_CLOCK, tip)
  assert(scoped[0]!.time >= start, 'Nikkei window starts at/after 9:00 JST five sessions prior')
  const bands = computeAnchoredVwap(scoped, TOKYO_DESK_CLOCK)
  assert(bands != null, 'Nikkei AVWAP exists')
  const firstT = bands!.vwap[0]!.time as number
  // First drawn point is an RTH bar on/after Nikkei open of the start day — not NY hours
  assert(firstT >= start, 'Nikkei AVWAP draw starts at Nikkei session open')
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // Start day open itself is 09:00; first bar is 09:10
  const openParts = fmt.formatToParts(new Date(start * 1000))
  const oh = openParts.find((p) => p.type === 'hour')?.value
  const om = openParts.find((p) => p.type === 'minute')?.value
  assert(oh === '09' && om === '00', `Nikkei cash open must be 09:00 JST, got ${oh}:${om}`)
}

console.log('anchored_vwap_lookback: all passed')
