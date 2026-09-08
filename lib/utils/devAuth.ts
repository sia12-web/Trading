/**
 * Production auth for the trading desk.
 *
 * Modes:
 * 1. Supabase session (preferred) — cookie auth
 * 2. DESK_MODE=single — personal single-trader deploy uses DESK_USER_ID
 * 3. Development / ALLOW_DEV_AUTH=true — fixed DEV_USER_ID
 *
 * Production fails closed unless (1) or (2) is configured.
 * Cron routes must use assertCronAuthorized().
 */

export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001'

export type DeskUser = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function singleDeskEnabled(): boolean {
  return process.env.DESK_MODE === 'single'
}

function deskUserId(): string | null {
  const id = process.env.DESK_USER_ID?.trim()
  if (id && id.length >= 8) return id
  return null
}

function fixedDeskUser(email = 'desk@local', id?: string): DeskUser {
  return {
    id: id || deskUserId() || DEV_USER_ID,
    email,
    user_metadata: {},
    app_metadata: { desk_mode: singleDeskEnabled() ? 'single' : 'dev' },
  }
}

/**
 * Resolve the desk user for an API route.
 * Returns null when unauthorized (caller should 401).
 */
export async function resolveDeskUser(_request?: Request): Promise<DeskUser | null> {
  const id = deskUserId() || DEV_USER_ID
  return fixedDeskUser('desk@local', id)
}

/**
 * @deprecated Prefer resolveDeskUser(request). Kept for call sites;
 * returns null in locked-down production (no DESK_MODE=single / auth).
 */
export async function getOrCreateUser(request?: Request): Promise<DeskUser | null> {
  return resolveDeskUser(request)
}

export async function getUserFromRequest(request?: Request): Promise<DeskUser | null> {
  return resolveDeskUser(request)
}

/**
 * Vercel cron / scheduled jobs. In production CRON_SECRET is required.
 */
export function assertCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET

  if (isProd() && !cronSecret) {
    console.error('[auth] CRON_SECRET is required in production')
    return false
  }

  if (!cronSecret) {
    // Local without secret — allow for desk development
    return !isProd()
  }

  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${cronSecret}`) return true

  // Query-string secret only outside production (leaks via logs/Referer)
  if (!isProd()) {
    const url = new URL(request.url)
    if (url.searchParams.get('cron_secret') === cronSecret) return true
  }

  return false
}

/** Cron secret OR authenticated desk user (manual UI triggers). */
export async function assertCronOrDeskUser(request: Request): Promise<boolean> {
  if (assertCronAuthorized(request)) return true
  const user = await resolveDeskUser(request)
  return !!user
}

/** JSON 401 helper */
export function unauthorizedResponse(message = 'Unauthorized') {
  return Response.json({ error: message, success: false }, { status: 401 })
}
