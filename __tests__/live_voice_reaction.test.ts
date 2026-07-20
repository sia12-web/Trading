/**
 * Live Voice level-tag classification.
 * Run: npx tsx __tests__/live_voice_reaction.test.ts
 */

import {
  buildLevelTagReactionText,
  classifyLevelReaction,
  dedupeWatchLevels,
  isTipTaggingLevel,
  LIVE_VOICE_MAX_REACTIONS_PER_LEVEL,
} from '../lib/trading/liveVoiceReactionCore'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(LIVE_VOICE_MAX_REACTIONS_PER_LEVEL === 2, 'max 2 per level')

assert(isTipTaggingLevel(42150, 42150), 'exact tag')
assert(isTipTaggingLevel(42160, 42150), 'near tag')
assert(!isTipTaggingLevel(43000, 42150), 'far not tag')

assert(
  classifyLevelReaction({ tip: 42150, level: 42150, side: 'BUY', wasTagged: false }) ===
    'tagged',
  'first touch tagged'
)
assert(
  classifyLevelReaction({ tip: 42000, level: 42150, side: 'BUY', wasTagged: true }) ===
    'broke',
  'BUY broke below'
)
assert(
  classifyLevelReaction({ tip: 42300, level: 42150, side: 'BUY', wasTagged: true }) ===
    'held',
  'BUY held above'
)
assert(
  classifyLevelReaction({ tip: 42600, level: 42500, side: 'SHORT', wasTagged: true }) ===
    'broke',
  'SHORT broke above'
)

const text = buildLevelTagReactionText({
  price: 42150,
  tipPrice: 42148,
  side: 'BUY',
  source: 'pin',
  verdict: 'tagged',
})
assert(text.includes('42150') || text.includes('42,150'), 'mentions price')
assert(text.toLowerCase().includes('place'), 'reminds trader places limit')
assert(!text.toLowerCase().includes('i will place'), 'never offers to place')

{
  const d = dedupeWatchLevels([
    { price: 42150, source: 'ai' as const, side: 'BUY' as const },
    { price: 42150, source: 'pin' as const, side: 'BUY' as const },
    { price: 42200, source: 'ai' as const, side: 'SHORT' as const },
  ])
  assert(d.length === 2, 'dedupe same price')
  assert(d.find((x) => x.price === 42150)?.source === 'pin', 'pin wins over ai')
}

assert(
  classifyLevelReaction({ tip: 42150, level: 42150, side: 'BUY', wasTagged: true }) === null,
  'no duplicate tagged while still at level'
)
assert(
  classifyLevelReaction({ tip: 42400, level: 42500, side: 'SHORT', wasTagged: true }) ===
    'held',
  'SHORT held below'
)

console.log('live_voice_reaction: all passed')
