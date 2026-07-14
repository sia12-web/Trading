/**
 * Development auth utility
 * Provides a default user for development without requiring actual authentication
 * Remove or modify this for production
 */

export const DEV_USER_ID = 'dev-user-00000000-0000-0000-0000-000000000000'

export async function getOrCreateUser() {
  return {
    id: DEV_USER_ID,
    email: 'dev@example.com',
    user_metadata: {},
    app_metadata: {},
  }
}

export async function getUserFromRequest() {
  // In development, always return dev user
  // In production, validate actual auth token
  if (process.env.NODE_ENV === 'development' || process.env.SKIP_AUTH === 'true') {
    return getOrCreateUser()
  }

  return null
}
