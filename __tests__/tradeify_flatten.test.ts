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

// ── Tradeify flatten beats Nikkei 02:00 / Tokyo cash-close hold ──────────────

assert(
  shouldAutoFlattenAtCashClose({
    timeSec: tokyoBeforeClose,
    marketCloseSec: tokyoClose,
    tradeifyMustFlatten: true,
  }) === true,
  'Tradeify: flatten Nikkei even before 15:00 JST / 02:00 Montreal'
)
assert(
  shouldExpireWorkingLimit({
    timeSec: tokyoBeforeClose,
    lastEntryCloseSec: tokyoClose,
    marketCloseSec: tokyoClose,
    tradeifyMustFlatten: true,
  }) === true,
  'Tradeify: expire working Nikkei limits in flatten window'
)
assert(tradeifyMustFlatten(flattenEt), '17:05 ET is flatten window')
assert(tradeifyFlattenOverridesKeepOpen(flattenEt), 'keep-open does not survive 16:59 ET')
assert(!tradeifyFlattenOverridesKeepOpen(middayEt), 'keep-open still valid at 11:30 ET')
assert(!tradeifyFlattenOverridesKeepOpen(afterRoll), 'after 18:00 roll keep-open overlay off')

const place = resolveTradeifyPlace({ now: flattenEt, fillsUsed: 0, dailyPnl: -150 })
assert(!place.allowed, 'no new holds in flatten window')
assert(place.refuseReason === 'must_flatten', 'refuse is must_flatten')
assert(tradeifyDeskStatus(place, flattenEt) === 'must_flatten', 'status must_flatten')

const middayPlace = resolveTradeifyPlace({ now: middayEt, fillsUsed: 0, dailyPnl: -150 })
assert(middayPlace.allowed, 'midday still placeable')
assert(tradeifyDeskStatus(middayPlace, middayEt) === 'can_trade', 'midday can_trade')

// ── Banner chip matches snapshot leftover / floor ────────────────────────────

const okChip = formatTradeifyBannerChip({
  leftoverDll: middayPlace.leftoverDll,
  floorRoom: middayPlace.floorRoom,
  status: 'can_trade',
  flattenMontreal: '16:59 Montreal',
})
assert(okChip.label.includes(`DLL $${Math.round(middayPlace.leftoverDll)}`), 'chip leftover DLL')
assert(okChip.label.includes(`floor $${Math.round(middayPlace.floorRoom)}`), 'chip floor room')
assert(okChip.tone === 'ok', 'can_trade chip tone')
assert(!okChip.label.includes('FLATTEN'), 'can_trade chip is not flatten')

const flatChip = formatTradeifyBannerChip({
  leftoverDll: place.leftoverDll,
  floorRoom: place.floorRoom,
  status: 'must_flatten',
  refuseReason: 'must_flatten',
  flattenMontreal: '16:59 Montreal',
})
assert(flatChip.tone === 'flatten', 'flatten chip tone')
assert(flatChip.label.startsWith('FLATTEN'), 'flatten chip label')
assert(flatChip.label.includes(`DLL $${Math.round(place.leftoverDll)}`), 'flatten chip same DLL')
assert(flatChip.title.includes('Nikkei 02:00'), 'flatten title mentions Nikkei hold')

const lockChip = formatTradeifyBannerChip({
  leftoverDll: 400,
  floorRoom: 1600,
  status: 'day_locked',
  refuseReason: 'day_locked_stops',
})
assert(lockChip.tone === 'lock', 'lock chip tone')
assert(lockChip.label.startsWith('LOCKED'), 'lock chip label')
assert(lockChip.label.includes('DLL $400'), 'lock chip DLL')
assert(lockChip.label.includes('floor $1600'), 'lock chip floor')

console.log('tradeify_flatten: all passed')
