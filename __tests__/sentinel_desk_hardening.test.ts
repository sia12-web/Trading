/**
 * Sentinel fixes: trade dates per desk + account size resolve.
 * Run: npx tsx __tests__/sentinel_desk_hardening.test.ts
 */

import { tradeDateForInstrument, sessionDateForMarket } from '../lib/trading/deskAttendance'
import { resolveDeskAccountSize } from '../lib/trading/positionSizing'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Wed 2026-07-15 22:00 ET = Thu 11:00 JST Jul 16
const tokyoMorningNyEvening = new Date('2026-07-16T02:00:00.000Z') // 11:00 JST Jul 16 / 22:00 ET Jul 15

assert(
  sessionDateForMarket('TOKYO', tokyoMorningNyEvening) === '2026-07-16',
  'TOKYO session date is JST'
)
assert(
  sessionDateForMarket('NY', tokyoMorningNyEvening) === '2026-07-15',
  'NY session date is ET'
)
assert(
  tradeDateForInstrument('NIKKEI', tokyoMorningNyEvening) === '2026-07-16',
  'NIKKEI trade_date = JST'
)
assert(
  tradeDateForInstrument('DOW', tokyoMorningNyEvening) === '2026-07-15',
  'DOW trade_date = ET'
)
assert(
  tradeDateForInstrument('NASDAQ', tokyoMorningNyEvening) === '2026-07-15',
  'NASDAQ trade_date = ET'
)

const prev = process.env.DESK_ACCOUNT_SIZE
delete process.env.DESK_ACCOUNT_SIZE

assert(resolveDeskAccountSize(100_000) === 100_000, 'valid client size')
assert(resolveDeskAccountSize(99) === null, 'below $100 min')
assert(resolveDeskAccountSize(100) === 100, 'min $100 allowed')
assert(resolveDeskAccountSize(10_000_001) === null, 'too large')
assert(resolveDeskAccountSize(undefined) === null, 'missing')

process.env.DESK_ACCOUNT_SIZE = '250000'
assert(resolveDeskAccountSize(999_999) === 250_000, 'env overrides client')
if (prev === undefined) delete process.env.DESK_ACCOUNT_SIZE
else process.env.DESK_ACCOUNT_SIZE = prev

console.log('sentinel_desk_hardening: all passed')
