import { createBrowserClient } from '@supabase/ssr'
import { assertSupabasePublicEnv } from '@/lib/supabase/env'

/**
 * Create Supabase client for client-side use (browser components)
 * Singleton pattern ensures only one instance
 */
let supabaseClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (supabaseClient) {
    return supabaseClient
  }

  const { url, anonKey } = assertSupabasePublicEnv()
  supabaseClient = createBrowserClient(url, anonKey)

  return supabaseClient
}
