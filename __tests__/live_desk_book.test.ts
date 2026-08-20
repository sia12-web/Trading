/**
 * Live $50k book: NYC DOW/NASDAQ/GOLD/CRUDE, free switch, shared 3 fills.
 * Run: npx tsx __tests__/live_desk_book.test.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LIVE_CLOCK_REFUSE,
  assertLiveClockIn,
  clockedNameOnlyMessage,
  isLiveClockInstrument,
  isNyGlanceChart,
  liveDeskContractLabel,
  liveDeskIndexHint,
  resolveClockedChartInstrument,
} from '../lib/trading/liveDeskBook'
import {
  assertCanOpenPosition,
  liveVisibleInstruments,
  resolveSessionGate,
  shouldRunLiveAiForInstrument,
} from '../lib/trading/sessionGate'
import { buildTradovateMirrorTicket } from '../lib/trading/tradovateMirror'

function etDate(h: number, m: number) {
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, 0))
}

assert.equal(isLiveClockInstrument('DOW'), true)
assert.equal(isLiveClockInstrument('NASDAQ'), true)
assert.equal(isLiveClockInstrument('GOLD'), true)
assert.equal(isLiveClockInstrument('CRUDE'), true)
assert.equal(isLiveClockInstrument('NIKKEI'), false)
assert.equal(isNyGlanceChart('NASDAQ', 'DOW'), false)
assert.equal(isNyGlanceChart('NASDAQ', 'NASDAQ'), false)

assert.equal(liveDeskContractLabel('DOW'), 'DOW · MYM')
assert.equal(liveDeskContractLabel('NASDAQ'), 'NASDAQ · MNQ')
assert.equal(liveDeskContractLabel('GOLD'), 'GOLD · MGC')
assert.equal(liveDeskContractLabel('CRUDE'), 'CRUDE · CL')
assert.ok(liveDeskIndexHint('NASDAQ').includes('30k'))
assert.ok(liveDeskIndexHint('DOW').includes('53k'))
assert.ok(clockedNameOnlyMessage('NASDAQ').includes('shared 3'))

assert.equal(
  resolveClockedChartInstrument({
    locked: 'NASDAQ',
    viewing: 'DOW',
    visible: ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'],
  }),
  'DOW',
  'viewing wins on free-switch desk'
)
assert.equal(
  resolveClockedChartInstrument({
    locked: 'NASDAQ',
    viewing: null,
    visible: ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'],
  }),
  'NASDAQ',
  'locked preference when no viewing'
)
assert.equal(
  resolveClockedChartInstrument({
    locked: null,
    viewing: 'GOLD',
    visible: ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'],
  }),
  'GOLD'
)

const noName = assertLiveClockIn({ market: 'NY', instrument: null })
assert.equal(noName.ok, false)

const tokyo = assertLiveClockIn({ market: 'TOKYO', instrument: 'NIKKEI' })
assert.equal(tokyo.ok, false)
assert.ok(tokyo.ok === false && tokyo.error.includes('NYC'))

const nikkei = assertLiveClockIn({ market: 'NY', instrument: 'NIKKEI' })
assert.equal(nikkei.ok, false)

const ok = assertLiveClockIn({ market: 'NY', instrument: 'NASDAQ' })
assert.equal(ok.ok, true)
if (ok.ok) assert.equal(ok.instrument, 'NASDAQ')

const goldOk = assertLiveClockIn({ market: 'NY', instrument: 'GOLD' })
assert.equal(goldOk.ok, true)

const switchName = assertLiveClockIn({
  market: 'NY',
  instrument: 'DOW',
  existingInstrument: 'NASDAQ',
  alreadyClockedIn: true,
})
assert.equal(switchName.ok, true, 'free switch between NY books')

const now = etDate(10, 0)
const vis = liveVisibleInstruments(now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.deepEqual(vis, ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'], `full board ${vis}`)
assert.ok(vis.includes('GOLD'))
assert.ok(!vis.includes('NIKKEI'))

const freeSwitch = resolveSessionGate({
  now,
  lockedInstrument: 'NASDAQ',
  viewingInstrument: 'GOLD',
  clockedIn: true,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
assert.equal(freeSwitch.glanceOnly, false)
assert.equal(freeSwitch.lockedInstrument, 'NASDAQ')
assert.deepEqual(freeSwitch.allowedInstruments, ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'])
assert.ok(freeSwitch.allowedInstruments.includes('GOLD'))

const allowedGold = assertCanOpenPosition('GOLD', {
  ...freeSwitch,
  canPlaceEntry: true,
  clockedIn: true,
})
assert.equal(allowedGold.ok, true)

const nikkeiTicket = assertCanOpenPosition('NIKKEI', freeSwitch)
assert.equal(nikkeiTicket.ok, false)
if (!nikkeiTicket.ok) assert.equal(nikkeiTicket.message, LIVE_CLOCK_REFUSE)

const twinAi = shouldRunLiveAiForInstrument('DOW', now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.equal(twinAi.ok, true, 'AI allowed on other NY books')

const goldAi = shouldRunLiveAiForInstrument('GOLD', now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.equal(goldAi.ok, true)

const skipNikkeiAi = shouldRunLiveAiForInstrument('NIKKEI', now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.equal(skipNikkeiAi.ok, false)

const nikkeiLockIgnored = liveVisibleInstruments(etDate(10, 0), {
  lockedInstrument: 'NIKKEI',
  clockedIn: true,
  attendedToday: true,
})
assert.ok(!nikkeiLockIgnored.includes('NIKKEI'))
assert.deepEqual(nikkeiLockIgnored, ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'])

const tokyoHours = new Date(Date.UTC(2026, 6, 15, 0, 30, 0)) // 09:30 JST
assert.ok(!liveVisibleInstruments(tokyoHours).includes('NIKKEI'))
const tokyoGate = resolveSessionGate({
  now: tokyoHours,
  viewingInstrument: 'NIKKEI',
  lockedInstrument: 'NIKKEI',
  clockedIn: false,
  attendedToday: false,
})
assert.equal(tokyoGate.market, 'NY')
assert.ok(!tokyoGate.allowedInstruments.includes('NIKKEI'))

const tight = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 19996,
  target: 20006,
  riskDollars: 400,
})
assert.ok(tight)
assert.equal(tight!.symbol, 'MNQ')
assert.notEqual(tight!.symbol, 'NQ')
assert.ok(tight!.qty <= 40)
assert.ok(tight!.copyText.includes('Micro only'))

const tightDow = buildTradovateMirrorTicket({
  instrument: 'DOW',
  direction: 'LONG',
  entry: 40000,
  stop: 39996,
  target: 40006,
  riskDollars: 400,
})
assert.ok(tightDow)
assert.equal(tightDow!.symbol, 'MYM')
assert.notEqual(tightDow!.symbol, 'YM')

const goldTicket = buildTradovateMirrorTicket({
  instrument: 'GOLD',
  direction: 'LONG',
  entry: 4500,
  stop: 4490,
  target: 4515,
  riskDollars: 400,
})
assert.ok(goldTicket)
assert.equal(goldTicket!.symbol, 'MGC')

const livePage = readFileSync(
  join(__dirname, '../app/dashboard/chart/page.tsx'),
  'utf8'
)
const ticketCard = readFileSync(
  join(__dirname, '../app/dashboard/chart/components/TradovateMirrorCard.tsx'),
  'utf8'
)
assert.ok(livePage.includes('<ManageDeskBar'), 'manage card stays on the live desk')
assert.ok(livePage.includes('<TradovateMirrorCard'), 'TradingView ticket stays on the live desk')
assert.ok(ticketCard.includes('Copied — close'), 'ticket can hide after copy without canceling the book')
assert.ok(livePage.includes('onClose={() => setTvTicketClosed(true)}'), 'close only hides the copy overlay')
assert.ok(
  livePage.includes('flex flex-col gap-2 items-start'),
  'manage + ticket stack instead of overlapping'
)
assert.ok(
  !ticketCard.includes('absolute bottom-28'),
  'ticket card is not independently pinned over the manage strip'
)

console.log('live_desk_book.test.ts: all assertions passed')
