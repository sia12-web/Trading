/**
 * Desk CALL engine — bias + legal ±10. Slice 1 (no overlay / Leo).
 * Run: npx tsx __tests__/desk_call.test.ts
 */

import assert from 'node:assert/strict'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import { RANGE_EDGE_BAND_POINTS } from '../lib/trading/rangeEdgeEntryGate'
import {
  CALL_BAND_POINTS,
  CALL_COLORS,
  assertDeskCallEntry,
  assertDeskTicketEntry,
  computeDeskCall,
  deskCallBadgeText,
  deskCallHoverText,
  deskCallLegalEdges,
  deskCallSetupEdges,
  ticketAllowedEdges,
  deskCallLineSpecs,
  deskCallPaintKey,
  formatDeskCallForPrompt,
  formatDeskCallScoreStrip,
  resolveDeskCallAsOfUnix,
  scoreDeskCallSession,
  scoreDeskCallWindow,
  tallyDeskCallScores,
  type DeskCallBar,
} from '../lib/trading/deskCall'
import {
  CALL_MODE_UNSET_MESSAGE,
  parseDeskCallMode,
  deskCallModeHoverPrefix,
} from '../lib/trading/deskCallMode'
import { CONTROL_PERIOD_SEC } from '../lib/trading/marketControl'
import { OPENING_BAR_SEC } from '../lib/trading/openingActivity'

function rthBars(
  ymd: string,
  clock: typeof NY_DESK_CLOCK,
  make: (i: number, t: number) => {
    open: number
    high: number
    low: number
    close: number
  }
): DeskCallBar[] {
  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
  const out: DeskCallBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    out.push({ time: t, ...make(i, t), volume: 1 })
    i += 1
  }
  return out
}

const friday = rthBars('2026-08-14', NY_DESK_CLOCK, (i) => {
  const mid = 42100
  if (i === 2) return { open: mid, high: 42200, low: 42090, close: 42110 }
  if (i === 40) return { open: mid, high: 42110, low: 42000, close: 42090 }
  const wobble = (i % 7) - 3
  const px = mid + wobble * 8
  return { open: px, high: px + 12, low: px - 12, close: px + 2 }
})

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const tokyoOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)
const tokyoFriday = rthBars('2026-08-14', TOKYO_DESK_CLOCK, (i) => {
  const mid = 39100
  const wobble = (i % 7) - 3
  const px = mid + wobble * 8
  return { open: px, high: px + 12, low: px - 12, close: px + 2 }
})

function fillPeriod(
  openU: number,
  idx: number,
  ohlc: { open: number; high: number; low: number; close: number }
): DeskCallBar[] {
  const start = openU + idx * CONTROL_PERIOD_SEC
  const out: DeskCallBar[] = []
  for (let i = 0; i < 6; i++) {
    out.push({ time: start + i * 300, ...ohlc, volume: 1 })
  }
  return out
}

/** First 5m is an up-drive tail; later bars hold the first-bar low. */
function driveUpSession(
  openU: number,
  periods: number,
  kind: 'buy' | 'sell' | 'flat' = 'buy'
): DeskCallBar[] {
  const out: DeskCallBar[] = []
  for (let p = 0; p < periods; p++) {
    const shift = kind === 'buy' ? p * 40 : kind === 'sell' ? -p * 40 : 0
    const base = 42100 + shift
    for (let i = 0; i < 6; i++) {
      const t = openU + p * CONTROL_PERIOD_SEC + i * 300
      if (p === 0 && i === 0) {
        out.push({
          time: t,
          open: 42100,
          high: 42140,
          low: 42095,
          close: 42130,
          volume: 1,
        })
        continue
      }
      const floor = 42120
      out.push({
        time: t,
        open: Math.max(floor, base),
        high: base + 50,
        low: Math.max(floor, base - 10),
        close: base + 30,
        volume: 1,
      })
    }
  }
  return out
}

function auctionThenBuy(openU: number): DeskCallBar[] {
  const a: DeskCallBar[] = [
    {
      time: openU,
      open: 42100,
      high: 42130,
      low: 42070,
      close: 42100,
      volume: 1,
    },
    {
      time: openU + 300,
      open: 42105,
      high: 42125,
      low: 42085,
      close: 42110,
      volume: 1,
    },
    {
      time: openU + 600,
      open: 42110,
      high: 42135,
      low: 42090,
      close: 42100,
      volume: 1,
    },
  ]
  for (let i = 3; i < 6; i++) {
    a.push({
      time: openU + i * 300,
      open: 42110,
      high: 42140,
      low: 42080,
      close: 42115,
      volume: 1,
    })
  }
  return [...a, ...fillPeriod(openU, 1, { open: 42180, high: 42220, low: 42160, close: 42200 })]
}

{
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: [],
    asOfUnix: mondayOpen + 40 * 60,
    playbookMode: 'morning',
  })
  assert.equal(p.side, 'WAIT')
  assert.equal(deskCallBadgeText(p), 'WAIT')
  assert.equal(deskCallLineSpecs(p).length, 0)
  assert.ok(formatDeskCallForPrompt(p).includes('CALL'))
}

{
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: Number.NaN,
    playbookMode: 'morning',
  })
  assert.equal(p.side, 'WAIT', 'NaN asOf → WAIT')
}

{
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: null as unknown as DeskCallBar[],
    asOfUnix: mondayOpen + 40 * 60,
    playbookMode: 'morning',
  })
  assert.equal(p.side, 'WAIT', 'non-array candles → WAIT')
}

{
  const bars = driveUpSession(mondayOpen, 1)
  const early = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 10 * 60,
    playbookMode: 'morning',
  })
  assert.equal(early.side, 'WAIT', 'Drive locked but OR30 not complete')
  assert.ok(early.playLine.includes('no locked playbook range'))
}

{
  const bars = driveUpSession(mondayOpen, 1)
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'LONG', 'OR30 Drive up → LONG')
  assert.equal(call.rangeKey, 'OR30')
  assert.equal(deskCallBadgeText(call), 'OR30 LONG')
  assert.equal(call.entryEdge, 'low')
  assert.equal(call.entryPrice, call.rangeLow)
  assert.equal(call.controlLabel, 'WAIT')
  assert.ok(call.playLine.includes('below OR30 low'))
  assert.ok(call.playLine.includes('Ticket unchanged'))
  assert.ok(call.playLine.includes('off-band'))
  assert.ok(formatDeskCallForPrompt(call).includes('dPOC is not the fill'))
  assert.ok(deskCallHoverText(call).includes('CALL OR30 LONG — ticket allowed'))
  assert.ok(deskCallHoverText(call).includes('OK     Open:'))
  assert.ok(deskCallHoverText(call).includes('Hunt:'))
  assert.equal(deskCallLineSpecs(call).length, 0)
  assert.equal(CALL_COLORS.badge, '#a1a1aa')
  assert.equal(CALL_BAND_POINTS, RANGE_EDGE_BAND_POINTS)
}

{
  const bars = auctionThenBuy(mondayOpen)
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  assert.equal(call.openingType, 'OPEN_AUCTION')
  assert.equal(call.controlLabel, 'ONE-TF BUY')
  assert.equal(call.side, 'WAIT', 'Auction + ONE-TF BUY → WAIT')
  assert.equal(deskCallBadgeText(call), 'WAIT')
  const hover = deskCallHoverText(call)
  assert.ok(hover.includes('CALL WAIT — no ticket'))
  assert.ok(hover.includes('BLOCK  Open: AUCTION'))
  assert.ok(hover.includes('Drive or Test-Drive'))
  assert.ok(hover.includes('OK     Ctrl:'))
  assert.ok(hover.includes('Leo and Level Finder advise only. No line.'))
}

{
  const bars = driveUpSession(mondayOpen, 2, 'buy')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  assert.equal(call.side, 'LONG')
  assert.equal(call.rangeKey, 'IB')
  assert.equal(deskCallBadgeText(call), 'IB LONG')
  assert.equal(call.controlLabel, 'ONE-TF BUY')
  assert.ok(call.playLine.includes('below IB low'))
}

{
  const bars = driveUpSession(mondayOpen, 2, 'buy')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
    peerSide: 'SHORT',
  })
  assert.equal(call.side, 'WAIT', 'opposite twin → WAIT')
}

{
  const bars = driveUpSession(mondayOpen, 2, 'buy')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
    peerSide: 'WAIT',
  })
  assert.equal(call.side, 'LONG', 'twin WAIT does not veto')
}

{
  const bars = driveUpSession(mondayOpen, 2, 'buy')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
    bookLocked: true,
  })
  assert.equal(call.side, 'LONG')
  assert.ok(call.playLine.includes('CALL is the read, not a fill — book is locked.'))
}

{
  const bars = driveUpSession(mondayOpen, 1)
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 40 * 60,
    playbookMode: 'lunch_break',
  })
  assert.equal(call.side, 'WAIT', 'lunch break has no legal band')
}

{
  const lunchStart = zonedCivilToUnix('2026-08-17', 12, NY_DESK_CLOCK.timeZone)
  const lunchBars: DeskCallBar[] = []
  for (let t = lunchStart; t < lunchStart + 90 * 60; t += 300) {
    lunchBars.push({
      time: t,
      open: 42200,
      high: 42240,
      low: 42180,
      close: 42210,
      volume: 1,
    })
  }
  const bars = [...driveUpSession(mondayOpen, 8, 'buy'), ...lunchBars]
  const forming = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: lunchStart + 30 * 60,
    playbookMode: 'lunch_range',
  })
  assert.equal(forming.side, 'WAIT', 'lunch not complete')

  const locked = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: lunchStart + 90 * 60,
    playbookMode: 'lunch_range',
  })
  assert.equal(locked.rangeKey, 'LN')
  assert.equal(locked.side, 'LONG')
  assert.equal(deskCallBadgeText(locked), 'LN LONG')
  assert.ok(locked.playLine.includes('Lunch-range'))
}

{
  const nyFri = rthBars('2026-08-14', NY_DESK_CLOCK, (i) => {
    const px = 39000 + (i % 5) * 10
    return { open: px, high: px + 40, low: px - 20, close: px + 5 }
  })
  const tokyoDrive: DeskCallBar[] = []
  for (let i = 0; i < 6; i++) {
    const t = tokyoOpen + i * OPENING_BAR_SEC
    if (i === 0) {
      tokyoDrive.push({
        time: t,
        open: 39100,
        high: 39140,
        low: 39095,
        close: 39130,
        volume: 1,
      })
    } else {
      tokyoDrive.push({
        time: t,
        open: 39120,
        high: 39150 + i,
        low: 39120,
        close: 39140,
        volume: 1,
      })
    }
  }
  const peek: DeskCallBar = {
    time: tokyoOpen + 4 * 3600,
    open: 40000,
    high: 40100,
    low: 39900,
    close: 40050,
    volume: 1,
  }
  const call = computeDeskCall({
    instrument: 'NIKKEI',
    candles: [...tokyoFriday, ...nyFri, ...tokyoDrive, peek],
    asOfUnix: tokyoOpen + 30 * 60,
    playbookMode: 'us_range',
  })
  assert.equal(call.rangeKey, 'US')
  assert.ok(call.rangeHigh != null && call.rangeHigh < 40000, 'no peek future Tokyo bar')
  assert.ok(call.playLine.includes('US Range') || call.side === 'WAIT')
  if (call.side === 'LONG') {
    assert.equal(deskCallBadgeText(call), 'US LONG')
    assert.equal(call.midAllowed, false)
    assert.ok(formatDeskCallForPrompt(call).includes('not US Range TPO'))
  }
}

{
  const bars = driveUpSession(mondayOpen, 2, 'buy')
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...bars],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  const withCall = scoreDeskCallWindow({
    call,
    bars: [
      { time: mondayOpen + 70 * 60, high: (call.rangeHigh ?? 0) + 20, low: (call.rangeLow ?? 0) + 5 },
    ],
  })
  assert.equal(withCall.leftWait, false)
  assert.equal(withCall.brokeWithCall, true)
  assert.equal(withCall.taggedBand, false)

  const tagged = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeLow ?? 0) + 5,
        low: (call.rangeLow ?? 0) - 5,
      },
    ],
  })
  assert.equal(tagged.taggedBand, true)

  const laterWide = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeHigh ?? 0) + 20,
        low: (call.rangeLow ?? 0) + 5,
      },
      {
        time: mondayOpen + 80 * 60,
        high: (call.rangeHigh ?? 0) + 5,
        low: (call.rangeLow ?? 0) - 20,
      },
    ],
  })
  assert.equal(laterWide.brokeWithCall, true, 'later bar spanning both edges must not wipe B')

  const tight = {
    ...call,
    rangeHigh: (call.rangeLow ?? 0) + 15,
    rangeLow: call.rangeLow,
    side: 'LONG' as const,
  }
  const namedThenOpp = scoreDeskCallWindow({
    call: tight,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (tight.rangeLow ?? 0) + 4,
        low: (tight.rangeLow ?? 0) - 4,
      },
      {
        time: mondayOpen + 80 * 60,
        high: (tight.rangeHigh ?? 0) + 1,
        low: (tight.rangeHigh ?? 0) - 1,
      },
    ],
  })
  assert.equal(
    namedThenOpp.taggedBand,
    true,
    'named ±10 before opposite edge counts C even when ±10 bands overlap'
  )

  const waitScore = scoreDeskCallWindow({
    call: computeDeskCall({
      instrument: 'DOW',
      candles: [],
      asOfUnix: mondayOpen,
      playbookMode: 'morning',
    }),
    bars: [],
  })
  assert.equal(waitScore.leftWait, true)
  assert.equal(waitScore.brokeWithCall, null)
}

{
  const sat = cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  const p = computeDeskCall({
    instrument: 'DOW',
    candles: friday,
    asOfUnix: sat,
    playbookMode: 'morning',
  })
  assert.equal(p.side, 'WAIT', 'weekend')
}

{
  const a = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  const b = computeDeskCall({
    instrument: 'NASDAQ',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.notEqual(deskCallPaintKey(a), deskCallPaintKey(b))
  const simT = mondayOpen + 30 * 60
  assert.equal(resolveDeskCallAsOfUnix('DOW', simT, simT), simT)
  assert.equal(
    resolveDeskCallAsOfUnix('DOW', mondayOpen + 100, mondayOpen + 200),
    mondayOpen + 200
  )
}

{
  const packed = formatDeskCallForPrompt(
    computeDeskCall({
      instrument: 'DOW',
      candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
      asOfUnix: mondayOpen + 60 * 60,
      playbookMode: 'ib',
    })
  )
  assert.ok(packed.includes('CALL'))
  assert.ok(!packed.toLowerCase().includes('volume poc'))
  assert.ok(packed.includes('Does not unlock off-band') || packed.includes('off-band'))
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
}

{
  const closeU = zonedCivilToUnix(
    '2026-08-17',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const rows = scoreDeskCallSession({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 8, 'buy')],
    asOfUnix: closeU,
  })
  assert.ok(rows.length >= 2, 'OR30 + IB snapshots')
  const tally = tallyDeskCallScores(rows)
  const strip = formatDeskCallScoreStrip(rows, tally)
  assert.ok(strip.startsWith('Call score'))
  assert.ok(strip.includes('session'))
}

{
  const wait = computeDeskCall({
    instrument: 'DOW',
    candles: [],
    asOfUnix: mondayOpen,
    playbookMode: 'morning',
  })
  assert.deepEqual(deskCallLegalEdges(wait), [])
  const waitGate = assertDeskCallEntry({ call: wait, edge: 'low' })
  assert.equal(waitGate.ok, false)
  if (!waitGate.ok) {
    assert.ok(waitGate.message.includes('CALL WAIT'))
  }

  const long = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(long.side, 'LONG')
  assert.ok(deskCallLegalEdges(long).includes('low'))
  assert.ok(!deskCallLegalEdges(long).includes('high'))
  assert.equal(assertDeskCallEntry({ call: long, edge: 'low' }).ok, true)
  const high = assertDeskCallEntry({ call: long, edge: 'high' })
  assert.equal(high.ok, false)
  const flip = assertDeskCallEntry({ call: long, direction: 'SHORT' })
  assert.equal(flip.ok, false)

  assert.equal(parseDeskCallMode(undefined), null)
  assert.equal(parseDeskCallMode(true), true)
  assert.equal(parseDeskCallMode(false), false)
  const unset = assertDeskTicketEntry({ useCall: null, call: wait })
  assert.equal(unset.ok, false)
  if (!unset.ok) assert.equal(unset.message, CALL_MODE_UNSET_MESSAGE)
  const regularWait = assertDeskTicketEntry({
    useCall: false,
    call: wait,
    edge: 'high',
  })
  assert.equal(regularWait.ok, true)
  if (regularWait.ok) assert.equal(regularWait.side, 'SHORT')
  const regularFlip = assertDeskTicketEntry({
    useCall: false,
    call: long,
    edge: 'high',
    direction: 'SHORT',
  })
  assert.equal(regularFlip.ok, true)
  const stillGated = assertDeskTicketEntry({
    useCall: true,
    call: wait,
    edge: 'low',
  })
  assert.equal(stillGated.ok, false)
  assert.deepEqual(ticketAllowedEdges({ useCall: false, call: wait }), null)
  assert.deepEqual(ticketAllowedEdges({ useCall: true, call: wait }), [])
  assert.ok(ticketAllowedEdges({ useCall: true, call: long })?.includes('low'))
  assert.ok(deskCallSetupEdges(long).includes('low'))
  assert.ok(!deskCallSetupEdges(wait).length)
  assert.ok(deskCallModeHoverPrefix(false).includes('setup is still live'))
}

{
  const twoTf = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2)],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
    control: {
      instrument: 'DOW',
      sourceSession: 'NY_RTH',
      sessionDate: '2026-08-17',
      label: 'TWO-TF',
      rf: 2,
      rfTop: 1,
      rfBot: 1,
      dpoc: 42120,
      dpocDir: 'stuck',
      amRf: null,
      amDpoc: null,
      periodCount: 2,
      playLine: 'TWO-TF',
    },
  })
  assert.equal(twoTf.side, 'WAIT', 'RF +2 with TWO-TF is not a CALL')
  assert.equal(twoTf.controlLabel, 'TWO-TF')
  const twoTfHover = deskCallHoverText(twoTf)
  assert.ok(twoTfHover.includes('BLOCK  Ctrl:'))
  assert.ok(twoTfHover.includes('RF +2 2TF'))
  assert.ok(twoTfHover.includes('dPOC stuck'))
  assert.ok(!twoTfHover.includes('RF +2 ↑'), '↑ is ONE-TF only')
  assert.ok(!twoTfHover.includes('RF 0 ROT'))
}

console.log('desk_call: all passed')
