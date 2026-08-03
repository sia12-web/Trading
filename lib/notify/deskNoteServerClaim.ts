/**
 * Process-local Telegram desk-note dedupe (survives client refresh against
 * the same server instance). Client localStorage is still the primary guard.
 */

const claims = new Map<string, number>()
const MAX_KEYS = 2_000

function pruneIfNeeded(): void {
  if (claims.size <= MAX_KEYS) return
  const cutoff = Date.now() - 36 * 60 * 60 * 1000
  for (const [k, ts] of claims) {
    if (ts < cutoff) claims.delete(k)
  }
  if (claims.size <= MAX_KEYS) return
  const oldest = [...claims.entries()].sort((a, b) => a[1] - b[1])
  for (let i = 0; i < Math.ceil(oldest.length / 4); i++) {
    claims.delete(oldest[i]![0])
  }
}

/** Returns true if this is the first claim for key (caller may send Telegram). */
export function claimServerDeskNoteOnce(key: string): boolean {
  const k = key.trim()
  if (!k || k.length > 200) return true
  pruneIfNeeded()
  if (claims.has(k)) return false
  claims.set(k, Date.now())
  return true
}

/** Drop a claim so a failed send can retry later (same process). */
export function releaseServerDeskNoteClaim(key: string): void {
  const k = key.trim()
  if (!k) return
  claims.delete(k)
}
