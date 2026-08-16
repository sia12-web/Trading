/**
 * Desk CALL — binary read from Open type + Control + yesterday veto +
 * the locked playbook range (stop-pool ±10). Governs ticket side and
 * legal edge. Level Finder and Leo advise only — they never place.
 *
 * Not a new clock, not a price line. Ticket stays 1:1.5 and
 * $400→$250→$150. Does not unlock ±10.
 */

import { computeOr30Range } from '@/lib/chart/openingRange30'
import { computeNycLunchRange } from '@/lib/chart/nycLunchSessionRange'
import { computeNikkeiUsRangeBreakout } from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import { computeInitialBalance, type DeskBar } from '@/lib/trading/deskLevels'
import {
  RANGE_EDGE_BAND_POINTS,
  rangeAllowsMidEdge,
} from '@/lib/trading/rangeEdgeEntryGate'
import {
  computeOpeningActivity,
  type OpeningActivity,
  type OpeningBar,
} from '@/lib/trading/openingActivity'
import {
  computeMarketControl,
  type ControlBar,
  type MarketControl,
} from '@/lib/trading/marketControl'
import {
  computeYesterdayProfile,
  type YesterdayBar,
  type YesterdayOpenType,
} from '@/lib/trading/yesterdayProfile'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'

export type DeskCallSide = 'WAIT' | 'LONG' | 'SHORT'
export type DeskCallRangeKey = 'OR30' | 'IB' | 'LN' | 'US'

export type DeskCallBar = OpeningBar & { volume?: number }

export type DeskCall = {
  instrument: string
  sessionDate: string | null
  side: DeskCallSide
  rangeKey: DeskCallRangeKey | null
  rangeHigh: number | null
  rangeLow: number | null
  entryEdge: 'low' | 'high' | null
  entryPrice: number | null
  midAllowed: boolean
  bookLocked: boolean
  playLine: string
  openingType: OpeningActivity['type']
  controlLabel: MarketControl['label']
}

export type DeskCallWindowScore = {
  leftWait: boolean
  brokeWithCall: boolean | null
  taggedBand: boolean | null
}

export type DeskCallScoreRow = {
  playbookMode: DeskPlaybookMode
  asOfUnix: number
  badge: string
  score: DeskCallWindowScore
}

export type DeskCallScoreTally = {
  windows: number
  broke: number
  tagged: number
}

export const CALL_COLORS = {
  badge: '#a1a1aa',
} as const

export const CALL_BAND_POINTS = RANGE_EDGE_BAND_POINTS

export { resolveYesterdayAsOfUnix as resolveDeskCallAsOfUnix } from '@/lib/trading/yesterdayProfile'

const EPS = 1e-8
const TICKET =
  'Ticket unchanged: SL beyond active-range edge · TP 1.5R · $400→$250→$150. Does not unlock off-band. Does not pick Level Finder entries. dPOC is not the fill.'
const BOOK_LOCKED = 'CALL is the read, not a fill — book is locked.'

function px(n: number): number {
  return Math.round(n * 100) / 100
}

function dayKey(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function asBars(candles: DeskCallBar[]): DeskBar[] {
  return candles
    .filter(
      (c) =>
        typeof c.time === 'number' &&
        Number.isFinite(c.time) &&
        typeof c.high === 'number' &&
        typeof c.low === 'number'
    )
    .map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
}

function speakRange(key: DeskCallRangeKey, tokyo: boolean): string {
  if (key === 'US') return 'US Range'
  if (key === 'LN') return 'Lunch-range'
  if (key === 'IB') return tokyo ? 'Tokyo IB' : 'IB'
  return 'OR30'
}

function waiting(
  instrument: string,
  extra?: Partial<DeskCall> & { reason?: string }
): DeskCall {
  const reason =
    extra?.reason ??
    'CALL WAIT — Open and Control don’t agree yet, or it’s two-timeframe. Hunt nothing new.'
  const locked = extra?.bookLocked === true
  return {
    instrument,
    sessionDate: extra?.sessionDate ?? null,
    side: 'WAIT',
    rangeKey: extra?.rangeKey ?? null,
    rangeHigh: extra?.rangeHigh ?? null,
    rangeLow: extra?.rangeLow ?? null,
    entryEdge: null,
    entryPrice: null,
    midAllowed: extra?.midAllowed ?? false,
    bookLocked: locked,
    playLine: locked ? `${reason} ${BOOK_LOCKED} ${TICKET}` : `${reason} ${TICKET}`,
    openingType: extra?.openingType ?? 'WAITING',
    controlLabel: extra?.controlLabel ?? 'WAIT',
  }
}

function openBias(opening: OpeningActivity): DeskCallSide {
  if (opening.failedDrive) return 'WAIT'
  if (
    opening.type !== 'OPEN_DRIVE' &&
    opening.type !== 'OPEN_TEST_DRIVE'
  ) {
    return 'WAIT'
  }
  if (opening.direction === 'up') return 'LONG'
  if (opening.direction === 'down') return 'SHORT'
  return 'WAIT'
}

function controlBias(control: MarketControl): DeskCallSide {
  if (control.label === 'ONE-TF BUY') return 'LONG'
  if (control.label === 'ONE-TF SELL') return 'SHORT'
  return 'WAIT'
}

function ydayVetoes(
  openType: YesterdayOpenType | undefined,
  opening: OpeningActivity
): boolean {
  if (openType !== 'IN_VALUE') return false
  return (
    opening.type === 'OPEN_REJECTION_REVERSE' ||
    opening.type === 'OPEN_AUCTION'
  )
}

function resolveActiveRange(args: {
  instrument: string
  candles: DeskCallBar[]
  asOfUnix: number
  playbookMode: DeskPlaybookMode
  sessionYmd: string
  openU: number
}): { key: DeskCallRangeKey; high: number; low: number } | null {
  const { instrument, asOfUnix, playbookMode, sessionYmd, openU } = args
  const bars = asBars(args.candles).filter((c) => c.time <= asOfUnix)
  if (playbookMode === 'morning') {
    const or30 = computeOr30Range(bars, openU, asOfUnix)
    if (!or30?.complete || !(or30.high > or30.low)) return null
    return { key: 'OR30', high: or30.high, low: or30.low }
  }
  if (playbookMode === 'ib') {
    const ib = computeInitialBalance(bars, openU, asOfUnix, 60)
    if (!ib || !(ib.high > ib.low)) return null
    return { key: 'IB', high: ib.high, low: ib.low }
  }
  if (playbookMode === 'us_range') {
    if (instrument !== 'NIKKEI') return null
    const us = computeNikkeiUsRangeBreakout(
      bars.map((c) => ({ ...c, volume: Math.max(1, c.volume || 0) }))
    )
    if (!us || !(us.high > us.low)) return null
    return { key: 'US', high: us.high, low: us.low }
  }
  if (playbookMode === 'lunch_range') {
    if (instrument === 'NIKKEI') return null
    const lunch = computeNycLunchRange(bars, sessionYmd, asOfUnix)
    if (!lunch?.complete || !(lunch.high > lunch.low)) return null
    return { key: 'LN', high: lunch.high, low: lunch.low }
  }
  return null
}

function decideSide(args: {
  opening: OpeningActivity
  control: MarketControl
  ydayType: YesterdayOpenType | undefined
  peerSide?: DeskCallSide | null
}): DeskCallSide {
  if (ydayVetoes(args.ydayType, args.opening)) return 'WAIT'
  const fromOpen = openBias(args.opening)
  if (fromOpen === 'WAIT') return 'WAIT'

  const afterIb = args.control.label !== 'WAIT'
  let side: DeskCallSide = fromOpen
  if (afterIb) {
    const fromCtrl = controlBias(args.control)
    if (fromCtrl === 'WAIT' || fromCtrl !== fromOpen) return 'WAIT'
    side = fromOpen
  }

  if (
    args.peerSide === 'LONG' ||
    args.peerSide === 'SHORT'
  ) {
    if (args.peerSide !== side) return 'WAIT'
  }
  return side
}

export function deskCallBadgeText(p: DeskCall): string {
  if (p.side === 'WAIT' || !p.rangeKey) return 'WAIT'
  return `${p.rangeKey} ${p.side}`
}

export type DeskCallEdge = 'high' | 'low' | 'mid'

const CALL_WAIT_ENTRY =
  'CALL WAIT — hunt nothing new. Open and Control don’t agree yet, or there is no legal ±10.'

/** Which painted ±10 edges CALL allows (live + sim). WAIT → none. */
export function deskCallLegalEdges(call: DeskCall): DeskCallEdge[] {
  if (call.side === 'WAIT' || !call.rangeKey) return []
  if (call.side === 'LONG') {
    return call.midAllowed ? ['low', 'mid'] : ['low']
  }
  return call.midAllowed ? ['high', 'mid'] : ['high']
}

/**
 * Ticket gate — CALL picks side and legal edge. Does not unlock off-band.
 * Level Finder / Leo never place.
 */
export function assertDeskCallEntry(args: {
  call: DeskCall
  edge?: DeskCallEdge | null
  direction?: 'LONG' | 'SHORT' | null
}): { ok: true; side: 'LONG' | 'SHORT' } | { ok: false; message: string } {
  if (args.call.side === 'WAIT' || !args.call.rangeKey) {
    return { ok: false, message: CALL_WAIT_ENTRY }
  }
  const side = args.call.side
  if (args.direction && args.direction !== side) {
    return {
      ok: false,
      message: `CALL is ${side} — this ticket must be a ${
        side === 'LONG' ? 'buy' : 'sell'
      }.`,
    }
  }
  if (args.edge && !deskCallLegalEdges(args.call).includes(args.edge)) {
    if (side === 'LONG') {
      return {
        ok: false,
        message:
          'CALL LONG — buy liquidity is the legal ±10 below the range low. Mid is a pullback in the same CALL, never the opposite edge.',
      }
    }
    return {
      ok: false,
      message:
        'CALL SHORT — sell liquidity is the legal ±10 above the range high. Mid is a pullback in the same CALL, never the opposite edge.',
    }
  }
  return { ok: true, side }
}

export function playLineForCall(
  p: Pick<
    DeskCall,
    'side' | 'rangeKey' | 'instrument' | 'bookLocked' | 'midAllowed'
  >
): string {
  const tokyo = p.instrument === 'NIKKEI'
  const locked = p.bookLocked ? ` ${BOOK_LOCKED}` : ''
  if (p.side === 'WAIT' || !p.rangeKey) {
    return `CALL WAIT — Open and Control don’t agree yet, or it’s two-timeframe. Hunt nothing new.${locked} ${TICKET}`
  }
  const name = speakRange(p.rangeKey, tokyo)
  const mid =
    p.midAllowed && p.side === 'LONG'
      ? ' Mid is a pullback line in the same CALL, never a second CALL.'
      : p.midAllowed && p.side === 'SHORT'
        ? ' Mid is a pullback line in the same CALL, never a second CALL.'
        : ''
  if (p.side === 'LONG') {
    return `CALL LONG — buy liquidity is the legal ±10 below ${name} low.${mid}${locked} ${TICKET}`
  }
  return `CALL SHORT — sell liquidity is the legal ±10 above ${name} high.${mid}${locked} ${TICKET}`
}

export function formatDeskCallForPrompt(p: DeskCall): string {
  const tokyo = p.instrument === 'NIKKEI'
  const nikkei = tokyo ? ' Nikkei CALL uses Tokyo cash Open/Control, not US Range TPO.' : ''
  if (p.side === 'WAIT' || !p.rangeKey || p.entryPrice == null) {
    return `CALL (desk — bias + legal ±10): waiting.${nikkei} ${p.playLine}`
  }
  const name = speakRange(p.rangeKey, tokyo)
  const hunt =
    p.side === 'LONG'
      ? `buy liquidity ±${CALL_BAND_POINTS} below ${name} low ${p.entryPrice}`
      : `sell liquidity ±${CALL_BAND_POINTS} above ${name} high ${p.entryPrice}`
  return [
    `CALL (desk — bias + legal ±10): ${deskCallBadgeText(p)}`,
    `Open ${p.openingType} · Control ${p.controlLabel} · ${name} H ${p.rangeHigh} / L ${p.rangeLow}.${nikkei}`,
    `Hunt ${hunt}. dPOC is not the fill.`,
    p.playLine,
  ].join('\n')
}

export function deskCallLineSpecs(_p: DeskCall): [] {
  return []
}

export function deskCallPaintKey(p: DeskCall): string {
  return [p.instrument, p.sessionDate, deskCallBadgeText(p), p.entryPrice].join(
    '|'
  )
}

function taggedBand(
  bar: { high: number; low: number },
  center: number,
  band = CALL_BAND_POINTS
): boolean {
  return bar.low <= center + band + EPS && bar.high >= center - band - EPS
}

function tradedAt(
  bar: { high: number; low: number },
  price: number
): boolean {
  return bar.low <= price + EPS && bar.high >= price - EPS
}

/**
 * Per-window score (not per-day). B = broke the range in CALL direction
 * before the opposite extreme. C = named ±10 tagged before the opposite edge.
 * First decisive event latches — a later wide bar must not undo B or C.
 */
export function scoreDeskCallWindow(args: {
  call: DeskCall
  bars: Array<{ time: number; high: number; low: number }>
}): DeskCallWindowScore {
  const { call } = args
  if (call.side === 'WAIT' || call.rangeHigh == null || call.rangeLow == null) {
    return { leftWait: true, brokeWithCall: null, taggedBand: null }
  }
  const bars = Array.isArray(args.bars) ? args.bars : []
  const hi = call.rangeHigh
  const lo = call.rangeLow
  const named = call.side === 'LONG' ? lo : hi
  const opposite = call.side === 'LONG' ? hi : lo

  let brokeWith = false
  let tagged = false
  let brokeOpp = false
  let taggedOpp = false

  for (const b of bars) {
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low)) continue
    const brokeHigh = b.high > hi + EPS
    const brokeLow = b.low < lo - EPS
    // Same-bar both extremes is inconclusive for B; do not undo a prior B.
    if (!(brokeHigh && brokeLow)) {
      if (call.side === 'LONG') {
        if (brokeLow) brokeOpp = true
        if (brokeHigh && !brokeOpp) brokeWith = true
      } else {
        if (brokeHigh) brokeOpp = true
        if (brokeLow && !brokeOpp) brokeWith = true
      }
    }

    const hitNamed = taggedBand(b, named)
    const hitOppEdge = tradedAt(b, opposite)
    if (hitOppEdge) taggedOpp = true
    if (hitNamed && !taggedOpp) tagged = true
  }

  return {
    leftWait: false,
    brokeWithCall: brokeWith,
    taggedBand: tagged,
  }
}

function cashCloseUnixForYmd(ymd: string, clock: DeskClock): number {
  return zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
}

/** Snapshot CALL at each locked window, then score that window vs later bars. */
export function scoreDeskCallSession(args: {
  instrument: string
  candles: DeskCallBar[]
  asOfUnix: number
  bookLocked?: boolean
}): DeskCallScoreRow[] {
  const instrument = String(args.instrument || '')
  if (!Number.isFinite(args.asOfUnix) || !instrument) return []
  const clock = deskClockFor(instrument)
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) return []
  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = cashCloseUnixForYmd(ymd, clock)
  const horizon = Math.min(args.asOfUnix, closeU)
  const candles = (Array.isArray(args.candles) ? args.candles : []).filter(
    (c) => c && Number.isFinite(c.time) && c.time <= horizon
  )
  const tokyo = instrument === 'NIKKEI'
  const snaps: Array<{ playbookMode: DeskPlaybookMode; asOfUnix: number }> = [
    { playbookMode: 'morning', asOfUnix: openU + 30 * 60 },
    tokyo
      ? { playbookMode: 'us_range', asOfUnix: openU + 30 * 60 }
      : { playbookMode: 'ib', asOfUnix: openU + 60 * 60 },
  ]
  if (tokyo) {
    snaps.push({ playbookMode: 'ib', asOfUnix: openU + 60 * 60 })
  } else {
    snaps.push({
      playbookMode: 'lunch_range',
      asOfUnix: zonedCivilToUnix(ymd, 13.5, clock.timeZone),
    })
  }
  const rows: DeskCallScoreRow[] = []
  for (const snap of snaps) {
    if (snap.asOfUnix > horizon) continue
    const call = computeDeskCall({
      instrument,
      candles,
      asOfUnix: snap.asOfUnix,
      playbookMode: snap.playbookMode,
      bookLocked: args.bookLocked,
    })
    const later = candles.filter(
      (c) => c.time > snap.asOfUnix && c.time <= horizon
    )
    rows.push({
      playbookMode: snap.playbookMode,
      asOfUnix: snap.asOfUnix,
      badge: deskCallBadgeText(call),
      score: scoreDeskCallWindow({ call, bars: later }),
    })
  }
  return rows
}

export function tallyDeskCallScores(rows: DeskCallScoreRow[]): DeskCallScoreTally {
  const scored = rows.filter((r) => !r.score.leftWait)
  return {
    windows: scored.length,
    broke: scored.filter((r) => r.score.brokeWithCall === true).length,
    tagged: scored.filter((r) => r.score.taggedBand === true).length,
  }
}

export function formatDeskCallScoreStrip(
  rows: DeskCallScoreRow[],
  tally: DeskCallScoreTally
): string {
  const marks = rows.map((r) => {
    if (r.score.leftWait) return `${r.badge}`
    const b = r.score.brokeWithCall ? 'B✓' : 'B✗'
    const c = r.score.taggedBand ? 'C✓' : 'C✗'
    return `${r.badge} ${b} ${c}`
  })
  const pct = (n: number) =>
    tally.windows < 1 ? '—' : `${Math.round((n / tally.windows) * 100)}%`
  const session =
    tally.windows < 1
      ? 'session 0w'
      : `session ${tally.windows}w B ${pct(tally.broke)} C ${pct(tally.tagged)}`
  return `Call score · ${marks.join(' · ') || 'none'} · ${session}`
}

export function computeDeskCall(args: {
  instrument: string
  candles: DeskCallBar[]
  asOfUnix: number
  playbookMode: DeskPlaybookMode
  bookLocked?: boolean
  peerSide?: DeskCallSide | null
}): DeskCall {
  const instrument = String(args.instrument || '')
  const bookLocked = args.bookLocked === true
  if (!Number.isFinite(args.asOfUnix)) {
    return waiting(instrument, { bookLocked })
  }
  const raw = Array.isArray(args.candles) ? args.candles : []
  const candles = raw.filter(
    (c) =>
      c &&
      typeof c.time === 'number' &&
      Number.isFinite(c.time) &&
      c.time <= args.asOfUnix
  )

  const clock = deskClockFor(instrument || 'DOW')
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!instrument || !isWeekdayYmd(ymd, clock.timeZone)) {
    return waiting(instrument, { bookLocked, sessionDate: ymd })
  }

  const openU = cashOpenUnixForYmd(ymd, clock)
  const opening = computeOpeningActivity({
    instrument,
    candles: candles as YesterdayBar[],
    asOfUnix: args.asOfUnix,
  })
  const control = computeMarketControl({
    instrument,
    candles: candles as ControlBar[],
    asOfUnix: args.asOfUnix,
  })
  const yday = computeYesterdayProfile({
    instrument,
    candles: candles as YesterdayBar[],
    asOfUnix: args.asOfUnix,
  })

  const baseWait = {
    sessionDate: ymd,
    bookLocked,
    openingType: opening.type,
    controlLabel: control.label,
  }

  const range = resolveActiveRange({
    instrument,
    candles,
    asOfUnix: args.asOfUnix,
    playbookMode: args.playbookMode,
    sessionYmd: ymd,
    openU,
  })
  if (!range) {
    return waiting(instrument, {
      ...baseWait,
      reason:
        'CALL WAIT — no locked playbook range yet, so there is no legal ±10.',
    })
  }

  const side = decideSide({
    opening,
    control,
    ydayType: yday?.openType,
    peerSide: args.peerSide,
  })
  const midAllowed = rangeAllowsMidEdge({
    high: range.high,
    low: range.low,
    label: range.key === 'US' ? 'US Range' : range.key,
  })

  if (side === 'WAIT') {
    return waiting(instrument, {
      ...baseWait,
      rangeKey: range.key,
      rangeHigh: px(range.high),
      rangeLow: px(range.low),
      midAllowed,
    })
  }

  const entryEdge = side === 'LONG' ? 'low' : 'high'
  const entryPrice = px(entryEdge === 'low' ? range.low : range.high)
  const call: DeskCall = {
    instrument,
    sessionDate: ymd,
    side,
    rangeKey: range.key,
    rangeHigh: px(range.high),
    rangeLow: px(range.low),
    entryEdge,
    entryPrice,
    midAllowed,
    bookLocked,
    playLine: '',
    openingType: opening.type,
    controlLabel: control.label,
  }
  call.playLine = playLineForCall(call)
  return call
}
