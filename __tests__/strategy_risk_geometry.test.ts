/**
 * Strategy SL/TP — active range bait geometry (not zone-only).
 * Run: npx tsx __tests__/strategy_risk_geometry.test.ts
 */
import assert from 'node:assert/strict'
import {
  activeRangeForPlaybook,
  visibleOverlayEntryRanges,
  strategyEntryRisk,
  strategyStopDetail,
  strategyStopPrice,
  strategyTakeProfitPrice,
} from '../lib/trading/strategyRiskGeometry'
import { zoneStopPrice } from '../lib/trading/deskLevels'

const or30 = { label: 'OR30', high: 42_200, low: 42_000 }

{
  // Stop-pool LONG: never double-extend past zone
  const entry = 41_980
  const zone = zoneStopPrice(entry, 'LONG')
  const detail = strategyStopDetail({
    entry,
    direction: 'LONG',
    activeRange: or30,
  })
  assert.ok(detail.stop < entry, 'LONG stop below entry')
  assert.equal(detail.stop, zone, 'stop-pool uses zone floor once (no double extend)')
  assert.equal(detail.source, 'zone', 'stop-pool stopSource=zone')
}

{
  // SHORT stop beyond range high when inside/near high
  const stop = strategyStopPrice({
    entry: 42_220,
    direction: 'SHORT',
    activeRange: or30,
  })
  assert.ok(stop > 42_220, 'SHORT stop above entry')
  assert.ok(stop >= or30.high, 'SHORT stop at/beyond OR30 high')
}

{
  // No range → zone fallback
  const stop = strategyStopPrice({
    entry: 42_100,
    direction: 'LONG',
    activeRange: null,
  })
  assert.equal(stop, zoneStopPrice(42_100, 'LONG'))
}

{
  // Wrong side of range → zone (do not span full range)
  const entry = 42_400
  const zone = zoneStopPrice(entry, 'LONG')
  const detail = strategyStopDetail({
    entry,
    direction: 'LONG',
    activeRange: or30,
  })
  assert.equal(detail.stop, zone, 'LONG above range high → zone')
  assert.equal(detail.source, 'zone')
}

{
  // Inside-range LONG near high can use range stop (beyond low)
  const entry = 42_180
  const detail = strategyStopDetail({
    entry,
    direction: 'LONG',
    activeRange: or30,
  })
  assert.ok(detail.stop < entry, 'inside LONG stop below')
  assert.ok(detail.stop <= or30.low, 'inside LONG stop at/beyond bait low')
  // Should be at least as wide as zone
  const zone = zoneStopPrice(entry, 'LONG')
  assert.ok(detail.stop <= zone, 'never tighter than zone')
}

{
  // TP prefers opposing range edge when RR ≥ 1.5
  const entry = 42_050
  const stop = strategyStopPrice({
    entry,
    direction: 'LONG',
    activeRange: or30,
  })
  const tp = strategyTakeProfitPrice({
    entry,
    stop,
    direction: 'LONG',
    activeRange: or30,
  })
  assert.ok(tp > entry, 'LONG TP above')
  const risk = entry - stop
  assert.ok(tp - entry >= risk * 1.5 - 1e-6, 'TP at least ~1.5R')
}

{
  const risk = strategyEntryRisk({
    entry: 42_180,
    direction: 'SHORT',
    activeRange: or30,
    magnets: { avwap: 42_080 },
  })
  assert.ok(risk.stop > 42_180, 'SHORT stop')
  assert.ok(risk.target < 42_180, 'SHORT target')
  assert.equal(risk.rangeLabel, 'OR30')
  assert.ok(risk.stopSource === 'range' || risk.stopSource === 'zone')
}

{
  assert.deepEqual(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      ib: { high: 110, low: 95 },
      morningAttempts: 0,
    }),
    { label: 'IB', high: 110, low: 95 },
    'OR30 skipped + IB shaped → auto handoff to IB (OR30 finished)'
  )
  assert.deepEqual(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      morningAttempts: 0,
    }),
    { label: 'OR30', high: 100, low: 90 },
    'OR30 optional while IB not shaped yet'
  )
  assert.deepEqual(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      ib: { high: 110, low: 95 },
      morningAttempts: 1,
    }),
    { label: 'OR30', high: 100, low: 90 },
    'morning fill keeps OR30 bait (do not steal to IB mid-manage framing)'
  )
  assert.deepEqual(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: false },
      ib: { high: 110, low: 95 },
      morningAttempts: 0,
    }),
    { label: 'IB', high: 110, low: 95 },
    'IB already shaped + OR30 skipped → hand off even if OR30 still marked forming'
  )
  // Forming OR30 with no other shaped bait → null (deny entries)
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: false },
    }),
    null
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'ib',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      ib: { high: 110, low: 95 },
    })?.label,
    'IB'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: true },
    })?.label,
    'US Range'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: false },
      morningAttempts: 0,
    })?.label,
    'US Range',
    'Nikkei OR30 forming + prior NYC complete → preview US Range ±10'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: true },
      morningAttempts: 0,
    })?.label,
    'OR30',
    'Nikkei OR30 locked + morning playbook → OR30 ±10 (US must not steal)'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: true },
      morningAttempts: 1,
    })?.label,
    'OR30',
    'Nikkei actively probing OR30 → keep OR30 bait'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: true },
      morningAttempts: 0,
    })?.label,
    'US Range',
    'Nikkei us_range playbook keeps US ±10 even when OR30 is locked'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: false },
    }),
    null,
    'incomplete NYC session must not unlock Nikkei US Range entries'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'ib',
      instrument: 'NIKKEI',
      ib: { high: 40_100, low: 39_900 },
    })?.label,
    'Tokyo IB'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'lunch_range',
      instrument: 'NASDAQ',
      lunchRange: { high: 18_500, low: 18_400, complete: true },
    })?.label,
    'Lunch-range'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'lunch_range',
      instrument: 'NASDAQ',
      lunchRange: { high: 18_500, low: 18_400, complete: false },
    }),
    null,
    'lunch must finish (13:30 ET) before ±10 lunch-range entries'
  )

  const overlays = visibleOverlayEntryRanges({
    instrument: 'NIKKEI',
    showOr30: true,
    showIb: true,
    showUsRange: true,
    showLunchRange: true,
    or30: { high: 40_050, low: 39_950, complete: true },
    ib: { high: 40_100, low: 39_900 },
    usRange: { high: 40_000, low: 39_500, complete: true },
    lunchRange: { high: 18_500, low: 18_400, complete: true },
  })
  assert.deepEqual(
    overlays.map((o) => o.label),
    ['OR30', 'US Range', 'Tokyo IB'],
    'Nikkei overlays paint OR30 + US + Tokyo IB when toggled (no NYC lunch)'
  )
  assert.deepEqual(
    visibleOverlayEntryRanges({
      instrument: 'NIKKEI',
      showOr30: false,
      showIb: true,
      showUsRange: false,
      or30: { high: 40_050, low: 39_950, complete: true },
      ib: { high: 40_100, low: 39_900 },
      usRange: { high: 40_000, low: 39_500, complete: true },
    }).map((o) => o.label),
    ['Tokyo IB'],
    'toggling OR30/US off leaves only Tokyo IB ±10'
  )
  assert.deepEqual(
    visibleOverlayEntryRanges({
      instrument: 'NASDAQ',
      showOr30: true,
      showIb: true,
      showLunchRange: true,
      or30: { high: 18_200, low: 18_100, complete: true },
      ib: { high: 18_250, low: 18_050 },
      lunchRange: { high: 18_500, low: 18_400, complete: true },
    }).map((o) => o.label),
    ['OR30', 'IB', 'Lunch-range']
  )
}

console.log('strategy_risk_geometry: all passed')
