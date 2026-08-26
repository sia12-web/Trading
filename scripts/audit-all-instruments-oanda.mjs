import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
      envVars[key] = val
    }
  }
})

Object.assign(process.env, envVars)

import { getOandaPrice } from '../lib/oanda/pricing.ts'
import { getOandaCandles } from '../lib/oanda/candles.ts'

const instruments = ['DOW', 'NASDAQ', 'NIKKEI']

async function audit() {
  console.log('==================================================')
  console.log(' AUDITING OANDA LIVE PRICE FEEDS FOR ALL INSTRUMENTS')
  console.log(' Account ID:', process.env.OANDA_ACCOUNT_ID)
  console.log('==================================================\n')

  for (const inst of instruments) {
    console.log(`--- Auditing ${inst} ---`)
    try {
      const priceQuote = await getOandaPrice(inst)
      if (priceQuote && priceQuote.price > 0) {
        console.log(`  [Quote] ${inst} (${priceQuote.symbol}): Mid=${priceQuote.price}, Bid=${priceQuote.bid}, Ask=${priceQuote.ask}`)
      } else {
        console.error(`  ❌ [Quote Error] Failed to get live OANDA quote for ${inst}`)
      }

      const candleRes = await getOandaCandles(inst, '5', 1)
      if (candleRes && candleRes.candles && candleRes.candles.length > 0) {
        const last = candleRes.candles[candleRes.candles.length - 1]
        console.log(`  [Candles] ${inst} (${candleRes.symbol}): ${candleRes.candles.length} bars fetched. Last Close = ${last.close} at ${new Date(last.time * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`)
      } else {
        console.error(`  ❌ [Candle Error] Failed to get live OANDA candles for ${inst}`)
      }
    } catch (err) {
      console.error(`  ❌ Error testing ${inst}:`, err)
    }
    console.log('')
  }

  console.log('==================================================')
  console.log(' AUDIT COMPLETE')
  console.log('==================================================')
}

audit()
