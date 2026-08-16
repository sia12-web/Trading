/**
 * Read-only Questrade account size check. Never places or cancels.
 * Usage: node --env-file=.env.local scripts/questrade-account-size.mjs
 */
import { createClient } from '@supabase/supabase-js'

const LOGIN = 'https://login.questrade.com/oauth2/token'
const account = process.env.QUESTRADE_ACCOUNT_NUMBER?.trim()
const envRefresh = process.env.QUESTRADE_INITIAL_REFRESH_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!account) {
  console.error('QUESTRADE_ACCOUNT_NUMBER missing')
  process.exit(1)
}
if (!url || !key) {
  console.error('Supabase admin env missing')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: stored } = await supabase
  .from('questrade_session')
  .select('refresh_token, access_token, api_server, token_expiry')
  .eq('id', 1)
  .maybeSingle()

let refresh = stored?.refresh_token || envRefresh
if (!refresh) {
  console.error('No Questrade refresh token in session or env')
  process.exit(1)
}

const expiry = stored?.token_expiry ? new Date(stored.token_expiry).getTime() : 0
let access = stored?.access_token || ''
let apiServer = stored?.api_server || ''

if (!access || !apiServer || expiry - Date.now() < 60_000) {
  const res = await fetch(
    `${LOGIN}?grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`
  )
  const body = await res.text()
  if (!res.ok) {
    console.error('Questrade auth failed', res.status, body.slice(0, 180))
    process.exit(1)
  }
  const next = JSON.parse(body)
  access = next.access_token
  apiServer = next.api_server
  refresh = next.refresh_token
  await supabase.from('questrade_session').upsert({
    id: 1,
    refresh_token: next.refresh_token,
    access_token: next.access_token,
    api_server: next.api_server,
    token_expiry: new Date(Date.now() + (next.expires_in || 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })
}

const headers = {
  Authorization: `Bearer ${access}`,
  Accept: 'application/json',
}
const base = apiServer.replace(/\/+$/, '')
const [balRes, posRes] = await Promise.all([
  fetch(`${base}/v1/accounts/${account}/balances`, { headers }),
  fetch(`${base}/v1/accounts/${account}/positions`, { headers }),
])
if (!balRes.ok) {
  console.error('Balances failed', balRes.status, (await balRes.text()).slice(0, 180))
  process.exit(1)
}
const balances = await balRes.json()
const positions = posRes.ok ? (await posRes.json()).positions || [] : []
const rows = balances.combinedBalances?.length
  ? balances.combinedBalances
  : balances.perCurrencyBalances || []
const row =
  rows.find((r) => String(r.currency).toUpperCase() === 'CAD') ||
  rows.find((r) => String(r.currency).toUpperCase() === 'USD') ||
  rows[0] ||
  {}

console.log(
  JSON.stringify(
    {
      ok: true,
      account,
      currency: row.currency || 'CAD',
      equity: row.totalEquity ?? null,
      cash: row.cash ?? null,
      marketValue: row.marketValue ?? null,
      buyingPower: row.buyingPower ?? null,
      positions: positions.length,
    },
    null,
    2
  )
)
