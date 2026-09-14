import assert from 'node:assert'
import { GET as getJournal } from '../app/api/trading/journal/route'
import { GET as getSimJournal } from '../app/api/trading/sim-journal/route'

async function run() {
  // Test live journal GET
  const req1 = new Request('http://localhost:3000/api/trading/journal?days=30&limit=120')
  const res1 = await getJournal(req1 as any)
  assert.strictEqual(res1.status, 200, `Live journal should return HTTP 200, got ${res1.status}`)
  const json1 = await res1.json()
  assert.strictEqual(json1.success, true, 'Live journal response must have success: true')
  assert.ok(Array.isArray(json1.entries), 'Live journal must return entries array')
  assert.ok(json1.summary != null, 'Live journal must return summary object')

  // Test live journal with instrument filter
  const req2 = new Request('http://localhost:3000/api/trading/journal?days=7&instrument=DOW')
  const res2 = await getJournal(req2 as any)
  assert.strictEqual(res2.status, 200, `Filtered journal should return HTTP 200, got ${res2.status}`)
  const json2 = await res2.json()
  assert.strictEqual(json2.success, true)

  // Test sim journal GET
  const reqSim = new Request('http://localhost:3000/api/trading/sim-journal?days=30')
  const resSim = await getSimJournal(reqSim as any)
  assert.strictEqual(resSim.status, 200, `Sim journal should return HTTP 200, got ${resSim.status}`)
  const jsonSim = await resSim.json()
  assert.strictEqual(jsonSim.success, true, 'Sim journal response must have success: true')
  assert.ok(Array.isArray(jsonSim.entries), 'Sim journal must return entries array')

  console.log('journal_api_resilience.test.ts: all assertions passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
