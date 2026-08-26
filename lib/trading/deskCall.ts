/**
 * Desk CALL — binary read from Drive/Test-Drive (morning) + Control
 * (after IB) + the locked playbook range (stop-pool ±10). Governs
 * ticket side and legal edge. Open-Auction / Rejection-Reverse stay
 * on the Open chip — they do not gate CALL. Level Finder and Leo
 * advise only — they never place.
 *
 * Not a new clock, not a price line. Ticket stays 1:1.5 and
 * $400→$250→$150. Does not unlock ±10.
 */

import { computeOr15Range } from '@/lib/chart/openingRange15'
import { computeOr30Range } from '@/lib/chart/openingRange30'
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
  openingActivityBadgeText,
  type OpeningActivity,
  type OpeningBar,
} from '@/lib/trading/openingActivity'
import {
  computeMarketControl,
  controlGatesCall,
  marketControlBadgeText,
  type ControlBar,
  type MarketControl,
} from '@/lib/trading/marketControl'
import { CALL_MODE_UNSET_MESSAGE } from '@/lib/trading/deskCallMode'
import {
  computeYesterdayProfile,
  type YesterdayBar,
  type YesterdayOpenType,
} from '@/lib/trading/yesterdayProfile'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'

export type DeskCallSide = 'WAIT' | 'LONG' | 'SHORT'
export type DeskCallRangeKey = 'OR15' | 'OR30' | 'IB' | 'US'

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
  /** Hover checklist — every WAIT / CALL decision, same on live and sim. */
  hoverText: string
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
  if (key === 'OR15') return 'Open range'
  if (key === 'IB') return tokyo ? 'Tokyo IB' : 'IB'
  return 'OR30'
}

function waiting(
  instrument: string,
  extra?: Partial<DeskCall> & { reason?: string }
): DeskCall {
  const reason =
    extra?.reason ??
    'CALL WAIT — Control isn’t ONE-TF yet, Drive/Test-Drive didn’t give a morning side, or it’s two-timeframe. Hunt nothing new.'
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
    hoverText:
      extra?.hoverText ??
      [
        'CALL WAIT — no ticket',
        '',
        reason,
        locked ? BOOK_LOCKED : null,
        '',
        'Leo and Level Finder advise only. No line.',
      ]
        .filter((line) => line != null)
        .join('\n'),
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

function sideFromOpenAndControl(args: {
  opening: OpeningActivity
  control: MarketControl
}): DeskCallSide {
  if (args.opening.failedDrive) return 'WAIT'
  const fromOpen = openBias(args.opening)
  const fromCtrl = controlBias(args.control)
  const ctrlReady = controlGatesCall(args.control)
  if (fromOpen !== 'WAIT') {
    if (!ctrlReady) return fromOpen
    return fromCtrl === fromOpen ? fromOpen : 'WAIT'
  }
  if (fromCtrl === 'LONG' || fromCtrl === 'SHORT') return fromCtrl
  return 'WAIT'
}

function resolveActiveRange(args: {
  instrument: string
  candles: DeskCallBar[]
  asOfUnix: number
  playbookMode: DeskPlaybookMode
  sessionYmd: string
  openU: number
}): { key: DeskCallRangeKey; high: number; low: number } | null {
  const { instrument, asOfUnix, playbookMode, openU } = args
  const bars = asBars(args.candles).filter((c) => c.time <= asOfUnix)
  if (playbookMode === 'morning') {
    const or15 = computeOr15Range(bars, openU, asOfUnix)
    if (!or15?.complete || !(or15.high > or15.low)) return null
    return { key: 'OR15', high: or15.high, low: or15.low }
  }
  if (playbookMode === 'or30') {
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
  return null
}

function decideSide(args: {
  opening: OpeningActivity
  control: MarketControl
  peerSide?: DeskCallSide | null
}): DeskCallSide {
  const side = sideFromOpenAndControl({
    opening: args.opening,
    control: args.control,
  })
  if (
    args.peerSide === 'LONG' ||
    args.peerSide === 'SHORT'
  ) {
    if (side === 'WAIT' || args.peerSide !== side) return 'WAIT'
  }
  return side
}

function ydayHoverLabel(openType: YesterdayOpenType | undefined): string {
  if (!openType || openType === 'WAITING') return 'not ready'
  if (openType === 'IN_VALUE') return 'opened in value'
  if (openType === 'IN_RANGE') return 'opened in range'
  return 'opened outside range'
}

function ctrlHoverDetail(control: MarketControl): string {
  const badge = marketControlBadgeText(control)
  const dpoc =
    control.dpocDir === 'up'
      ? 'dPOC up'
      : control.dpocDir === 'down'
        ? 'dPOC down'
        : control.dpocDir === 'stuck'
          ? 'dPOC stuck'
          : 'dPOC n/a'
  return `${badge} · ${control.label} · ${dpoc}`
}

function buildCallHoverText(args: {
  instrument: string
  side: DeskCallSide
  range: { key: DeskCallRangeKey; high: number; low: number } | null
  opening: OpeningActivity
  control: MarketControl
  ydayType: YesterdayOpenType | undefined
  bookLocked: boolean
  peerSide?: DeskCallSide | null
  midAllowed: boolean
  entryPrice: number | null
}): string {
  const tokyo = args.instrument === 'NIKKEI'
  const openBadge = openingActivityBadgeText(args.opening)
  const ctrlDetail = ctrlHoverDetail(args.control)
  const fromOpen = openBias(args.opening)
  const fromCtrl = controlBias(args.control)
  const ctrlReady = controlGatesCall(args.control)
  const localSide = sideFromOpenAndControl({
    opening: args.opening,
    control: args.control,
  })
  const rows: string[] = []

  if (!args.range) {
    rows.push('BLOCK  Range: not locked — no legal ±10')
  } else {
    rows.push(
      `OK     Range: ${speakRange(args.range.key, tokyo)} locked · H ${px(args.range.high)} / L ${px(args.range.low)}`
    )
  }

  if (args.opening.failedDrive) {
    rows.push(`BLOCK  Open: ${openBadge} — failed drive, no side`)
  } else if (fromOpen === 'WAIT') {
    rows.push(
      `ADVISE Open: ${openBadge} — chip only; Auction / Rej-Rev does not gate CALL`
    )
  } else {
    rows.push(`OK     Open: ${openBadge} → ${fromOpen}`)
  }

  rows.push(
    `OK     Yday: ${ydayHoverLabel(args.ydayType)} — location only, not a CALL gate`
  )

  if (!ctrlReady) {
    rows.push(
      fromOpen !== 'WAIT'
        ? args.control.label === 'TWO-TF'
          ? `OK     Ctrl: ${ctrlDetail} — opening TWO-TF does not veto Drive`
          : `OK     Ctrl: ${ctrlDetail} — not scored yet; Drive/Test-Drive can CALL alone`
        : `OK     Ctrl: ${ctrlDetail} — not scored yet; wait for ONE-TF or a Drive`
    )
  } else if (fromCtrl === 'WAIT') {
    rows.push(
      `BLOCK  Ctrl: ${ctrlDetail} — needs ONE-TF BUY or SELL`
    )
  } else if (fromOpen !== 'WAIT' && fromCtrl !== fromOpen) {
    rows.push(
      `BLOCK  Ctrl: ${ctrlDetail} → ${fromCtrl} — disagrees with Open ${fromOpen}`
    )
  } else {
    rows.push(
      fromOpen === 'WAIT'
        ? `OK     Ctrl: ${ctrlDetail} → ${fromCtrl} — CALL from Control (Open is chip only)`
        : `OK     Ctrl: ${ctrlDetail} → ${fromCtrl}`
    )
  }

  if (args.peerSide === 'LONG' || args.peerSide === 'SHORT') {
    if (localSide !== 'WAIT' && args.peerSide !== localSide) {
      rows.push(`BLOCK  Twin desk: ${args.peerSide} — disagrees with this CALL`)
    } else {
      rows.push(`OK     Twin desk: ${args.peerSide}`)
    }
  }

  rows.push(
    args.bookLocked
      ? 'BLOCK  Book locked — CALL is the read, not a fill'
      : 'OK     Book open'
  )

  const header =
    args.side === 'WAIT' || !args.range
      ? 'CALL WAIT — no ticket'
      : `CALL ${args.range.key} ${args.side} — ticket allowed`
  const hunt =
    args.side === 'WAIT' || !args.range || args.entryPrice == null
      ? 'Hunt nothing new until Control is ONE-TF, or Drive/Test-Drive gives a morning side.'
      : args.side === 'LONG'
        ? `Hunt: ±${CALL_BAND_POINTS} below ${speakRange(args.range.key, tokyo)} low ${args.entryPrice}${args.midAllowed ? ' (mid is a pullback in the same CALL)' : ''
        }`
        : `Hunt: ±${CALL_BAND_POINTS} above ${speakRange(args.range.key, tokyo)} high ${args.entryPrice}${args.midAllowed ? ' (mid is a pullback in the same CALL)' : ''
        }`

  return [
    header,
    '',
    ...rows,
    '',
    hunt,
    tokyo ? 'Nikkei Open/Control = Tokyo cash, not US Range TPO.' : null,
    'Leo and Level Finder advise only. No line.',
  ]
    .filter((line) => line != null)
    .join('\n')
}

export function deskCallHoverText(p: DeskCall): string {
  return p.hoverText
}

export function deskCallBadgeText(p: DeskCall): string {
  if (p.side === 'WAIT' || !p.rangeKey) return 'WAIT'
  return `${p.rangeKey} ${p.side}`
}

export type DeskCallEdge = 'high' | 'low' | 'mid'

const CALL_WAIT_ENTRY =
  'CALL WAIT — hunt nothing new. Control isn’t ONE-TF yet, or there is no legal ±10.'

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
      message: `CALL is ${side} — this ticket must be a ${side === 'LONG' ? 'buy' : 'sell'
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

/**
 * Ticket gate after the clock-in CALL / regular choice.
 * `useCall: true` — same as {@link assertDeskCallEntry}.
 * `useCall: false` — any playbook ±10; CALL is still the setup read.
 * `useCall: null` — not answered; no tickets.
 */
export function assertDeskTicketEntry(args: {
  useCall: boolean | null
  call: DeskCall
  edge?: DeskCallEdge | null
  direction?: 'LONG' | 'SHORT' | null
}): { ok: true; side: 'LONG' | 'SHORT' } | { ok: false; message: string } {
  if (args.useCall == null) {
    return { ok: false, message: CALL_MODE_UNSET_MESSAGE }
  }
  if (args.useCall) {
    return assertDeskCallEntry({
      call: args.call,
      edge: args.edge,
      direction: args.direction,
    })
  }
  const side =
    args.direction ?? (args.edge === 'high' ? 'SHORT' : 'LONG')
  return { ok: true, side }
}

/**
 * Painted / drag-legal ±10 edges for the current CALL mode.
 * `null` = all playbook edges (US Range still drops mid via rangeEdgeBands).
 * Empty = none (WAIT, or CALL/regular not chosen).
 */
export function ticketAllowedEdges(args: {
  useCall: boolean | null
  call: DeskCall | null
}): ReadonlyArray<DeskCallEdge> | null {
  if (args.useCall == null) return []
  if (!args.useCall) return null
  if (!args.call) return []
  return deskCallLegalEdges(args.call)
}

/** CALL setup edges to highlight even when tickets are regular ±10. */
export function deskCallSetupEdges(call: DeskCall | null): ReadonlyArray<DeskCallEdge> {
  if (!call) return []
  return deskCallLegalEdges(call)
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
    return `CALL WAIT — Control isn’t ONE-TF yet, Drive/Test-Drive didn’t give a morning side, or it’s two-timeframe. Hunt nothing new.${locked} ${TICKET}`
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
    { playbookMode: 'morning', asOfUnix: openU + 15 * 60 },
    tokyo
      ? { playbookMode: 'us_range', asOfUnix: openU + 30 * 60 }
      : { playbookMode: 'or30', asOfUnix: openU + 30 * 60 },
    { playbookMode: 'ib', asOfUnix: openU + 60 * 60 },
  ]
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
  /** Same Control snapshot as the Ctrl chip — CALL must not recompute a second RF. */
  control?: MarketControl | null
  htfStandAside?: { isStandAside: boolean; reason: string; directiveSummary: string } | null
}): DeskCall {
  const instrument = String(args.instrument || '')
  let bookLocked = args.bookLocked === true
  if (!Number.isFinite(args.asOfUnix)) {
    return waiting(instrument, { bookLocked })
  }

  // Stand-Aside Engine Override: Automatically disable regular calls & lock book if active
  if (args.htfStandAside?.isStandAside) {
    return waiting(instrument, {
      bookLocked: true,
      reason: `STAND ASIDE ACTIVE (${args.htfStandAside.reason}): Regular calls disabled by HTF Specialist. ${args.htfStandAside.directiveSummary}`,
    })
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
  const control =
    args.control ??
    computeMarketControl({
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
      hoverText: buildCallHoverText({
        instrument,
        side: 'WAIT',
        range: null,
        opening,
        control,
        ydayType: yday?.openType,
        bookLocked,
        peerSide: args.peerSide,
        midAllowed: false,
        entryPrice: null,
      }),
    })
  }

  const side = decideSide({
    opening,
    control,
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
      hoverText: buildCallHoverText({
        instrument,
        side: 'WAIT',
        range,
        opening,
        control,
        ydayType: yday?.openType,
        bookLocked,
        peerSide: args.peerSide,
        midAllowed,
        entryPrice: null,
      }),
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
    hoverText: '',
  }
  call.playLine = playLineForCall(call)
  call.hoverText = buildCallHoverText({
    instrument,
    side,
    range,
    opening,
    control,
    ydayType: yday?.openType,
    bookLocked,
    peerSide: args.peerSide,
    midAllowed,
    entryPrice,
  })
  return call
}
