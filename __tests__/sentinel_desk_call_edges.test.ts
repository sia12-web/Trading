/**
 * SENTINEL — Desk CALL edge cases: bias, scoring, garbage input, security.
 * Run: npx tsx __tests__/sentinel_desk_call_edges.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  cashOpenUnixForYmd,
  NY_DESK_CLOCK,
  TOKYO_DESK_CLOCK,
  zonedCivilToUnix,
} from '../lib/chart/sessionVwap'
import { DEFAULT_TAKE_PROFIT_R } from '../lib/trading/positionSizing'
import {
  computeDeskCall,
  deskCallBadgeText,
  deskCallLineSpecs,
  formatDeskCallForPrompt,
  formatDeskCallScoreStrip,
  playLineForCall,
  scoreDeskCallSession,
  scoreDeskCallWindow,
  tallyDeskCallScores,
  type DeskCallBar,
} from '../lib/trading/deskCall'
import { CONTROL_PERIOD_SEC } from '../lib/trading/marketControl'

const passed: string[] = []
const failed: { name: string; error: string }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed.push(name)
  } catch (err) {
    failed.push({ name, error: err instanceof Error ? err.message : String(err) })
  }
}

function src(rel: string): string {
  return readFileSync(join(__dirname, '..', rel), 'utf8')
}

function rthBars(
  ymd: string,
  clock: typeof NY_DESK_CLOCK,
  make: (i: number) => { open: number; high: number; low: number; close: number }
): DeskCallBar[] {
  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
  const out: DeskCallBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    out.push({ time: t, ...make(i), volume: 1 })
    i += 1
  }
  return out
}

const friday = rthBars('2026-08-14', NY_DESK_CLOCK, (i) => {
  const mid = 42100
  const wobble = (i % 7) - 3
  const px = mid + wobble * 8
  return { open: px, high: px + 12, low: px - 12, close: px + 2 }
})

const mondayOpen = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const tokyoOpen = cashOpenUnixForYmd('2026-08-17', TOKYO_DESK_CLOCK)

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

function driveDownSession(openU: number, periods: number): DeskCallBar[] {
  const out: DeskCallBar[] = []
  for (let p = 0; p < periods; p++) {
    const base = 42100 - p * 40
    for (let i = 0; i < 6; i++) {
      const t = openU + p * CONTROL_PERIOD_SEC + i * 300
      if (p === 0 && i === 0) {
        out.push({
          time: t,
          open: 42100,
          high: 42105,
          low: 42060,
          close: 42070,
          volume: 1,
        })
        continue
      }
      const cap = 42080
      out.push({
        time: t,
        open: Math.min(cap, base),
        high: Math.min(cap, base + 10),
        low: base - 50,
        close: base - 30,
        volume: 1,
      })
    }
  }
  return out
}

function failedDriveOr30(openU: number): DeskCallBar[] {
  const bars: DeskCallBar[] = [
    {
      time: openU,
      open: 42100,
      high: 42140,
      low: 42095,
      close: 42130,
      volume: 1,
    },
    {
      time: openU + 300,
      open: 42130,
      high: 42160,
      low: 42120,
      close: 42150,
      volume: 1,
    },
    {
      time: openU + 600,
      open: 42150,
      high: 42155,
      low: 42080,
      close: 42090,
      volume: 1,
    },
  ]
  for (let i = 3; i < 6; i++) {
    bars.push({
      time: openU + i * 300,
      open: 42100,
      high: 42120,
      low: 42085,
      close: 42100,
      volume: 1,
    })
  }
  return bars
}

test('Drive down + locked OR30 → SHORT at the high', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveDownSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'SHORT')
  assert.equal(call.rangeKey, 'OR15')
  assert.equal(call.entryEdge, 'high')
  assert.equal(call.entryPrice, call.rangeHigh)
  assert.equal(deskCallBadgeText(call), 'OR15 SHORT')
  assert.ok(call.playLine.includes('above Open range high') || call.playLine.includes('above OR15 high'))
})

test('Drive up + TWO-TF after IB → WAIT (Open and Control disagree)', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'flat')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  assert.ok(
    call.openingType === 'OPEN_DRIVE' || call.openingType === 'OPEN_TEST_DRIVE',
    `expected a drive, got ${call.openingType}`
  )
  assert.equal(call.controlLabel, 'TWO-TF')
  assert.equal(call.side, 'WAIT')
  assert.equal(deskCallBadgeText(call), 'WAIT')
})

test('DRIVE FAIL stays WAIT even with a locked OR30', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...failedDriveOr30(mondayOpen)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'WAIT')
  assert.ok(call.openingType === 'OPEN_REJECTION_REVERSE' || call.playLine.includes('WAIT'))
})

test('Auction + ONE-TF BUY after IB → CALL from Control', () => {
  const a: DeskCallBar[] = [
    {
      time: mondayOpen,
      open: 42100,
      high: 42130,
      low: 42070,
      close: 42100,
      volume: 1,
    },
    {
      time: mondayOpen + 300,
      open: 42105,
      high: 42125,
      low: 42085,
      close: 42110,
      volume: 1,
    },
    {
      time: mondayOpen + 600,
      open: 42110,
      high: 42135,
      low: 42090,
      close: 42100,
      volume: 1,
    },
  ]
  for (let i = 3; i < 6; i++) {
    a.push({
      time: mondayOpen + i * 300,
      open: 42110,
      high: 42140,
      low: 42080,
      close: 42115,
      volume: 1,
    })
  }
  const start = mondayOpen + CONTROL_PERIOD_SEC
  for (let i = 0; i < 6; i++) {
    a.push({
      time: start + i * 300,
      open: 42180,
      high: 42220,
      low: 42160,
      close: 42200,
      volume: 1,
    })
  }
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...a],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  assert.equal(call.openingType, 'OPEN_AUCTION')
  assert.equal(call.controlLabel, 'ONE-TF BUY')
  assert.equal(call.side, 'LONG')
  assert.equal(deskCallBadgeText(call), 'IB LONG')
})

test('US Range on DOW is not a legal CALL range', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'us_range',
  })
  assert.equal(call.side, 'WAIT')
  assert.equal(call.rangeKey, null)
})

test('lunch-break on NIKKEI is not a legal CALL range', () => {
  const call = computeDeskCall({
    instrument: 'NIKKEI',
    candles: driveUpSession(tokyoOpen, 1).map((c) => ({
      ...c,
      open: c.open - 3000,
      high: c.high - 3000,
      low: c.low - 3000,
      close: c.close - 3000,
    })),
    asOfUnix: tokyoOpen + 90 * 60,
    playbookMode: 'lunch_break',
  })
  assert.equal(call.side, 'WAIT')
  assert.equal(call.rangeKey, null)
})

test('playbook done / unknown has no legal band', () => {
  const done = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 8, 'buy')],
    asOfUnix: mondayOpen + 5 * 3600,
    playbookMode: 'done',
  })
  assert.equal(done.side, 'WAIT')
  assert.equal(deskCallLineSpecs(done).length, 0)
})

test('agreeing twin does not veto; bookLocked false omits locked copy', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
    peerSide: 'LONG',
    bookLocked: false,
  })
  assert.equal(call.side, 'LONG')
  assert.equal(call.bookLocked, false)
  assert.ok(!call.playLine.includes('book is locked'))
})

test('OR30/IB/LN never allow mid copy; US Range neither', () => {
  const or30 = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(or30.side, 'LONG')
  assert.equal(or30.midAllowed, false)
  assert.ok(!or30.playLine.includes('Mid is a pullback line'))

  const usLine = playLineForCall({
    side: 'LONG',
    rangeKey: 'US',
    instrument: 'NIKKEI',
    bookLocked: false,
    midAllowed: false,
  })
  assert.ok(usLine.includes('US Range'))
  assert.ok(!usLine.includes('Mid is a pullback'))
  assert.ok(usLine.includes('Tokyo IB') === false)
})

test('Nikkei IB playLine says Tokyo IB, never NY IB', () => {
  const line = playLineForCall({
    side: 'LONG',
    rangeKey: 'IB',
    instrument: 'NIKKEI',
    bookLocked: false,
    midAllowed: false,
  })
  assert.ok(line.includes('Tokyo IB'))
  assert.ok(!line.includes('below IB low'))
})

test('garbage candles / Infinity asOf never throw', () => {
  const junk = [
    null,
    undefined,
    { time: Number.NaN, open: 1, high: 2, low: 0, close: 1 },
    { time: mondayOpen, open: 1, high: Number.POSITIVE_INFINITY, low: 0, close: 1 },
    { time: mondayOpen + 300, high: 2, low: 1 },
  ] as unknown as DeskCallBar[]
  const a = computeDeskCall({
    instrument: 'DOW',
    candles: junk,
    asOfUnix: mondayOpen + 40 * 60,
    playbookMode: 'morning',
  })
  assert.equal(a.side, 'WAIT')
  const b = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1)],
    asOfUnix: Number.POSITIVE_INFINITY,
    playbookMode: 'morning',
  })
  assert.equal(b.side, 'WAIT')
  const c = computeDeskCall({
    instrument: '',
    candles: driveUpSession(mondayOpen, 1),
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(c.side, 'WAIT')
})

test('future bars after asOf cannot lift the range', () => {
  const peek: DeskCallBar = {
    time: mondayOpen + 4 * 3600,
    open: 50000,
    high: 51000,
    low: 49000,
    close: 50500,
    volume: 1,
  }
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 1), peek],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'LONG')
  assert.ok((call.rangeHigh ?? 0) < 45000, 'must not peek a 51k future bar')
})

test('B is false when the opposite extreme breaks first', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  assert.equal(call.side, 'LONG')
  const s = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeLow ?? 0) + 2,
        low: (call.rangeLow ?? 0) - 20,
      },
      {
        time: mondayOpen + 80 * 60,
        high: (call.rangeHigh ?? 0) + 20,
        low: (call.rangeLow ?? 0) + 2,
      },
    ],
  })
  assert.equal(s.brokeWithCall, false)
})

test('same-bar both-edge break is inconclusive for B', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  const s = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeHigh ?? 0) + 15,
        low: (call.rangeLow ?? 0) - 15,
      },
    ],
  })
  assert.equal(s.brokeWithCall, false)
})

test('C is false when the opposite edge prints before named ±10', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  const s = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeHigh ?? 0) + 1,
        low: (call.rangeHigh ?? 0) - 1,
      },
      {
        time: mondayOpen + 80 * 60,
        high: (call.rangeLow ?? 0) + 4,
        low: (call.rangeLow ?? 0) - 4,
      },
    ],
  })
  assert.equal(s.taggedBand, false)
})

test('SHORT C tags ±10 of the high before the low prints', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveDownSession(mondayOpen, 1)],
    asOfUnix: mondayOpen + 30 * 60,
    playbookMode: 'morning',
  })
  assert.equal(call.side, 'SHORT')
  const s = scoreDeskCallWindow({
    call,
    bars: [
      {
        time: mondayOpen + 40 * 60,
        high: (call.rangeHigh ?? 0) + 4,
        low: (call.rangeHigh ?? 0) - 4,
      },
    ],
  })
  assert.equal(s.taggedBand, true)
  assert.equal(s.brokeWithCall, false)
})

test('score window skips NaN bars and non-array later bars', () => {
  const call = computeDeskCall({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'buy')],
    asOfUnix: mondayOpen + 60 * 60,
    playbookMode: 'ib',
  })
  const s = scoreDeskCallWindow({
    call,
    bars: [
      { time: mondayOpen, high: Number.NaN, low: 1 },
      {
        time: mondayOpen + 70 * 60,
        high: (call.rangeHigh ?? 0) + 20,
        low: (call.rangeLow ?? 0) + 5,
      },
    ],
  })
  assert.equal(s.brokeWithCall, true)
  const empty = scoreDeskCallWindow({
    call,
    bars: null as unknown as Array<{ time: number; high: number; low: number }>,
  })
  assert.equal(empty.brokeWithCall, false)
  assert.equal(empty.leftWait, false)
})

test('session scoreboard: weekend / NaN / empty id return no rows', () => {
  assert.deepEqual(
    scoreDeskCallSession({
      instrument: 'DOW',
      candles: friday,
      asOfUnix: Number.NaN,
    }),
    []
  )
  assert.deepEqual(
    scoreDeskCallSession({
      instrument: '',
      candles: friday,
      asOfUnix: mondayOpen + 3600,
    }),
    []
  )
  const sat = cashOpenUnixForYmd('2026-08-15', NY_DESK_CLOCK)
  assert.deepEqual(
    scoreDeskCallSession({
      instrument: 'DOW',
      candles: friday,
      asOfUnix: sat,
    }),
    []
  )
})

test('WAIT windows are excluded from B/C tally; strip has no B marks on WAIT', () => {
  const rows = scoreDeskCallSession({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 2, 'flat')],
    asOfUnix: mondayOpen + 60 * 60,
  })
  assert.ok(rows.length >= 1)
  assert.ok(
    !rows.some((r) => r.playbookMode === 'lunch_break'),
    'lunch-break snap must not appear in the scored windows'
  )
  assert.ok(
    rows.some((r) => r.playbookMode === 'ib'),
    'IB snap at +60m is expected'
  )
  const tally = tallyDeskCallScores(rows)
  const waitRows = rows.filter((r) => r.score.leftWait)
  assert.equal(tally.windows, rows.length - waitRows.length)
  const strip = formatDeskCallScoreStrip(rows, tally)
  for (const r of waitRows) {
    assert.ok(!strip.includes(`${r.badge} B`), 'WAIT badge must not carry B/C')
  }
  const zero = formatDeskCallScoreStrip([], { windows: 0, broke: 0, tagged: 0 })
  assert.ok(zero.includes('session 0w'))
  assert.ok(zero.includes('none'))
})

test('session horizon does not score bars after cash close', () => {
  const closeU = zonedCivilToUnix(
    '2026-08-17',
    NY_DESK_CLOCK.overnightStartHour,
    NY_DESK_CLOCK.timeZone
  )
  const afterHours: DeskCallBar = {
    time: closeU + 300,
    open: 1,
    high: 9e9,
    low: 1,
    close: 2,
    volume: 1,
  }
  const withLeak = scoreDeskCallSession({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 8, 'buy'), afterHours],
    asOfUnix: closeU + 3600,
  })
  const atClose = scoreDeskCallSession({
    instrument: 'DOW',
    candles: [...friday, ...driveUpSession(mondayOpen, 8, 'buy')],
    asOfUnix: closeU,
  })
  assert.equal(withLeak.length, atClose.length)
  assert.ok(withLeak.every((r) => r.asOfUnix <= closeU))
})

test('XSS / SQLi instrument ids never appear in the prompt HTML or SQL', () => {
  const payloads = [
    '<script>alert(1)</script>',
    "'; DROP TABLE trades_journal; --",
    '{"$gt":""}',
    'javascript:alert(1)',
  ]
  for (const instrument of payloads) {
    const packed = formatDeskCallForPrompt(
      computeDeskCall({
        instrument,
        candles: driveUpSession(mondayOpen, 1),
        asOfUnix: mondayOpen + 30 * 60,
        playbookMode: 'morning',
      })
    )
    assert.ok(!packed.includes('<script>'))
    assert.ok(!packed.includes('DROP TABLE'))
    assert.ok(!packed.includes('javascript:'))
    assert.ok(!packed.includes(instrument), 'hostile instrument id must not be echoed')
  }
})

test('ticket freeze + no CALL API + Level Finder does not compute CALL', () => {
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
  const engine = src('lib/trading/deskCall.ts')
  assert.ok(!engine.includes('/api/trading/call'))
  assert.ok(!engine.includes('process.env'))
  assert.ok(!src('lib/services/levelFinderAgent/levelFinderAgent.ts').includes('computeDeskCall'))
  assert.ok(
    src('lib/trading/liveVoicePrompt.ts').includes('CALL bias/entry ±10') ||
      src('lib/trading/liveVoicePrompt.ts').includes('CALL (desk — bias + legal ±10)')
  )
  assert.ok(src('lib/trading/liveVoiceContext.ts').includes('MAX_DAY_ATTEMPTS'))
  assert.ok(src('lib/trading/liveVoiceContext.ts').includes('workingOrders.length'))
})

if (failed.length) {
  console.error(`sentinel_desk_call_edges: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_desk_call_edges: ${passed.length} passed`)
