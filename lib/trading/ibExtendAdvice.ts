/**
 * IB extend vs revert — advice only (live + sim).
 *
 * After IB locks (`computeInitialBalance` ≠ null), first tag of IB H/L is
 * liquidity building, not an entry. One swing at/beyond the tagged edge is
 * the liquidity. The trade is the TEST of that swing:
 *
 *   Raid + value accepted outside → EXTEND (pullback to the broken swing)
 *   Raid + value accepted back inside → BALANCE (mean revert toward VWAP/POC)
 *
 * Value mapping (do not duplicate a 15-minute cliff):
 *   Extend: virtual fill at first print beyond the swing; SL = swing;
 *           side = raid direction. `scoreValueAcceptance` looking_accepted
 *           while lastPrice is still outside → extend.
 *   Revert: after a raid, virtual fill at first print back inside the IB
 *           box; SL = swing/raid extreme; side = fade. looking_accepted
 *           while lastPrice is still inside → balance.
 *
 * CALL ON uses the same gate as tickets: a “go” only if CALL agrees.
 * Never places orders. `shouldExecuteOandaOrders()` stays false.
 */

import {
  VALUE_ACCEPTANCE_MIN_R,
  scoreValueAcceptance,
  type ValueAcceptanceBar,
  type ValueAcceptanceResult,
} from '@/lib/trading/valueAcceptance'
import { liveDeskPointValue } from '@/lib/trading/deskExitGuard'
import { TRADEIFY_RISK_FIRST_DOLLARS } from '@/lib/trading/tradeifyGrowth50k'
import type { InitialBalanceRange } from '@/lib/trading/deskLevels'
import type { DeskCallSide } from '@/lib/trading/deskCall'

export const IB_EXTEND_NY_INSTRUMENTS = ['DOW', 'NASDAQ'] as const

export type IbExtendInstrument = (typeof IB_EXTEND_NY_INSTRUMENTS)[number]

export type IbExtendRegime =
  | 'waiting'
  | 'extend_high'
  | 'extend_low'
  | 'balance'
  | 'stand_down'

export type IbExtendPhase =
  | 'ib_forming'
  | 'idle'
  | 'first_tag'
  | 'swing'
  | 'raid'
  | 'extend'
  | 'revert'
  | 'stand_down'

export type IbSwingKind = 'high' | 'low'

export type IbAdviceBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type IbLiquiditySwing = {
  kind: IbSwingKind
  price: number
  time: number
  /** Bar index in the post-IB series (confirmed: has a neighbor after). */
  confirmTime: number
}

export type IbExtendAdvice = {
  instrument: string
  ibComplete: boolean
  regime: IbExtendRegime | null
  phase: IbExtendPhase
  isGo: boolean
  adviceSide: 'LONG' | 'SHORT' | null
  chip: string
  message: string
  skip: boolean
  skipReason: string | null
  firstTag: { kind: IbSwingKind; time: number; price: number } | null
  swing: IbLiquiditySwing | null
  raid: {
    kind: IbSwingKind
    time: number
    extreme: number
    outsideRead: ValueAcceptanceResult | null
    insideRead: ValueAcceptanceResult | null
  } | null
  entryAdvice: number | null
  stopAdvice: number | null
}

export const IB_EXTEND_CHIP: Record<IbExtendRegime, string> = {
  waiting: 'Waiting (liquidity building)',
  extend_high: 'Extend high',
  extend_low: 'Extend low',
  balance: 'Balance',
  stand_down: 'Stand down',
}

const EPS = 1e-8
const STOP_PAD_FRAC = 0.1
const STOP_PAD_FLOOR = 10

export function isIbExtendInstrument(
  instrument: string | null | undefined
): instrument is IbExtendInstrument {
  return instrument === 'DOW' || instrument === 'NASDAQ'
}

export function ibExtendRegimeLabel(regime: IbExtendRegime | null): string {
  if (!regime) return '—'
  return IB_EXTEND_CHIP[regime]
}

export function isIbContextBoxReasoning(reasoning: string | null | undefined): boolean {
  const why = String(reasoning || '').toLowerCase()
  if (!why) return false
  if (why.includes('liquidity swing') || why.includes('liq swing')) return false
  return /initial balance (high|low)/.test(why) || why.includes('ib context box')
}

type RangeLike = { label: string; high: number; low: number }

/** After a swing exists, ±10 magnets use the swing — not raw IB H/L. */
export function applyIbLiquiditySwingToRange<T extends RangeLike>(
  range: T,
  swing: IbLiquiditySwing | null | undefined
): T {
  if (!swing) return range
  const label = String(range.label || '')
  if (label !== 'IB' && label !== 'Tokyo IB') return range
  if (swing.kind === 'high') return { ...range, high: swing.price }
  return { ...range, low: swing.price }
}

export function applyIbLiquiditySwingToRanges<T extends RangeLike>(
  ranges: readonly T[],
  swing: IbLiquiditySwing | null | undefined
): T[] {
  return ranges.map((r) => applyIbLiquiditySwingToRange(r, swing))
}

export function findIbLiquiditySwing(
  candles: readonly IbAdviceBar[],
  ib: InitialBalanceRange
): IbLiquiditySwing | null {
  const post = candles.filter((c) => c.time >= ib.endUnix)
  if (post.length < 3) return null

  let high: IbLiquiditySwing | null = null
  let low: IbLiquiditySwing | null = null

  for (let i = 1; i < post.length - 1; i++) {
    const prev = post[i - 1]!
    const curr = post[i]!
    const next = post[i + 1]!
    if (
      !high &&
      curr.high >= ib.high - EPS &&
      curr.high > prev.high &&
      curr.high > next.high
    ) {
      high = {
        kind: 'high',
        price: roundPx(curr.high),
        time: curr.time,
        confirmTime: next.time,
      }
    }
    if (
      !low &&
      curr.low <= ib.low + EPS &&
      curr.low < prev.low &&
      curr.low < next.low
    ) {
      low = {
        kind: 'low',
        price: roundPx(curr.low),
        time: curr.time,
        confirmTime: next.time,
      }
    }
    if (high && low) break
  }

  if (high && low) return high.time <= low.time ? high : low
  return high ?? low
}

function findFirstIbTag(
  candles: readonly IbAdviceBar[],
  ib: InitialBalanceRange
): { kind: IbSwingKind; time: number; price: number } | null {
  for (const c of candles) {
    if (c.time < ib.endUnix) continue
    if (c.high >= ib.high - EPS) {
      return { kind: 'high', time: c.time, price: roundPx(Math.max(c.high, ib.high)) }
    }
    if (c.low <= ib.low + EPS) {
      return { kind: 'low', time: c.time, price: roundPx(Math.min(c.low, ib.low)) }
    }
  }
  return null
}

function findRaid(args: {
  candles: readonly IbAdviceBar[]
  swing: IbLiquiditySwing
}): { time: number; extreme: number; close: number } | null {
  for (const c of args.candles) {
    if (c.time <= args.swing.confirmTime) continue
    if (args.swing.kind === 'high' && c.high > args.swing.price + EPS) {
      return {
        time: c.time,
        extreme: roundPx(c.high),
        close: roundPx(c.close),
      }
    }
    if (args.swing.kind === 'low' && c.low < args.swing.price - EPS) {
      return {
        time: c.time,
        extreme: roundPx(c.low),
        close: roundPx(c.close),
      }
    }
  }
  return null
}

function firstPrintBackInside(args: {
  candles: readonly IbAdviceBar[]
  ib: InitialBalanceRange
  swing: IbLiquiditySwing
  raidTime: number
}): { time: number; close: number } | null {
  for (const c of args.candles) {
    if (c.time <= args.raidTime) continue
    if (args.swing.kind === 'high') {
      const back = c.close < args.swing.price - EPS && c.close <= args.ib.high + EPS
      if (back) return { time: c.time, close: roundPx(c.close) }
    } else {
      const back = c.close > args.swing.price + EPS && c.close >= args.ib.low - EPS
      if (back) return { time: c.time, close: roundPx(c.close) }
    }
  }
  return null
}

function raidR(ib: InitialBalanceRange, excursion: number): number {
  const height = Math.max(0, ib.high - ib.low)
  return Math.max(VALUE_ACCEPTANCE_MIN_R, STOP_PAD_FLOOR, height * STOP_PAD_FRAC, excursion)
}

function lastPriceOf(
  candles: readonly IbAdviceBar[],
  fallback: number | null | undefined
): number {
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) return fallback
  const last = candles[candles.length - 1]
  return last && last.close > 0 ? last.close : 0
}

function barsAfter(
  candles: readonly IbAdviceBar[],
  fromUnix: number
): ValueAcceptanceBar[] {
  return candles
    .filter((c) => c.time >= fromUnix)
    .map((c) => ({ high: c.high, low: c.low }))
}

function priceOutsideSwing(
  price: number,
  swing: IbLiquiditySwing
): boolean {
  if (swing.kind === 'high') return price > swing.price + EPS
  return price < swing.price - EPS
}

function priceInsideIb(
  price: number,
  ib: InitialBalanceRange,
  swing: IbLiquiditySwing
): boolean {
  if (swing.kind === 'high') return price <= ib.high + EPS && price < swing.price + EPS
  return price >= ib.low - EPS && price > swing.price - EPS
}

function ticketStopFits(args: {
  instrument: string
  stopDistance: number
  ticketRiskDollars?: number | null
}): { skip: boolean; reason: string | null } {
  const dist = args.stopDistance
  if (!(dist > 0) || !Number.isFinite(dist)) {
    return { skip: false, reason: null }
  }
  const pv = liveDeskPointValue(args.instrument)
  const oneMicro = dist * pv
  const cap = args.ticketRiskDollars
  const limit =
    cap != null && Number.isFinite(cap) && cap > 0 ? cap : TRADEIFY_RISK_FIRST_DOLLARS
  if (oneMicro > limit + EPS) {
    return {
      skip: true,
      reason: `Stop beyond the liquidity is ${Math.round(dist)} pts (~$${Math.round(oneMicro)}) — does not fit the $${Math.round(limit)} ticket. Skip.`,
    }
  }
  return { skip: false, reason: null }
}

function pullbackStop(args: {
  ib: InitialBalanceRange
  swing: IbLiquiditySwing
  side: 'LONG' | 'SHORT'
}): { entry: number; stop: number } {
  const pad = Math.max(STOP_PAD_FLOOR, (args.ib.high - args.ib.low) * STOP_PAD_FRAC)
  if (args.side === 'LONG') {
    return { entry: args.swing.price, stop: roundPx(args.swing.price - pad) }
  }
  return { entry: args.swing.price, stop: roundPx(args.swing.price + pad) }
}

function callBlocksGo(args: {
  useCall: boolean | null
  callSide: DeskCallSide
  adviceSide: 'LONG' | 'SHORT'
}): boolean {
  if (args.useCall == null) return true
  if (!args.useCall) return false
  if (args.callSide === 'WAIT') return true
  return args.callSide !== args.adviceSide
}

function idleAdvice(
  instrument: string,
  phase: IbExtendPhase,
  message: string,
  extra?: Partial<IbExtendAdvice>
): IbExtendAdvice {
  const regime: IbExtendRegime | null =
    phase === 'ib_forming' || phase === 'idle' ? null : extra?.regime ?? 'waiting'
  return {
    instrument,
    ibComplete: phase !== 'ib_forming',
    regime,
    phase,
    isGo: false,
    adviceSide: null,
    chip: ibExtendRegimeLabel(regime),
    message,
    skip: false,
    skipReason: null,
    firstTag: null,
    swing: null,
    raid: null,
    entryAdvice: null,
    stopAdvice: null,
    ...extra,
  }
}

/**
 * Pure IB extend vs revert read. `ib` must come from `computeInitialBalance`
 * (null until cash open + 60m). NY names only for a live “go”.
 */
export function computeIbExtendAdvice(input: {
  instrument: string
  ib: InitialBalanceRange | null
  candles: readonly IbAdviceBar[]
  nowUnix: number
  useCall: boolean | null
  callSide: DeskCallSide
  lastPrice?: number | null
  ticketRiskDollars?: number | null
}): IbExtendAdvice {
  const instrument = String(input.instrument || '')
  const ny = isIbExtendInstrument(instrument)
  if (!ny) {
    return idleAdvice(instrument, 'idle', 'IB extend/revert is NY only (DOW / NASDAQ).')
  }
  if (!input.ib) {
    return idleAdvice(
      instrument,
      'ib_forming',
      'IB is still building — 9:30–10:30 stays Open / OR30. No extend advice on a half-built box.'
    )
  }

  const ib = input.ib
  const candles = input.candles.filter(
    (c) =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
  )
  const lastPrice = lastPriceOf(candles, input.lastPrice)
  const firstTag = findFirstIbTag(candles, ib)
  if (!firstTag) {
    return idleAdvice(
      instrument,
      'idle',
      'IB is locked. Waiting for the first tag of IB high/low — that tag is not the entry.',
      { ibComplete: true, regime: 'waiting', firstTag: null }
    )
  }

  const swing = findIbLiquiditySwing(candles, ib)
  if (!swing) {
    return idleAdvice(
      instrument,
      'first_tag',
      'First IB tag is liquidity building — not the entry. Wait for a swing at/beyond the tagged edge.',
      { ibComplete: true, regime: 'waiting', firstTag }
    )
  }

  const raid = findRaid({ candles, swing })
  if (!raid) {
    return idleAdvice(
      instrument,
      'swing',
      'Liquidity swing is in. Wait for the test of that swing — do not fade the first tag.',
      { ibComplete: true, regime: 'waiting', firstTag, swing }
    )
  }

  const nowMs = Number(input.nowUnix) * 1000
  const excursion = Math.abs(raid.extreme - swing.price)
  const r = raidR(ib, excursion)
  const outsideSide: 'LONG' | 'SHORT' = swing.kind === 'high' ? 'LONG' : 'SHORT'
  const outsideEntry = roundPx(
    swing.kind === 'high'
      ? Math.max(raid.close, swing.price + 0.5)
      : Math.min(raid.close, swing.price - 0.5)
  )
  const outsideStop =
    swing.kind === 'high' ? roundPx(outsideEntry - r) : roundPx(outsideEntry + r)
  const outsideRead = scoreValueAcceptance({
    side: outsideSide,
    entry: outsideEntry,
    stopLoss: outsideStop,
    nowMs,
    filledAtMs: raid.time * 1000,
    lastPrice,
    recentBars: barsAfter(candles, raid.time),
  })

  const back = firstPrintBackInside({
    candles,
    ib,
    swing,
    raidTime: raid.time,
  })
  let insideRead: ValueAcceptanceResult | null = null
  if (back) {
    const fadeSide: 'LONG' | 'SHORT' = swing.kind === 'high' ? 'SHORT' : 'LONG'
    const insideStop =
      fadeSide === 'SHORT'
        ? roundPx(Math.max(swing.price, raid.extreme))
        : roundPx(Math.min(swing.price, raid.extreme))
    insideRead = scoreValueAcceptance({
      side: fadeSide,
      entry: back.close,
      stopLoss: insideStop,
      nowMs,
      filledAtMs: back.time * 1000,
      lastPrice,
      recentBars: barsAfter(candles, back.time),
    })
  }

  const raidInfo = {
    kind: swing.kind,
    time: raid.time,
    extreme: raid.extreme,
    outsideRead,
    insideRead,
  }

  const acceptedOutside =
    outsideRead.state === 'looking_accepted' && priceOutsideSwing(lastPrice, swing)
  const acceptedInside =
    !!insideRead &&
    insideRead.state === 'looking_accepted' &&
    priceInsideIb(lastPrice, ib, swing)

  let adviceSide: 'LONG' | 'SHORT' | null = null
  let regime: IbExtendRegime = 'waiting'
  let phase: IbExtendPhase = 'raid'
  let message =
    'Raid of the swing is on — waiting for value acceptance outside (extend) or back inside (balance).'

  if (acceptedOutside) {
    adviceSide = outsideSide
    regime = swing.kind === 'high' ? 'extend_high' : 'extend_low'
    phase = 'extend'
    message =
      swing.kind === 'high'
        ? 'Raid accepted outside IB high — EXTEND HIGH. Enter the pullback to the broken swing / IB edge, not the wick. Means: session VWAP, yPOC, dPOC.'
        : 'Raid accepted outside IB low — EXTEND LOW. Enter the pullback to the broken swing / IB edge, not the wick. Means: session VWAP, yPOC, dPOC.'
  } else if (acceptedInside) {
    adviceSide = swing.kind === 'high' ? 'SHORT' : 'LONG'
    regime = 'balance'
    phase = 'revert'
    message =
      'Raid accepted back inside — failed extension. BALANCE / mean revert toward VWAP / POC. Do not chase the wick.'
  }

  let skip = false
  let skipReason: string | null = null
  let entryAdvice: number | null = null
  let stopAdvice: number | null = null
  if (adviceSide) {
    const geo = pullbackStop({ ib, swing, side: adviceSide })
    entryAdvice = geo.entry
    stopAdvice = geo.stop
    const fit = ticketStopFits({
      instrument,
      stopDistance: Math.abs(geo.entry - geo.stop),
      ticketRiskDollars: input.ticketRiskDollars,
    })
    skip = fit.skip
    skipReason = fit.reason
    if (skip) {
      message = fit.reason || 'Stop beyond the liquidity does not fit the ticket. Skip.'
    }
  }

  const blocked =
    !!adviceSide &&
    callBlocksGo({
      useCall: input.useCall,
      callSide: input.callSide,
      adviceSide,
    })

  if (blocked) {
    return {
      instrument,
      ibComplete: true,
      regime: 'stand_down',
      phase: 'stand_down',
      isGo: false,
      adviceSide,
      chip: IB_EXTEND_CHIP.stand_down,
      message: skip
        ? message
        : input.useCall == null
          ? 'CALL / Regular is unset — no go. IB structure is advice only.'
          : input.callSide === 'WAIT' || input.useCall
            ? 'CALL ON does not agree — stand down. First IB tag is still not the entry.'
            : message,
      skip,
      skipReason,
      firstTag,
      swing,
      raid: raidInfo,
      entryAdvice,
      stopAdvice,
    }
  }

  if (skip) {
    return {
      instrument,
      ibComplete: true,
      regime: 'stand_down',
      phase: 'stand_down',
      isGo: false,
      adviceSide,
      chip: IB_EXTEND_CHIP.stand_down,
      message,
      skip: true,
      skipReason,
      firstTag,
      swing,
      raid: raidInfo,
      entryAdvice,
      stopAdvice,
    }
  }

  const isGo = regime === 'extend_high' || regime === 'extend_low' || regime === 'balance'
  return {
    instrument,
    ibComplete: true,
    regime,
    phase,
    isGo,
    adviceSide,
    chip: IB_EXTEND_CHIP[regime],
    message,
    skip: false,
    skipReason: null,
    firstTag,
    swing,
    raid: raidInfo,
    entryAdvice,
    stopAdvice,
  }
}

function roundPx(n: number): number {
  return Math.round(n * 100) / 100
}

export function ibExtendAlertKind(regime: IbExtendRegime): string | null {
  if (regime === 'extend_high') return 'ib_extend_high'
  if (regime === 'extend_low') return 'ib_extend_low'
  if (regime === 'balance') return 'ib_extend_balance'
  return null
}
