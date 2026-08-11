/**
 * Progressive session risk: 2% → 1% → 0.5%
 * Size scales with risk %; TP price is geometry (stop / magnets), not risk %.
 * Run: npx tsx __tests__/session_risk_ladder.test.ts
 */

import {
  formatSessionRiskChip,
  getPositionSizer,
  previewPositionSizing,
  riskPercentForEntrySource,
  riskPercentForSessionAttempt,
  SESSION_RISK_FIRST_PERCENT,
  SESSION_RISK_SECOND_PERCENT,
  SESSION_RISK_THIRD_PERCENT,
} from '../lib/trading/positionSizing'
import { strategyTakeProfitPrice } from '../lib/trading/strategyRiskGeometry'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function approxEqual(a: number, b: number, tol: number, msg: string) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`${msg}: expected ${b}, got ${a} (tol ${tol})`)
  }
}

// ─── Ladder percents ─────────────────────────────────────────────────────────

assert(SESSION_RISK_FIRST_PERCENT === 2, 'first = 2%')
assert(SESSION_RISK_SECOND_PERCENT === 1, 'second = 1%')
assert(SESSION_RISK_THIRD_PERCENT === 0.5, 'third = 0.5%')

assert(riskPercentForSessionAttempt(0) === 2, '0 fills → 2%')
assert(riskPercentForSessionAttempt(1) === 1, '1 fill → 1%')
assert(riskPercentForSessionAttempt(2) === 0.5, '2 fills → 0.5%')
assert(riskPercentForSessionAttempt(3) === 0.5, '3 fills still 0.5% (session already locked)')
assert(riskPercentForSessionAttempt(null) === 2, 'null → first probe')
assert(riskPercentForSessionAttempt(undefined) === 2, 'undefined → first probe')

assert(riskPercentForEntrySource('manual', 0) === 2, 'manual first')
assert(riskPercentForEntrySource('ai', 1) === 1, 'ai second')
assert(riskPercentForEntrySource('structure', 2) === 0.5, 'structure third')
assert(riskPercentForEntrySource('manual') === 2, 'default fills=0 → 2%')

// DOW / NASDAQ / NIKKEI all use the same helpers (source ignored; fills drive %)
for (const src of ['manual', 'ai', 'structure'] as const) {
  assert(riskPercentForEntrySource(src, 0) === 2, `${src} fill0 = 2%`)
  assert(riskPercentForEntrySource(src, 1) === 1, `${src} fill1 = 1%`)
  assert(riskPercentForEntrySource(src, 2) === 0.5, `${src} fill2 = 0.5%`)
}

assert(formatSessionRiskChip(0).includes('2%'), 'chip first')
assert(formatSessionRiskChip(0).includes('1/3'), 'chip fill 1/3')
assert(formatSessionRiskChip(1).includes('1%'), 'chip second')
assert(formatSessionRiskChip(2).includes('0.5%'), 'chip third')

// ─── Size scales with risk % (same SL distance, uncapped mid-price) ──────────

const account = 100_000
const entry = 2000
const stop = 1900 // 100 pt stop — stays under notional / margin caps
const stopDist = Math.abs(entry - stop)
const sizer = getPositionSizer()

const pct2 = riskPercentForSessionAttempt(0)
const pct1 = riskPercentForSessionAttempt(1)
const pct05 = riskPercentForSessionAttempt(2)

const sz2 = sizer.calculatePosition(entry, account, 'LONG', stop, pct2)!
const sz1 = sizer.calculatePosition(entry, account, 'LONG', stop, pct1)!
const sz05 = sizer.calculatePosition(entry, account, 'LONG', stop, pct05)!

assert(sz2 && sz1 && sz05, 'sizer returns positions for mid-price ladder')

approxEqual(sz2.risk_amount, account * 0.02, 1e-6, '2% dollar risk = 2% of account')
approxEqual(sz1.risk_amount, account * 0.01, 1e-6, '1% dollar risk = 1% of account')
approxEqual(sz05.risk_amount, account * 0.005, 1e-6, '0.5% dollar risk = 0.5% of account')

approxEqual(sz2.position_size, sz1.position_size * 2, 1e-9, '2% size ≈ 2× 1% size')
approxEqual(sz1.position_size, sz05.position_size * 2, 1e-9, '1% size ≈ 2× 0.5% size')
approxEqual(sz2.position_size, sz05.position_size * 4, 1e-9, '2% size ≈ 4× 0.5% size')

approxEqual(sz2.position_size, (account * 0.02) / stopDist, 1e-9, 'size = risk$ / stopDist @ 2%')
approxEqual(sz1.position_size, (account * 0.01) / stopDist, 1e-9, 'size = risk$ / stopDist @ 1%')
approxEqual(sz05.position_size, (account * 0.005) / stopDist, 1e-9, 'size = risk$ / stopDist @ 0.5%')

// ─── previewPositionSizing matches ladder + same TP price across risk % ──────

const prev2 = previewPositionSizing(entry, account, 'LONG', stop, pct2)!
const prev1 = previewPositionSizing(entry, account, 'LONG', stop, pct1)!
const prev05 = previewPositionSizing(entry, account, 'LONG', stop, pct05)!

assert(prev2 && prev1 && prev05, 'preview returns for mid-price ladder')
approxEqual(prev2.position_size, sz2.position_size, 1e-9, 'preview size matches sizer @ 2%')
approxEqual(prev1.position_size, sz1.position_size, 1e-9, 'preview size matches sizer @ 1%')
approxEqual(prev05.position_size, sz05.position_size, 1e-9, 'preview size matches sizer @ 0.5%')

// TP price comes from stop distance (2R), not risk % — identical across ladder
assert(
  prev2.profit_target_price === prev1.profit_target_price &&
    prev1.profit_target_price === prev05.profit_target_price,
  'TP price independent of risk % (same entry/stop)'
)

const tpDist = prev2.profit_target_price - entry
assert(tpDist > 0, 'LONG TP above entry')

const dollarAtTp2 = prev2.position_size * tpDist
const dollarAtTp1 = prev1.position_size * tpDist
const dollarAtTp05 = prev05.position_size * tpDist

approxEqual(dollarAtTp2, dollarAtTp1 * 2, 1e-6, '$ reward at TP doubles with 2% vs 1%')
approxEqual(dollarAtTp1, dollarAtTp05 * 2, 1e-6, '$ reward at TP doubles with 1% vs 0.5%')
approxEqual(dollarAtTp2, dollarAtTp05 * 4, 1e-6, '$ reward at TP is 4× at 2% vs 0.5%')

// Strategy magnets TP also ignores risk % (geometry only)
const magnetTp = strategyTakeProfitPrice({
  entry,
  stop,
  direction: 'LONG',
  activeRange: { low: 1800, high: 2300, label: 'test' },
})
const magnetTpAgain = strategyTakeProfitPrice({
  entry,
  stop,
  direction: 'LONG',
  activeRange: { low: 1800, high: 2300, label: 'test' },
})
assert(magnetTp === magnetTpAgain, 'strategy TP deterministic for same geometry')
assert(magnetTp > entry, 'strategy LONG TP above entry')

// ─── Edges: zero stop distance / missing account ─────────────────────────────

assert(sizer.calculatePosition(entry, account, 'LONG', entry) !== null, 'stop==entry falls back to disaster stop')
assert(previewPositionSizing(100, account, 'LONG', 99.995) === null, 'stop dist < 0.01 → null')
assert(previewPositionSizing(entry, 0, 'LONG', stop) === null, 'zero account → null preview')
assert(previewPositionSizing(0, account, 'LONG', stop) === null, 'zero entry → null preview')
assert(sizer.calculatePosition(entry, 0, 'LONG', stop) === null, 'zero account → null sizer')
assert(sizer.calculatePosition(0, account, 'LONG', stop) === null, 'zero entry → null sizer')

console.log('session_risk_ladder: all passed')
