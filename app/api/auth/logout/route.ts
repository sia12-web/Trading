import { NextResponse } from 'next/server'
import { buildClearGateCookie } from '@/lib/auth/deskGate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 * Clears the desk_gate session cookie.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(buildClearGateCookie())
  return res
}
