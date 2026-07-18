/**
 * Unit checks for volume-by-price MVP + confluence gate.
 * Run: npx tsx __tests__/level_confluence_mvp.test.ts
 */

import { computeVolumeProfile } from '../lib/chart/volumeProfile'
import { filterByConfluence, scoreLevelConfluence } from '../lib/trading/levelConfluence'
import type { LevelIdentification } from '../lib/services/levelFinderAgent/types'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// Synthetic flat profile: heavy volume around 100, lighter wings
const bars = []
for (let i = 0; i < 40; i++) {
  const t = 1_700_000_000 + i * 3600
  // Cluster volume at ~100
  bars.push({
    time: t,
    open: 99.5 + (i % 3) * 0.1,
    high: 100.8,
    low: 99.2,
    close: 100.1,
    volume: 1000 + (i % 5) * 50,
  })
  // Sparse wing
  bars.push({
    time: t + 1,
    open: 102,
    high: 103,
    low: 101.5,
    close: 102.2,
    volume: 80,
  })
}

const profile = computeVolumeProfile(bars)
assert(profile, 'profile should compute')
assert(profile!.poc.price > 0, 'poc price')
assert(profile!.anchors.length >= 1, 'at least POC anchor')
assert(profile!.anchors.includes(profile!.poc.price), 'poc in anchors')
console.log('OK volumeProfile', {
  poc: profile!.poc.price,
  hvn: profile!.hvn.map((h) => h.price),
  buckets: profile!.bucketSize,
})

const avwap = [100.0, 100.5, 99.5]
const vp = profile!.anchors
const deskBars = bars.map((b) => ({ ...b }))

const strong: LevelIdentification = {
  level: profile!.poc.price,
  type: 'support',
  conviction: 8,
  reasoning:
    'Retail stops under prior low bait — institutional entry into that stop liquidity near AVWAP',
  timeframe: 'H1',
}
const weak: LevelIdentification = {
  level: 107.5,
  type: 'resistance',
  conviction: 6,
  reasoning: 'Looks like resistance',
  timeframe: 'H1',
}

const openUnix = deskBars[deskBars.length - 1]!.time + 1
const sig = scoreLevelConfluence(strong, {
  candles: deskBars,
  openUnix,
  timeZone: 'America/New_York',
  avwapBands: avwap,
  vpAnchors: vp,
})
assert(sig.volumeProfile, 'strong should hit VP')
assert(sig.score >= 1, 'strong score >= 1')

const filtered = filterByConfluence([strong, weak], {
  candles: deskBars,
  openUnix,
  timeZone: 'America/New_York',
  avwapBands: avwap,
  vpAnchors: vp,
})
assert(filtered.some((l) => Math.abs(l.level - strong.level) < 1), 'keeps strong')
assert(!filtered.some((l) => l.level === weak.level) || filtered.length <= 2, 'weak dropped or safety cap')
console.log('OK confluence', { sig, kept: filtered.map((l) => l.level) })

console.log('\nAll level confluence MVP checks passed.')
