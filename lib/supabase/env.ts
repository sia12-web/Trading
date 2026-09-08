/**
 * Supabase URL / anon key resolution.
 * Prefer non-NEXT_PUBLIC aliases on the server so Railway runtime env works
 * even if a build inlined empty NEXT_PUBLIC_* values.
 */
export function getSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ''
  )
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ''
  )
}

export function assertSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = getSupabaseUrl() || 'http://localhost:54321'
  const anonKey = getSupabaseAnonKey() || 'mock-anon-key'
  return { url, anonKey }
}
