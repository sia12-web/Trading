import assert from 'node:assert'
import { POST as openPosition } from '../app/api/trading/positions/open/route'
import { POST as closePosition } from '../app/api/trading/positions/close/route'
import { POST as updateBrackets } from '../app/api/trading/positions/update-brackets/route'

async function run() {
  console.log('Testing position open, close, and bracket update for GOLD & CRUDE...')

  // 1. Test Open LONG GOLD (same scenario as user: 4,345.24 with 1:1 SL/TP)
  const reqGold = new Request('http://localhost:3000/api/trading/positions/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrument: 'GOLD',
      entry_price: 4345.24,
      entry_direction: 'LONG',
      entry_window: 1,
      account_size: 50000,
      regime: 'bullish',
      regime_confidence: 90,
      entry_source: 'ai',
      is_leo_order: true,
      stop_loss_price: 4340.24,
      profit_target_price: 4350.24,
      entry_reason: 'Leo AI Order: LONG GOLD @ 4345.24. 1:1 risk-to-reward target',
      auction_ticket: true,
      risk_profile: 'tradeify_growth_50k',
    }),
  })

  const resGold = await openPosition(reqGold as any)
  assert.strictEqual(resGold.status, 201, `Open GOLD position must return HTTP 201, got ${resGold.status}`)
  const jsonGold = await resGold.json()
  assert.strictEqual(jsonGold.success, true, 'Position open must succeed')
  assert.ok(jsonGold.position_id, 'Position open must return a valid position_id')
  assert.strictEqual(jsonGold.instrument, 'GOLD', 'Instrument must match GOLD')
  assert.strictEqual(jsonGold.entry_direction, 'LONG', 'Direction must match LONG')
  console.log('✅ Open LONG GOLD succeeded with position ID:', jsonGold.position_id)

  // 2. Test Update Brackets for the opened GOLD position
  const reqUpdateBrackets = new Request('http://localhost:3000/api/trading/positions/update-brackets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position_id: jsonGold.position_id,
      stop_loss_price: 4342.0,
      profit_target_price: 4355.0,
    }),
  })
  const resUpdate = await updateBrackets(reqUpdateBrackets as any)
  assert.strictEqual(resUpdate.status, 200, `Bracket update must return HTTP 200, got ${resUpdate.status}`)
  const jsonUpdate = await resUpdate.json()
  assert.strictEqual(jsonUpdate.success, true, 'Bracket update must succeed')
  console.log('✅ Update brackets for GOLD position succeeded')

  // 3. Test Close GOLD position
  const reqClose = new Request('http://localhost:3000/api/trading/positions/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position_id: jsonGold.position_id,
      instrument: 'GOLD',
      exit_price: 4348.5,
      exit_reason: 'manual',
    }),
  })
  const resClose = await closePosition(reqClose as any)
  assert.strictEqual(resClose.status, 200, `Close position must return HTTP 200, got ${resClose.status}`)
  const jsonClose = await resClose.json()
  assert.strictEqual(jsonClose.success, true, 'Position close must succeed')
  console.log('✅ Close GOLD position succeeded')

  // 4. Test Open SHORT CRUDE
  const reqCrude = new Request('http://localhost:3000/api/trading/positions/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrument: 'CRUDE',
      entry_price: 78.5,
      entry_direction: 'SHORT',
      entry_window: 1,
      account_size: 50000,
      regime: 'bearish',
      regime_confidence: 88,
      entry_source: 'ai',
      is_leo_order: true,
      stop_loss_price: 79.1,
      profit_target_price: 77.9,
      entry_reason: 'Leo AI Order: SHORT CRUDE @ 78.50.',
      auction_ticket: true,
      risk_profile: 'tradeify_growth_50k',
    }),
  })

  const resCrude = await openPosition(reqCrude as any)
  assert.strictEqual(resCrude.status, 201, `Open CRUDE position must return HTTP 201, got ${resCrude.status}`)
  const jsonCrude = await resCrude.json()
  assert.strictEqual(jsonCrude.success, true, 'Position open must succeed for CRUDE')
  assert.ok(jsonCrude.position_id, 'Position open must return a valid position_id for CRUDE')
  console.log('✅ Open SHORT CRUDE succeeded with position ID:', jsonCrude.position_id)

  console.log('All assertions in gold_crude_positions_open.test.ts passed successfully!')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
