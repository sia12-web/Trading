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
import { attemptLadderFromCounts } from '../lib/trading/attemptLadder'

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
  // Chart-painted Nikkei US Range high while server history missed Friday NYC
  const us = { label: 'US Range', high: 40_100, low: 39_900 }
  const ok = gateEntryAgainstAuthoritativeRange({
    entry: us.high,
    serverRange: null,
    clientRange: us,
  })
  assert.equal(ok.ok, true, 'US Range high accepted via client when server null')
  if (!ok.ok) assert.fail(ok.message)

  const mid = (us.high + us.low) / 2
  const midRejected = gateEntryAgainstAuthoritativeRange({
    entry: mid,
    serverRange: null,
    clientRange: us,
  })
  assert.equal(midRejected.ok, false, 'US Range 50% mid rejected even via client fallback')
}

{
  // Monday OR30 window: server shaped today's OR30 but missed Friday NYC.
  // Client US high must win soft-fallback *before* sequential active=OR30.
  const or30 = { label: 'OR30', high: 40_050, low: 39_950 }
  const us = { label: 'US Range', high: 41_000, low: 40_800 }
  const usHigh = us.high // 41000 — outside OR30 ±10
  const { range, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: usHigh,
    shaped: { or30, ib: null, usRange: null, lunchRange: null },
    active: or30,
    clientRange: us,
  })
  assert.equal(usedUsClientFallback, true, 'US client fallback must run before active OR30')
  assert.equal(range?.label, 'US Range', 'US high billed to client US Range')
  assert.equal(range?.high, us.high)
  assert.equal(range?.low, us.low)

  // US mid must NOT soft-fallback (mid is not a legal US entry)
  const usMid = (us.high + us.low) / 2
  const midAttr = attributeServerPlaybookEntry({
    entry: usMid,
    shaped: { or30, ib: null, usRange: null, lunchRange: null },
    active: or30,
    clientRange: us,
  })
  assert.equal(midAttr.usedUsClientFallback, false, 'US mid does not trigger client fallback')
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
  const { range, usedUsClientFallback } = attributeServerPlaybookEntry({
    entry: serverUs.high,
    shaped: { or30: null, ib: null, usRange: serverUs, lunchRange: null },
    active: serverUs,
    clientRange: clientUs,
  })
  assert.equal(usedUsClientFallback, false)
  assert.equal(range?.high, serverUs.high)
  assert.equal(range?.low, serverUs.low)
}

{
  // Overlap: US Range high == Tokyo IB 50% mid → prefer bucket-open US Range
  // (candidates list Tokyo IB before US — nearest-only used to mis-bill to IB
  // while the banner still said "US Range unlocked").
  const us = { label: 'US Range', high: 40_000, low: 39_500 }
  const tokyoIb = { label: 'Tokyo IB', high: 40_100, low: 39_900 } // mid = 40000
  const duringUs = new Date(Date.UTC(2026, 6, 30, 0, 30, 0)) // 09:30 JST
  const ladder = attemptLadderFromCounts({
    morningAttempts: 1,
    ibAttempts: 1,
    lunchAttempts: 0,
    now: duringUs,
    instrument: 'NIKKEI',
  })

  const { range: claimed } = attributeServerPlaybookEntry({
    entry: us.high,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: { high: us.high, low: us.low, label: 'US Range' },
    instrument: 'NIKKEI',
    ladder,
    now: duringUs,
  })
  assert.equal(claimed?.label, 'US Range', 'client US claim wins over overlapping Tokyo IB mid')

  // Even with a wrong Tokyo IB client claim, live-open US bucket must win
  const { range: wrongClaim } = attributeServerPlaybookEntry({
    entry: us.high,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: { high: tokyoIb.high, low: tokyoIb.low, label: 'Tokyo IB' },
    instrument: 'NIKKEI',
    ladder,
    now: duringUs,
  })
  assert.equal(
    wrongClaim?.label,
    'US Range',
    'banner US Range playbook must not reject as Tokyo IB on overlap'
  )

  // No client claim — active US Range playbook still wins over Tokyo IB mid
  const { range: activePref } = attributeServerPlaybookEntry({
    entry: us.high,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: null,
    instrument: 'NIKKEI',
    ladder,
    now: duringUs,
  })
  assert.equal(activePref?.label, 'US Range', 'active US Range preferred on overlap without client')

  // Explicit Tokyo IB-only price (not in US bands) still attributes to Tokyo IB
  const { range: ibOnly } = attributeServerPlaybookEntry({
    entry: tokyoIb.high,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: { high: tokyoIb.high, low: tokyoIb.low, label: 'Tokyo IB' },
    instrument: 'NIKKEI',
    ladder,
    now: duringUs,
  })
  assert.equal(ibOnly?.label, 'Tokyo IB', 'Tokyo IB-only price still attributes to IB for deny copy')

  // After first-hour lock both books are live — US H (== IB mid) must stay US
  const duringOverlap = new Date(Date.UTC(2026, 6, 30, 1, 15, 0)) // 10:15 JST
  const ladderOverlap = attemptLadderFromCounts({
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 0,
    now: duringOverlap,
    instrument: 'NIKKEI',
  })
  const { range: overlapUs } = attributeServerPlaybookEntry({
    entry: us.high,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: { high: tokyoIb.high, low: tokyoIb.low, label: 'Tokyo IB' },
    instrument: 'NIKKEI',
    ladder: ladderOverlap,
    now: duringOverlap,
  })
  assert.equal(
    overlapUs?.label,
    'US Range',
    'during US+IB overlap US H beats Tokyo IB mid even with IB client claim'
  )
}

{
  // Off-band must NOT soft-fallback to sequential active (that used to accept
  // outside painted highlights when combined with client soft-clamps).
  const us = { label: 'US Range', high: 40_000, low: 39_500 }
  const tokyoIb = { label: 'Tokyo IB', high: 40_100, low: 39_900 }
  const offBand = 39_750 // US mid — illegal; also outside IB bands
  const { range } = attributeServerPlaybookEntry({
    entry: offBand,
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: { high: us.high, low: us.low, label: 'US Range' },
  })
  assert.equal(range, null, 'off-band leaves attribution null — hard reject upstream')

  const midGap = attributeServerPlaybookEntry({
    entry: 40_050, // between US high and IB mid
    shaped: { or30: null, ib: tokyoIb, usRange: us, lunchRange: null },
    active: us,
    clientRange: null,
  })
  assert.equal(midGap.range, null, 'mid-gap between painted bands is not active-fallback')
}

console.log('server_playbook_range.test.ts: ok')
