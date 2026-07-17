/**
 * Next.js instrumentation — runs once on server boot (Node runtime).
 * Logs env readiness without printing secret values.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { checkEnv } = await import('./lib/utils/env')
  const { logger } = await import('./lib/utils/logger')

  const env = checkEnv()
  logger.info('boot.start', {
    nodeEnv: process.env.NODE_ENV,
    deskMode: process.env.DESK_MODE || null,
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
    railwayEnv: process.env.RAILWAY_ENVIRONMENT || null,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
    envOk: env.ok,
    missing: env.missing,
    warnings: env.warnings,
    hasFinnhub: Boolean(process.env.FINNHUB_API_KEY),
    hasOanda: Boolean(process.env.OANDA_API_KEY),
    hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    hasSupabaseService: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasCronSecret: Boolean(process.env.CRON_SECRET),
  })

  if (!env.ok) {
    logger.error('boot.env_incomplete', { missing: env.missing })
  }
}
