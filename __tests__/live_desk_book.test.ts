/**
 * Live $50k book: NYC micros, one clock-in name, no live Nikkei.
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
assert.equal(isLiveClockInstrument('NIKKEI'), false)
assert.equal(isNyGlanceChart('NASDAQ', 'DOW'), true)
assert.equal(isNyGlanceChart('NASDAQ', 'NASDAQ'), false)

assert.equal(liveDeskContractLabel('DOW'), 'DOW · MYM')
assert.equal(liveDeskContractLabel('NASDAQ'), 'NASDAQ · MNQ')
assert.ok(liveDeskIndexHint('NASDAQ').includes('30k'))
assert.ok(liveDeskIndexHint('DOW').includes('53k'))
assert.ok(clockedNameOnlyMessage('NASDAQ').includes('MNQ'))
assert.ok(clockedNameOnlyMessage('NASDAQ').includes('one name'))

assert.equal(
  resolveClockedChartInstrument({
    locked: 'NASDAQ',
    viewing: 'DOW',
    visible: ['NASDAQ'],
  }),
  'NASDAQ',
  'clocked name is the only door'
)
assert.equal(
  resolveClockedChartInstrument({
    locked: 'NASDAQ',
    viewing: 'DOW',
    visible: ['DOW', 'NASDAQ'],
  }),
  'NASDAQ',
  'lock wins even if a twin is still in the list'
)
assert.equal(
  resolveClockedChartInstrument({
    locked: null,
    viewing: 'DOW',
    visible: ['DOW', 'NASDAQ'],
  }),
  'DOW'
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

const switchName = assertLiveClockIn({
  market: 'NY',
  instrument: 'DOW',
  existingInstrument: 'NASDAQ',
  alreadyClockedIn: true,
})
assert.equal(switchName.ok, false)

const now = etDate(10, 0)
const vis = liveVisibleInstruments(now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.deepEqual(vis, ['NASDAQ'], `one door ${vis}`)
assert.ok(!vis.includes('DOW'))
assert.ok(!vis.includes('NIKKEI'))

const staleTwin = resolveSessionGate({
  now,
  lockedInstrument: 'NASDAQ',
  viewingInstrument: 'DOW',
  clockedIn: true,
  attendedToday: true,
  attemptsUsed: 0,
  stopLossHitCount: 0,
})
assert.equal(staleTwin.glanceOnly, false)
assert.equal(staleTwin.lockedInstrument, 'NASDAQ')
assert.deepEqual(staleTwin.allowedInstruments, ['NASDAQ'])
assert.ok(!staleTwin.allowedInstruments.includes('DOW'))

const denied = assertCanOpenPosition('DOW', staleTwin)
assert.equal(denied.ok, false)
if (!denied.ok) assert.ok(/NASDAQ|MNQ|one name/i.test(denied.message))

const nikkeiTicket = assertCanOpenPosition('NIKKEI', staleTwin)
assert.equal(nikkeiTicket.ok, false)
if (!nikkeiTicket.ok) assert.equal(nikkeiTicket.message, LIVE_CLOCK_REFUSE)

const skipTwinAi = shouldRunLiveAiForInstrument('DOW', now, {
  lockedInstrument: 'NASDAQ',
  clockedIn: true,
  attendedToday: true,
})
assert.equal(skipTwinAi.ok, false)

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
assert.deepEqual(nikkeiLockIgnored, ['DOW', 'NASDAQ'])

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

// Tight stop: 1 NQ would match $400 exactly; live book must still print MNQ.
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
