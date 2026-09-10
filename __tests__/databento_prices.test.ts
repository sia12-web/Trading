/**
 * Databento CME price parsing + archive/live merge.
 * Run: npx tsx __tests__/databento_prices.test.ts
 */

import assert from 'node:assert/strict'
import {
  databentoHistoricalAuthHeader,
  mergeCandleSeries,
  parseDatabentoPx,
  parseDatabentoTs,
} from '../lib/databento/client'

{
  // Historical auth: Basic base64("db-key:") — empty password (Databento hist docs).
  // Live Raw uses TCP CRAM instead; there is no Databento webhook.
  const header = databentoHistoricalAuthHeader('db-testkey')
  assert.equal(header, `Basic ${Buffer.from('db-testkey:').toString('base64')}`)
  assert.equal(
    databentoHistoricalAuthHeader('  db-trim  '),
    `Basic ${Buffer.from('db-trim:').toString('base64')}`,
    'trims whitespace around key'
  )
}

{
  assert.equal(parseDatabentoPx(4470.5), 4470.5, 'already-decimal gold')
  assert.equal(parseDatabentoPx('4470.5'), 4470.5, 'decimal string gold')
  assert.equal(parseDatabentoPx(4470500000000), 4470.5, '1e-9 nanounits gold')
  assert.equal(parseDatabentoPx(53317000000000), 53317, '1e-9 nanounits MYM')
  assert.equal(parseDatabentoPx(92.08), 92.08, 'already-decimal crude')
  assert.ok(Number.isNaN(parseDatabentoPx(0)))
}

{
  const ns = 1788738900 * 1e9
  assert.equal(parseDatabentoTs(ns), 1788738900, 'nanosecond ts_event')
  assert.equal(parseDatabentoTs(1788738900000), 1788738900, 'millisecond ts_event')
  assert.equal(parseDatabentoTs(1788738900), 1788738900, 'second ts_event')
}

{
  const archive = [
    { time: 100, open: 4470, high: 4471, low: 4469, close: 4470, volume: 10 },
    { time: 400, open: 4470, high: 4472, low: 4468, close: 4469, volume: 8 },
  ]
  const live = [
    { time: 400, open: 4400, high: 4402, low: 4398, close: 4401, volume: 12 },
    { time: 700, open: 4401, high: 4405, low: 4400, close: 4404, volume: 9 },
  ]
  const merged = mergeCandleSeries(live, archive)
  assert.equal(merged.length, 3)
  assert.equal(merged[0]!.close, 4470, 'archive fills the hole before live')
  assert.equal(merged[1]!.close, 4401, 'live API wins on overlap')
  assert.equal(merged[2]!.close, 4404, 'live extends past archive')
}

console.log('databento_prices.test.ts: all passed')
