/**
 * CME vs OANDA basis — live ticks must sit on Tradovate scale.
 * Run: npx tsx __tests__/cme_basis.test.ts
 */

import assert from 'node:assert/strict'
import {
  applyCmeBasis,
  applyCmeBasisToCandles,
  cmeBasisFromPair,
  getCmeBasis,
  getLastKnownCmeBasis,
  medianOf,
  pairOandaMidForYahooPrint,
  setCmeBasis,
  CME_BASIS_MAX_ABS,
  CME_BASIS_PAIR_WINDOW_MS,
  CME_BASIS_REFRESH_MS,
  CME_BASIS_TTL_MS,
  __resetCmeBasisForTest,
} from '../lib/trading/cmeBasis'
import { YAHOO_CME_SYMBOLS } from '../lib/yahoo/symbols'
import {
  isYahooPrintLiveGrade,
  isYahooPrintUsableForBasis,
  yahooPrintAgeSec,
  YAHOO_CME_DECLARED_DELAY_SEC,
  YAHOO_LIVE_MAX_AGE_SEC,
} from '../lib/yahoo/quote'
import {
  recordOandaMidSample,
  getStreamedMidNear,
  __resetOandaMidHistoryForTest,
} from '../lib/oanda/pricingStream'

assert.equal(YAHOO_CME_SYMBOLS.DOW, 'MYM=F')
assert.equal(YAHOO_CME_SYMBOLS.NASDAQ, 'MNQ=F')
assert.equal(YAHOO_CME_SYMBOLS.NIKKEI, 'NKD=F')
assert.equal(YAHOO_CME_SYMBOLS.GOLD, 'MGC=F', 'GOLD chart is CME Micro Gold')
assert.equal(YAHOO_CME_SYMBOLS.CRUDE, 'CL=F', 'CRUDE chart is CME Crude Oil')
assert.ok(CME_BASIS_MAX_ABS.GOLD >= 10 && CME_BASIS_MAX_ABS.GOLD <= 40)
assert.ok(CME_BASIS_MAX_ABS.CRUDE >= 0.5 && CME_BASIS_MAX_ABS.CRUDE <= 5)

{
  const b = cmeBasisFromPair(4540.2, 4542.1, 'GOLD')
  assert.ok(b != null, 'gold oz basis is valid')
  assert.equal(Math.round(applyCmeBasis(4540.2, b) * 10) / 10, 4542.1)
}
{
  const b = cmeBasisFromPair(86.5, 86.62, 'CRUDE')
  assert.ok(b != null, 'crude basis is valid')
  assert.equal(Math.round(applyCmeBasis(86.5, b) * 100) / 100, 86.62)
}
assert.equal(
  cmeBasisFromPair(4500, 4600, 'GOLD'),
  null,
  '100 oz gap is not a gold basis (GLD-scale bleed)'
)

assert.ok(CME_BASIS_MAX_ABS.DOW <= 120)
assert.ok(CME_BASIS_MAX_ABS.NASDAQ <= 140)
assert.ok(CME_BASIS_MAX_ABS.DOW >= 80, 'Dow band keeps headroom above typical 40–80')
assert.ok(CME_BASIS_MAX_ABS.NASDAQ >= 90, 'Nasdaq band keeps headroom above typical 50–90')
assert.ok(CME_BASIS_PAIR_WINDOW_MS <= 2_000, 'pairing window is tighter than 8s')

{
  const b = cmeBasisFromPair(53262.6, 53311, 'DOW')
  assert.ok(b != null, 'today Dow basis is valid')
  assert.equal(Math.round(b! * 10) / 10, 48.4)
  assert.equal(applyCmeBasis(53262.6, b), 53311)
}

{
  const b = cmeBasisFromPair(29495.2, 29568.25, 'NASDAQ')
  assert.ok(b != null, 'today Nasdaq basis is valid')
  assert.equal(Math.round(applyCmeBasis(29495.2, b) * 100) / 100, 29568.25)
}

assert.equal(cmeBasisFromPair(53000, 53000 * 1.02, 'DOW'), null, '2% gap is not a basis')
assert.equal(
  cmeBasisFromPair(53000, 53200, 'DOW'),
  null,
  '200 Dow pts exceeds the plausible band (old 1% frac would have allowed ~530)'
)
assert.equal(cmeBasisFromPair(0, 53311, 'DOW'), null)
assert.equal(applyCmeBasis(53262.6, null), 53262.6, 'no basis → leave OANDA')

{
  const shifted = applyCmeBasisToCandles(
    [{ time: 1, open: 100, high: 110, low: 90, close: 105, volume: 8 }],
    48.4
  )
  assert.equal(shifted[0]!.open, 148.4)
  assert.equal(shifted[0]!.high, 158.4)
  assert.equal(shifted[0]!.low, 138.4)
  assert.equal(shifted[0]!.close, 153.4)
  assert.equal(shifted[0]!.volume, 8, 'volume is not a price')
  assert.deepEqual(
    applyCmeBasisToCandles([{ open: 1, high: 2, low: 0, close: 1 }], null),
    [{ open: 1, high: 2, low: 0, close: 1 }],
    'no basis → leave CFD candles'
  )
}

{
  const now = Date.now()
  const delayed = {
    price: 53354,
    timestamp: Math.floor(now / 1000) - YAHOO_CME_DECLARED_DELAY_SEC,
    delayedBySec: YAHOO_CME_DECLARED_DELAY_SEC,
  }
  assert.ok(isYahooPrintUsableForBasis(delayed, now), '10-minute delayed print is usable for pairing')
  assert.equal(isYahooPrintLiveGrade(delayed, now), false, 'delayed print is not a live last')
  assert.ok((yahooPrintAgeSec(delayed, now) ?? 0) >= 590)

  const stuck = {
    ...delayed,
    timestamp: Math.floor(now / 1000) - YAHOO_CME_DECLARED_DELAY_SEC - 180,
  }
  assert.equal(
    isYahooPrintUsableForBasis(stuck, now),
    false,
    'print older than delay+slack is rejected'
  )

  const missingTs = { price: 53354, timestamp: 0, delayedBySec: 600 }
  assert.equal(isYahooPrintUsableForBasis(missingTs, now), false)
  assert.equal(isYahooPrintLiveGrade(missingTs, now), false)

  const live = {
    price: 53354,
    timestamp: Math.floor(now / 1000) - 1,
    delayedBySec: 0,
  }
  assert.ok(isYahooPrintLiveGrade(live, now))
  assert.ok(YAHOO_LIVE_MAX_AGE_SEC <= 5)
}

{
  __resetOandaMidHistoryForTest()
  const now = Date.now()
  const printUnix = Math.floor(now / 1000) - 600
  const delayed = {
    price: 53311,
    timestamp: printUnix,
    delayedBySec: 600,
  }

  assert.equal(
    pairOandaMidForYahooPrint('DOW', delayed, {
      fallbackMid: 53262.6,
      nowMs: now,
    }),
    null,
    'delayed print must not pair with the live fallback mid'
  )

  recordOandaMidSample('DOW', 53262.6, printUnix * 1000)
  assert.equal(getStreamedMidNear('DOW', printUnix, 2_000), 53262.6)
  assert.equal(
    pairOandaMidForYahooPrint('DOW', delayed, {
      fallbackMid: 99999,
      nowMs: now,
    }),
    53262.6,
    'delayed print pairs with the same-age OANDA mid'
  )

  const livePrint = {
    price: 53311,
    timestamp: Math.floor(now / 1000),
    delayedBySec: 0,
  }
  assert.equal(
    pairOandaMidForYahooPrint('DOW', livePrint, {
      fallbackMid: 53200,
      nowMs: now,
    }),
    53200,
    'live-grade print may use the live fallback mid'
  )
}

assert.equal(medianOf([]), null)
assert.equal(medianOf([48.4]), 48.4)
assert.equal(medianOf([48, 50, 49]), 49)
assert.equal(medianOf([40, 80]), 60)

// Cached basis — priming a stream must not wait on Yahoo when one is already known
{
  __resetCmeBasisForTest()
  assert.ok(CME_BASIS_REFRESH_MS < CME_BASIS_TTL_MS, 'refresh faster than expiry')

  assert.equal(getCmeBasis('DOW'), null, 'cold process has no basis')
  assert.equal(getLastKnownCmeBasis('DOW'), null)

  setCmeBasis('DOW', 48.4)
  assert.equal(getCmeBasis('DOW'), 48.4, 'fresh basis is reused as-is')
  assert.equal(applyCmeBasis(53262.6, getCmeBasis('DOW')), 53311)

  // Expired for the fast path, still the best shift available on a Yahoo outage
  assert.equal(getCmeBasis('DOW', 0), null, 'expired basis is not treated as fresh')
  assert.equal(getLastKnownCmeBasis('DOW'), 48.4)

  setCmeBasis('DOW', null)
  assert.equal(getCmeBasis('DOW'), 48.4, 'a failed derivation never clears the basis')
  setCmeBasis('DOW', Number.NaN)
  assert.equal(getCmeBasis('DOW'), 48.4, 'NaN never reaches the cache')

  // Instruments must not share a shift — NKD basis is nothing like MYM's
  assert.equal(getCmeBasis('NASDAQ'), null, 'basis is per instrument')
  setCmeBasis('NASDAQ', 73.05)
  assert.equal(getCmeBasis('DOW'), 48.4)
  assert.equal(getCmeBasis('NASDAQ'), 73.05)
}

console.log('cme_basis: ok')
