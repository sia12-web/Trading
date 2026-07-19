/**
 * Chart click snap + hover SL/TP preview.
 * Run: npx tsx __tests__/chart_level_pick.test.ts
 */

import {
  CHART_CLICK_DRAG_PX,
  CHART_LEVEL_SNAP_PCT,
  directionFromChartLevel,
  isChartDragGesture,
  previewLevelOrderPrices,
  resolveChartLimitPick,
} from '../lib/trading/chartLevelPick'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const aiBuy = {
  price: 42150,
  type: 'support',
  source: 'ai' as const,
  side: 'BUY' as const,
  reasoning: 'liquidity',
}
const aiShort = {
  price: 42500,
  type: 'resistance',
  source: 'ai' as const,
  side: 'SHORT' as const,
}

{
  const p = resolveChartLimitPick({
    rawPrice: 42148,
    levels: [aiBuy],
    levelsVisible: true,
  })
  assert(p.source === 'ai', 'visible: snap to AI')
  assert(p.price === 42150, 'snapped price')
  assert(p.matched?.price === 42150, 'matched')
}

{
  const p = resolveChartLimitPick({
    rawPrice: 42148,
    levels: [aiBuy],
    levelsVisible: false,
  })
  assert(p.source === 'manual', 'hidden: never snap to AI')
  assert(p.price === 42148, 'keeps click price')
  assert(p.matched === null, 'no match when hidden')
}

{
  const p = resolveChartLimitPick({
    rawPrice: 43000,
    levels: [aiBuy],
    levelsVisible: true,
  })
  assert(p.source === 'manual', 'far click stays manual even when visible')
}

{
  const edge = 42150 * (1 + CHART_LEVEL_SNAP_PCT + 0.0001)
  const p = resolveChartLimitPick({
    rawPrice: edge,
    levels: [aiBuy],
    levelsVisible: true,
  })
  assert(p.source === 'manual', 'outside snap band')
}

assert(directionFromChartLevel(aiBuy) === 'LONG', 'BUY → LONG')
assert(directionFromChartLevel(aiShort) === 'SHORT', 'SHORT → SHORT')
assert(
  directionFromChartLevel({ price: 1, type: 'resistance' }) === 'SHORT',
  'resistance → SHORT'
)

{
  const prev = previewLevelOrderPrices({ level: aiBuy, instrument: 'DOW' })
  assert(prev != null, 'preview exists')
  assert(prev!.direction === 'LONG', 'LONG preview')
  assert(prev!.entry === 42150 || prev!.entry > 0, 'entry')
  assert(prev!.stop < prev!.entry, 'LONG stop below entry')
  assert(prev!.target > prev!.entry, 'LONG target above entry')
}

{
  const prev = previewLevelOrderPrices({ level: aiShort, instrument: 'DOW' })
  assert(prev != null, 'short preview')
  assert(prev!.direction === 'SHORT', 'SHORT')
  assert(prev!.stop > prev!.entry, 'SHORT stop above')
  assert(prev!.target < prev!.entry, 'SHORT target below')
}

assert(!isChartDragGesture(100, 100, 102, 101), 'tiny move = click')
assert(isChartDragGesture(100, 100, 100 + CHART_CLICK_DRAG_PX + 1, 100), 'pan = drag')

console.log('chart_level_pick: all passed')
