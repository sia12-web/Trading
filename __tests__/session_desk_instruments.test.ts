/**
 * Production readiness: DOW / NASDAQ / NIKKEI share real Asia/London/NY (ET) colors.
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

// ── Shared ET classifier ─────────────────────────────────────────────────────
assert(nyDeskSessionAt(et(2026, 7, 16, 16, 0)) === 'Asia', 'NY 16:00 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 21, 50)) === 'Asia', 'NY 21:50 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 3, 0)) === 'London', 'NY 03:00 → London')
assert(nyDeskSessionAt(et(2026, 7, 16, 9, 30)) === 'New York', 'NY 09:30 → NY')
assert(nyDeskSessionAt(et(2026, 7, 16, 15, 55)) === 'New York', 'NY 15:55 → NY')

// ── DOW / NASDAQ / NIKKEI: same session highlight coloring (ET clock) ─────────
for (const instrument of ['DOW', 'NASDAQ', 'NIKKEI'] as const) {
  const end = et(2026, 7, 16, 21, 50)
  const { spans } = computeSessionHighlightSpans({
    candles: makeBars(et(2026, 7, 15, 9, 30), end),
    asOfUnix: end,
    instrument,
  })
  assert(spans.length >= 3, `${instrument}: expected multiple session spans`)
  const tip = spans.find((s) => s.startT <= end && s.endT >= end)
  assert(tip?.name === 'Asia', `${instrument}: tip 21:50 must be Asia, got ${tip?.name}`)

  // NY cash window must paint New York (green) — including NIKKEI JP225 overnight
  const midNy = et(2026, 7, 16, 12, 0)
  const nySpan = spans.find((s) => s.startT <= midNy && s.endT >= midNy)
  assert(nySpan?.name === 'New York', `${instrument}: 12:00 ET must be New York, got ${nySpan?.name}`)

  const nyThenAsia = spans.some(
    (s, i) =>
      s.name === 'New York' &&
      spans[i + 1]?.name === 'Asia' &&
      spans[i + 1]!.startT <= s.endT + 1
  )
  assert(nyThenAsia, `${instrument}: NY must abut Asia at cash close`)

  assert(sessionLegendLabel('Asia', instrument) === 'Asia', `${instrument} Asia legend`)
  assert(sessionLegendLabel('London', instrument) === 'London', `${instrument} London legend`)
  assert(sessionLegendLabel('New York', instrument) === 'New York', `${instrument} NY legend`)
  const order = sessionLegendOrder(instrument)
  assert(
    order[0] === 'Asia' && order[1] === 'London' && order[2] === 'New York',
    `${instrument} legend order`
  )
}

assert(deskClockFor('DOW').timeZone === 'America/New_York', 'DOW TZ')
assert(deskClockFor('NASDAQ').timeZone === 'America/New_York', 'NASDAQ TZ')
assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI trading clock stays Tokyo')

console.log('✅ session_desk_instruments: DOW / NASDAQ / NIKKEI share real NYC session colors')
