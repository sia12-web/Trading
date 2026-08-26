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

const apiKey = envVars.OANDA_API_KEY
const accountId = envVars.OANDA_ACCOUNT_ID

async function testCandles(envLabel, baseUrl) {
  console.log(`\nTesting OANDA Candles (${envLabel} -> ${baseUrl})...`)
  const url = `${baseUrl}/v3/instruments/US30_USD/candles?granularity=M5&count=5`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
    console.log('HTTP Status:', res.status)
    const text = await res.text()
    if (res.ok) {
      const json = JSON.parse(text)
      const last = json.candles?.[json.candles.length - 1]
      console.log('✅ OANDA US30_USD Last Candle:', last?.mid)
    } else {
      console.log('Response:', text.slice(0, 200))
    }
  } catch (err) {
    console.error('Error:', err.message)
  }
}

async function run() {
  await testCandles('Practice', 'https://api-fxpractice.oanda.com')
  await testCandles('Live', 'https://api-fxtrade.oanda.com')
}

run()
