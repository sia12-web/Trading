/**
 * Chart click / hover helpers for limit placement.
 * Snap to AI/structure only when those levels are visible on the chart.
 */

import { zoneStopPrice } from '@/lib/trading/deskLevels'
import {
  instrumentTick,
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
  type DeskTickInstrument,
} from '@/lib/trading/instrumentTicks'
import {
  DESK_RISK_PERCENT,
  previewPositionSizing,
} from '@/lib/trading/positionSizing'

/** Same band as live/sim click snap (~0.25%). */
export const CHART_LEVEL_SNAP_PCT = 0.0025

/** Pointer move beyond this (px) = pan/drag, not a place-limit click. */
export const CHART_CLICK_DRAG_PX = 6

/** True when pointer traveled far enough to count as chart pan, not a click. */
export function isChartDragGesture(
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  thresholdPx = CHART_CLICK_DRAG_PX
): boolean {
  return Math.hypot(upX - downX, upY - downY) > thresholdPx
}

export type ChartPickLevel = {
  price: number
  type?: string
  source?: 'ai' | 'structure' | string
  reasoning?: string
  side?: 'BUY' | 'SHORT' | null
}

export type ChartLimitPick = {
  price: number
  source: 'ai' | 'structure' | 'manual'
  type: string
  reasoning?: string
  matched: ChartPickLevel | null
}

export function directionFromChartLevel(level: ChartPickLevel): 'LONG' | 'SHORT' {
  if (level.side === 'SHORT') return 'SHORT'
  if (level.side === 'BUY') return 'LONG'
  const t = String(level.type || '').toLowerCase()
  if (t.includes('resist') || t.includes('short') || t.includes('supply')) {
    return 'SHORT'
  }
  return 'LONG'
}

/**
 * Resolve a chart click to a limit pick.
 * When levelsVisible is false, never snap to AI/structure — always manual.
 */
export function resolveChartLimitPick(args: {
  rawPrice: number
  levels: ChartPickLevel[]
  levelsVisible: boolean
  snapPct?: number
}): ChartLimitPick {
  const raw = Number(args.rawPrice)
  if (!(raw > 0) || !Number.isFinite(raw)) {
    return { price: 0, source: 'manual', type: 'manual', matched: null }
  }

  if (!args.levelsVisible) {
    return { price: raw, source: 'manual', type: 'manual', matched: null }
  }

  const snapPct = args.snapPct ?? CHART_LEVEL_SNAP_PCT
  const tradeLevels = args.levels.filter(
    (l) =>
      (l.source === 'ai' || l.source === 'structure') &&
      Number.isFinite(l.price) &&
      l.price > 0
  )

  let best = raw
  let matched: ChartPickLevel | null = null
  let bestDist = Infinity
  for (const l of tradeLevels) {
    const d = Math.abs(l.price - raw) / raw
    if (d < bestDist && d <= snapPct) {
      bestDist = d
      best = l.price
      matched = l
    }
  }

  if (!matched) {
    return { price: raw, source: 'manual', type: 'manual', matched: null }
  }

  const source = matched.source === 'structure' ? 'structure' : 'ai'
  return {
    price: best,
    source,
    type: String(matched.type || source),
    reasoning: matched.reasoning,
    matched,
  }
}

/** Entry / SL / TP the ticket would use for an AI/structure level (desk risk). */
export function previewLevelOrderPrices(args: {
  level: ChartPickLevel
  instrument: DeskTickInstrument
  accountSize?: number
}): {
  direction: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  tick: number
} | null {
  const direction = directionFromChartLevel(args.level)
  const entry = snapDeskPrice(args.instrument, args.level.price)
  if (!(entry > 0)) return null

  const stopRaw = zoneStopPrice(entry, direction)
  const stop = snapStopToTick(args.instrument, entry, stopRaw, direction)
  const preview = previewPositionSizing(
    entry,
    args.accountSize && args.accountSize > 0 ? args.accountSize : 100_000,
    direction,
    stop,
    DESK_RISK_PERCENT
  )
  if (!preview) return null

  const target = snapTargetToTick(
    args.instrument,
    entry,
    preview.profit_target_price,
    direction
  )
  return {
    direction,
    entry,
    stop,
    target,
    tick: instrumentTick(args.instrument),
  }
}
