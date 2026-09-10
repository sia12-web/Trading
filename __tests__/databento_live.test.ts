/**
 * Databento Live CRAM + trade tip parsing.
 * Run: npx tsx __tests__/databento_live.test.ts
 */

import assert from 'node:assert/strict'
import {
  databentoLiveAuthControlLine,
  databentoLiveCramAuth,
  databentoLiveGatewayHost,
  DATABENTO_LIVE_PORT,
} from '../lib/databento/liveCram'
import {
  __handleDatabentoLiveJsonForTest,
  __mapDatabentoInstrumentForTest,
  __resetDatabentoLiveHubForTest,
  getLastDatabentoLivePrice,
} from '../lib/databento/liveHub'

{
  // Official Databento docs example
  const key = 'db-89s9vCvwDDKPdQJ5Pb30Fyj9mNUM6'
  const cram = 'j5pwMHz6vwXruJM4cOwQrQeQE0bImIzT'
  assert.equal(
    databentoLiveCramAuth(cram, key),
    '6d3c875bb9f8cf503c3ed83ee5f476a3ad53f0c67706c51cf42d2db5ad8ff5a9-mNUM6'
  )
  assert.equal(databentoLiveGatewayHost('GLBX.MDP3'), 'glbx-mdp3.lsg.databento.com')
  assert.equal(DATABENTO_LIVE_PORT, 13000)
  const line = databentoLiveAuthControlLine(databentoLiveCramAuth(cram, key), 'GLBX.MDP3')
  assert.match(line, /^auth=.+-mNUM6\|dataset=GLBX\.MDP3\|encoding=json/)
  assert.match(line, /pretty_px=1/)
  assert.ok(line.endsWith('\n'))
}

{
  __resetDatabentoLiveHubForTest()
  __handleDatabentoLiveJsonForTest(
    JSON.stringify({
      stype_in_symbol: 'MYM.c.0',
      stype_out_symbol: 'MYMH6',
      instrument_id: 42001,
    })
  )
  __handleDatabentoLiveJsonForTest(
    JSON.stringify({
      hd: { ts_event: 1_700_000_000 * 1e9, instrument_id: 42001 },
      price: '44912.5',
      size: 1,
      side: 'A',
      action: 'T',
    })
  )
  const q = getLastDatabentoLivePrice('DOW', 60_000)
  assert.ok(q)
  assert.equal(q!.instrument, 'DOW')
  assert.equal(q!.price, 44912.5)
  assert.equal(q!.source, 'databento')
}

{
  __resetDatabentoLiveHubForTest()
  __mapDatabentoInstrumentForTest(7, 'GOLD')
  __handleDatabentoLiveJsonForTest(
    JSON.stringify({
      instrument_id: 7,
      price: 2650.4,
      size: 2,
      side: 'B',
      ts_event: 1_700_000_100,
    })
  )
  const q = getLastDatabentoLivePrice('GOLD', 60_000)
  assert.ok(q)
  assert.equal(q!.price, 2650.4)
}

console.log('databento_live.test.ts: all passed')
