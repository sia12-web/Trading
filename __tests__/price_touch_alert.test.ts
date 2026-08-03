/**
 * Price touch alert helpers.
 * Run: npx tsx __tests__/price_touch_alert.test.ts
 */
import assert from 'node:assert/strict'
import {
  didPriceTouchAlert,
  formatPriceTouchAlert,
  hasPriceLeftAlert,
  PRICE_ALERT_AWAY_POINTS,
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

{
  // Arm-after-away: place at spot must not count as left
  assert.equal(
    hasPriceLeftAlert({ livePrice: 100, alertPrice: 100 }),
    false,
    'at alert → still pending'
  )
  assert.equal(
    hasPriceLeftAlert({
      livePrice: 100 + PRICE_ALERT_TOUCH_TOLERANCE,
      alertPrice: 100,
    }),
    false,
    'inside touch band → still pending'
  )
  assert.equal(
    hasPriceLeftAlert({
      livePrice: 100 + PRICE_ALERT_TOUCH_TOLERANCE + PRICE_ALERT_AWAY_POINTS,
      alertPrice: 100,
    }),
    false,
    'exactly at touch+away boundary is not yet away (strict >)'
  )
  assert.equal(
    hasPriceLeftAlert({
      livePrice: 100 + PRICE_ALERT_TOUCH_TOLERANCE + PRICE_ALERT_AWAY_POINTS + 1,
      alertPrice: 100,
    }),
    true,
    'cleared away gap → can arm'
  )
  assert.equal(
    hasPriceLeftAlert({ livePrice: 96, alertPrice: 100 }),
    true,
    'below away gap → can arm'
  )
  assert.equal(
    hasPriceLeftAlert({ livePrice: null, alertPrice: 100 }),
    false,
    'no live → stay pending'
  )
}

{
  // Full place → leave → return cycle (logic the chart effect uses)
  const alert = 40_000
  let pendingAway = true
  let armed = true
  // create at spot
  assert.equal(hasPriceLeftAlert({ livePrice: alert, alertPrice: alert }), false)
  assert.equal(
    didPriceTouchAlert({ prevPrice: alert, livePrice: alert, alertPrice: alert }),
    true,
    'would touch — but pendingAway must block fire'
  )
  // leave
  const awayPx = alert + PRICE_ALERT_TOUCH_TOLERANCE + PRICE_ALERT_AWAY_POINTS + 1
  assert.equal(hasPriceLeftAlert({ livePrice: awayPx, alertPrice: alert }), true)
  pendingAway = false
  // return / cross
  assert.equal(
    didPriceTouchAlert({
      prevPrice: awayPx,
      livePrice: alert,
      alertPrice: alert,
    }),
    true,
    're-touch after leave fires'
  )
  armed = false
  assert.equal(pendingAway, false)
  assert.equal(armed, false)
}

const msg = formatPriceTouchAlert({
  instrument: 'NASDAQ',
  alertPrice: 27600,
  livePrice: 27601,
})
assert.match(msg.title, /NASDAQ/)
assert.match(msg.telegram, /Soft signal/)

console.log('price_touch_alert: all passed')
