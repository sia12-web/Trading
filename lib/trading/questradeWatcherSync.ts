/**
 * Copy the watcher's live access token into TradePulse.
 * Read-only SELECT — never refreshes Questrade (that would steal the watcher token).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function syncQuestradeSessionFromWatcher(
  supabase: SupabaseClient
): Promise<boolean> {
  const url = process.env.QUESTRADE_WATCHER_DATABASE_URL?.trim()
  if (!url) return false
  type PgClient = {
    connect: () => Promise<unknown>
    query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>
    end: () => Promise<unknown>
  }
  let client: PgClient
  try {
    const pg = (await import('pg')) as unknown as {
      Client: new (cfg: { connectionString: string; ssl: object }) => PgClient
      default?: { Client: new (cfg: { connectionString: string; ssl: object }) => PgClient }
    }
    const Client = pg.Client || pg.default?.Client
    if (!Client) return false
    client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    })
  } catch {
    return false
  }
  try {
    await client.connect()
    const { rows } = await client.query(
      'SELECT access_token, refresh_token, api_server, token_expiry FROM questrade_session LIMIT 1'
    )
    const row = rows[0]
    if (!row?.access_token || !row?.api_server) return false
    const expiryRaw = Number(row.token_expiry)
    const expiryIso = Number.isFinite(expiryRaw)
      ? new Date(expiryRaw > 1e12 ? expiryRaw : expiryRaw * 1000).toISOString()
      : new Date(Date.now() + 20 * 60 * 1000).toISOString()
    await supabase.from('questrade_session').upsert({
      id: 1,
      refresh_token: String(row.refresh_token || 'watcher'),
      access_token: String(row.access_token),
      api_server: String(row.api_server),
      token_expiry: expiryIso,
      updated_at: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}
