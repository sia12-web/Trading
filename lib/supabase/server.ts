import { createMockSupabaseClient } from '@/lib/supabase/mockClient'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side client: returns zero-network local mock client.
 */
export async function createClient(): Promise<SupabaseClient<any, 'public', any>> {
  return createMockSupabaseClient()
}

