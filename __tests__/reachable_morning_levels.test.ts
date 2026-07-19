/**
 * Geometry: SHORT above open, BUY below open.
 * Levels may sit on overnight/London/HTF anywhere inside the candle universe.
 * Invented prices outside the chart range are rejected.
 * Run: npx tsx __tests__/reachable_morning_levels.test.ts
 */

import {
  filterReachableMorningLevels,
  referencePriceAtOpen,
  resolveDeskLevels,
  type DeskBar,
} from '../lib/trading/deskLevels'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const OPEN = 1_721_000_000
const ref = 29522.3

function barsAroundOpen(): DeskBar[] {
  const out: DeskBar[] = []
  // Overnight low far from open but still on the chart
  out.push({
    time: OPEN - 40 * 300,
    open: 28750,
    high: 28820,
    low: 28680,
    close: 28790,
    volume: 200,
  })
  for (let i = 79; i >= 1; i--) {
    const t = OPEN - i * 300
    const base = 29500 + Math.sin(i / 5) * 400
    out.push({
      time: t,
      open: base,
      high: base + 80,
      low: base - 80,
      // Chronological last pre-open bar closes at cash-open reference
      close: i === 1 ? ref : base + 10,
      volume: 100,
    })
  }
  out.push({
    time: OPEN,
    open: ref,
    high: ref + 50,
    low: ref - 40,
    close: ref + 20,
    volume: 100,
  })
  return out
}

const candles = barsAroundOpen()
assert(Math.abs((referencePriceAtOpen(candles, OPEN) ?? 0) - ref) < 0.01, 'ref = pre-open close')

// SHORT below open is invalid geometry (user bug)
const wrongSide = filterReachableMorningLevels(
  [
    { level: 26136.5, type: 'resistance', conviction: 10, source: 'ai' },
    { level: 25953.91, type: 'support', conviction: 8, source: 'ai' },
  ],
  candles,
  OPEN,
  'America/New_York'
)
assert(wrongSide.length === 0, 'SHORT/BUY on wrong side or outside candle range dropped')

// Far-from-open but ON the overnight print — valid day-trader BUY
const overnightBuy = filterReachableMorningLevels(
  [{ level: 28690, type: 'support', conviction: 9, source: 'ai' }],
  candles,
  OPEN,
  'America/New_York'
)
assert(overnightBuy.length === 1, 'overnight/London-style level below open is allowed')

// SHORT above open inside recent highs — valid
const okShort = filterReachableMorningLevels(
  [{ level: 29850, type: 'resistance', conviction: 9, source: 'ai' }],
  candles,
  OPEN,
  'America/New_York'
)
assert(okShort.length === 1, 'SHORT above open kept')

const resolved = resolveDeskLevels(
  [
    { level: 26136.5, type: 'resistance', conviction: 10 },
    { level: 25953.91, type: 'support', conviction: 8 },
  ],
  candles,
  OPEN,
  'America/New_York',
  'none'
)
assert(resolved.source === 'structure', 'hallucinated AI → structure fallback')
assert(resolved.levels.length > 0, 'structure still provides levels')

console.log('✅ reachable_morning_levels: side geometry + candle-range; HTF distance OK')
