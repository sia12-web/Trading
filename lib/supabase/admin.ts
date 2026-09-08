import { createMockSupabaseClient } from '@/lib/supabase/mockClient'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client: returns zero-network local mock client.
 */
export function createAdminClient(): SupabaseClient<any, 'public', any> {
  return createMockSupabaseClient()
}

