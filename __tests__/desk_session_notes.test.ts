/**
 * Structured desk Telegram notes.
 * Run: npx tsx __tests__/desk_session_notes.test.ts
 */

import assert from 'node:assert/strict'
import {
  formatClockInNote,
  formatSessionStartNote,
  formatSessionEndNote,
  formatRangeShapedNote,
  formatEntryPermissionNote,
  formatSessionScheduleBlock,
} from '../lib/notify/deskSessionNotes'

const dow = formatClockInNote({
  instrument: 'DOW',
  market: 'NY',
  sessionDate: '2026-07-28',
  now: new Date('2026-07-28T12:00:00Z'),
})
assert.match(dow.telegram, /CLOCK IN/)
assert.match(dow.telegram, /Session START/)
assert.match(dow.telegram, /Session END/)
assert.match(dow.telegram, /OR30/)
assert.match(dow.telegram, /Lunch-range/)

const nikkei = formatSessionScheduleBlock(
  'NIKKEI',
  new Date('2026-07-28T00:00:00Z')
)
assert.match(nikkei, /US Range/)
assert.match(nikkei, /Tokyo IB/)

const start = formatSessionStartNote({ instrument: 'NASDAQ' })
assert.match(start.telegram, /SESSION START/)

const end = formatSessionEndNote({ instrument: 'DOW' })
assert.match(end.telegram, /SESSION END/)

const shaped = formatRangeShapedNote({
  instrument: 'DOW',
  rangeLabel: 'IB',
  high: 42010,
  low: 41900,
})
assert.match(shaped.telegram, /RANGE LOCKED/)
assert.match(shaped.body, /42,?010/)

const entry = formatEntryPermissionNote({
  instrument: 'NIKKEI',
  windowLabel: 'US Range',
  ladderHint: '2/2/2',
  rangeHigh: 39000,
  rangeLow: 38800,
})
assert.match(entry.telegram, /ENTRY PERMISSION/)
assert.match(entry.body, /39,?000/)

console.log('desk_session_notes: all passed')
