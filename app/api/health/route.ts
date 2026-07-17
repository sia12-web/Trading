/**
 * GET /api/health — production readiness probe (no secrets returned).
 */
import { NextResponse } from 'next/server'
import { checkEnv } from '@/lib/utils/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const env = checkEnv()

  return NextResponse.json(
    {
      ok: env.ok,
      ready: env.ok,
      env: {
        missing: env.missing,
        warnings: env.warnings,
        desk_mode: process.env.DESK_MODE || null,
        node_env: process.env.NODE_ENV,
      },
      timestamp: new Date().toISOString(),
    },
    { status: env.ok ? 200 : 503 }
  )
}
