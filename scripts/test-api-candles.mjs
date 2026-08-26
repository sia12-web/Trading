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

// Set env vars on process.env
Object.assign(process.env, envVars)

import { getOandaCandles } from '../lib/oanda/candles.ts'

async function run() {
  console.log('Testing getOandaCandles directly...')
  console.log('OANDA_ACCOUNT_ID:', process.env.OANDA_ACCOUNT_ID)
  console.log('OANDA_API_KEY:', process.env.OANDA_API_KEY ? 'Present' : 'Missing')

  const res = await getOandaCandles('DOW', '5', 1)
  if (res && res.candles && res.candles.length > 0) {
    const last = res.candles[res.candles.length - 1]
    console.log('✅ OANDA DOW CANDLES WORKING!')
    console.log('Source:', res.source)
    console.log('Symbol:', res.symbol)
    console.log('Last candle close:', last.close)
    console.log('Last candle time:', new Date(last.time * 1000).toLocaleString())
  } else {
    console.log('❌ getOandaCandles returned NULL or empty!')
  }
}

run()
