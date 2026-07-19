/**
 * DOW / NASDAQ: Asia/London/NY on America/New_York.
 * NIKKEI: same legend names, but Asia starts at Tokyo cash open (09:00 JST).
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

/** Approximate ET (EDT = UTC-4) helper for US desk tests. */
function et(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h + 4, min)).getTime() / 1000)
}

/** JST = UTC+9 */
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

// ── Shared ET classifier (US desks) ──────────────────────────────────────────
assert(nyDeskSessionAt(et(2026, 7, 16, 16, 0)) === 'Asia', 'NY 16:00 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 21, 50)) === 'Asia', 'NY 21:50 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 3, 0)) === 'London', 'NY 03:00 → London')
assert(nyDeskSessionAt(et(2026, 7, 16, 9, 30)) === 'New York', 'NY 09:30 → NY')
assert(nyDeskSessionAt(et(2026, 7, 16, 15, 55)) === 'New York', 'NY 15:55 → NY')

// ── Tokyo classifier (Nikkei desk) ───────────────────────────────────────────
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 8, 55)) === 'New York', 'JST 08:55 → NY overnight')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 9, 0)) === 'Asia', 'JST 09:00 → Tokyo/Asia start')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 11, 0)) === 'Asia', 'JST 11:00 → Asia')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 15, 0)) === 'London', 'JST 15:00 → London')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 23, 0)) === 'New York', 'JST 23:00 → NY')

// ── DOW / NASDAQ: NYC ET paint ───────────────────────────────────────────────
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

  const midNy = et(2026, 7, 16, 12, 0)
  const nySpan = spans.find((s) => s.startT <= midNy && s.endT >= midNy)
  assert(nySpan?.name === 'New York', `${instrument}: 12:00 ET must be New York, got ${nySpan?.name}`)

  assert(sessionLegendLabel('Asia', instrument) === 'Asia', `${instrument} Asia legend`)
  const order = sessionLegendOrder(instrument)
  assert(
    order[0] === 'Asia' && order[1] === 'London' && order[2] === 'New York',
    `${instrument} legend order`
  )
}

// ── NIKKEI: Tokyo cash open starts Asia ──────────────────────────────────────
{
  const open = jst(2026, 7, 16, 9, 0)
  const tip = jst(2026, 7, 16, 10, 0)
  const { spans } = computeSessionHighlightSpans({
    candles: makeBars(jst(2026, 7, 16, 6, 0), tip),
    asOfUnix: tip,
    instrument: 'NIKKEI',
  })
  const atOpen = spans.find((s) => s.startT <= open && s.endT >= open + 60)
  assert(atOpen?.name === 'Asia', `NIKKEI: 09:00 JST must start Asia, got ${atOpen?.name}`)

  const preOpen = jst(2026, 7, 16, 8, 0)
  const overnight = spans.find((s) => s.startT <= preOpen && s.endT >= preOpen)
  assert(
    overnight?.name === 'New York',
    `NIKKEI: 08:00 JST must be overnight NY, got ${overnight?.name}`
  )

  assert(sessionLegendLabel('Asia', 'NIKKEI') === 'Tokyo', 'NIKKEI Asia legend → Tokyo')
  assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI trading clock stays Tokyo')
}

assert(deskClockFor('DOW').timeZone === 'America/New_York', 'DOW TZ')
assert(deskClockFor('NASDAQ').timeZone === 'America/New_York', 'NASDAQ TZ')

console.log('✅ session_desk_instruments: US desks ET; NIKKEI Tokyo cash-open Asia')
