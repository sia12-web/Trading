/**
 * News AI system prompt and live quote integration unit tests.
 * Run: npx tsx __tests__/news_ai.test.ts
 */

import assert from 'node:assert/strict'
import { getYahooQuote } from '../lib/yahoo/quote'

async function testNewsAiQuotes() {
  const [dow, nq, gold, crude] = await Promise.all([
    getYahooQuote('DOW'),
    getYahooQuote('NASDAQ'),
    getYahooQuote('GOLD'),
    getYahooQuote('CRUDE'),
  ])

  // Verify all 4 CME instruments return non-null quotes with prices > 0
  assert.ok(dow && dow.price > 30000, `DOW price must be reasonable (>30k), got ${dow?.price}`)
  assert.ok(nq && nq.price > 15000, `NASDAQ price must be reasonable (>15k), got ${nq?.price}`)
  assert.ok(gold && gold.price > 2000, `GOLD price must be reasonable (>2k), got ${gold?.price}`)
  assert.ok(crude && crude.price > 40, `CRUDE price must be reasonable (>40), got ${crude?.price}`)

  console.log('news_ai quote verification: all 4 CME live quotes valid!')
  console.log(`DOW (MYM): ${dow.price}`)
  console.log(`NASDAQ (MNQ): ${nq.price}`)
  console.log(`GOLD (MGC): $${gold.price}`)
  console.log(`CRUDE (CL): $${crude.price}`)
}

void testNewsAiQuotes().catch((err) => {
  console.error('news_ai test failed:', err)
  process.exit(1)
})
