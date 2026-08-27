/**
 * Open-book manage read — leave / pullback / reverse from range H/L,
 * volume, Opening type, Control, and CALL. Advise only; never auto-close.
 */

import type { DeskCallSide } from '@/lib/trading/deskCall'
import type { ControlLabel } from '@/lib/trading/marketControl'
import type {
  OpeningActivityType,
  OpeningDirection,
} from '@/lib/trading/openingActivity'

export type ManageRangeState =
  | 'inside'
  | 'broke_in_favor'
  | 'broke_against'
  | 'unknown'

export type ManageBookStructure = {
  rangeState: ManageRangeState
  rangeLabel: string | null
  rangeHigh: number | null
  rangeLow: number | null
  midPullback: boolean
  openingAgainst: boolean
  controlAgainst: boolean
  callAgainst: boolean
  perfLeave: boolean
  factors: string[]
}

function isLongDir(direction: string): boolean {
  const d = String(direction || '').toUpperCase()
  return d === 'LONG' || d === 'BUY'
}

export function structureVsOpenBook(args: {
  direction: string
  tip: number
  rangeHigh?: number | null
  rangeLow?: number | null
  rangeLabel?: string | null
  openingType?: OpeningActivityType | null
  openingDirection?: OpeningDirection | null
  failedDrive?: boolean
  controlLabel?: ControlLabel | null
  callSide?: DeskCallSide | null
  perfLeave?: boolean
}): ManageBookStructure {
  const long = isLongDir(args.direction)
  const tip = Number(args.tip)
  const high = args.rangeHigh != null ? Number(args.rangeHigh) : null
  const low = args.rangeLow != null ? Number(args.rangeLow) : null
  const label = args.rangeLabel?.trim() || null
  const factors: string[] = []

  let rangeState: ManageRangeState = 'unknown'
  if (
    high != null &&
    low != null &&
    high > low &&
    Number.isFinite(tip) &&
    tip > 0
  ) {
    if (tip > high) rangeState = long ? 'broke_in_favor' : 'broke_against'
    else if (tip < low) rangeState = long ? 'broke_against' : 'broke_in_favor'
    else rangeState = 'inside'
    factors.push(
      `${label || 'range'} H ${high} / L ${low} · tip ${rangeState.replace(/_/g, ' ')}`
    )
  }

  const height =
    high != null && low != null && high > low ? high - low : 0
  const mid = height > 0 && high != null && low != null ? (high + low) / 2 : null
  const midPullback =
    rangeState === 'inside' &&
    mid != null &&
    height > 0 &&
    Math.abs(tip - mid) <= height * 0.2
  if (midPullback) factors.push('testing 50% mid (pullback magnet)')

  const failedDrive = args.failedDrive === true
  const driveWithBook =
    (long && args.openingDirection === 'up') ||
    (!long && args.openingDirection === 'down')
  const openingAgainst = failedDrive && driveWithBook
  if (openingAgainst) {
    factors.push(`Open-Drive FAIL vs ${long ? 'LONG' : 'SHORT'}`)
  } else if (args.openingType && args.openingType !== 'WAITING') {
    factors.push(`Open ${args.openingType.replace(/_/g, ' ')}`)
  }

  const controlAgainst =
    (long && args.controlLabel === 'ONE-TF SELL') ||
    (!long && args.controlLabel === 'ONE-TF BUY')
  if (controlAgainst) {
    factors.push(`Control ${args.controlLabel} against the book`)
  } else if (args.controlLabel && args.controlLabel !== 'WAIT') {
    factors.push(`Control ${args.controlLabel}`)
  }

  const callAgainst =
    (long && args.callSide === 'SHORT') || (!long && args.callSide === 'LONG')
  if (callAgainst) {
    factors.push(`CALL ${args.callSide} against the book`)
  } else if (args.callSide && args.callSide !== 'WAIT') {
    factors.push(`CALL ${args.callSide}`)
  }

  const perfLeave = args.perfLeave === true
  if (perfLeave) {
    factors.push('LEAVE — Perf WEAK/UNCLEAR (banner only, no auto-flatten)')
  }

  return {
    rangeState,
    rangeLabel: label,
    rangeHigh: high != null && Number.isFinite(high) ? high : null,
    rangeLow: low != null && Number.isFinite(low) ? low : null,
    midPullback,
    openingAgainst,
    controlAgainst,
    callAgainst,
    perfLeave,
    factors,
  }
}

export function formatOpenBookManageForPrompt(args: {
  direction: string
  fillPrice: number
  livePrice: number | null
  stopLoss: number
  takeProfit: number | null
  rvol?: number | null
  structure?: ManageBookStructure | null
}): string {
  const long = isLongDir(args.direction)
  const side = long ? 'LONG' : 'SHORT'
  const live =
    args.livePrice != null && Number.isFinite(args.livePrice)
      ? String(Math.round(args.livePrice * 100) / 100)
      : 'n/a'
  const fill = Math.round(Number(args.fillPrice) * 100) / 100
  const sl = Math.round(Number(args.stopLoss) * 100) / 100
  const tp =
    args.takeProfit != null && Number.isFinite(args.takeProfit)
      ? String(Math.round(args.takeProfit * 100) / 100)
      : 'n/a'
  const rvol =
    args.rvol != null && Number.isFinite(args.rvol)
      ? `${args.rvol.toFixed(2)}×`
      : 'n/a'
  const st = args.structure
  const rangeLine = st
    ? st.rangeState === 'unknown'
      ? 'Primary range H/L not shaped yet — do not invent edges.'
      : `${st.rangeLabel || 'range'} H ${st.rangeHigh} / L ${st.rangeLow} · tip ${st.rangeState.replace(/_/g, ' ')}${st.midPullback ? ' · at 50% mid' : ''}`
    : 'Range H/L from RANGE LIQUIDITY MAP — treat printed edges as ground truth.'
  const extra = st?.factors.length ? `Structure: ${st.factors.join(' · ')}` : null

  return [
    'OPEN BOOK MANAGE (filled — advise only, never auto-close):',
    `${side} @ ${fill} · live ${live} · SL ${sl} · TP ${tp} · 5m RVOL ${rvol}`,
    rangeLine,
    extra,
    'Job is manage, not hunt a second fill. Lead with HOLD, PULLBACK, LEAVE, or REVERSE.',
    'Quiet volume + still inside the traded H–L (or tagging 50% mid) + CALL/Control still with you + AI/RVOL/options/news supportive → PULLBACK, hold.',
    'Initiative volume through the opposite H/L, Open-Drive FAIL, Control ONE-TF against you, or CALL flipped against the book → REVERSE / LEAVE. Trader confirms any exit.',
    'AI levels, RVOL, options P/C + OI, and news still count — they confirm or veto the same four calls. Do not invent H/L or volume.',
  ]
    .filter((line): line is string => !!line)
    .join('\n')
}

export function structureFromRangeBrief(args: {
  direction: string
  tip: number
  brief: {
    active: { label: string; high: number; low: number } | null
    opening: {
      type: OpeningActivityType
      direction: OpeningDirection | null
      failedDrive: boolean
    } | null
    control: { label: ControlLabel } | null
    call: { side: DeskCallSide } | null
    perfLeave?: boolean
  }
}): ManageBookStructure {
  return structureVsOpenBook({
    direction: args.direction,
    tip: args.tip,
    rangeHigh: args.brief.active?.high ?? null,
    rangeLow: args.brief.active?.low ?? null,
    rangeLabel: args.brief.active?.label ?? null,
    openingType: args.brief.opening?.type ?? null,
    openingDirection: args.brief.opening?.direction ?? null,
    failedDrive: args.brief.opening?.failedDrive === true,
    controlLabel: args.brief.control?.label ?? null,
    callSide: args.brief.call?.side ?? null,
    perfLeave: args.brief.perfLeave === true,
  })
}
