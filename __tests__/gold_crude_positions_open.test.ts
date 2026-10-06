import assert from 'node:assert'
import { POST as openPosition } from '../app/api/trading/positions/open/route'

async function run() {
  console.log('Positions and working limits cannot be placed...')

  const reqGold = new Request('http://localhost:3000/api/trading/positions/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrument: 'GOLD',
      entry_price: 4345.24,
      entry_direction: 'LONG',
      entry_window: 1,
    }),
  })

  const resGold = await openPosition(reqGold as any)
  assert.strictEqual(resGold.status, 403, `Open GOLD must be refused, got ${resGold.status}`)
  const jsonGold = await resGold.json()
  assert.strictEqual(jsonGold.success, false)
  assert.match(String(jsonGold.message), /does not place positions or working limits/i)

  const reqCrude = new Request('http://localhost:3000/api/trading/positions/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrument: 'CRUDE',
      entry_price: 78.5,
      entry_direction: 'SHORT',
      entry_window: 1,
    }),
  })
  const resCrude = await openPosition(reqCrude as any)
  assert.strictEqual(resCrude.status, 403, `Open CRUDE must be refused, got ${resCrude.status}`)
  const jsonCrude = await resCrude.json()
  assert.strictEqual(jsonCrude.success, false)

  console.log('gold_crude_positions_open: placement refused')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
