/**
 * Copy the watcher's live access token into TradePulse.
 * Read-only SELECT — never refreshes Questrade (that would steal the watcher token).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LiveWatcherSession = {
  accessToken: string
  refreshToken: string
  apiServer: string
  tokenExpiryIso: string
  tokenExpiryMs: number
}

let cachedWatcherSession: (LiveWatcherSession & { fetchedAt: number }) | null = null

export async function fetchLiveWatcherSession(): Promise<LiveWatcherSession | null> {
  const url = process.env.QUESTRADE_WATCHER_DATABASE_URL?.trim()
  if (!url) return null

  const now = Date.now()
  if (
    cachedWatcherSession &&
    now - cachedWatcherSession.fetchedAt < 15_000 &&
    cachedWatcherSession.tokenExpiryMs - now > 30_000
  ) {
    return cachedWatcherSession
  }

  type PgClient = {
    connect: () => Promise<unknown>
    query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>
    end: () => Promise<unknown>
  }
  let client: PgClient | null = null
  try {
    const pg = (await import('pg')) as unknown as {
      Client: new (cfg: { connectionString: string; ssl: object }) => PgClient
      default?: { Client: new (cfg: { connectionString: string; ssl: object }) => PgClient }
    }
    const Client = pg.Client || pg.default?.Client
    if (!Client) return null
    client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    })
    await client.connect()
    const { rows } = await client.query(
      'SELECT access_token, refresh_token, api_server, token_expiry FROM questrade_session LIMIT 1'
    )
    const row = rows[0]
    if (!row?.access_token || !row?.api_server) return null

    const expiryRaw = Number(row.token_expiry)
    const tokenExpiryMs = Number.isFinite(expiryRaw)
      ? (expiryRaw > 1e12 ? expiryRaw : expiryRaw * 1000)
      : Date.now() + 20 * 60 * 1000
    const tokenExpiryIso = new Date(tokenExpiryMs).toISOString()
    const apiServer = String(row.api_server).replace(/\/$/, '')

    const session: LiveWatcherSession = {
      accessToken: String(row.access_token),
      refreshToken: String(row.refresh_token || 'watcher'),
      apiServer,
      tokenExpiryIso,
      tokenExpiryMs,
    }
    cachedWatcherSession = { ...session, fetchedAt: now }
    return session
  } catch {
    return null
  } finally {
    if (client) {
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
  }
}

export async function syncQuestradeSessionFromWatcher(
  supabase: SupabaseClient
): Promise<boolean> {
  const session = await fetchLiveWatcherSession()
  if (!session) return false
  try {
    await supabase.from('questrade_session').upsert({
      id: 1,
      refresh_token: session.refreshToken,
      access_token: session.accessToken,
      api_server: session.apiServer,
      token_expiry: session.tokenExpiryIso,
      updated_at: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  }
}
