/**
 * Range edge entry gate unit tests.
 * Run: npx tsx __tests__/range_edge_entry_gate.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertRangeEdgeEntry,
  attributePlaybookBandEntry,
  clampPriceToNearestRangeEdgeBands,
  clampPriceToRangeEdgeBands,
  clampPriceToRangeEdgeEnvelope,
  filterLevelsInRangeEdgeBand,
  findRangeEdgeBandHit,
  isEntryWithinRangeEdgeBand,
  nearestRangeEdge,
  rangeAllowsMidEdge,
  rangeEdgeBandLegend,
  rangeEdgeBands,
  rangeEdgeBandsEnvelope,
  rangeMidpoint,
  snapEntryToOpenBandCenter,
  snapEntryToNearestOpenBandCenter,
  RANGE_EDGE_BAND_POINTS,
  RANGE_EDGE_OFF_BAND_MESSAGE,
  RANGE_EDGE_US_MID_REJECTED_MESSAGE,
} from '../lib/trading/rangeEdgeEntryGate'

const range = { high: 40000, low: 39900, label: 'OR30' }

{
  assert.equal(RANGE_EDGE_BAND_POINTS, 10)
  assert.equal(rangeMidpoint(range), 39950)
  const bands = rangeEdgeBands(range)
  assert.equal(bands.length, 3)
  assert.deepEqual(
    bands.map((b) => [b.edge, b.min, b.max]),
    [
      ['high', 39990, 40010],
      ['mid', 39940, 39960],
      ['low', 39890, 39910],
    ]
  )
}

{
  assert.equal(isEntryWithinRangeEdgeBand(40000, range), true)
  assert.equal(isEntryWithinRangeEdgeBand(40010, range), true)
  assert.equal(isEntryWithinRangeEdgeBand(39990, range), true)
  assert.equal(isEntryWithinRangeEdgeBand(39900, range), true)
  assert.equal(isEntryWithinRangeEdgeBand(39910, range), true)
  assert.equal(isEntryWithinRangeEdgeBand(39950, range), true, '50% mid is legal')
  assert.equal(isEntryWithinRangeEdgeBand(39945, range), true, 'mid band interior')
  assert.equal(isEntryWithinRangeEdgeBand(39970, range), false, 'between mid and high illegal')
  assert.equal(isEntryWithinRangeEdgeBand(40011, range), false)
  assert.equal(isEntryWithinRangeEdgeBand(39889, range), false)
}

{
  const ok = assertRangeEdgeEntry({ entry: 40005, range })
  assert.equal(ok.ok, true)
  const midOk = assertRangeEdgeEntry({ entry: 39950, range })
  assert.equal(midOk.ok, true)
  const bad = assertRangeEdgeEntry({ entry: 39970, range })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.message, /highlighted ±10 H\/Mid\/L/i)
  const missing = assertRangeEdgeEntry({ entry: 40000, range: null })
  assert.equal(missing.ok, false)
}

{
  const levels = [{ price: 40005 }, { price: 39950 }, { price: 39970 }, { price: 39895 }]
  const kept = filterLevelsInRangeEdgeBand(levels, range)
  assert.deepEqual(
    kept.map((l) => l.price),
    [40005, 39950, 39895]
  )
}

{
  assert.equal(clampPriceToRangeEdgeBands(40005, range), 40005, 'in-band unchanged')
  assert.equal(clampPriceToRangeEdgeBands(39905, range), 39905, 'low band unchanged')
  assert.equal(clampPriceToRangeEdgeBands(39950, range), 39950, 'exact mid stays')
  assert.equal(clampPriceToRangeEdgeBands(39955, range), 39955, 'mid band interior')
  assert.equal(clampPriceToRangeEdgeBands(39980, range), 39990, 'near high snaps to high min')
  assert.equal(clampPriceToRangeEdgeBands(39920, range), 39910, 'near low snaps to low max')
  assert.equal(clampPriceToRangeEdgeBands(39965, range), 39960, 'between mid/high snaps to mid max')
  assert.equal(clampPriceToRangeEdgeBands(40050, range), 40010, 'above high clamps to high max')
  assert.equal(clampPriceToRangeEdgeBands(39800, range), 39890, 'below low clamps to low min')
  assert.equal(clampPriceToRangeEdgeBands(40000, null), null)
}

{
  assert.equal(nearestRangeEdge(39950, range), 'mid')
  assert.equal(nearestRangeEdge(40000, range), 'high')
  assert.equal(nearestRangeEdge(39900, range), 'low')
}

{
  // US Range H=40000 L=39500 · Tokyo IB H=40100 L=39900 · OR30 H=40050 L=39950
  const us = { high: 40000, low: 39500, label: 'US Range' }
  const ib = { high: 40100, low: 39900, label: 'Tokyo IB' }
  const or30 = { high: 40050, low: 39950, label: 'OR30' }
  assert.equal(rangeAllowsMidEdge(us), false, 'US Range drops mid')
  assert.equal(rangeEdgeBandLegend(us), 'H / L')
  assert.equal(rangeEdgeBands(us).length, 2, 'US Range has H/L only')
  assert.equal(rangeEdgeBands(us).some((b) => b.edge === 'mid'), false)
  assert.equal(
    clampPriceToNearestRangeEdgeBands(40095, [us, ib, or30]),
    40095,
    'in Tokyo IB high band stays put (not yanked to US)'
  )
  assert.equal(
    clampPriceToNearestRangeEdgeBands(40005, [us, ib, or30]),
    40005,
    'in US high band stays put'
  )
  // Former US mid (39750) is no longer a legal magnet on US alone
  assert.equal(
    clampPriceToRangeEdgeBands(39750, us),
    39990,
    'US mid price snaps to nearest legal US high band (not mid)'
  )
  assert.equal(
    isEntryWithinRangeEdgeBand(39750, us),
    false,
    'US 50% mid is off-band'
  )
  assert.equal(
    clampPriceToNearestRangeEdgeBands(40045, [us, ib, or30]),
    40045,
    'in OR30 high band stays put'
  )
  assert.equal(
    clampPriceToNearestRangeEdgeBands(40085, [us, ib, or30]),
    40090,
    'near Tokyo IB high snaps to IB high band (not US)'
  )
  assert.equal(
    clampPriceToNearestRangeEdgeBands(40062, [us, ib, or30]),
    40060,
    'near OR30 high snaps to OR30 high band (not US)'
  )
  assert.equal(
    clampPriceToNearestRangeEdgeBands(39480, [us, ib, or30]),
    39490,
    'below US low snaps to US low band'
  )
  assert.equal(clampPriceToNearestRangeEdgeBands(40000, []), null)
  assert.equal(clampPriceToNearestRangeEdgeBands(40000, [null]), null)
}

{
  // Continuous nearest-band clamp traps drag on the high edge; envelope must
  // span high↔low so dragging down through mid-range stays free until release snap.
  const env = rangeEdgeBandsEnvelope([range])
  assert.deepEqual(env, { min: 39890, max: 40010 })
  assert.equal(clampPriceToRangeEdgeEnvelope(39950, [range]), 39950, 'mid-range free during drag')
  assert.equal(clampPriceToRangeEdgeEnvelope(39980, [range]), 39980, 'just below high band stays put')
  assert.equal(clampPriceToRangeEdgeEnvelope(39920, [range]), 39920, 'just above low band stays put')
  assert.equal(clampPriceToRangeEdgeEnvelope(40100, [range]), 40010, 'above envelope clamps to max')
  assert.equal(clampPriceToRangeEdgeEnvelope(39800, [range]), 39890, 'below envelope clamps to min')
  assert.equal(clampPriceToRangeEdgeEnvelope(39950, []), null)
  // After free mid drag, release snap lands on nearest legal band (mid preferred at exact mid)
  assert.equal(clampPriceToNearestRangeEdgeBands(39950, [range]), 39950)
  assert.equal(clampPriceToNearestRangeEdgeBands(39920, [range]), 39910)
  assert.equal(clampPriceToNearestRangeEdgeBands(39970, [range]), 39960)
}

{
  const hitHigh = findRangeEdgeBandHit(40005, [range])
  assert.equal(hitHigh?.edge, 'high')
  assert.equal(hitHigh?.center, 40000)
  const hitLow = findRangeEdgeBandHit(39905, [range])
  assert.equal(hitLow?.edge, 'low')
  assert.equal(hitLow?.center, 39900)
  const hitMid = findRangeEdgeBandHit(39950, [range])
  assert.equal(hitMid?.edge, 'mid')
  assert.equal(hitMid?.center, 39950)
  assert.equal(findRangeEdgeBandHit(39970, [range]), null, 'gap between mid and high is not a hit')
}

{
  // 50% mid for OR30 / IB / lunch; US Range is H/L only
  const midOkRanges: Array<{ instrument: string; label: string; high: number; low: number }> = [
    { instrument: 'DOW', label: 'OR30', high: 42_200, low: 42_000 },
    { instrument: 'DOW', label: 'IB', high: 42_300, low: 41_900 },
    { instrument: 'DOW', label: 'Lunch-range', high: 42_400, low: 42_100 },
    { instrument: 'NASDAQ', label: 'OR30', high: 18_200, low: 18_100 },
    { instrument: 'NASDAQ', label: 'IB', high: 18_250, low: 18_050 },
    { instrument: 'NASDAQ', label: 'Lunch-range', high: 18_500, low: 18_400 },
    { instrument: 'NIKKEI', label: 'OR30', high: 40_050, low: 39_950 },
    { instrument: 'NIKKEI', label: 'Tokyo IB', high: 40_100, low: 39_900 },
  ]
  for (const r of midOkRanges) {
    const mid = rangeMidpoint(r)
    assert.ok(mid != null, `${r.instrument} ${r.label} mid`)
    const bands = rangeEdgeBands(r)
    assert.equal(bands.length, 3, `${r.instrument} ${r.label} has H/mid/L bands`)
    assert.equal(bands[1]!.edge, 'mid')
    assert.equal(bands[1]!.center, mid)
    const ok = assertRangeEdgeEntry({ entry: mid!, range: r })
    assert.equal(ok.ok, true, `${r.instrument} ${r.label} 50% mid is a legal entry`)
    const hit = findRangeEdgeBandHit(mid!, [r])
    assert.equal(hit?.edge, 'mid', `${r.instrument} ${r.label} click hits 50%`)
  }

  const us = { instrument: 'NIKKEI', label: 'US Range', high: 40_000, low: 39_500 }
  const usMid = rangeMidpoint(us)!
  assert.equal(rangeAllowsMidEdge(us), false)
  assert.equal(rangeEdgeBands(us).length, 2, 'US Range H/L only')
  assert.equal(isEntryWithinRangeEdgeBand(usMid, us), false, 'US mid not in-band')
  assert.equal(findRangeEdgeBandHit(usMid, [us]), null, 'US mid click is not a hit')
  assert.equal(nearestRangeEdge(usMid, us), 'high', 'US mid nearest is H or L, not mid')
  const usMidReject = assertRangeEdgeEntry({ entry: usMid, range: us })
  assert.equal(usMidReject.ok, false, 'US Range 50% mid rejected')
  if (!usMidReject.ok) {
    assert.equal(usMidReject.message, RANGE_EDGE_US_MID_REJECTED_MESSAGE)
  }
  const usHigh = assertRangeEdgeEntry({ entry: 40_000, range: us })
  assert.equal(usHigh.ok, true, 'US Range high still legal')
  const usLow = assertRangeEdgeEntry({ entry: 39_500, range: us })
  assert.equal(usLow.ok, true, 'US Range low still legal')
}

{
  // Reject off-band — never silently accept a clamped substitute as legal entry.
  const ib = { high: 40_100, low: 39_900, label: 'IB' }
  for (const entry of [40_100, 40_000, 39_900]) {
    const ok = assertRangeEdgeEntry({ entry, range: ib })
    assert.equal(ok.ok, true, `IB band entry ${entry} OK`)
  }
  const offBand = assertRangeEdgeEntry({ entry: 40_050, range: ib })
  assert.equal(offBand.ok, false, 'mid-gap between IB bands rejected')
  if (!offBand.ok) assert.equal(offBand.message, RANGE_EDGE_OFF_BAND_MESSAGE)

  const clamped = clampPriceToRangeEdgeBands(40_050, ib)
  assert.notEqual(clamped, 40_050, 'clamp moves off-band price')
  const clampedCheck = assertRangeEdgeEntry({ entry: clamped!, range: ib })
  assert.equal(clampedCheck.ok, true, 'clamped price lands in legal band')
  assert.notEqual(40_050, clamped, 'policy: reject original — do not silently trade clamped level')
}

{
  // Place/snap: in-band → band center; outside → null (hard reject, no soft place)
  const us = { high: 40_000, low: 39_500, label: 'US Range' }
  const ib = { high: 40_100, low: 39_900, label: 'Tokyo IB' }
  const snapHigh = snapEntryToOpenBandCenter({
    entry: 40_005,
    candidates: [us, ib],
    preferLabel: 'US Range',
  })
  assert.equal(snapHigh?.price, 40_000, 'US high band snaps to high center')
  assert.equal(snapHigh?.hit.edge, 'high')
  assert.equal(snapHigh?.hit.range.label, 'US Range')

  const snapIb = snapEntryToOpenBandCenter({
    entry: 40_095,
    candidates: [us, ib],
    preferLabel: 'US Range',
  })
  assert.equal(snapIb?.price, 40_100, 'Tokyo IB-only click snaps to IB high')
  assert.equal(snapIb?.hit.range.label, 'Tokyo IB')

  assert.equal(
    snapEntryToOpenBandCenter({ entry: 39_750, candidates: [us, ib] }),
    null,
    'US mid / gap rejects — no soft snap place'
  )
  assert.equal(
    snapEntryToOpenBandCenter({ entry: 40_050, candidates: [us, ib] }),
    null,
    'between US high and IB mid rejects'
  )

  // liveOk closed → not placeable even if painted
  const closed = snapEntryToOpenBandCenter({
    entry: 40_100,
    candidates: [us, ib],
    liveOk: (r) => r.label === 'US Range',
  })
  assert.equal(closed, null, 'closed-bucket band is not a placeable snap')

  const usMidReject = snapEntryToOpenBandCenter({
    entry: (us.high + us.low) / 2,
    candidates: [us],
  })
  assert.equal(usMidReject, null, 'US Range mid is never a placeable snap')

  // Limit / place-near: nearest live band center when price is between bands
  const nearest = snapEntryToNearestOpenBandCenter({
    entry: 40_050,
    candidates: [us, ib],
    preferLabel: 'Tokyo IB',
    liveOk: (r) => r.label === 'Tokyo IB',
  })
  assert.equal(nearest?.price, 40_100, 'nearest live IB high when mid-gap')
  assert.equal(nearest?.hit.range.label, 'Tokyo IB')

  const nearestUs = snapEntryToNearestOpenBandCenter({
    entry: 39_750,
    candidates: [us, ib],
    preferLabel: 'US Range',
    liveOk: (r) => r.label === 'US Range',
  })
  assert.equal(
    nearestUs?.price === us.high || nearestUs?.price === us.low,
    true,
    'US mid snaps to nearest US H or L (no mid band)'
  )

  // Edge-distance nearest: price in the upper gap nearer the high ±10 band must
  // lock high center — not mid — so Limit near H+ / H− does not bias 50%.
  const ibWide = { high: 40_200, low: 40_000, label: 'IB' }
  const nearHighGap = snapEntryToNearestOpenBandCenter({
    entry: 40_175, // outside mid (±10 of 40100) and outside high (±10 of 40200); closer to high band
    candidates: [ibWide],
  })
  assert.equal(nearHighGap?.price, 40_200, 'gap nearer high band → high center')
  assert.equal(nearHighGap?.hit.edge, 'high')

  const nearLowGap = snapEntryToNearestOpenBandCenter({
    entry: 40_025,
    candidates: [ibWide],
  })
  assert.equal(nearLowGap?.price, 40_000, 'gap nearer low band → low center')
  assert.equal(nearLowGap?.hit.edge, 'low')

  const nearMidGap = snapEntryToNearestOpenBandCenter({
    entry: 40_100,
    candidates: [ibWide],
  })
  assert.equal(nearMidGap?.price, 40_100, 'exact mid → mid center')
  assert.equal(nearMidGap?.hit.edge, 'mid')

  // In-band click prices lock that edge center (H / Mid / L), never always mid
  assert.equal(
    snapEntryToOpenBandCenter({ entry: 40_198, candidates: [ibWide] })?.hit.edge,
    'high',
    'IB high-band click → high'
  )
  assert.equal(
    snapEntryToOpenBandCenter({ entry: 40_102, candidates: [ibWide] })?.hit.edge,
    'mid',
    'IB mid-band click → mid'
  )
  assert.equal(
    snapEntryToOpenBandCenter({ entry: 40_005, candidates: [ibWide] })?.hit.edge,
    'low',
    'IB low-band click → low'
  )
  assert.equal(
    snapEntryToOpenBandCenter({
      entry: (us.high + us.low) / 2,
      candidates: [us],
    }),
    null,
    'US Range mid still not placeable'
  )

  assert.equal(
    snapEntryToNearestOpenBandCenter({
      entry: 40_050,
      candidates: [us, ib],
      liveOk: () => false,
    }),
    null,
    'no live bands → nearest snap rejects'
  )

  // Overlap during US+Tokyo IB both live: US high == Tokyo IB mid must stay US H/L
  const bothLive = (r: { label?: string | null }) =>
    r.label === 'US Range' || r.label === 'Tokyo IB'
  const usHighVsIbMid = attributePlaybookBandEntry({
    entry: us.high,
    candidates: [ib, us], // IB listed first (would win nearest-only)
    preferLabel: 'Tokyo IB',
    liveOk: bothLive,
  })
  assert.equal(usHighVsIbMid?.range.label, 'US Range', 'US H beats Tokyo IB mid when both live')
  assert.equal(usHighVsIbMid?.edge, 'high')

  const usLowSnap = snapEntryToOpenBandCenter({
    entry: us.low,
    candidates: [ib, us],
    preferLabel: 'Tokyo IB',
    liveOk: bothLive,
  })
  assert.equal(usLowSnap?.hit.range.label, 'US Range', 'US L placeable when both live')
  assert.equal(usLowSnap?.price, us.low)

  const ibOnlyHigh = snapEntryToOpenBandCenter({
    entry: ib.high,
    candidates: [ib, us],
    preferLabel: 'US Range',
    liveOk: bothLive,
  })
  assert.equal(ibOnlyHigh?.hit.range.label, 'Tokyo IB', 'Tokyo IB-only H still places as IB')
}

console.log('range_edge_entry_gate: all passed')
