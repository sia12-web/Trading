/**
 * Verify OANDA account + place & close a 1-unit smoke order on practice.
 * Usage: node scripts/verify-oanda.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    let v = line.slice(i + 1).trim()
    if (!v.startsWith('"') && !v.startsWith("'") && v.includes(' #')) {
      v = v.split(' #')[0].trim()
    }
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[line.slice(0, i).trim()] = v
  }
}

loadEnvLocal()

const key = process.env.OANDA_API_KEY
const accountId = process.env.OANDA_ACCOUNT_ID
const env = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase()
const base =
  env === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com'

if (!key || !accountId) {
  console.error('Missing OANDA_API_KEY or OANDA_ACCOUNT_ID')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

async function main() {
  console.log('Account:', accountId)
  console.log('Base:', base)

  const summaryRes = await fetch(`${base}/v3/accounts/${accountId}/summary`, { headers })
  const summaryText = await summaryRes.text()
  if (!summaryRes.ok) {
    console.error('SUMMARY FAILED', summaryRes.status, summaryText.slice(0, 500))
    process.exit(1)
  }
  const summary = JSON.parse(summaryText)
  const a = summary.account
  console.log('OK summary', {
    id: a.id,
    currency: a.currency,
    balance: a.balance,
    NAV: a.NAV,
    openTradeCount: a.openTradeCount,
    marginAvailable: a.marginAvailable,
  })

  if (a.id !== accountId) {
    console.error('Account id mismatch', a.id, accountId)
    process.exit(1)
  }

  const instRes = await fetch(
    `${base}/v3/accounts/${accountId}/instruments?instruments=US30_USD,NAS100_USD`,
    { headers }
  )
  const instJson = await instRes.json()
  if (!instRes.ok) {
    console.error('INSTRUMENTS FAILED', instRes.status, instJson)
    process.exit(1)
  }
  console.log(
    'Instruments:',
    (instJson.instruments || []).map((i) => ({
      name: i.name,
      type: i.type,
      displayPrecision: i.displayPrecision,
      tradeUnitsPrecision: i.tradeUnitsPrecision,
    }))
  )

  // Smoke: market buy 1 unit US30 with far SL, then close
  const pricing = await fetch(
    `${base}/v3/accounts/${accountId}/pricing?instruments=US30_USD`,
    { headers }
  )
  const pricingJson = await pricing.json()
  const bid = Number(pricingJson?.prices?.[0]?.bids?.[0]?.price)
  const ask = Number(pricingJson?.prices?.[0]?.asks?.[0]?.price)
  console.log('US30 pricing', { bid, ask })
  if (!Number.isFinite(ask) || ask <= 0) {
    console.error('No US30 price — market may be closed; account auth still OK')
    process.exit(0)
  }

  const sl = (ask * 0.97).toFixed(1)
  const orderBody = {
    order: {
      type: 'MARKET',
      instrument: 'US30_USD',
      units: '1',
      timeInForce: 'FOK',
      positionFill: 'DEFAULT',
      stopLossOnFill: { price: sl, timeInForce: 'GTC' },
    },
  }

  console.log('Placing smoke market order (1 unit US30)...')
  const orderRes = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(orderBody),
  })
  const orderText = await orderRes.text()
  let orderJson
  try {
    orderJson = JSON.parse(orderText)
  } catch {
    orderJson = { raw: orderText }
  }

  if (!orderRes.ok) {
    console.error('ORDER FAILED', orderRes.status, orderText.slice(0, 800))
    process.exit(1)
  }

  const tradeId =
    orderJson?.orderFillTransaction?.tradeOpened?.tradeID ||
    orderJson?.orderFillTransaction?.id
  const fillPrice = orderJson?.orderFillTransaction?.price
  console.log('ORDER FILLED', { tradeId, fillPrice, lastTx: orderJson?.lastTransactionID })

  if (!tradeId) {
    console.error('No trade id in fill response')
    process.exit(1)
  }

  console.log('Closing smoke trade...')
  const closeRes = await fetch(`${base}/v3/accounts/${accountId}/trades/${tradeId}/close`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({}),
  })
  const closeText = await closeRes.text()
  if (!closeRes.ok) {
    console.error('CLOSE FAILED', closeRes.status, closeText.slice(0, 800))
    process.exit(1)
  }
  console.log('CLOSE OK', closeText.slice(0, 300))
  console.log('\n✅ Account', accountId, 'can authenticate, place, and close orders.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
