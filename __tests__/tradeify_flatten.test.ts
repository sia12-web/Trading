/**
 * Slice 6 — Tradeify prop flatten + banner chip.
 * Run: npx tsx __tests__/tradeify_flatten.test.ts
 */

import {
  shouldAutoFlattenAtCashClose,
  shouldExpireWorkingLimit,
} from '../lib/trading/sessionCleanup'
import { parseTimeToSeconds } from '../lib/utils/timeUtils'
import { TOKYO_SESSION } from '../lib/trading/sessionGate'
import {
  formatTradeifyBannerChip,
  resolveTradeifyPlace,
  tradeifyDeskStatus,
  tradeifyFlattenOverridesKeepOpen,
  tradeifyMustFlatten,
} from '../lib/trading/tradeifyGrowth50k'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const tokyoClose = parseTimeToSeconds(TOKYO_SESSION.marketClose)
const tokyoBeforeClose = parseTimeToSeconds('14:00:00') // 14:00 JST — still open
const flattenEt = new Date('2026-08-18T17:05:00-04:00')
const middayEt = new Date('2026-08-18T11:30:00-04:00')
const afterRoll = new Date('2026-08-18T18:05:00-04:00')

// ── OANDA cash-close unchanged ───────────────────────────────────────────────

assert(
  shouldAutoFlattenAtCashClose({
    timeSec: tokyoBeforeClose,
    marketCloseSec: tokyoClose,
  }) === false,
  'OANDA: Nikkei before 15:00 JST does not flatten'
)
assert(
  shouldAutoFlattenAtCashClose({
    timeSec: tokyoClose,
    marketCloseSec: tokyoClose,
  }) === true,
  'OANDA: Tokyo cash close still flattens'
)
assert(
  shouldExpireWorkingLimit({
    timeSec: tokyoBeforeClose,
    lastEntryCloseSec: tokyoClose,
    marketCloseSec: tokyoClose,
  }) === false,
  'OANDA: working Nikkei limit survives before cash close'
)

// ── Personal Futures: No forced 16:59 prop flatten ───────────────────────────

assert(!tradeifyMustFlatten(flattenEt), 'Personal futures has no 16:59 forced flatten')
assert(!tradeifyMustFlatten(new Date('2026-11-27T13:05:00-05:00')), 'holiday early close has no forced flatten')
assert(!tradeifyFlattenOverridesKeepOpen(flattenEt), 'keep-open not overridden by prop clock')

const middayPlace = resolveTradeifyPlace({ now: middayEt, fillsUsed: 0, dailyPnl: -150 })
assert(middayPlace.allowed, 'midday still placeable')
assert(tradeifyDeskStatus(middayPlace, middayEt) === 'can_trade', 'midday can_trade')

// ── Banner chip matches snapshot leftover ────────────────────────────────────

const okChip = formatTradeifyBannerChip({
  leftoverDll: middayPlace.leftoverDll,
  floorRoom: middayPlace.floorRoom,
  status: 'can_trade',
  flattenMontreal: '16:59 Montreal',
})
assert(okChip.label.includes(`DLL $${Math.round(middayPlace.leftoverDll)}`), 'chip leftover DLL')
assert(okChip.tone === 'ok', 'can_trade chip tone')
assert(!okChip.label.includes('FLATTEN'), 'can_trade chip is not flatten')

const lockChip = formatTradeifyBannerChip({
  leftoverDll: 400,
  floorRoom: 1600,
  status: 'day_locked',
  refuseReason: 'day_locked_stops',
})
assert(lockChip.tone === 'lock', 'lock chip tone')
assert(lockChip.label.startsWith('LOCKED'), 'lock chip label')
assert(lockChip.label.includes('DLL $400'), 'lock chip DLL')

console.log('tradeify_flatten: all passed')
