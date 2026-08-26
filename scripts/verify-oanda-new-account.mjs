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
const accountId = envVars.OANDA_ACCOUNT_ID || '001-002-17823794-001'

console.log('Testing OANDA Live vs Practice for Account ID:', accountId)

async function testEndpoint(label, baseUrl) {
  console.log(`\n--- Testing ${label} (${baseUrl}) ---`)
  try {
    const res = await fetch(`${baseUrl}/v3/accounts/${accountId}/summary`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    const text = await res.text()
    console.log('HTTP Status:', res.status)

    if (res.ok) {
      const data = JSON.parse(text)
      const acc = data.account
      console.log('✅ SUCCESS!')
      console.log('ID:', acc.id)
      console.log('Currency:', acc.currency)
      console.log('Balance:', acc.balance)
      console.log('NAV:', acc.NAV)
      console.log('Margin Available:', acc.marginAvailable)
      console.log('Margin Used:', acc.marginUsed)
      console.log('Margin Rate:', acc.marginRate)
      return true
    } else {
      console.log('Response:', text)
      return false
    }
  } catch (err) {
    console.error('Error:', err)
    return false
  }
}

async function run() {
  const liveOk = await testEndpoint('Live (api-fxtrade.oanda.com)', 'https://api-fxtrade.oanda.com')
  const practiceOk = await testEndpoint('Practice (api-fxpractice.oanda.com)', 'https://api-fxpractice.oanda.com')
  console.log('\nResult -> Live:', liveOk ? 'OK' : 'Failed', '| Practice:', practiceOk ? 'OK' : 'Failed')
}

run()
