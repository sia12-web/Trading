/**
 * AI must not propose SHORT below cash open / BUY above it, or levels
 * thousands of points from the open (unreachable in the morning window).
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

const OPEN = 1_721_000_000 // arbitrary unix
const ref = 29522.3

function barsAroundOpen(): DeskBar[] {
  const out: DeskBar[] = []
  // Prior day ~28.8k–30.1k then open at ~29.5k
  for (let i = 80; i >= 1; i--) {
    const t = OPEN - i * 300
    const base = 29500 + Math.sin(i / 5) * 400
    out.push({
      time: t,
      open: base,
      high: base + 80,
      low: base - 80,
      // Last pre-open bar closes at cash-open reference
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

// Crazy AI short ~3.4k BELOW open (user screenshot)
const crazy = filterReachableMorningLevels(
  [
    {
      level: 26136.5,
      type: 'resistance',
      conviction: 10,
      source: 'ai',
      reasoning: 'stale',
    },
    {
      level: 25953.91,
      type: 'support',
      conviction: 8,
      source: 'ai',
    },
  ],
  candles,
  OPEN,
  'America/New_York'
)
assert(crazy.length === 0, 'absurd AI levels below open must be dropped')

// Valid: SHORT above open, BUY below open within prior range
const ok = filterReachableMorningLevels(
  [
    { level: 29850, type: 'resistance', conviction: 9, source: 'ai' },
    { level: 29200, type: 'support', conviction: 8, source: 'ai' },
  ],
  candles,
  OPEN,
  'America/New_York'
)
assert(ok.length === 2, 'reachable levels kept')

// resolveDeskLevels falls back to structure when AI is all junk
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
assert(resolved.source === 'structure', 'junk AI → structure fallback')
assert(resolved.levels.length > 0, 'structure still provides levels')
for (const l of resolved.levels) {
  const isShort = String(l.type).toLowerCase().includes('resist')
  if (isShort) {
    assert(l.level > ref, `structure SHORT ${l.level} must be above open ${ref}`)
  } else {
    assert(l.level < ref, `structure BUY ${l.level} must be below open ${ref}`)
  }
}

console.log('✅ reachable_morning_levels: absurd AI shorts/buys rejected')
