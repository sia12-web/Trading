import fs from 'fs'

const raw = fs.readFileSync('.env.local', 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1)
  }
  env[m[1]] = v
}

const key = env.OANDA_API_KEY
const id = env.OANDA_ACCOUNT_ID
const base =
  (env.OANDA_ENVIRONMENT || 'practice').toLowerCase() === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com'

const res = await fetch(`${base}/v3/accounts/${id}/summary`, {
  headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
})
const j = await res.json()
const a = j.account || {}
console.log(
  JSON.stringify(
    {
      http: res.status,
      id: a.id,
      currency: a.currency,
      balance: a.balance,
      NAV: a.NAV,
      unrealizedPL: a.unrealizedPL,
      marginAvailable: a.marginAvailable,
      marginUsed: a.marginUsed,
      marginCloseoutPercent: a.marginCloseoutPercent,
      openTradeCount: a.openTradeCount,
      openPositionCount: a.openPositionCount,
      pl: a.pl,
      resettablePL: a.resettablePL,
    },
    null,
    2
  )
)
