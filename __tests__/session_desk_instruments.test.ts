/**
 * DOW / NASDAQ / NIKKEI share TradingView-style Asia/London/NY AM/NY PM bands (ET).
 * Run: npx tsx __tests__/session_desk_instruments.test.ts
 */

import {
  computeSessionHighlightSpans,
  nyDeskSessionAt,
  sessionLegendLabel,
  sessionLegendOrder,
  deskClockFor,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function et(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h + 4, min)).getTime() / 1000)
}

function makeBars(
  start: number,
  end: number,
  step = 300
): Array<{
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}> {
  const out = []
  for (let t = start; t <= end; t += step) {
    out.push({
      time: t,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    })
  }
  return out
}

// ── Shared ET classifier (4 bands like TradingView) ──────────────────────────
assert(nyDeskSessionAt(et(2026, 7, 16, 16, 0)) === 'Asia', 'NY 16:00 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 21, 50)) === 'Asia', 'NY 21:50 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 3, 0)) === 'London', 'NY 03:00 → London')
assert(nyDeskSessionAt(et(2026, 7, 16, 9, 30)) === 'NY AM', 'NY 09:30 → NY AM')
assert(nyDeskSessionAt(et(2026, 7, 16, 11, 0)) === 'NY AM', 'NY 11:00 → NY AM')
assert(nyDeskSessionAt(et(2026, 7, 16, 11, 30)) === 'NY PM', 'NY 11:30 → NY PM')
assert(nyDeskSessionAt(et(2026, 7, 16, 15, 55)) === 'NY PM', 'NY 15:55 → NY PM')

for (const instrument of ['DOW', 'NASDAQ', 'NIKKEI'] as const) {
  const end = et(2026, 7, 16, 21, 50)
  const { spans } = computeSessionHighlightSpans({
    candles: makeBars(et(2026, 7, 15, 9, 30), end),
    asOfUnix: end,
    instrument,
  })
  assert(spans.length >= 4, `${instrument}: expected ≥4 session spans, got ${spans.length}`)
  const tip = spans.find((s) => s.startT <= end && s.endT >= end)
  assert(tip?.name === 'Asia', `${instrument}: tip 21:50 must be Asia, got ${tip?.name}`)

  const am = spans.find((s) => s.startT <= et(2026, 7, 16, 10, 0) && s.endT >= et(2026, 7, 16, 10, 0))
  assert(am?.name === 'NY AM', `${instrument}: 10:00 ET must be NY AM, got ${am?.name}`)

  const pm = spans.find((s) => s.startT <= et(2026, 7, 16, 13, 0) && s.endT >= et(2026, 7, 16, 13, 0))
  assert(pm?.name === 'NY PM', `${instrument}: 13:00 ET must be NY PM, got ${pm?.name}`)

  const pmThenAsia = spans.some(
    (s, i) =>
      s.name === 'NY PM' &&
      spans[i + 1]?.name === 'Asia' &&
      spans[i + 1]!.startT <= s.endT + 1
  )
  assert(pmThenAsia, `${instrument}: NY PM must abut Asia at cash close`)

  const order = sessionLegendOrder(instrument)
  assert(
    order.join(',') === 'Asia,London,NY AM,NY PM',
    `${instrument} legend order`
  )
  assert(sessionLegendLabel('NY AM', instrument) === 'NY AM', `${instrument} NY AM label`)
}

assert(deskClockFor('DOW').timeZone === 'America/New_York', 'DOW TZ')
assert(deskClockFor('NASDAQ').timeZone === 'America/New_York', 'NASDAQ TZ')
assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI trading clock stays Tokyo')

console.log('✅ session_desk_instruments: TradingView-style Asia/London/NY AM/NY PM OK')
