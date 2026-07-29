/**
 * Range edge entry gate unit tests.
 * Run: npx tsx __tests__/range_edge_entry_gate.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertRangeEdgeEntry,
  clampPriceToNearestRangeEdgeBands,
  clampPriceToRangeEdgeBands,
  clampPriceToRangeEdgeEnvelope,
  filterLevelsInRangeEdgeBand,
  isEntryWithinRangeEdgeBand,
  rangeEdgeBands,
  rangeEdgeBandsEnvelope,
  RANGE_EDGE_BAND_POINTS,
} from '../lib/trading/rangeEdgeEntryGate'

const range = { high: 40000, low: 39900, label: 'OR30' }

{
  assert.equal(RANGE_EDGE_BAND_POINTS, 10)
  const bands = rangeEdgeBands(range)
  assert.equal(bands.length, 2)
  assert.deepEqual(
    bands.map((b) => [b.edge, b.min, b.max]),
    [
      ['high', 39990, 40010],
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
  assert.equal(isEntryWithinRangeEdgeBand(39950, range), false, 'mid-range illegal')
  assert.equal(isEntryWithinRangeEdgeBand(40011, range), false)
  assert.equal(isEntryWithinRangeEdgeBand(39889, range), false)
}

{
  const ok = assertRangeEdgeEntry({ entry: 40005, range })
  assert.equal(ok.ok, true)
  const bad = assertRangeEdgeEntry({ entry: 39950, range })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.message, /within 10 pts/i)
  const missing = assertRangeEdgeEntry({ entry: 40000, range: null })
  assert.equal(missing.ok, false)
}

{
  const levels = [{ price: 40005 }, { price: 39950 }, { price: 39895 }]
  const kept = filterLevelsInRangeEdgeBand(levels, range)
  assert.deepEqual(
    kept.map((l) => l.price),
    [40005, 39895]
  )
}

{
  assert.equal(clampPriceToRangeEdgeBands(40005, range), 40005, 'in-band unchanged')
  assert.equal(clampPriceToRangeEdgeBands(39905, range), 39905, 'low band unchanged')
  assert.equal(clampPriceToRangeEdgeBands(39950, range), 39990, 'exact mid ties to high band edge')
  assert.equal(clampPriceToRangeEdgeBands(39980, range), 39990, 'near high snaps to high min')
  assert.equal(clampPriceToRangeEdgeBands(39920, range), 39910, 'near low snaps to low max')
  assert.equal(clampPriceToRangeEdgeBands(40050, range), 40010, 'above high clamps to high max')
  assert.equal(clampPriceToRangeEdgeBands(39800, range), 39890, 'below low clamps to low min')
  assert.equal(clampPriceToRangeEdgeBands(40000, null), null)
}

{
  // US Range H=40000 L=39500 · Tokyo IB H=40100 L=39900 · OR30 H=40050 L=39950
  const us = { high: 40000, low: 39500, label: 'US Range' }
  const ib = { high: 40100, low: 39900, label: 'Tokyo IB' }
  const or30 = { high: 40050, low: 39950, label: 'OR30' }
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
  // After free mid drag, release snap still lands on a legal edge band
  assert.equal(clampPriceToNearestRangeEdgeBands(39950, [range]), 39990)
  assert.equal(clampPriceToNearestRangeEdgeBands(39920, [range]), 39910)
}

console.log('range_edge_entry_gate: all passed')
