import test from 'node:test'
import assert from 'node:assert/strict'
import { getActiveCmeClContract, getActiveCmeGoldContract, getDatabentoActiveSymbol } from '../lib/databento/client'
import { liveTipDisagreesWithBook } from '../lib/chart/liveFormingBar'

test('WTI follows the volume front month, not calendar CL.c.0', () => {
  // Sep 21 2026 14:00 NY — October last trade is Sep 22; volume already on November.
  assert.equal(getActiveCmeClContract(new Date('2026-09-21T18:00:00Z')), 'CLX6')
  // Before the October volume roll (5 business days before last trade ≈ Sep 15).
  assert.equal(getActiveCmeClContract(new Date('2026-09-08T18:00:00Z')), 'CLV6')
  const crude = getDatabentoActiveSymbol('CRUDE', new Date('2026-09-21T18:00:00Z'))
  assert.equal(crude.symbol, 'CLX6')
  assert.equal(crude.stype_in, 'raw_symbol')
})

test('Gold follows the volume front month, not calendar MGC.c.0', () => {
  // Sep 21 2026 — October FND is Sep 30; volume already on December MGC=F / GC=F.
  assert.equal(getActiveCmeGoldContract(new Date('2026-09-21T18:00:00Z')), 'MGCZ6')
  // Before the October volume roll (10 business days before FND ≈ Sep 16).
  assert.equal(getActiveCmeGoldContract(new Date('2026-09-08T18:00:00Z')), 'MGCV6')
  const gold = getDatabentoActiveSymbol('GOLD', new Date('2026-09-21T18:00:00Z'))
  assert.equal(gold.symbol, 'MGCZ6')
  assert.equal(gold.stype_in, 'raw_symbol')
})

test('live overlay rejects calendar-front Crude vs CL=F book', () => {
  assert.equal(liveTipDisagreesWithBook(97.44, 93.51, 'CRUDE'), true)
  assert.equal(liveTipDisagreesWithBook(93.41, 93.51, 'CRUDE'), false)
  assert.equal(liveTipDisagreesWithBook(4648, 4647.5, 'DOW'), false)
})
