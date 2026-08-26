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

import { getOandaAccountSummary } from '../lib/oanda/orders.ts'

async function run() {
  console.log('Testing Live OANDA Account Summary...')
  console.log('OANDA_ENVIRONMENT:', process.env.OANDA_ENVIRONMENT)
  console.log('OANDA_ACCOUNT_ID:', process.env.OANDA_ACCOUNT_ID)

  const summary = await getOandaAccountSummary()
  console.log('Result:', JSON.stringify(summary, null, 2))
}

run()
