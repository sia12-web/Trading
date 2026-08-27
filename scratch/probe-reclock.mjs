import { buildAttemptLadder } from '../lib/trading/attemptLadder.js'
import { shouldRetainClockInAtLunch, canReClockInNow } from '../lib/trading/deskAttendance.js'
import { resolveSessionGate } from '../lib/trading/sessionGate.js'

const fills = [
  { instrument: 'NIKKEI', entryTimestamp: '2026-07-30T00:42:10.387Z', exitReason: 'stop_hit' },
  { instrument: 'NIKKEI', entryTimestamp: '2026-07-30T00:48:53.513Z', exitReason: 'take_profit' },
]
const now = new Date('2026-07-30T02:56:30.120Z')
const ladder = buildAttemptLadder(fills, 'NIKKEI', now)
console.log('ladder', {
  dayAttempts: ladder.dayAttempts,
  ibEligible: ladder.ibEligible,
  lunchEligible: ladder.lunchEligible,
  dayLocked: ladder.dayLocked,
})
console.log('retain', shouldRetainClockInAtLunch(ladder))
console.log('reClock', canReClockInNow('TOKYO', now))
const gate = resolveSessionGate({
  now,
  lockedInstrument: 'NIKKEI',
  viewingInstrument: 'NIKKEI',
  clockedIn: false,
  attendedToday: true,
  attemptFills: fills,
})
console.log('gate', { canClockIn: gate.canClockIn, message: gate.message, phase: gate.phase })
