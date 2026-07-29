/**
 * Durable desk-note claim / cooldown (refresh must not re-send Telegram).
 * Run: npx tsx __tests__/desk_note_claim.test.ts
 */

import assert from 'node:assert/strict'
import {
  claimDeskNoteOnce,
  claimDeskNoteCooldown,
  hasDeskNoteClaim,
  deskNoteClaimKey,
  deskNoteTradeDate,
} from '../lib/notify/deskSessionNotes'
import { claimServerDeskNoteOnce } from '../lib/notify/deskNoteServerClaim'

const now = new Date('2026-07-28T16:00:00Z')
const key = deskNoteClaimKey('range_or30', 'DOW', now)
assert.match(key, /^tp\.deskNote\.range_or30\.DOW\.20/)
assert.equal(deskNoteTradeDate('DOW', now), key.split('.').pop())

// Memory-only claim (no browser storage in node)
assert.equal(hasDeskNoteClaim('range_or30', 'DOW', now), false)
assert.equal(claimDeskNoteOnce('range_or30', 'DOW', now), true)
assert.equal(hasDeskNoteClaim('range_or30', 'DOW', now), true)
assert.equal(claimDeskNoteOnce('range_or30', 'DOW', now), false, 'second claim blocked')

assert.equal(claimDeskNoteCooldown('range_edge_OR30_high', 'NASDAQ', 90_000, now), true)
assert.equal(
  claimDeskNoteCooldown('range_edge_OR30_high', 'NASDAQ', 90_000, now),
  false,
  'cooldown blocks'
)

assert.equal(claimServerDeskNoteOnce('user:tp.deskNote.test'), true)
assert.equal(claimServerDeskNoteOnce('user:tp.deskNote.test'), false)

console.log('desk_note_claim: all passed')
