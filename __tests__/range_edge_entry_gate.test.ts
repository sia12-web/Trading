/**
 * Range edge entry gate unit tests.
 * Run: npx tsx __tests__/range_edge_entry_gate.test.ts
 */
import assert from 'node:assert/strict'
import {
  assertRangeEdgeEntry,
  clampPriceToRangeEdgeBands,
  filterLevelsInRangeEdgeBand,
  isEntryWithinRangeEdgeBand,
  rangeEdgeBands,
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

console.log('range_edge_entry_gate: all passed')
