/**
 * Post-AI confluence gate for Level Finder.
 * Keep a level only when ≥2 of: stop-pool / AVWAP band / POC|HVN agree.
 */

import { collectBaitExtremes, type DeskBar } from '@/lib/trading/deskLevels'
import type { LevelIdentification } from '@/lib/services/levelFinderAgent/types'

const NEAR_PCT = 0.0015 // 0.15%

export type ConfluenceSignals = {
  stopPool: boolean
  avwap: boolean
  volumeProfile: boolean
  score: number
}

function nearAny(price: number, anchors: number[], tolPct = NEAR_PCT): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  for (const a of anchors) {
    if (!Number.isFinite(a) || a <= 0) continue
    if (Math.abs(price - a) / a <= tolPct) return true
  }
  return false
}

function stopPoolHit(
  level: LevelIdentification,
  candles: DeskBar[],
  openUnix: number,
  timeZone: string
): boolean {
  const reasoning = (level.reasoning || '').toLowerCase()
  if (
    /stop|liquidity|bait|beyond|hunt|pool/.test(reasoning) &&
    /(retail|institutional|desk|above|below|under|over)/.test(reasoning)
  ) {
    // Soft signal from reasoning — still need structural proximity below
  }

  const ctx = collectBaitExtremes(candles, openUnix, timeZone)
  if (!ctx) {
    return /stop\s*(pool|loss|cluster)|liquidity|beyond\s+(the\s+)?(asia|london|prior|overnight)/i.test(
      level.reasoning || ''
    )
  }

  const isRes =
    level.type === 'resistance' || String(level.type).toLowerCase().includes('resist')

  for (const bait of ctx.baits) {
    if (isRes && bait.kind === 'high') {
      // Institutional sell zone is just ABOVE bait high
      const lo = bait.price
      const hi = bait.price * (1 + 0.0025)
      if (level.level >= lo && level.level <= hi) return true
      if (Math.abs(level.level - bait.price) / bait.price <= 0.002) return true
    }
    if (!isRes && bait.kind === 'low') {
      const hi = bait.price
      const lo = bait.price * (1 - 0.0025)
      if (level.level <= hi && level.level >= lo) return true
      if (Math.abs(level.level - bait.price) / bait.price <= 0.002) return true
    }
  }

  return /stop\s*(pool|loss|cluster)|into that (stop )?liquidity|retail stops/i.test(
    level.reasoning || ''
  )
}

export function scoreLevelConfluence(
  level: LevelIdentification,
  opts: {
    candles: DeskBar[]
    openUnix: number
    timeZone: string
    avwapBands: number[]
    vpAnchors: number[]
  }
): ConfluenceSignals {
  const stopPool = stopPoolHit(level, opts.candles, opts.openUnix, opts.timeZone)
  const avwap = nearAny(level.level, opts.avwapBands)
  const volumeProfile = nearAny(level.level, opts.vpAnchors)
  const score = Number(stopPool) + Number(avwap) + Number(volumeProfile)
  return { stopPool, avwap, volumeProfile, score }
}

/**
 * Require ≥2 confluence signals. If filtering would wipe the list, keep top
 * conviction singles (never return empty when AI produced something grounded).
 */
export function filterByConfluence(
  levels: LevelIdentification[],
  opts: {
    candles: DeskBar[]
    openUnix: number
    timeZone: string
    avwapBands: number[]
    vpAnchors: number[]
  }
): LevelIdentification[] {
  if (levels.length === 0) return []

  const scored = levels.map((l) => ({
    level: l,
    signals: scoreLevelConfluence(l, opts),
  }))

  const kept = scored
    .filter((s) => s.signals.score >= 2)
    .map((s) => {
      // Mild conviction bump when all three fire
      if (s.signals.score >= 3 && s.level.conviction < 10) {
        const next = Math.min(10, s.level.conviction + 1) as LevelIdentification['conviction']
        return { ...s.level, conviction: next }
      }
      return s.level
    })

  if (kept.length > 0) return kept

  // Safety: don't blank the desk — keep highest-conviction with ≥1 signal, else top 2
  const withOne = scored
    .filter((s) => s.signals.score >= 1)
    .sort((a, b) => b.level.conviction - a.level.conviction)
    .slice(0, 2)
    .map((s) => s.level)
  if (withOne.length > 0) return withOne

  return [...levels]
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, 2)
}
