/**
 * Read-only Questrade session for TradePulse.
 * Persists the rotated refresh token so we can keep reading account size.
 * Never places or cancels.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseQuestradeAccountSize,
  questradeGet,
  questradeLoginRefresh,
  type QuestradeAccountSnapshot,
} from '@/lib/trading/questradeReadOnly'

type StoredSession = {
  refresh_token: string
  access_token: string | null
  api_server: string | null
  token_expiry: string | null
}

async function loadStored(supabase: SupabaseClient): Promise<StoredSession | null> {
  const { data } = await supabase
    .from('questrade_session')
    .select('refresh_token, access_token, api_server, token_expiry')
    .eq('id', 1)
    .maybeSingle()
  if (!data?.refresh_token) return null
  return data as StoredSession
}

async function saveStored(
  supabase: SupabaseClient,
  row: {
    refreshToken: string
    accessToken: string
    apiServer: string
    expiresIn: number
  }
): Promise<void> {
  const expiry = new Date(Date.now() + Math.max(60, row.expiresIn) * 1000).toISOString()
  await supabase.from('questrade_session').upsert({
    id: 1,
    refresh_token: row.refreshToken,
    access_token: row.accessToken,
    api_server: row.apiServer,
    token_expiry: expiry,
    updated_at: new Date().toISOString(),
  })
}

function accessStillGood(expiryIso?: string | null): boolean {
  if (!expiryIso) return false
  const t = new Date(expiryIso).getTime()
  return Number.isFinite(t) && t - Date.now() > 60_000
}

export async function getQuestradeApiCreds(
  supabase: SupabaseClient
): Promise<
  | { ok: true; account: string; accessToken: string; apiServer: string }
  | { ok: false; error: string }
> {
  const account = process.env.QUESTRADE_ACCOUNT_NUMBER?.trim()
  if (!account) {
    return { ok: false, error: 'QUESTRADE_ACCOUNT_NUMBER is not set' }
  }

  let stored = await loadStored(supabase)
  if (!accessStillGood(stored?.token_expiry) || !stored?.access_token || !stored?.api_server) {
    const { syncQuestradeSessionFromWatcher } = await import(
      '@/lib/trading/questradeWatcherSync'
    )
    await syncQuestradeSessionFromWatcher(supabase)
    stored = await loadStored(supabase)
  }

  const envRefresh = process.env.QUESTRADE_INITIAL_REFRESH_TOKEN?.trim() || ''
  let access = stored?.access_token || ''
  let apiServer = stored?.api_server || ''
  let refresh = stored?.refresh_token || envRefresh

  const allowRefresh = process.env.QUESTRADE_ALLOW_REFRESH === 'true'
  if (!accessStillGood(stored?.token_expiry) || !access || !apiServer) {
    if (!allowRefresh || !refresh) {
      return {
        ok: false,
        error:
          'Questrade access expired. The watcher owns the refresh token — TradePulse only reads.',
      }
    }
    try {
      const next = await questradeLoginRefresh(refresh)
      access = next.access_token
      apiServer = next.api_server
      await saveStored(supabase, {
        refreshToken: next.refresh_token,
        accessToken: next.access_token,
        apiServer: next.api_server,
        expiresIn: next.expires_in || 1800,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Questrade login failed'
      return { ok: false, error: msg }
    }
  }

  return { ok: true, account, accessToken: access, apiServer }
}

export async function loadQuestradeAccountSnapshot(
  supabase: SupabaseClient
): Promise<QuestradeAccountSnapshot | { ok: false; error: string }> {
  const creds = await getQuestradeApiCreds(supabase)
  if (!creds.ok) return creds
  const { account, accessToken: access, apiServer } = creds

  try {
    const [balances, positions] = await Promise.all([
      questradeGet<{
        combinedBalances?: Array<Record<string, unknown>>
        perCurrencyBalances?: Array<Record<string, unknown>>
      }>({
        apiServer,
        accessToken: access,
        endpoint: `v1/accounts/${account}/balances`,
      }),
      questradeGet<{ positions?: unknown[] }>({
        apiServer,
        accessToken: access,
        endpoint: `v1/accounts/${account}/positions`,
      }),
    ])
    return parseQuestradeAccountSize({
      account,
      balances,
      positions: positions.positions || [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Questrade read failed'
    return { ok: false, error: msg }
  }
}
