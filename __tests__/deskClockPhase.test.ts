/**
 * NYC desk clock: close cooldown vs overnight inventory vs live hours.
 * Run: npx tsx __tests__/deskClockPhase.test.ts
 */

import assert from 'node:assert/strict'
import {
  deskPhaseAt,
  isCloseReprintWindow,
  isDeskCooled,
  isLiveChartHours,
  isOvernightInventoryWindow,
} from '../lib/trading/deskClockPhase'

function et(isoUtc: string) {
  return new Date(isoUtc)
}

{
  // Wednesday 14:00 ET = 18:00 UTC in September (EDT)
  const now = et('2026-09-09T18:00:00Z')
  assert.equal(deskPhaseAt(now), 'LIVE')
  assert.equal(isLiveChartHours(now), true)
  assert.equal(isDeskCooled(now), false)
  assert.equal(isOvernightInventoryWindow(now), false)
  assert.equal(isCloseReprintWindow(now), false)
}

{
  // Wednesday 16:30 ET — reprint window
  const now = et('2026-09-09T20:30:00Z')
  assert.equal(deskPhaseAt(now), 'COOLDOWN')
  assert.equal(isCloseReprintWindow(now), true)
  assert.equal(isDeskCooled(now), true)
  assert.equal(isOvernightInventoryWindow(now), false)
}

{
  // Wednesday 22:00 ET — new overnight for Thursday open
  const now = et('2026-09-10T02:00:00Z')
  assert.equal(deskPhaseAt(now), 'OVERNIGHT')
  assert.equal(isOvernightInventoryWindow(now), true)
  assert.equal(isLiveChartHours(now), false)
}

{
  // Thursday 08:00 ET — still inventory, charts cooled until 09:00
  const now = et('2026-09-10T12:00:00Z')
  assert.equal(isOvernightInventoryWindow(now), true)
  assert.equal(isDeskCooled(now), true)
  assert.equal(deskPhaseAt(now), 'OVERNIGHT')
}

{
  // Thursday 09:15 ET — prep, charts back, inventory still live until 09:30
  const now = et('2026-09-10T13:15:00Z')
  assert.equal(deskPhaseAt(now), 'PREP')
  assert.equal(isLiveChartHours(now), true)
  assert.equal(isOvernightInventoryWindow(now), true)
}

{
  // Friday 20:00 ET — Globex closed until Sunday 18:00
  const now = et('2026-09-12T00:00:00Z')
  assert.equal(isOvernightInventoryWindow(now), false)
  assert.equal(isDeskCooled(now), true)
}

{
  // Sunday 20:00 ET — Monday inventory starts
  const now = et('2026-09-14T00:00:00Z')
  assert.equal(isOvernightInventoryWindow(now), true)
  assert.equal(deskPhaseAt(now), 'OVERNIGHT')
}

console.log('deskClockPhase.test.ts: all passed')
