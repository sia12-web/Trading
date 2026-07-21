import { NextResponse } from 'next/server'
import { buildClearGateCookie } from '@/lib/auth/deskGate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 * Clears the desk_gate session cookie.
 */
export async function POST() {
  const cookie = buildClearGateCookie()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
  })
  return res
}
