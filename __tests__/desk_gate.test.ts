/**
 * Desk gate session helpers.
 * Run: npx tsx __tests__/desk_gate.test.ts
 */

import {
  mintGateToken,
  verifyGateToken,
  verifyGatePassword,
  gateConfigured,
  DESK_GATE_COOKIE,
  parseCookieHeader,
} from '../lib/auth/deskGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

process.env.DESK_GATE_PASSWORD = 'test-password-xyz'
process.env.DESK_AUTH_SECRET = 'test-signing-secret-16+'
process.env.DESK_AUTH_TTL_DAYS = '7'

async function main() {
  assert((await verifyGatePassword('nope')) === false, 'wrong password rejected')
  assert((await verifyGatePassword('test-password-xyz')) === true, 'correct password ok')

  const token = await mintGateToken()
  assert(!!token, 'minted token')
  assert((await verifyGateToken(token)) === true, 'token verifies')

  const expired = await mintGateToken(Date.now() - 8 * 86_400_000)
  assert(!!expired, 'minted expired-shaped token')
  assert((await verifyGateToken(expired!)) === false, 'expired rejected')

  const tampered = token!.replace(/v1\.\d+/, 'v1.9999999999')
  assert((await verifyGateToken(tampered)) === false, 'tampered rejected')

  assert(
    parseCookieHeader(`${DESK_GATE_COOKIE}=abc; other=1`, DESK_GATE_COOKIE) === 'abc',
    'cookie parse'
  )
  assert(gateConfigured().ok === true, 'configured')

  console.log('desk_gate.test.ts: all passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
