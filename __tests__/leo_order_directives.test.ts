import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLeoDirectives } from '../lib/ai/leoAssistant.ts'

test('parseLeoDirectives - PLACE_ORDER directive', () => {
  const text = `
Roger that! Placing LONG order on NASDAQ at 21,500.00.
Stop Loss: 21,475.00, Take Profit: 21,550.00.

<execute>
{
  "action": "PLACE_ORDER",
  "instrument": "NASDAQ",
  "direction": "LONG",
  "price": 21500,
  "stopLoss": 21475,
  "profitTarget": 21550,
  "size": 1,
  "reason": "Trader command: Buy NASDAQ at market"
}
</execute>
`
  const directives = parseLeoDirectives(text)
  assert.equal(directives.length, 1)
  const d = directives[0] as any
  assert.equal(d.action, 'PLACE_ORDER')
  assert.equal(d.instrument, 'NASDAQ')
  assert.equal(d.direction, 'LONG')
  assert.equal(d.price, 21500)
  assert.equal(d.stopLoss, 21475)
  assert.equal(d.profitTarget, 21550)
  assert.equal(d.size, 1)
})

test('parseLeoDirectives - OPEN_POSITION directive (alias)', () => {
  const text = `
Executing trade:
<execute>
{
  "action": "OPEN_POSITION",
  "instrument": "DOW",
  "direction": "SHORT",
  "price": 39800,
  "stopLoss": 39860,
  "profitTarget": 39680,
  "reason": "Trader sell command"
}
</execute>
`
  const directives = parseLeoDirectives(text)
  assert.equal(directives.length, 1)
  const d = directives[0] as any
  assert.equal(d.action, 'OPEN_POSITION')
  assert.equal(d.instrument, 'DOW')
  assert.equal(d.direction, 'SHORT')
  assert.equal(d.price, 39800)
})

test('parseLeoDirectives - CLOSE_POSITION directive', () => {
  const text = `
Flattening position immediately.
<execute>
{
  "action": "CLOSE_POSITION",
  "reason": "Trader voice command: Close position"
}
</execute>
`
  const directives = parseLeoDirectives(text)
  assert.equal(directives.length, 1)
  assert.equal(directives[0]?.action, 'CLOSE_POSITION')
})
