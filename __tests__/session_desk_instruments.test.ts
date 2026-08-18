/**
 * DOW / NASDAQ: Asia/London/NY on America/New_York.
 * Post–NY cash close (16:00–18:00 ET) is uncolored — not Asia.
 * NIKKEI: Asia at Tokyo cash open; New York = US RTH only (09:30–16:00 ET);
 * after US cash close until Tokyo 09:00 is uncolored (not NYC).
 * 15:00–17:00 JST also uncolored after Tokyo cash close.
 * Run: npx tsx __tests__/session_desk_instruments.test.ts
 */

import {
  computeSessionHighlightSpans,
  projectSessionHighlightRects,
  SESSION_STYLES,
  nyDeskSessionAt,
  tokyoDeskSessionAt,
  sessionLegendLabel,
  sessionLegendOrder,
  deskClockFor,
  deskSessionAt,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** Approximate ET (EDT = UTC-4) helper for US desk tests. */
function et(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h + 4, min)).getTime() / 1000)
}

/** Approximate ET (EST = UTC-5) for winter DST checks. */
function etWinter(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h + 5, min)).getTime() / 1000)
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
assert(nyDeskSessionAt(et(2026, 7, 16, 16, 0)) === null, 'NY 16:00 → dead zone (not Asia)')
assert(nyDeskSessionAt(et(2026, 7, 16, 17, 0)) === null, 'NY 17:00 → dead zone')
assert(nyDeskSessionAt(et(2026, 7, 16, 18, 0)) === 'Asia', 'NY 18:00 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 21, 50)) === 'Asia', 'NY 21:50 → Asia')
assert(nyDeskSessionAt(et(2026, 7, 16, 3, 0)) === 'London', 'NY 03:00 → London')
assert(nyDeskSessionAt(et(2026, 7, 16, 9, 30)) === 'New York', 'NY 09:30 → NY')
assert(nyDeskSessionAt(et(2026, 7, 16, 15, 55)) === 'New York', 'NY 15:55 → NY')

// ── Tokyo classifier (Nikkei desk) ───────────────────────────────────────────
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 8, 55)) === null, 'JST 08:55 → dead (after US close)')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 9, 0)) === 'Asia', 'JST 09:00 → Tokyo/Asia start')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 11, 0)) === 'Asia', 'JST 11:00 → Asia')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 14, 59)) === 'Asia', 'JST 14:59 still Tokyo cash')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 15, 0)) === null, 'JST 15:00 → dead zone after cash')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 16, 0)) === null, 'JST 16:00 → dead zone')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 17, 0)) === 'London', 'JST 17:00 → London')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 22, 29)) === 'London', 'JST 22:29 still London')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 22, 30)) === 'New York', 'JST 22:30 → NY (US open EDT)')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 23, 0)) === 'New York', 'JST 23:00 → NY')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 5, 0)) === null, 'JST 05:00 → dead (US cash close EDT)')
assert(tokyoDeskSessionAt(jst(2026, 7, 16, 5, 30)) === null, 'JST 05:30 → dead after US close')
assert(tokyoDeskSessionAt(et(2026, 7, 16, 16, 30)) === null, 'ET 16:30 on Nikkei → not NYC')
assert(tokyoDeskSessionAt(et(2026, 7, 16, 19, 0)) === null, 'ET 19:00 on Nikkei → not NYC')
assert(tokyoDeskSessionAt(et(2026, 7, 16, 15, 0)) === 'New York', 'ET 15:00 still US RTH')

// Winter DST: US open 09:30 EST = 23:30 JST; cash close 16:00 EST = 06:00 JST
assert(
  tokyoDeskSessionAt(jst(2026, 1, 15, 23, 0)) === 'London',
  'winter JST 23:00 still before US open'
)
assert(
  tokyoDeskSessionAt(jst(2026, 1, 15, 23, 30)) === 'New York',
  'winter JST 23:30 → NY (US open EST)'
)
assert(tokyoDeskSessionAt(jst(2026, 1, 16, 6, 0)) === null, 'winter JST 06:00 → dead after US close')
assert(tokyoDeskSessionAt(jst(2026, 1, 16, 8, 0)) === null, 'winter JST 08:00 → dead until Tokyo')
assert(tokyoDeskSessionAt(etWinter(2026, 1, 15, 16, 30)) === null, 'winter ET 16:30 → not NYC')

// deskSessionAt routes by instrument
assert(deskSessionAt(et(2026, 7, 16, 17, 0), 'DOW') === null, 'DOW 17:00 dead')
assert(deskSessionAt(et(2026, 7, 16, 17, 0), 'NIKKEI') === null, 'NIKKEI 17:00 dead')
assert(deskSessionAt(et(2026, 7, 16, 12, 0), 'NIKKEI') === 'New York', 'NIKKEI noon ET = NY')
assert(deskSessionAt(jst(2026, 7, 16, 10, 0), 'NIKKEI') === 'Asia', 'NIKKEI 10 JST = Tokyo cash')
assert(deskSessionAt(jst(2026, 7, 16, 10, 0), 'DOW') === 'Asia', 'DOW 10 JST = prior ET evening Asia')

// ── DOW / NASDAQ: post-NY dead zone uncolored; Asia from 18:00 ────────────────
for (const instrument of ['DOW', 'NASDAQ'] as const) {
  const tipDead = et(2026, 7, 16, 17, 0)
  const { spans: deadSpans } = computeSessionHighlightSpans({
    candles: makeBars(et(2026, 7, 16, 9, 30), tipDead),
    asOfUnix: tipDead,
    instrument,
  })
  const coveringDead = deadSpans.find((s) => s.startT <= tipDead && s.endT >= tipDead)
  assert(
    coveringDead == null,
    `${instrument}: 17:00 ET must be uncolored, got ${coveringDead?.name}`
  )

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

// ── NIKKEI: Tokyo cash open starts Asia; post-US and post-Tokyo dead zones ───
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
    overnight == null,
    `NIKKEI: 08:00 JST must be uncolored (after US close), got ${overnight?.name}`
  )

  const afterCash = jst(2026, 7, 16, 15, 30)
  const { spans: pm } = computeSessionHighlightSpans({
    candles: makeBars(jst(2026, 7, 16, 9, 0), afterCash),
    asOfUnix: afterCash,
    instrument: 'NIKKEI',
  })
  const dead = pm.find((s) => s.startT <= afterCash && s.endT >= afterCash)
  assert(dead == null, `NIKKEI: 15:30 JST uncolored, got ${dead?.name}`)

  // Green NY must not cover post–US-close evening (the chart bug)
  const eveTip = et(2026, 7, 16, 19, 30)
  const { spans: eve } = computeSessionHighlightSpans({
    candles: makeBars(et(2026, 7, 16, 9, 30), eveTip),
    asOfUnix: eveTip,
    instrument: 'NIKKEI',
  })
  const at1930 = eve.find((s) => s.startT <= eveTip && s.endT >= eveTip)
  assert(at1930 == null, `NIKKEI: 19:30 ET must not be NYC, got ${at1930?.name}`)
  const at1500 = et(2026, 7, 16, 15, 0)
  const nyOk = eve.find((s) => s.startT <= at1500 && s.endT >= at1500)
  assert(nyOk?.name === 'New York', `NIKKEI: 15:00 ET still New York, got ${nyOk?.name}`)
  const at1630 = et(2026, 7, 16, 16, 30)
  const afterNy = eve.find((s) => s.startT <= at1630 && s.endT >= at1630)
  assert(afterNy == null, `NIKKEI: 16:30 ET uncolored, got ${afterNy?.name}`)

  assert(sessionLegendLabel('Asia', 'NIKKEI') === 'Tokyo', 'NIKKEI Asia legend → Tokyo')
  assert(deskClockFor('NIKKEI').timeZone === 'Asia/Tokyo', 'NIKKEI trading clock stays Tokyo')
}

assert(deskClockFor('DOW').timeZone === 'America/New_York', 'DOW TZ')
assert(deskClockFor('NASDAQ').timeZone === 'America/New_York', 'NASDAQ TZ')

// Richer fills — must stay readable on the light pane
for (const name of ['Asia', 'London', 'New York'] as const) {
  const fill = SESSION_STYLES[name].color
  const col = SESSION_STYLES[name].column
  const fillA = Number(fill.match(/([\d.]+)\)\s*$/)?.[1] ?? 0)
  const colA = Number(col.match(/([\d.]+)\)\s*$/)?.[1] ?? 0)
  assert(fillA >= 0.3, `${name} range fill too faint (${fill})`)
  assert(colA >= 0.18, `${name} time column too faint (${col})`)
}

{
  const start = et(2026, 8, 17, 18, 0)
  const end = et(2026, 8, 18, 9, 30)
  const { spans, candleTimes } = computeSessionHighlightSpans({
    candles: makeBars(start, end),
    asOfUnix: end,
    instrument: 'NASDAQ',
  })
  const asia = spans.find((s) => s.name === 'Asia')
  assert(asia, 'NASDAQ overnight must include an Asia span')
  const { rects } = projectSessionHighlightRects({
    spans,
    candleTimes,
    timeScale: {
      timeToCoordinate: (t) => Number(t) - start,
      height: () => 400,
    },
    priceToY: () => null,
    priceScaleWidth: 70,
    containerWidth: 900,
    containerHeight: 400,
  })
  const asiaCol = rects.filter((r) => r.name === 'Asia' && r.top === 0 && r.height === 400)
  assert(asiaCol.length >= 1, 'Asia time column must paint even when priceToY is null')
  const nyOffscreen = projectSessionHighlightRects({
    spans: [
      {
        name: 'New York',
        startT: start,
        endT: start + 3600,
        high: 50000,
        low: 49900,
      },
    ],
    candleTimes: [start, start + 3600],
    timeScale: {
      timeToCoordinate: (t) => Number(t) - start,
      height: () => 400,
    },
    priceToY: (price) => (price > 1000 ? -80 : 40),
    priceScaleWidth: 70,
    containerWidth: 900,
    containerHeight: 400,
  })
  assert(
    nyOffscreen.rects.some((r) => r.name === 'New York' && r.top === 0 && r.height === 400),
    'Yesterday NY column stays visible when its high/low is off the price scale'
  )
  assert(
    !nyOffscreen.rects.some((r) => r.name === 'New York' && r.top > 0),
    'Off-scale NY must not draw a high→low box'
  )
}

console.log(
  '✅ session_desk_instruments: dead zones after cash close; Nikkei NY = US RTH only'
)
