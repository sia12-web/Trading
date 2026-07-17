import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client for server routes that must bypass RLS
 * (e.g. local dev with getOrCreateUser / no cookie session).
 * Falls back to null when the key is not configured.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
