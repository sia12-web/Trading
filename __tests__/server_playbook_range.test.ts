/**
 * Server playbook range gate — server H/L is authoritative.
 * Run: npx tsx __tests__/server_playbook_range.test.ts
 */
import assert from 'node:assert/strict'
import {
  attributeServerPlaybookEntry,
  gateEntryAgainstAuthoritativeRange,
  SERVER_PLAYBOOK_CANDLE_DAYS,
} from '../lib/trading/serverPlaybookRange'

assert.ok(
  SERVER_PLAYBOOK_CANDLE_DAYS >= 5,
  'Nikkei US Range needs ≥5 calendar days so Monday Tokyo still sees Friday NYC'
)

const serverOr30 = { label: 'OR30', high: 63_281.3, low: 62_508.8 }

{
  // Stale client OR30 (live tip / prior paint) must not block a valid server-band entry
  const entry = 63_281.3 // exact server high — in ±10
  const clientStale = { label: 'OR30', high: 63_295.0, low: 62_500.0 }
  const result = gateEntryAgainstAuthoritativeRange({
    entry,
    serverRange: serverOr30,
    clientRange: clientStale,
  })
  assert.equal(result.ok, true, 'stale client range must not reject valid server-band entry')
  if (result.ok) {
    assert.equal(result.range.high, serverOr30.high)
    assert.equal(result.range.low, serverOr30.low)
  }
}

{
  // Entry only valid on stale client band — still reject vs server
  const entry = 63_295 // in stale client high±10, outside server high±10
  const clientStale = { label: 'OR30', high: 63_295.0, low: 62_500.0 }
  const result = gateEntryAgainstAuthoritativeRange({
    entry,
    serverRange: serverOr30,
    clientRange: clientStale,
  })
  assert.equal(result.ok, false, 'entry outside server ±10 must fail')
  if (!result.ok) {
    assert.match(result.message, /highlighted ±10 H\/Mid\/L/i)
  }
}

{
  // No client range — server alone decides
  const ok = gateEntryAgainstAuthoritativeRange({
    entry: 62_508.8,
    serverRange: serverOr30,
    clientRange: null,
  })
  assert.equal(ok.ok, true, 'server-only path accepts in-band entry')
}

{
  // OANDA down — soft-fail to shaped client range
  const client = { label: 'OR30', high: 100, low: 90 }
  const ok = gateEntryAgainstAuthoritativeRange({
    entry: 100,
    serverRange: null,
    clientRange: client,
  })
  assert.equal(ok.ok, true, 'client fallback when server null')
  const bad = gateEntryAgainstAuthoritativeRange({
    entry: 50, // mid-gap, outside both ±10 bands of 100/90
    serverRange: null,
    clientRange: client,
  })
  assert.equal(bad.ok, false, 'client fallback still enforces ±10')
}

{
  // Chart-painted Nikkei US Range mid while server history missed Friday NYC
  const us = { label: 'US Range', high: 40_100, low: 39_900 }
  const mid = (us.high + us.low) / 2
  const ok = gateEntryAgainstAuthoritativeRange({
    entry: mid,
    serverRange: null,
    clientRange: us,
  })
  assert.equal(ok.ok, true, 'US Range 50% mid accepted via client when server null')
  if (!ok.ok) assert.fail(ok.message)
}

{
  // Monday OR30 window: server shaped today's OR30 but missed Friday NYC.
  // Client US mid must win soft-fallback *before* sequential active=OR30.
  const or30 = { label: 'OR30', high: 40_050, low: 39_950 }
  const us = { label: 'US Range', high: 41_000, low: 40_800 }
  const mid = (us.high + us.low) / 2 // 40900 — outside OR30 ±10
  const { range, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: mid,
    shaped: { or30, ib: null, usRange: null, lunchRange: null },
    active: or30,
    clientRange: us,
  })
  assert.equal(usedUsClientFallback, true, 'US client fallback must run before active OR30')
  assert.equal(range?.label, 'US Range', 'US mid billed to client US Range')
  assert.equal(range?.high, us.high)
  assert.equal(range?.low, us.low)
}

{
  // Price in OR30 ±10 still attributes to OR30 — client US must not steal
  const or30 = { label: 'OR30', high: 40_050, low: 39_950 }
  const us = { label: 'US Range', high: 41_000, low: 40_800 }
  const { range, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: 40_050,
    shaped: { or30, ib: null, usRange: null, lunchRange: null },
    active: or30,
    clientRange: us,
  })
  assert.equal(usedUsClientFallback, false, 'in-band OR30 hit blocks US fallback')
  assert.equal(range?.label, 'OR30')
}

{
  // Server-shaped US Range is authoritative — client H/L cannot substitute
  const serverUs = { label: 'US Range', high: 40_100, low: 39_900 }
  const clientUs = { label: 'US Range', high: 41_000, low: 40_000 }
  const mid = (serverUs.high + serverUs.low) / 2
  const { range, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: mid,
    shaped: { or30: null, ib: null, usRange: serverUs, lunchRange: null },
    active: serverUs,
    clientRange: clientUs,
  })
  assert.equal(usedUsClientFallback, false)
  assert.equal(range?.high, serverUs.high)
  assert.equal(range?.low, serverUs.low)
}

console.log('server_playbook_range.test.ts: ok')
