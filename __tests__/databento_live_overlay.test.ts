/**
 * Databento overlay must cover the Yahoo lag window with real 1m CME bars.
 * Run: npx tsx __tests__/databento_live_overlay.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeHistoryWithLiveTip } from '../lib/chart/liveFormingBar'
import {
  liveTapeHasVendorGap,
  mergeTapeBars,
  overlayVendorWithTape,
} from '../lib/databento/liveOverlay'

const t0 = 1_700_000_000 - (1_700_000_000 % 300)

function bar(time: number, close: number, volume = 10) {
  return {
    time,
    open: close,
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume,
  }
}

test('mergeTapeBars: live wins on the same 1m timestamp', () => {
  const hist = [bar(t0, 93.4), bar(t0 + 60, 93.5)]
  const live = [bar(t0 + 60, 93.62, 4), bar(t0 + 120, 93.7, 2)]
  const merged = mergeTapeBars(hist, live)
  assert.equal(merged.length, 3)
  assert.equal(merged[1]!.close, 93.62, 'live close replaces lagged hist')
  assert.equal(merged[2]!.close, 93.7)
})

test('liveTapeHasVendorGap: forming-only sidecar after restart is a gap', () => {
  const vendorLast = t0
  const formingNow = [bar(t0 + 600, 94.2)]
  assert.equal(liveTapeHasVendorGap(formingNow, vendorLast, 300), true)
  const seeded = [bar(t0, 93.5), bar(t0 + 60, 93.6)]
  assert.equal(liveTapeHasVendorGap(seeded, vendorLast, 300), false)
  assert.equal(liveTapeHasVendorGap([], vendorLast, 300), true)
})

test('overlay fills the 10-minute Yahoo hole with real 1m tape', () => {
  const vendor = [bar(t0, 93.51, 100)]
  const tape1m: ReturnType<typeof bar>[] = []
  for (let i = 0; i <= 10; i++) {
    tape1m.push(bar(t0 + i * 60, 93.51 + i * 0.04, 8))
  }
  const { candles, applied } = overlayVendorWithTape(vendor, tape1m, 300, 'CRUDE')
  assert.equal(applied, true)
  assert.ok(candles.length >= 3, `expected 5m bars across 10m, got ${candles.length}`)
  assert.equal(candles[0]!.time, t0)
  const tip = candles[candles.length - 1]!
  assert.equal(tip.time, t0 + 600)
  assert.ok(Math.abs(tip.close - 93.91) < 1e-9)
  assert.ok((tip.volume || 0) > 0, 'overlay bars are real prints, not zero-volume flats')
})

test('overlay skips only a same-timestamp calendar-front mismatch', () => {
  const vendor = [bar(t0, 93.51)]
  const wrongMonth = [bar(t0, 97.44), bar(t0 + 60, 97.5)]
  const skipped = overlayVendorWithTape(vendor, wrongMonth, 300, 'CRUDE')
  assert.equal(skipped.applied, false)
  assert.equal(skipped.candles[0]!.close, 93.51)
})

test('overlay does not skip a real move across the delayed Yahoo last', () => {
  // Yahoo last 10m ago at 93.51; live now 96.20 after a fast dump/rally.
  // Old code compared tip vs delayed last (3pt CRUDE ceiling) and dropped the tape.
  const vendor = [bar(t0, 93.51)]
  const tape1m: ReturnType<typeof bar>[] = []
  for (let i = 0; i <= 10; i++) {
    tape1m.push(bar(t0 + i * 60, 93.51 + (i / 10) * 2.69, 8))
  }
  const { candles, applied } = overlayVendorWithTape(vendor, tape1m, 300, 'CRUDE')
  assert.equal(applied, true)
  assert.ok(Math.abs(candles[candles.length - 1]!.close - 96.2) < 0.05)
})

test('mergeHistoryWithLiveTip keeps a live tip ahead of delayed REST without flats', () => {
  const history = [bar(t0, 93.51)]
  const live = bar(t0 + 600, 96.2, 0)
  const merged = mergeHistoryWithLiveTip(history, live, '5m', 'CRUDE')
  assert.equal(merged.length, 2, 'do not invent 5m flats across the lag window')
  assert.equal(merged[1]!.close, 96.2)
  assert.equal(merged[1]!.time, t0 + 600)
})
