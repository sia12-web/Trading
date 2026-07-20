/**
 * Pure Live Voice level-tag helpers — safe for client + server.
 * (Keep server I/O out of this file so LiveVoicePanel can import it.)
 */

export const LIVE_VOICE_MAX_REACTIONS_PER_LEVEL = 2
/** Relative distance to count as a tip “tag” (~0.05%). */
export const LIVE_VOICE_TAG_PCT = 0.0005

export type LevelTagVerdict = 'tagged' | 'held' | 'broke'

export type LevelTagEvent = {
  price: number
  tipPrice: number
  side: 'BUY' | 'SHORT' | null
  source: 'pin' | 'ai'
  verdict: LevelTagVerdict
}

export function tagDistance(levelPrice: number): number {
  return Math.max(levelPrice * LIVE_VOICE_TAG_PCT, 1.5)
}

/** Pure: is tip within tag band of level? */
export function isTipTaggingLevel(tip: number, level: number): boolean {
  if (!(tip > 0) || !(level > 0)) return false
  return Math.abs(tip - level) <= tagDistance(level)
}

/**
 * Classify progression after a prior tag.
 * BUY broke = tip pushed meaningfully below; held = tip left upward.
 * SHORT broke = tip pushed meaningfully above; held = tip left downward.
 */
export function classifyLevelReaction(args: {
  tip: number
  level: number
  side: 'BUY' | 'SHORT' | null
  wasTagged: boolean
}): LevelTagVerdict | null {
  const { tip, level, side, wasTagged } = args
  if (!wasTagged) {
    return isTipTaggingLevel(tip, level) ? 'tagged' : null
  }
  const dist = tagDistance(level)
  if (isTipTaggingLevel(tip, level)) return null // still at level — no new event

  if (side === 'BUY') {
    if (tip < level - dist) return 'broke'
    if (tip > level + dist) return 'held'
    return null
  }
  if (side === 'SHORT') {
    if (tip > level + dist) return 'broke'
    if (tip < level - dist) return 'held'
    return null
  }
  // Unknown side: leaving the band after a tag = held (no clear break direction)
  if (Math.abs(tip - level) > dist * 2) return 'held'
  return null
}

export function buildLevelTagReactionText(ev: LevelTagEvent): string {
  const label = `${ev.side ? `${ev.side} ` : ''}${ev.price.toLocaleString()}`
  const src = ev.source === 'pin' ? 'your pin' : 'AI level'
  if (ev.verdict === 'tagged') {
    return `Price tagged ${src} ${label}. Watch hold versus break — you place the limit, not me.`
  }
  if (ev.verdict === 'broke') {
    return `${src} ${label} looks broken through. Invalidate that plan unless you see a clean reclaim.`
  }
  return `${src} ${label} held. Plan still valid if it fits your first-45-minute rules and attempts left.`
}

/** Prefer pin over AI when the same price appears twice in watch lists. */
export function dedupeWatchLevels<T extends { price: number; source: 'pin' | 'ai' }>(
  levels: T[]
): T[] {
  const byPrice = new Map<number, T>()
  for (const l of levels) {
    const key = Math.round(l.price * 100) / 100
    const prev = byPrice.get(key)
    if (!prev || (prev.source === 'ai' && l.source === 'pin')) {
      byPrice.set(key, l)
    }
  }
  return Array.from(byPrice.values())
}
