import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  let v = line.slice(i + 1).trim()
  if (!v.startsWith('"') && !v.startsWith("'") && v.includes(' #')) {
    v = v.split(' #')[0].trim()
  }
  process.env[line.slice(0, i).trim()] = v
}

const key = process.env.OANDA_API_KEY
const base = 'https://api-fxpractice.oanda.com'
const headers = {
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'Accept-Datetime-Format': 'RFC3339',
}

async function tryAccount(id) {
  console.log('\n====', id, '====')
  const s = await fetch(`${base}/v3/accounts/${id}/summary`, { headers })
  console.log('summary', s.status)
  if (!s.ok) {
    console.log(await s.text())
    return
  }
  const summary = await s.json()
  console.log({
    id: summary.account.id,
    balance: summary.account.balance,
    currency: summary.account.currency,
    openTradeCount: summary.account.openTradeCount,
  })

  const pricing = await fetch(`${base}/v3/accounts/${id}/pricing?instruments=US30_USD`, {
    headers,
  })
  const pj = await pricing.json()
  const ask = Number(pj?.prices?.[0]?.asks?.[0]?.price)
  console.log('pricing', pricing.status, { ask })
  if (!ask) return

  const orderRes = await fetch(`${base}/v3/accounts/${id}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      order: {
        type: 'MARKET',
        instrument: 'US30_USD',
        units: '1',
        timeInForce: 'FOK',
        positionFill: 'DEFAULT',
        stopLossOnFill: { price: (ask * 0.97).toFixed(1), timeInForce: 'GTC' },
      },
    }),
  })
  const ot = await orderRes.text()
  console.log('order', orderRes.status, ot.slice(0, 500))
  if (!orderRes.ok) return
  const oj = JSON.parse(ot)
  const tradeId = oj?.orderFillTransaction?.tradeOpened?.tradeID
  if (tradeId) {
    const c = await fetch(`${base}/v3/accounts/${id}/trades/${tradeId}/close`, {
      method: 'PUT',
      headers,
      body: '{}',
    })
    console.log('close', c.status, (await c.text()).slice(0, 200))
  }
}

await tryAccount('101-002-36082256-006')
await tryAccount('101-002-36082256-005')
