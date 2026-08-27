import { buildAttemptLadder } from '../lib/trading/attemptLadder.js'
import { shouldRetainClockInAtLunch } from '../lib/trading/deskAttendance.js'
import { getESTDateString } from '../lib/utils/timeUtils.js'

const fills = [
  { instrument: 'NIKKEI', entryTimestamp: '2026-07-30T00:42:10.387Z', exitReason: 'stop_hit' },
  { instrument: 'NIKKEI', entryTimestamp: '2026-07-30T00:48:53.513Z', exitReason: 'take_profit' },
]
const now = new Date('2026-07-30T03:15:40.016Z') // when auto clock-out fired
console.log('estDate', getESTDateString(now))
const ladder = buildAttemptLadder(fills, 'NIKKEI', now)
console.log('ladder', {
  dayAttempts: ladder.dayAttempts,
  morningAttempts: ladder.morningAttempts,
  ibAttempts: ladder.ibAttempts,
  lunchAttempts: ladder.lunchAttempts,
  ibEligible: ladder.ibEligible,
  lunchEligible: ladder.lunchEligible,
  dayLocked: ladder.dayLocked,
})
console.log('retain', shouldRetainClockInAtLunch(ladder))
