/**
 * Questrade access from TradePulse is read-only.
 * Allowed: token refresh + GET accounts, positions, balances, orders, executions.
 * Refused: any place / replace / cancel / impact path.
 */

const LOGIN_URL = 'https://login.questrade.com/oauth2/token'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function questradeReadOnlyEnabled(): boolean {
  return process.env.QUESTRADE_READ_ONLY !== 'false'
}

export function assertQuestradeReadOnly(method: string, endpoint: string): void {
  const m = String(method || 'GET').toUpperCase()
  const path = String(endpoint || '')
  if (WRITE_METHODS.has(m) || m !== 'GET') {
    throw new Error(`Questrade read-only: refusing ${m} ${path}`)
  }
  if (/\/orders(\/|$)/i.test(path) && m !== 'GET') {
    throw new Error(`Questrade read-only: refusing order impact ${m} ${path}`)
  }
}

export async function questradeLoginRefresh(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  api_server: string
  expires_in: number
}> {
  const token = String(refreshToken || '').trim()
  if (!token) throw new Error('Questrade refresh token missing')
  const form = `grant_type=refresh_token&refresh_token=${encodeURIComponent(token)}`
  let res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!res.ok) {
    res = await fetch(`${LOGIN_URL}?${form}`, { method: 'GET' })
  }
  if (!res.ok) {
    throw new Error(`Questrade auth failed (${res.status})`)
  }
  return (await res.json()) as {
    access_token: string
    refresh_token: string
    api_server: string
    expires_in: number
  }
}

export type QuestradeAccountSnapshot = {
  ok: true
  account: string
  equity: number
  cash: number
  marketValue: number
  buyingPower: number
  currency: string
  positions: number
  asOfIso: string
}

type QuestradeBalanceRow = {
  currency?: string
  cash?: number
  marketValue?: number
  totalEquity?: number
  buyingPower?: number
}

export function parseQuestradeAccountSize(args: {
  account: string
  balances: { combinedBalances?: QuestradeBalanceRow[]; perCurrencyBalances?: QuestradeBalanceRow[] }
  positions?: unknown[]
  now?: Date
}): QuestradeAccountSnapshot {
  const rows = args.balances.combinedBalances?.length
    ? args.balances.combinedBalances
    : args.balances.perCurrencyBalances || []
  const cad = rows.find((r) => String(r.currency || '').toUpperCase() === 'CAD')
  const usd = rows.find((r) => String(r.currency || '').toUpperCase() === 'USD')
  const row = cad || usd || rows[0] || {}
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0
  }
  return {
    ok: true,
    account: args.account,
    equity: n(row.totalEquity),
    cash: n(row.cash),
    marketValue: n(row.marketValue),
    buyingPower: n(row.buyingPower),
    currency: String(row.currency || 'CAD').toUpperCase(),
    positions: Array.isArray(args.positions) ? args.positions.length : 0,
    asOfIso: (args.now ?? new Date()).toISOString(),
  }
}

export async function questradeGet<T = unknown>(args: {
  apiServer: string
  accessToken: string
  endpoint: string
  params?: Record<string, string>
}): Promise<T> {
  assertQuestradeReadOnly('GET', args.endpoint)
  const base = args.apiServer.replace(/\/+$/, '')
  const path = args.endpoint.replace(/^\/+/, '')
  const qs = args.params ? `?${new URLSearchParams(args.params).toString()}` : ''
  const res = await fetch(`${base}/${path}${qs}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`Questrade GET ${path} failed (${res.status})`)
  }
  return (await res.json()) as T
}
