/**
 * Break-even stop amend payload / safety helpers.
 * Run: npx tsx __tests__/break_even_stop.test.ts
 */
import assert from 'node:assert/strict'
import {
  breakEvenShouldOffer,
  breakEvenStopPrice,
  breakEvenTpProgressThreshold,
  livePriceConfirmsStopHit,
  stopSafeVersusMarket,
  tradeTpProgress,
} from '../lib/trading/breakEvenStop'

{
  const be = breakEvenStopPrice('NIKKEI', 63299, 'LONG')
  assert.equal(be, 63298, `LONG BE must be 1 tick below entry, got ${be}`)
  assert.notEqual(be, 63299, 'must never equal entry (false client stop-hit)')
}

{
  const be = breakEvenStopPrice('DOW', 52191.3, 'LONG')
  assert.equal(be, 52190, `DOW LONG BE snaps below entry, got ${be}`)
}

{
  const be = breakEvenStopPrice('NASDAQ', 21000, 'SHORT')
  assert.equal(be, 21001, `SHORT BE must be 1 tick above entry, got ${be}`)
}

{
  // Live NIKKEI incident: BE claimed stop @ entry while mid still +426
  assert.equal(
    livePriceConfirmsStopHit({
      currentPrice: 63725,
      stopLoss: 63299,
      isLong: true,
    }),
    false,
    'must refuse stop-hit close while mid is far above stop'
  )
  assert.equal(
    livePriceConfirmsStopHit({
      currentPrice: 63298,
      stopLoss: 63298,
      isLong: true,
    }),
    true,
    'touch at BE stop is a real stop'
  )
}

{
  assert.equal(
    stopSafeVersusMarket({ stop: 63298, currentPrice: 63725, isLong: true }),
    true,
    'BE stop safe while in profit'
  )
  assert.equal(
    stopSafeVersusMarket({ stop: 63724, currentPrice: 63725, isLong: true, pad: 2 }),
    false,
    'stop through/near market refused'
  )
}

// Simulated auto-manage BE confirm payload shape
{
  const entry = 50000
  const instrument = 'DOW'
  const direction = 'LONG' as const
  const bePrice = breakEvenStopPrice(instrument, entry, direction)
  const payload = {
    position_id: 'test',
    confirm_action: 'CONFIRM' as const,
    action_type: 'BREAKEVEN' as const,
    updated_stop_loss: bePrice,
  }
  assert.equal(payload.action_type, 'BREAKEVEN')
  assert.equal(payload.updated_stop_loss, 49999)
  assert.ok(payload.updated_stop_loss < entry)
}

{
  assert.equal(breakEvenTpProgressThreshold('NASDAQ'), 0.5)
  const shot = {
    entry: 29593,
    takeProfit: 29438,
    livePrice: 29593,
    isLong: false,
  }
  const zero = tradeTpProgress(shot)
  assert.equal(zero.progress, 0, 'at fill →TP is 0%')
  assert.equal(zero.inProfit, false)
  assert.equal(
    breakEvenShouldOffer({ instrument: 'NASDAQ', ...shot }),
    false,
    'must not offer BE at 0% TP'
  )
  const halfLive = 29593 - (29593 - 29438) * 0.5
  assert.equal(
    breakEvenShouldOffer({
      instrument: 'NASDAQ',
      entry: 29593,
      takeProfit: 29438,
      livePrice: halfLive,
      isLong: false,
    }),
    true,
    'BE only after 50% toward TP on NASDAQ'
  )
}

console.log('break_even_stop: ok')
