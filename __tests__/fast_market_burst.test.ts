import test from 'node:test'
import assert from 'node:assert/strict'
import {
  liveTipDisagreesWithBook,
  liveQuoteDisagreesWithReference,
  isPlausibleRealtimeTick,
  applyTickToFormingBar,
  mergeHistoryWithLiveTip,
  MAX_DISAGREEMENT_PTS,
} from '../lib/chart/liveFormingBar'

test('fast market surges do not trigger false-positive book disagreement', () => {
  // Wednesday 10:30 AM NY (14:30 UTC) during active cash market hours
  const t0 = 1791988200

  // 1. NASDAQ surges 300 points in 15 seconds (e.g. CPI / FOMC / tech earnings breakout)
  // Yahoo book is 21,500; Databento CME print is 21,800 (+300 pts)
  assert.equal(
    liveTipDisagreesWithBook(21_800, 21_500, 'NASDAQ'),
    false,
    'NASDAQ +300 pts surge within single minute must not trigger book disagreement'
  )
  assert.equal(
    liveQuoteDisagreesWithReference(21_800, t0 + 15, 21_500, t0, 'NASDAQ'),
    false,
    'Fast-market NASDAQ quote must be served to stream without veto'
  )

  // 2. DOW surges 500 points in 30 seconds
  assert.equal(
    liveTipDisagreesWithBook(44_500, 44_000, 'DOW'),
    false,
    'DOW +500 pts surge must not trigger book disagreement'
  )
  assert.equal(
    liveQuoteDisagreesWithReference(44_500, t0 + 30, 44_000, t0, 'DOW'),
    false,
    'Fast-market DOW quote must be served to stream without veto'
  )

  // 3. GOLD surges 35 points in 10 seconds
  assert.equal(
    liveTipDisagreesWithBook(2_735, 2_700, 'GOLD'),
    false,
    'GOLD +35 pts surge must not trigger book disagreement'
  )

  // 4. CRUDE surges 1.80 points in 15 seconds
  assert.equal(
    liveTipDisagreesWithBook(73.8, 72.0, 'CRUDE'),
    false,
    'CRUDE +1.80 pts surge must not trigger book disagreement'
  )
})

test('calendar roll and wrong-contract scale mismatches are strictly rejected', () => {
  const t0 = 1791988200

  // 1. CME Crude front-month roll mismatch (CLV6 ~97.44 vs CLX6 ~93.51 = 3.93 pts)
  assert.equal(
    liveTipDisagreesWithBook(97.44, 93.51, 'CRUDE'),
    true,
    'Crude 3.93 pt calendar roll difference must be rejected'
  )
  assert.equal(
    liveQuoteDisagreesWithReference(97.44, t0 + 30, 93.51, t0, 'CRUDE'),
    true,
    'Crude roll mismatch must be rejected'
  )

  // 2. NASDAQ gross scale blip (> 600 pts)
  assert.equal(
    liveTipDisagreesWithBook(22_200, 21_500, 'NASDAQ'),
    true,
    'NASDAQ 700 pt scale mismatch must be rejected'
  )

  // 3. DOW gross scale blip (> 1200 pts)
  assert.equal(
    liveTipDisagreesWithBook(45_500, 44_000, 'DOW'),
    true,
    'DOW 1500 pt scale mismatch must be rejected'
  )
})

test('fast market ticks are strictly plausible for trusted exchange prints', () => {
  // Trusted exchange allows fast institutional price discovery up to LIVE_MAX_TIP_JUMP_PCT (8%)
  const lastClose = 21_500
  // Fast jump of +200 points on NASDAQ (0.93%)
  assert.equal(
    isPlausibleRealtimeTick(lastClose, 21_700, 'NASDAQ', true),
    true,
    'Trusted CME Globex tick +200 pts must be plausible'
  )

  // Fast jump of +500 points on NASDAQ (2.3%)
  assert.equal(
    isPlausibleRealtimeTick(lastClose, 22_000, 'NASDAQ', true),
    true,
    'Trusted CME Globex tick +500 pts must be plausible'
  )

  // Impossible 15% jump (e.g. 21,500 -> 25,000) is rejected even for exchange
  assert.equal(
    isPlausibleRealtimeTick(lastClose, 25_000, 'NASDAQ', true),
    false,
    'Impossible 15% jump must be rejected'
  )
})

test('forming bar absorbs 100 fast-market burst ticks without dropping extremes', () => {
  const t0 = 1791988200
  let forming = {
    time: t0,
    open: 21_500,
    high: 21_500,
    low: 21_500,
    close: 21_500,
    volume: 0,
  }

  // Simulate 100 fast ticks within the same 1m bucket (t0 + 1 to t0 + 50)
  // Volatility wave: surges to 21,650, drops to 21,420, settles at 21,610
  for (let i = 1; i <= 100; i++) {
    const elapsedSec = i * 0.5 // up to 50 seconds
    const quoteUnix = t0 + Math.floor(elapsedSec)
    // Oscillating burst price
    const price = 21_500 + Math.sin(i / 10) * 120 + (i / 100) * 110
    const step = applyTickToFormingBar(
      forming,
      price,
      quoteUnix,
      60, // 1m timeframe
      'NASDAQ',
      true, // trustedExchange = true
      false,
      0.5
    )
    assert.equal(step.rolled, false)
    forming = step.last
  }

  // Bar must have captured the highest peak and lowest dip of the burst
  assert.ok(forming.high >= 21_600, `High ${forming.high} must capture the surge peak`)
  assert.ok(forming.low <= 21_450, `Low ${forming.low} must capture the dip`)
  assert.equal(forming.open, 21_500, 'Open must remain initial print')
  assert.ok(forming.close > 21_500, 'Close must reflect the final print')
})

test('fast price move rolling to new bucket generates zero gaps', () => {
  const t0 = 1791988200
  const barSec = 60 // 1m bars
  const initial = {
    time: t0,
    open: 21_500,
    high: 21_540,
    low: 21_490,
    close: 21_530,
    volume: 10,
  }

  // Price runs fast and next tick arrives at t0 + 180s (skipped 2 minutes: t0+60 and t0+120)
  const surgePrice = 21_680
  const step = applyTickToFormingBar(
    initial,
    surgePrice,
    t0 + 180,
    barSec,
    'NASDAQ',
    true,
    false,
    180
  )

  assert.equal(step.rolled, true)
  assert.equal(step.last.time, t0 + 180)
  assert.equal(step.last.close, surgePrice)

  // Must have generated gap fill bars for t0 + 60 and t0 + 120 so there is no gap in bar printing
  assert.equal(step.gapFills.length, 2)
  assert.equal(step.gapFills[0]!.time, t0 + 60)
  assert.equal(step.gapFills[1]!.time, t0 + 120)
  assert.equal(step.gapFills[0]!.close, initial.close)
  assert.equal(step.gapFills[1]!.close, initial.close)
})

test('mergeHistoryWithLiveTip bridges intermediate bars when live is ahead of REST', () => {
  const t0 = 1791988200
  const history = [
    { time: t0, open: 21_500, high: 21_520, low: 21_490, close: 21_510, volume: 100 },
  ]
  // Live is at t0 + 120 (1m bar, 2 steps ahead of REST history at t0)
  const live = {
    time: t0 + 120,
    open: 21_510,
    high: 21_580,
    low: 21_505,
    close: 21_575,
    volume: 50,
  }

  const merged = mergeHistoryWithLiveTip(history, live, '1m', 'NASDAQ')
  // Must contain t0, t0 + 60 (bridged intermediate), and t0 + 120 (live)
  assert.equal(merged.length, 3, 'Must contain 3 continuous 1m bars with zero gaps')
  assert.equal(merged[0]!.time, t0)
  assert.equal(merged[1]!.time, t0 + 60)
  assert.equal(merged[2]!.time, t0 + 120)
  assert.equal(merged[1]!.close, history[0]!.close)
  assert.equal(merged[2]!.close, live.close)
})
