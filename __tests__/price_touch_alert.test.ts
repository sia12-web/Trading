/**
 * Price touch alert helpers.
 * Run: npx tsx __tests__/price_touch_alert.test.ts
 */
import assert from 'node:assert/strict'
import {
  didPriceTouchAlert,
  formatPriceTouchAlert,
  PRICE_ALERT_TOUCH_TOLERANCE,
} from '../lib/trading/priceTouchAlert'

assert.equal(
  didPriceTouchAlert({ prevPrice: null, livePrice: 100, alertPrice: 100 }),
  false,
  'no prev → no fire'
)
assert.equal(
  didPriceTouchAlert({ prevPrice: 99, livePrice: 100, alertPrice: 100 }),
  true,
  'cross up onto alert'
)
assert.equal(
  didPriceTouchAlert({ prevPrice: 101, livePrice: 99, alertPrice: 100 }),
  true,
  'cross down through alert'
)
assert.equal(
  didPriceTouchAlert({ prevPrice: 105, livePrice: 104, alertPrice: 100 }),
  false,
  'still above, no touch'
)
assert.equal(
  didPriceTouchAlert({
    prevPrice: 100 + PRICE_ALERT_TOUCH_TOLERANCE + 1,
    livePrice: 100 + PRICE_ALERT_TOUCH_TOLERANCE,
    alertPrice: 100,
  }),
  true,
  'enter tolerance band'
)
assert.equal(
  didPriceTouchAlert({ prevPrice: 90, livePrice: 91, alertPrice: 100 }),
  false,
  'still below'
)

const msg = formatPriceTouchAlert({
  instrument: 'NASDAQ',
  alertPrice: 27600,
  livePrice: 27601,
})
assert.match(msg.title, /NASDAQ/)
assert.match(msg.telegram, /Soft signal/)

console.log('price_touch_alert: all passed')
