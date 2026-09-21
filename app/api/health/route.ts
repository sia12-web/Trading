/**
 * GET /api/health — production readiness probe (no secrets returned).
 */
import { NextResponse } from 'next/server'
import { checkEnv } from '@/lib/utils/env'
import { logger } from '@/lib/utils/logger'
import { isDatabentoConfigured } from '@/lib/databento/client'
import { ensureDatabentoSidecarRunning } from '@/lib/databento/liveHub'

export const dynamic = 'force-dynamic'

/**
 * Warm the CME Globex live session from the deploy health probe. Starting it lazily on
 * the first chart subscribe would otherwise put the sidecar spawn and the gateway
 * handshake on a trader's critical path. Instrumentation cannot do this: it is also
 * compiled for the edge runtime, where child_process/fs do not resolve.
 */
let sidecarWarmed = false
function warmDatabentoSidecar() {
  if (sidecarWarmed || !isDatabentoConfigured()) return
  sidecarWarmed = true
  void ensureDatabentoSidecarRunning()
    .then((ready) => logger.info('health.databento_sidecar', { ready }))
    .catch((err) => logger.warn('health.databento_sidecar_failed', { err }))
}

export async function GET() {
  warmDatabentoSidecar()
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
    // Health probes are frequent — keep success at debug to avoid Railway noise
    logger.debug('health.ok', {
      deskMode: process.env.DESK_MODE || null,
      warnings: env.warnings,
    })
  }

  return NextResponse.json(body, { status: env.ok ? 200 : 503 })
}
