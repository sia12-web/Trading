/**
 * Strategy SL/TP — active range bait geometry (not zone-only).
 * Run: npx tsx __tests__/strategy_risk_geometry.test.ts
 */
import assert from 'node:assert/strict'
import {
  activeRangeForPlaybook,
  entryEligibleOverlayRanges,
  studyEntrySnapRanges,
  visibleOverlayEntryRanges,
  strategyEntryRisk,
  strategyStopDetail,
  strategyStopPrice,
  strategyTakeProfitPrice,
} from '../lib/trading/strategyRiskGeometry'
import { isOr30MorningEntryWindowOpen } from '../lib/trading/sessionGate'
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
  // Initial TP is 1.5R of the protective stop (not opposing-edge magnet)
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
  const rr = (tp - entry) / risk
  assert.ok(rr >= 1.5 - 1e-6, 'TP at least ~1.5R')
  // Soft round-snap may stretch a few ticks; opposing-edge magnets used to 2–4R
  assert.ok(rr < 2.2, 'TP stays near 1.5R (not opposing-edge magnet)')
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
    { label: 'OR30', high: 100, low: 90 },
    'Open range skipped + OR30 shaped → auto handoff to OR30'
  )
  assert.deepEqual(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      morningAttempts: 0,
    }),
    { label: 'OR30', high: 100, low: 90 },
    'Open range skipped → OR30 while IB not the morning book'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: true },
      ib: { high: 110, low: 95 },
      morningAttempts: 1,
    }),
    null,
    'morning fill keeps Open-range bait (OR15 not passed → no steal to OR30/IB)'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'DOW',
      or30: { high: 100, low: 90, complete: false },
      ib: { high: 110, low: 95 },
      morningAttempts: 0,
    }),
    null,
    'OR30 still forming + Open range skipped → wait (do not jump to IB)'
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
    'US Range',
    'Nikkei morning skip Open range → US Range (OR30 is not a Tokyo playbook slot)'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'morning',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
      or30: { high: 39_800, low: 39_600, complete: true },
      morningAttempts: 1,
    })?.label,
    'US Range',
    'Nikkei morning without OR15 still prefers US Range'
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
  // Regression: callers that strip `complete` (sim desk used to store {high,low}
  // only) must not unlock — same as incomplete. Full NikkeiUsSessionRange with
  // complete:true is required for mid/H/L ±10 during us_range playbook.
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500 },
    }),
    null,
    'US Range without complete:true must not unlock (stripped-flag regression)'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      usRange: { high: 40_000, low: 39_500, complete: true },
    })?.label,
    'US Range',
    'US Range with complete:true unlocks H/L ±10'
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
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      ib: { high: 18_500, low: 18_400, complete: true },
    })?.label,
    'IB'
  )
  assert.equal(
    activeRangeForPlaybook({
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      ib: { high: 18_500, low: 18_400 },
    })?.label,
    'IB'
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
      instrument: 'NIKKEI',
      showOr30: true,
      showIb: false,
      showUsRange: true,
      or30: { high: 40_050, low: 39_950, complete: true },
      ib: { high: 40_100, low: 39_900 },
      usRange: { high: 40_000, low: 39_500, complete: true },
    }).map((o) => o.label),
    ['OR30', 'US Range'],
    'showIb false drops Tokyo IB ±10 (chart must pass showIb:true with H/L, not markers toggle)'
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
    ['OR30', 'IB']
  )
  assert.deepEqual(
    visibleOverlayEntryRanges({
      instrument: 'NASDAQ',
      showOr30: false,
      showIb: true,
      showLunchRange: false,
      ib: { high: 18_250, low: 18_050 },
    }).map((o) => o.label),
    ['IB'],
    'NY desks paint IB ±10 whenever showIb + shaped IB (independent of OR30/lunch)'
  )

  const usActive = { label: 'US Range', high: 40_000, low: 39_500 }
  const tokyoIb = { label: 'Tokyo IB', high: 40_100, low: 39_900 }
  const or30Snap = { label: 'OR30', high: 40_050, low: 39_950 }
  assert.deepEqual(
    studyEntrySnapRanges({
      active: usActive,
      overlays: [or30Snap, usActive, tokyoIb],
    }).map((r) => r.label),
    ['US Range', 'OR30', 'Tokyo IB'],
    'drag snap includes active + painted overlays (dedupes US)'
  )
  assert.deepEqual(
    studyEntrySnapRanges({ active: usActive, overlays: [] }).map((r) => r.label),
    ['US Range'],
    'active alone still snaps when overlays off'
  )
}

{
  // Open range ±10: Nikkei (09:15–09:30 JST) + NY (09:45–10:00 ET)
  const nikkeiAfterOr15 = new Date('2026-07-28T00:35:00.000Z') // 09:35 JST
  const nikkeiDuringOr15 = new Date('2026-07-27T00:20:00.000Z') // 09:20 JST
  const nyAfterOr15 = new Date('2026-07-28T14:05:00.000Z') // 10:05 ET
  const nyDuringOr15 = new Date('2026-07-28T13:50:00.000Z') // 09:50 ET

  assert.equal(isOr30MorningEntryWindowOpen('NIKKEI', nikkeiAfterOr15), false)
  assert.equal(isOr30MorningEntryWindowOpen('NIKKEI', nikkeiDuringOr15), true)
  assert.equal(isOr30MorningEntryWindowOpen('DOW', nyAfterOr15), false)
  assert.equal(isOr30MorningEntryWindowOpen('NASDAQ', nyDuringOr15), true)

  const nikkeiAfterOr30 = new Date('2026-07-28T01:00:00.000Z') // 10:00 JST
  const nikkeiDuringOr30 = new Date('2026-07-27T00:35:00.000Z') // 09:35 JST
  const nyAfterOr30 = new Date('2026-07-28T14:30:00.000Z') // 10:30 ET
  const nyDuringOr30 = new Date('2026-07-28T14:05:00.000Z') // 10:05 ET

  const shaped = {
    or30: { high: 40_050, low: 39_950, complete: true as const },
    ib: { high: 40_100, low: 39_900 },
    usRange: { high: 40_000, low: 39_500, complete: true as const },
    lunchRange: { high: 18_500, low: 18_400, complete: true as const },
  }

  // Before first-hour IB lock (09:50 JST / 20:50 Montreal): US ±10 only
  const nikkeiBeforeIbLock = new Date('2026-07-28T00:50:00.000Z') // 09:50 JST
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiBeforeIbLock,
      showOr30: true,
      showIb: true,
      showUsRange: true,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['US Range'],
    'Nikkei before IB lock: paint US ±10 only — Tokyo IB waits until 21:00 Montreal'
  )

  // At/after first-hour lock during US Range tail (10:00 / 10:19 JST = 21:00 / 21:19 Montreal)
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiAfterOr30, // 10:00 JST
      showOr30: true,
      showIb: true,
      showUsRange: true,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['US Range', 'Tokyo IB'],
    'Nikkei at IB lock: US + Tokyo IB ±10 both paint (overlap to 21:45 Montreal)'
  )

  const nikkeiDuringUsAfterIbLock = new Date('2026-07-28T01:19:00.000Z') // 10:19 JST
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiDuringUsAfterIbLock,
      showOr30: true,
      showIb: true,
      showUsRange: true,
      ...shaped,
      morningAttempts: 1,
    }).map((o) => o.label),
    ['US Range', 'Tokyo IB'],
    'Nikkei 21:19 Montreal: Tokyo IB ±10 is hot after first-hour lock'
  )

  assert.ok(
    entryEligibleOverlayRanges({
      playbookMode: 'morning',
      instrument: 'NIKKEI',
      now: nikkeiDuringOr30,
      showOr30: true,
      showUsRange: true,
      showIb: true,
      ...shaped,
      morningAttempts: 0,
    })
      .map((o) => o.label)
      .includes('US Range'),
    'Nikkei after Open range: US Range ±10 eligible (OR30 is not a Tokyo playbook slot)'
  )

  assert.ok(
    !entryEligibleOverlayRanges({
      playbookMode: 'morning',
      instrument: 'DOW',
      now: nyAfterOr30,
      showOr30: true,
      showIb: true,
      showLunchRange: true,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    })
      .map((o) => o.label)
      .includes('OR30'),
    'NY after OR30 entryClose: OR30 ±10 excluded'
  )

  assert.ok(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      now: nyAfterOr30,
      showOr30: true,
      showIb: true,
      showLunchRange: true,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    })
      .map((o) => o.label)
      .includes('IB'),
    'NY IB playbook keeps IB ±10 after OR30 window'
  )

  assert.ok(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'DOW',
      now: new Date('2026-07-28T18:00:00.000Z'), // 14:00 ET
      showOr30: true,
      showIb: true,
      showLunchRange: true,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 2,
    })
      .map((o) => o.label)
      .includes('IB'),
    'NY IB playbook paints IB ±10; OR30 stay out'
  )
  assert.ok(
    !entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'DOW',
      now: new Date('2026-07-28T18:00:00.000Z'),
      showOr30: true,
      showIb: true,
      showLunchRange: true,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 2,
    })
      .map((o) => o.label)
      .includes('OR30'),
    'NY lunch window never resurrects OR30 ±10'
  )

  // Toggle OFF — ±10 tags stay dark until the trader clicks R / B / N / U.
  // Snap still uses studyEntrySnapRanges(active) independently of paint.
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      now: nyAfterOr30,
      showOr30: false,
      showIb: false,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    }).map((o) => o.label),
    [],
    'IB ±10 stays dark without B toggle even when IB playbook / bucket is live'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      now: nyAfterOr30,
      showOr30: false,
      showIb: true,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['IB'],
    'IB B toggle ON paints IB ±10 while IB bucket is open'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiAfterOr30,
      showOr30: false,
      showIb: false,
      showUsRange: false,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    [],
    'Nikkei US+IB clock: IB and US Range stay dark without B / U toggles'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiAfterOr30,
      showOr30: false,
      showIb: true,
      showUsRange: false,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['Tokyo IB'],
    'Nikkei after IB lock: B toggle ON paints Tokyo IB ±10; US stays dark without U'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'DOW',
      now: new Date('2026-07-28T18:00:00.000Z'),
      showOr30: false,
      showIb: false,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 2,
    }).map((o) => o.label),
    [],
    'Lunch ±10 stays dark without N toggle even when lunch playbook is live'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'or30',
      instrument: 'NASDAQ',
      now: nyDuringOr30,
      showOr30: false,
      showIb: false,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    }).map((o) => o.label),
    [],
    'OR30 ±10 stays dark without R toggle even during the morning window'
  )
  assert.ok(
    entryEligibleOverlayRanges({
      playbookMode: 'or30',
      instrument: 'NASDAQ',
      now: nyDuringOr30,
      showOr30: true,
      showIb: false,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 0,
    })
      .map((o) => o.label)
      .includes('OR30'),
    'OR30 R toggle ON paints ±10 during the OR30 window'
  )

  // Closed buckets: no ±10 invite. NY IB bucket stays open until lunch-range start (13:30).
  assert.ok(
    !entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NIKKEI',
      now: new Date('2026-07-28T05:00:00.000Z'), // 14:00 JST — Tokyo IB window
      showOr30: true,
      showIb: true,
      showUsRange: true,
      ...shaped,
      morningAttempts: 0,
    })
      .map((o) => o.label)
      .includes('US Range'),
    'US Range ±10 off after US entry clock (Tokyo IB playbook owns paint)'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NIKKEI',
      now: new Date('2026-07-28T05:00:00.000Z'), // 14:00 JST
      showOr30: false,
      showIb: true,
      showUsRange: true,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['Tokyo IB'],
    'Tokyo IB ±10 paints in its 10:00–15:00 desk / 21:00–02:00 Montreal window'
  )
  assert.ok(
    entryEligibleOverlayRanges({
      playbookMode: 'ib',
      instrument: 'NASDAQ',
      now: new Date('2026-07-28T15:30:00.000Z'), // 11:30 ET — still in IB window
      showOr30: false,
      showIb: true,
      showLunchRange: false,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 2,
    })
      .map((o) => o.label)
      .includes('IB'),
    'NY IB ±10 paints at 11:30 ET while IB bucket is open'
  )
  assert.ok(
    !entryEligibleOverlayRanges({
      playbookMode: 'done',
      instrument: 'NASDAQ',
      now: new Date('2026-07-28T19:20:00.000Z'), // 15:20 ET — IB entry closed
      showOr30: false,
      showIb: true,
      showLunchRange: true,
      or30: shaped.or30,
      ib: { high: 18_250, low: 18_050 },
      lunchRange: shaped.lunchRange,
      morningAttempts: 2,
    })
      .map((o) => o.label)
      .includes('IB'),
    'NY IB ±10 off after last-entry cutoff (15:15)'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiBeforeIbLock,
      showOr30: true,
      showIb: true,
      showUsRange: false,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    [],
    'Nikkei before IB lock: US ±10 stays dark without U toggle; Tokyo IB waits until 21:00'
  )
  assert.deepEqual(
    entryEligibleOverlayRanges({
      playbookMode: 'us_range',
      instrument: 'NIKKEI',
      now: nikkeiBeforeIbLock,
      showOr30: false,
      showIb: false,
      showUsRange: true,
      ...shaped,
      morningAttempts: 0,
    }).map((o) => o.label),
    ['US Range'],
    'Nikkei before IB lock: U toggle ON paints US ±10 only'
  )
}

console.log('strategy_risk_geometry: all passed')
