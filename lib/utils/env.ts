/**
 * Fail-fast environment checks for production boots / first API hit.
 */

const REQUIRED_ALWAYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const

const REQUIRED_PROD = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
] as const

export type EnvCheckResult = {
  ok: boolean
  missing: string[]
  warnings: string[]
}

export function checkEnv(): EnvCheckResult {
  const missing: string[] = []
  const warnings: string[] = []

  for (const key of REQUIRED_ALWAYS) {
    if (!process.env[key]?.trim()) missing.push(key)
  }

  if (process.env.NODE_ENV === 'production') {
    for (const key of REQUIRED_PROD) {
      if (!process.env[key]?.trim()) missing.push(key)
    }
    if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.GEMINI_API_KEY?.trim()) {
      missing.push('ANTHROPIC_API_KEY or GEMINI_API_KEY')
    }
    if (process.env.DESK_MODE !== 'single' && process.env.ALLOW_DEV_AUTH === 'true') {
      warnings.push('ALLOW_DEV_AUTH=true in production weakens auth — prefer DESK_MODE=single or Supabase login')
    }
    if (process.env.DESK_MODE !== 'single') {
      warnings.push('DESK_MODE is not "single" — API routes require a real Supabase session')
    }
    if (!process.env.FINNHUB_API_KEY?.trim() && !process.env.OANDA_API_KEY?.trim()) {
      warnings.push('No FINNHUB_API_KEY or OANDA_API_KEY — live quotes may fail')
    }
  }

  return { ok: missing.length === 0, missing, warnings }
}

/** Throw if critical env is missing (call from cron / market-open). */
export function assertProdEnv(): void {
  const result = checkEnv()
  for (const w of result.warnings) {
    console.warn(`[env] ${w}`)
  }
  if (!result.ok) {
    throw new Error(`Missing required environment variables: ${result.missing.join(', ')}`)
  }
}
