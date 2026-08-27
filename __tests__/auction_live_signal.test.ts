/**
 * Live auction entrance — last closed 5m bar only.
 * Run: npx tsx __tests__/auction_live_signal.test.ts
 */

import assert from 'node:assert/strict'
import { cashOpenUnixForYmd, NY_DESK_CLOCK } from '../lib/chart/sessionVwap'
import {
  evaluateAuctionLiveSignal,
  isAuctionTicketPayload,
  isAuctionTicketReason,
  type AuctionLiveSignal,
} from '../lib/trading/auctionLiveSignal'
import type { AuctionBar } from '../lib/trading/auctionStrategy'

function rthBars(
  ymd: string,
  make: (i: number) => { open: number; high: number; low: number; close: number; volume?: number }
): AuctionBar[] {
  const openU = cashOpenUnixForYmd(ymd, NY_DESK_CLOCK)
  const closeU = openU + 6.5 * 3600
  const out: AuctionBar[] = []
  let i = 0
  for (let t = openU; t < closeU; t += 300) {
    const b = make(i)
    out.push({
      time: t,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 100,
    })
    i += 1
  }
  return out
}

function quietDay(ymd: string, mid: number): AuctionBar[] {
  return rthBars(ymd, () => ({
    open: mid,
    high: mid + 40,
    low: mid - 40,
    close: mid,
    volume: 100,
  }))
}

const friday = quietDay('2026-08-14', 42000)

const failMonday = rthBars('2026-08-17', (i) => {
  if (i < 3) {
    return { open: 42040, high: 42100, low: 42000, close: 42050, volume: 100 }
  }
  if (i === 3) {
    return { open: 42070, high: 42140, low: 42050, close: 42120, volume: 800 }
  }
  if (i === 6) {
    return { open: 42080, high: 42090, low: 42000, close: 42020, volume: 120 }
  }
  return { open: 42100, high: 42120, low: 42080, close: 42100, volume: 90 }
})

const openU = cashOpenUnixForYmd('2026-08-17', NY_DESK_CLOCK)
const failFillUnix = openU + 6 * 300
const dow = evaluateAuctionLiveSignal({
  instrument: 'DOW',
  candles: [...friday, ...failMonday],
  nowUnix: failFillUnix + 300,
})
assert.ok(dow, 'Dow FAIL 15M must fire on the just-closed bar')
assert.equal(dow!.side, 'SHORT')
assert.equal(dow!.fillUnix, failFillUnix)
assert.ok(dow!.note.startsWith('AUCTION DOW SHORT'))
assert.ok(dow!.telegram.includes('AUCTION SHORT'))
assert.equal(dow!.rangeLabel, 'OR30')
assert.ok(dow!.stop > dow!.entry)

assert.equal(
  evaluateAuctionLiveSignal({
    instrument: 'NASDAQ',
    candles: [...friday, ...failMonday],
    nowUnix: failFillUnix + 300,
  }),
  null,
  'Nasdaq is not in the live auction book'
)

assert.equal(
  evaluateAuctionLiveSignal({
    instrument: 'DOW',
    candles: [...friday, ...failMonday],
    nowUnix: failFillUnix + 300 + 20 * 60,
  }),
  null,
  'stale closed bar must not re-fire'
)

const mondayIb = rthBars('2026-08-17', (i) => {
  if (i < 12) {
    return { open: 42020, high: 42100, low: 42000, close: 42085, volume: 100 }
  }
  if (i === 12) {
    return { open: 42090, high: 42140, low: 42080, close: 42095, volume: 100 }
  }
  if (i === 13) {
    return { open: 42100, high: 42160, low: 42095, close: 42150, volume: 100 }
  }
  return { open: 42150, high: 42300, low: 42140, close: 42250, volume: 100 }
})
const ibFillUnix = openU + 13 * 300
const gold: AuctionLiveSignal | null = evaluateAuctionLiveSignal({
  instrument: 'GOLD',
  candles: [...friday, ...mondayIb],
  nowUnix: ibFillUnix + 300,
})
assert.ok(gold, 'Gold IB absorb must fire on the just-closed bar')
assert.equal(gold!.side, 'LONG')
assert.equal(gold!.rangeLabel, 'IB')
assert.ok(gold!.note.includes('IB absorb-breakout'))

const crude = evaluateAuctionLiveSignal({
  instrument: 'CRUDE',
  candles: [...friday, ...mondayIb],
  nowUnix: ibFillUnix + 300,
})
assert.ok(crude, 'Crude IB long absorb must fire')
assert.equal(crude!.side, 'LONG')

assert.equal(isAuctionTicketReason('AUCTION DOW SHORT · 15M volume-bar FAIL'), true)
assert.equal(isAuctionTicketReason('SYSTEM CALL LONG'), false)
assert.equal(isAuctionTicketPayload({ auction_ticket: true }), true)
assert.equal(isAuctionTicketPayload({ entry_reason: 'AUCTION GOLD LONG · IB' }), true)
assert.equal(isAuctionTicketPayload({ entry_reason: 'SYSTEM CALL LONG' }), false)

console.log('auction_live_signal.test.ts: ok', {
  dow: dow!.side,
  gold: gold!.side,
  crude: crude!.side,
})
