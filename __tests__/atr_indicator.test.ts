/**
 * ATR indicator — parity with TradingView's built-in "Average True Range".
 * Run: npx tsx __tests__/atr_indicator.test.ts
 */

import {
  computeAtr,
  computeTrueRange,
  smoothSeries,
  normalizeAtrSettings,
  DEFAULT_ATR_SETTINGS,
} from '../lib/chart/atrIndicator'

let failures = 0
const near = (a: number | null, b: number | null, eps = 1e-9) =>
  a == null || b == null ? a === b : Math.abs(a - b) <= eps
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name}`, detail ?? '')
  }
}

const bars = [
  { high: 10, low: 8, close: 9 },
  { high: 11, low: 9, close: 10.5 },
  { high: 10.8, low: 7, close: 7.5 },
  { high: 9, low: 7.2, close: 8.8 },
  { high: 12, low: 9.5, close: 11 },
  { high: 11.5, low: 10, close: 10.2 },
]

console.log('True range (ta.tr(true))')
const tr = computeTrueRange(bars)
check('first bar uses high-low', near(tr[0], 2))
check('bar 2 = max(h-l, |h-pc|, |l-pc|)', near(tr[1], 2))
check('bar 3 gap down uses |h-pc| / h-l', near(tr[2], 3.8))
check('bar 5 gap up uses |h-pc|', near(tr[4], 3.2))

console.log('RMA (TradingView default) seeded with SMA')
const rma = computeAtr(bars, 3, 'RMA')
const seed = (2 + 2 + 3.8) / 3
check('warm-up is null', rma[0] === null && rma[1] === null)
check('first value = SMA of first 3 TR', near(rma[2], seed))
const r3 = (1 / 3) * (tr[3] as number) + (2 / 3) * seed
check('next value = rma recursion', near(rma[3], r3))

console.log('SMA / EMA / WMA')
const sma = computeAtr(bars, 3, 'SMA')
check('SMA rolling mean', near(sma[3], ((tr[1] as number) + (tr[2] as number) + (tr[3] as number)) / 3))
const ema = computeAtr(bars, 3, 'EMA')
check('EMA seeded with SMA', near(ema[2], seed))
check('EMA alpha = 2/(n+1)', near(ema[3], 0.5 * (tr[3] as number) + 0.5 * seed))
const wma = computeAtr(bars, 3, 'WMA')
check('WMA newest weighted highest', near(wma[2], (2 * 1 + 2 * 2 + 3.8 * 3) / 6))

console.log('Whitespace alignment')
const sparse = smoothSeries([1, null, 2, 3], 2, 'SMA')
check('null input stays null and is skipped', sparse[1] === null && near(sparse[2], 1.5) && near(sparse[3], 2.5))
const ws = computeAtr([bars[0], { high: undefined, low: undefined, close: undefined }, bars[1]], 1, 'RMA')
check('whitespace bar does not break prev-close chain', near(ws[2], 2) && ws[1] === null)

console.log('Settings normalisation')
check('defaults are 14 RMA #B71C1C', DEFAULT_ATR_SETTINGS.length === 14 && DEFAULT_ATR_SETTINGS.smoothing === 'RMA' && DEFAULT_ATR_SETTINGS.color === '#B71C1C')
const bad = normalizeAtrSettings({ length: -4, smoothing: 'HMA', color: 'red', lineWidth: 9 })
check('invalid input falls back to defaults', bad.length === 14 && bad.smoothing === 'RMA' && bad.color === '#B71C1C' && bad.lineWidth === 1)

if (failures) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll ATR tests passed')
