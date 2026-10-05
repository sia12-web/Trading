/**
 * Read and write the watcher Postgres questrade_session row.
 * Token refresh itself lives in questradeSession so the rotated refresh token
 * is stored before anything else can use the old one.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LiveWatcherSession = {
  accessToken: string
  refreshToken: string
  apiServer: string
  tokenExpiryIso: string
  tokenExpiryMs: number
}

export type WatcherAuthRow = {
  accessToken: string | null
  refreshToken: string | null
  apiServer: string | null
  tokenExpiryMs: number
}

let cachedWatcherSession: (LiveWatcherSession & { fetchedAt: number }) | null = null
let cachedAuthRow: (WatcherAuthRow & { fetchedAt: number }) | null = null
let pinnedAuth: WatcherAuthRow | null = null

type PgClient = {
  connect: () => Promise<unknown>
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>
  end: () => Promise<unknown>
}

async function withWatcherClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T | null> {
  const url = process.env.QUESTRADE_WATCHER_DATABASE_URL?.trim()
  if (!url) return null
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
    return await fn(client)
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

function rowToAuth(row: Record<string, unknown> | undefined): WatcherAuthRow | null {
  if (!row) return null
  const expiryRaw = Number(row.token_expiry)
  const tokenExpiryMs = Number.isFinite(expiryRaw)
    ? expiryRaw > 1e12
      ? expiryRaw
      : expiryRaw * 1000
    : 0
  const apiServer = row.api_server ? String(row.api_server).replace(/\/$/, '') : null
  return {
    accessToken: row.access_token ? String(row.access_token) : null,
    refreshToken: row.refresh_token ? String(row.refresh_token) : null,
    apiServer,
    tokenExpiryMs,
  }
}

export async function fetchWatcherAuthRow(opts?: {
  fresh?: boolean
}): Promise<WatcherAuthRow | null> {
  const now = Date.now()
  if (pinnedAuth?.accessToken && pinnedAuth.tokenExpiryMs - now > 30_000) {
    return pinnedAuth
  }
  if (!opts?.fresh && cachedAuthRow && now - cachedAuthRow.fetchedAt < 15_000) {
    return cachedAuthRow
  }
  const auth = await withWatcherClient(async (client) => {
    const { rows } = await client.query(
      'SELECT access_token, refresh_token, api_server, token_expiry FROM questrade_session LIMIT 1'
    )
    return rowToAuth(rows[0])
  })
  if (!auth) return null
  cachedAuthRow = { ...auth, fetchedAt: now }
  if (auth.accessToken && auth.apiServer) {
    cachedWatcherSession = {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken || 'watcher',
      apiServer: auth.apiServer,
      tokenExpiryIso: new Date(auth.tokenExpiryMs).toISOString(),
      tokenExpiryMs: auth.tokenExpiryMs,
      fetchedAt: now,
    }
  }
  return auth
}

export async function fetchLiveWatcherSession(): Promise<LiveWatcherSession | null> {
  const now = Date.now()
  if (
    cachedWatcherSession &&
    now - cachedWatcherSession.fetchedAt < 15_000 &&
    cachedWatcherSession.tokenExpiryMs - now > 30_000
  ) {
    return cachedWatcherSession
  }
  const auth = await fetchWatcherAuthRow({ fresh: true })
  if (!auth?.accessToken || !auth.apiServer) return null
  if (!cachedWatcherSession) return null
  return cachedWatcherSession
}

export async function persistWatcherSession(input: {
  accessToken: string
  refreshToken: string
  apiServer: string
  expiresInSec: number
}): Promise<boolean> {
  const expiryMs = Date.now() + Math.max(60, input.expiresInSec) * 1000
  const apiServer = input.apiServer.replace(/\/$/, '')
  const now = Date.now()
  pinnedAuth = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    apiServer,
    tokenExpiryMs: expiryMs,
  }
  cachedAuthRow = { ...pinnedAuth, fetchedAt: now }
  cachedWatcherSession = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    apiServer,
    tokenExpiryIso: new Date(expiryMs).toISOString(),
    tokenExpiryMs: expiryMs,
    fetchedAt: now,
  }
  const wrote = await withWatcherClient(async (client) => {
    const upd = await client.query(
      `UPDATE questrade_session
       SET access_token = $1, refresh_token = $2, api_server = $3, token_expiry = $4
       WHERE id = 1`,
      [input.accessToken, input.refreshToken, apiServer, expiryMs]
    )
    if ((upd.rowCount ?? 0) > 0) return true
    await client.query(
      `INSERT INTO questrade_session (id, access_token, refresh_token, api_server, token_expiry)
       VALUES (1, $1, $2, $3, $4)`,
      [input.accessToken, input.refreshToken, apiServer, expiryMs]
    )
    return true
  })
  return wrote === true
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
