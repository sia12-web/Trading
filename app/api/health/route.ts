/**
 * GET /api/health — production readiness probe (no secrets returned).
 */
import { NextResponse } from 'next/server'
import { checkEnv } from '@/lib/utils/env'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const env = checkEnv()
  const body = {
    ok: env.ok,
    ready: env.ok,
    env: {
      missing: env.missing,
      warnings: env.warnings,
      desk_mode: process.env.DESK_MODE || null,
      node_env: process.env.NODE_ENV,
      log_level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    },
    railway: {
      environment: process.env.RAILWAY_ENVIRONMENT || null,
      service: process.env.RAILWAY_SERVICE_NAME || null,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
    },
    timestamp: new Date().toISOString(),
  }

  if (!env.ok) {
    logger.error('health.check_failed', { missing: env.missing, warnings: env.warnings })
  } else {
    logger.info('health.ok', {
      deskMode: process.env.DESK_MODE || null,
      warnings: env.warnings,
    })
  }

  return NextResponse.json(body, { status: env.ok ? 200 : 503 })
}
