import { createMockSupabaseClient } from '@/lib/supabase/mockClient'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser-side client: returns zero-network local mock client.
 */
let mockInstance: SupabaseClient<any, 'public', any> | null = null

export function createClient(): SupabaseClient<any, 'public', any> {
  if (!mockInstance) {
    mockInstance = createMockSupabaseClient()
  }
  return mockInstance
}

