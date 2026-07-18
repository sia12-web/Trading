/**
 * Production readiness: DOW / NASDAQ / NIKKEI share contiguous session colors.
 * Run: npx tsx __tests__/session_desk_instruments.test.ts
 */

import {
  computeSessionHighlightSpans,
  nyDeskSessionAt,
  tokyoDeskSessionAt,
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

function jst(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h - 9, min)).getTime() / 1000)
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

// ── NY desk (DOW + NASDAQ identical) ─────────────────────────────────────────
assert(nyDeskSessionAt(et(2026, 7, 16, 16, 0)) === 'Asia', 'NY 16:00 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 21, 50)) === 'Asia', 'NY 21:50 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 3, 0)) === 'London', 'NY 03:00 → London')
assert(nyDeskSessionAt(et(2026, 7, 16, 9, 30)) === 'New York', 'NY 09:30 → NY')
assert(nyDeskSessionAt(et(2026, 7, 16, 15, 55)) === 'New York', 'NY 15:55 → NY')

for (const instrument of ['DOW', 'NASDAQ'] as const) {
  const end = et(2026, 7, 16, 21, 50)
  const { spans } = computeSessionHighlightSpans({
    candles: makeBars(et(2026, 7, 15, 9, 30), end),
    asOfUnix: end,
    instrument,
  })
  assert(spans.length >= 3, `${instrument}: expected multiple session spans`)
  const tip = spans.find((s) => s.startT <= end && s.endT >= end)
  assert(tip?.name === 'Asia', `${instrument}: tip 21:50 must be Asia, got ${tip?.name}`)
  // Contiguous: NY cash → Asia with no dead hour
  const nyThenAsia = spans.some(
    (s, i) =>
      s.name === 'New York' &&
      spans[i + 1]?.name === 'Asia' &&
      spans[i + 1]!.startT <= s.endT + 1
  )
  assert(nyThenAsia, `${instrument}: NY must abut Asia at cash close`)
  assert(deskClockFor(instrument).timeZone === 'America/New_York', `${instrument} TZ`)
  assert(sessionLegendLabel('Asia', instrument) === 'Asia', `${instrument} legend`)
}

// ── Tokyo desk (NIKKEI) ──────────────────────────────────────────────────────
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 15, 0)) === 'Asia', 'JST 15:00 → Asia')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 8, 0)) === 'Asia', 'JST 08:00 → Asia')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 9, 0)) === 'London', 'JST 09:00 → London')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 11, 0)) === 'London', 'JST 11:00 → London')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 12, 0)) === 'New York', 'JST 12:00 → NY')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 14, 55)) === 'New York', 'JST 14:55 → NY')

{
  const end = jst(2026, 7, 16, 14, 55)
  const { spans } = computeSessionHighlightSpans({
    candles: makeBars(jst(2026, 7, 15, 15, 0), end),
    asOfUnix: end,
    instrument: 'NIKKEI',
  })
  assert(spans.length >= 2, 'NIKKEI: expected multiple session spans')
  const tip = spans.find((s) => s.startT <= end && s.endT >= end)
  assert(tip?.name === 'New York', `NIKKEI tip afternoon, got ${tip?.name}`)
  assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI TZ')
  // Same legend language as DOW/NASDAQ
  assert(sessionLegendLabel('Asia', 'NIKKEI') === 'Asia', 'NIKKEI Asia label')
  assert(sessionLegendLabel('London', 'NIKKEI') === 'London', 'NIKKEI London label')
  assert(sessionLegendLabel('New York', 'NIKKEI') === 'New York', 'NIKKEI NY label')
  for (const inst of ['DOW', 'NASDAQ', 'NIKKEI'] as const) {
    const order = sessionLegendOrder(inst)
    assert(
      order[0] === 'Asia' && order[1] === 'London' && order[2] === 'New York',
      `${inst} legend order`
    )
  }
}

console.log('✅ session_desk_instruments: DOW / NASDAQ / NIKKEI contiguous + clocks OK')
