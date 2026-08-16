/**
 * Dalton opening activity (Mind Over Markets): Open-Drive, Open-Test-Drive,
 * Open-Rejection-Reverse, Open-Auction. Second axis next to yesterday location.
 *
 * Closed 5m cash bars only. NY 09:30 ET / Tokyo 09:00 JST. Advise-only —
 * does not change 1:1.5, the dollar ladder, or ±10 range-edge.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  nthTradingDayBefore,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import {
  computeYesterdayProfile,
  resolveYesterdayAsOfUnix,
  type YesterdayBar,
} from '@/lib/trading/yesterdayProfile'

export type OpeningBar = YesterdayBar

export type OpeningActivityType =
  | 'WAITING'
  | 'OPEN_DRIVE'
  | 'OPEN_TEST_DRIVE'
  | 'OPEN_REJECTION_REVERSE'
  | 'OPEN_AUCTION'

export type OpeningDirection = 'up' | 'down'

export type OpeningTestedRef =
  | 'YH'
  | 'YL'
  | 'VAH'
  | 'VAL'
  | 'ON_HIGH'
  | 'ON_LOW'

export type OpeningActivity = {
  instrument: string
  sourceSession: 'NY_RTH' | 'TOKYO_CASH'
  sessionDate: string | null
  type: OpeningActivityType
  direction: OpeningDirection | null
  openPrice: number | null
  rangeHigh: number | null
  rangeLow: number | null
  testedRef: OpeningTestedRef | null
  failedDrive: boolean
  playLine: string
}

export type OpeningRefs = {
  yh: number | null
  yl: number | null
  vah: number | null
  val: number | null
  overnightHigh: number | null
  overnightLow: number | null
}

export const OPENING_BAR_SEC = 300
const DRIVE_LOCK_BARS = 2
const AUCTION_LOCK_BARS = 3
const TAIL_FRAC = 0.2
const EPS = 1e-8

export const OPENING_ACTIVITY_COLORS = {
  open: '#22d3ee',
  range: '#06b6d4',
  fail: '#64748b',
} as const

export { resolveYesterdayAsOfUnix as resolveOpeningAsOfUnix }

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

function cashCloseUnixForYmd(ymd: string, clock: DeskClock): number {
  return zonedCivilToUnix(ymd, clock.overnightStartHour, clock.timeZone)
}

function waiting(
  instrument: string,
  extra?: Partial<OpeningActivity>
): OpeningActivity {
  const tokyo = instrument === 'NIKKEI'
  return {
    instrument,
    sourceSession: tokyo ? 'TOKYO_CASH' : 'NY_RTH',
    sessionDate: extra?.sessionDate ?? null,
    type: 'WAITING',
    direction: extra?.direction ?? null,
    openPrice: extra?.openPrice ?? null,
    rangeHigh: extra?.rangeHigh ?? null,
    rangeLow: extra?.rangeLow ?? null,
    testedRef: extra?.testedRef ?? null,
    failedDrive: extra?.failedDrive ?? false,
    playLine:
      extra?.playLine ??
      'OPENING TYPE waiting — first cash 5m bar not closed. Do not invent Drive / Test-Drive / Auction. Ticket stays 1.5R and ±10 of the shaped playbook range.',
  }
}

function finish(
  base: OpeningActivity,
  type: OpeningActivityType,
  direction: OpeningDirection | null,
  failedDrive: boolean,
  testedRef: OpeningTestedRef | null
): OpeningActivity {
  return {
    ...base,
    type,
    direction,
    testedRef,
    failedDrive,
    playLine: playLineFor(type, direction, failedDrive, testedRef),
  }
}

export function playLineFor(
  type: OpeningActivityType,
  direction: OpeningDirection | null,
  failedDrive: boolean,
  testedRef: OpeningTestedRef | null
): string {
  const ticket =
    'Ticket stays $400→$250→$150, TP = 1.5R, and ±10 of the shaped playbook range. Opening type does not unlock off-band entries — “early” means pick a side before IB locks, then hunt the first legal window (OR30 / IB).'
  const arrow = direction === 'up' ? 'up' : direction === 'down' ? 'down' : ''
  if (type === 'WAITING') {
    return `OPENING TYPE waiting — do not invent conviction. ${ticket}`
  }
  if (failedDrive) {
    const kind = testedRef ? 'TEST-DRIVE FAIL' : 'DRIVE FAIL'
    const next =
      type === 'OPEN_REJECTION_REVERSE'
        ? 'Relabel Rejection-Reverse: low conviction; wait for rotation; do not chase the first spike.'
        : 'Relabel Auction: two-sided; no directional call.'
    return `OPENING TYPE: ${kind} — the first extreme will not hold; through the open erased the tail. Stop calling a trend day. ${next} ${ticket}`
  }
  if (type === 'OPEN_DRIVE') {
    return `OPENING TYPE: Open-Drive ${arrow} — highest conviction. The first-bar extreme is the day reference; through the open / erase the tail = get out. Do not wait for a perfect pullback. ${ticket}`
  }
  if (type === 'OPEN_TEST_DRIVE') {
    const ref = testedRef ? ` Tested ${testedRef}.` : ''
    return `OPENING TYPE: Open-Test-Drive ${arrow} — second-most reliable extreme.${ref} Trade with the drive, as close as the legal band allows to the tested extreme. Through the open / drive origin = get out. ${ticket}`
  }
  if (type === 'OPEN_REJECTION_REVERSE') {
    return `OPENING TYPE: Open-Rejection-Reverse — lower conviction; extreme holds less than half the time. Expect two-sided / Normal day; wait for rotation back to the opening range. Do not chase the first spike. ${ticket}`
  }
  return `OPENING TYPE: Open-Auction — no apparent directional conviction; prints both sides of the open. Do not invent a Drive. ${ticket}`
}

/** ~0.075% of price, floored so DOW/Nikkei still tag a real stop pool. */
export function openingRefBuffer(price: number): number {
  if (!(price > 0)) return 1
  const pct = price * 0.00075
  const floor = price >= 10_000 ? 8 : price >= 1_000 ? 2 : 0.25
  return Math.max(pct, floor)
}

export function touchesRef(low: number, high: number, ref: number): boolean {
  const b = openingRefBuffer(ref)
  return low <= ref + b && high >= ref - b
}

function firstBarTail(bar: OpeningBar): OpeningDirection | 'two_sided' {
  const range = bar.high - bar.low
  if (!(range > EPS)) return 'two_sided'
  const pos = (bar.open - bar.low) / range
  if (pos <= TAIL_FRAC) return 'up'
  if (pos >= 1 - TAIL_FRAC) return 'down'
  return 'two_sided'
}

function overnightRange(
  candles: OpeningBar[],
  openU: number,
  sessionYmd: string,
  clock: DeskClock
): { high: number; low: number } | null {
  const priorYmd = nthTradingDayBefore(sessionYmd, 1, clock.timeZone)
  const priorClose = cashCloseUnixForYmd(priorYmd, clock)
  const bars = candles.filter((c) => c.time >= priorClose && c.time < openU)
  if (bars.length < 1) return null
  let high = -Infinity
  let low = Infinity
  for (const b of bars) {
    if (b.high > high) high = b.high
    if (b.low < low) low = b.low
  }
  if (!(high > low) || !Number.isFinite(high) || !Number.isFinite(low)) return null
  return { high: px(high), low: px(low) }
}

export function resolveOpeningRefs(args: {
  instrument: string
  candles: OpeningBar[]
  asOfUnix: number
  openU: number
  sessionYmd: string
}): OpeningRefs {
  const clock = deskClockFor(args.instrument)
  const profile = computeYesterdayProfile({
    instrument: args.instrument,
    candles: args.candles,
    asOfUnix: args.asOfUnix,
  })
  const over = overnightRange(args.candles, args.openU, args.sessionYmd, clock)
  return {
    yh: profile?.yh ?? null,
    yl: profile?.yl ?? null,
    vah: profile?.vah ?? null,
    val: profile?.val ?? null,
    overnightHigh: over?.high ?? null,
    overnightLow: over?.low ?? null,
  }
}

function taggedLowRef(
  low: number,
  high: number,
  refs: OpeningRefs
): OpeningTestedRef | null {
  const hits: Array<{ ref: OpeningTestedRef; price: number }> = []
  if (refs.yl != null && touchesRef(low, high, refs.yl)) {
    hits.push({ ref: 'YL', price: refs.yl })
  }
  if (refs.val != null && touchesRef(low, high, refs.val)) {
    hits.push({ ref: 'VAL', price: refs.val })
  }
  if (refs.overnightLow != null && touchesRef(low, high, refs.overnightLow)) {
    hits.push({ ref: 'ON_LOW', price: refs.overnightLow })
  }
  if (hits.length < 1) return null
  hits.sort((a, b) => Math.abs(low - a.price) - Math.abs(low - b.price))
  return hits[0]!.ref
}

function taggedHighRef(
  low: number,
  high: number,
  refs: OpeningRefs
): OpeningTestedRef | null {
  const hits: Array<{ ref: OpeningTestedRef; price: number }> = []
  if (refs.yh != null && touchesRef(low, high, refs.yh)) {
    hits.push({ ref: 'YH', price: refs.yh })
  }
  if (refs.vah != null && touchesRef(low, high, refs.vah)) {
    hits.push({ ref: 'VAH', price: refs.vah })
  }
  if (refs.overnightHigh != null && touchesRef(low, high, refs.overnightHigh)) {
    hits.push({ ref: 'ON_HIGH', price: refs.overnightHigh })
  }
  if (hits.length < 1) return null
  hits.sort((a, b) => Math.abs(high - a.price) - Math.abs(high - b.price))
  return hits[0]!.ref
}

function reverseThroughOpen(
  closed: OpeningBar[],
  openPrice: number
): { dir: OpeningDirection; probeIdx: number; reverseIdx: number } | null {
  if (closed.length < 2) return null
  let minI = 0
  let maxI = 0
  for (let i = 1; i < closed.length; i++) {
    if (closed[i]!.low < closed[minI]!.low) minI = i
    if (closed[i]!.high > closed[maxI]!.high) maxI = i
  }
  const probedDown = closed[minI]!.low < openPrice - EPS
  const probedUp = closed[maxI]!.high > openPrice + EPS
  if (probedDown) {
    for (let j = minI + 1; j < closed.length; j++) {
      if (closed[j]!.high > openPrice + EPS) {
        return { dir: 'up', probeIdx: minI, reverseIdx: j }
      }
    }
  }
  if (probedUp) {
    for (let j = maxI + 1; j < closed.length; j++) {
      if (closed[j]!.low < openPrice - EPS) {
        return { dir: 'down', probeIdx: maxI, reverseIdx: j }
      }
    }
  }
  return null
}

/** After a Test-Drive / Rej-Rev reverse, coming back through the open kills the drive. */
function reverseLaterFailed(
  closed: OpeningBar[],
  rev: { dir: OpeningDirection; reverseIdx: number },
  openPrice: number
): boolean {
  for (let i = rev.reverseIdx + 1; i < closed.length; i++) {
    const b = closed[i]!
    if (rev.dir === 'up' && b.low < openPrice - EPS) return true
    if (rev.dir === 'down' && b.high > openPrice + EPS) return true
  }
  return false
}

function driveHeldAtLock(
  closed: OpeningBar[],
  tail: OpeningDirection,
  rangeHigh: number,
  rangeLow: number
): boolean {
  if (closed.length < DRIVE_LOCK_BARS) return false
  const bar2 = closed[1]!
  if (tail === 'up') return bar2.low >= rangeLow - EPS
  return bar2.high <= rangeHigh + EPS
}

function takenOutAfterLock(
  closed: OpeningBar[],
  tail: OpeningDirection,
  rangeHigh: number,
  rangeLow: number
): boolean {
  for (let i = 1; i < closed.length; i++) {
    const b = closed[i]!
    if (tail === 'up' && b.low < rangeLow - EPS) return true
    if (tail === 'down' && b.high > rangeHigh + EPS) return true
  }
  return false
}

function relabelAfterFail(
  closed: OpeningBar[],
  openPrice: number,
  tail: OpeningDirection
): OpeningActivityType {
  const failBar = closed[closed.length - 1]!
  if (tail === 'up' && failBar.close < openPrice - EPS) {
    return 'OPEN_REJECTION_REVERSE'
  }
  if (tail === 'down' && failBar.close > openPrice + EPS) {
    return 'OPEN_REJECTION_REVERSE'
  }
  return 'OPEN_AUCTION'
}

export function computeOpeningActivity(args: {
  instrument: string
  candles: OpeningBar[]
  asOfUnix: number
  refs?: OpeningRefs | null
}): OpeningActivity {
  const instrument = args.instrument
  const clock = deskClockFor(instrument)
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) {
    return waiting(instrument)
  }

  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = cashCloseUnixForYmd(ymd, clock)
  const sessionDate = ymd
  const base = waiting(instrument, { sessionDate })

  if (args.asOfUnix < openU) return base

  const closed = args.candles
    .filter(
      (c) =>
        c.time >= openU - 30 &&
        c.time < closeU &&
        c.time + OPENING_BAR_SEC <= args.asOfUnix
    )
    .slice()
    .sort((a, b) => a.time - b.time)

  // Prefer the 09:30/09:00 bar; if the feed skipped it, take the first print in the first 10m.
  const first = closed.find(
    (c) => c.time >= openU - 30 && c.time < openU + 2 * OPENING_BAR_SEC
  )
  if (!first) return base

  const openPrice = px(first.open)
  const rangeHigh = px(first.high)
  const rangeLow = px(first.low)
  const withRange = waiting(instrument, {
    sessionDate,
    openPrice,
    rangeHigh,
    rangeLow,
  })

  const tail = firstBarTail(first)
  const n = closed.length
  const bothSides =
    closed.some((b) => b.high > openPrice + EPS) &&
    closed.some((b) => b.low < openPrice - EPS)

  if (tail === 'up' || tail === 'down') {
    const held = driveHeldAtLock(closed, tail, rangeHigh, rangeLow)
    if (held && !takenOutAfterLock(closed, tail, rangeHigh, rangeLow)) {
      return finish(withRange, 'OPEN_DRIVE', tail, false, null)
    }
    if (held && takenOutAfterLock(closed, tail, rangeHigh, rangeLow)) {
      const relabel = relabelAfterFail(closed, openPrice, tail)
      return finish(withRange, relabel, tail, true, null)
    }
  }

  const refs =
    args.refs === undefined
      ? resolveOpeningRefs({
          instrument,
          candles: args.candles,
          asOfUnix: args.asOfUnix,
          openU,
          sessionYmd: ymd,
        })
      : args.refs ?? {
          yh: null,
          yl: null,
          vah: null,
          val: null,
          overnightHigh: null,
          overnightLow: null,
        }

  // Centered first bar is already two-sided — not a one-way probe. Wait for Auction.
  const rev = tail === 'two_sided' ? null : reverseThroughOpen(closed, openPrice)
  if (rev) {
    const probe = closed[rev.probeIdx]!
    const tagged =
      rev.dir === 'up'
        ? taggedLowRef(probe.low, probe.high, refs)
        : taggedHighRef(probe.low, probe.high, refs)
    const locked = tagged ? 'OPEN_TEST_DRIVE' : 'OPEN_REJECTION_REVERSE'
    if (reverseLaterFailed(closed, rev, openPrice)) {
      const relabel = relabelAfterFail(closed, openPrice, rev.dir)
      return finish(withRange, relabel, rev.dir, true, tagged)
    }
    return finish(withRange, locked, rev.dir, false, tagged)
  }

  if (n >= AUCTION_LOCK_BARS && (bothSides || tail === 'two_sided')) {
    return finish(withRange, 'OPEN_AUCTION', null, false, null)
  }

  return withRange
}

export function formatOpeningActivityForPrompt(p: OpeningActivity): string {
  const src = p.sourceSession === 'TOKYO_CASH' ? 'Tokyo cash' : 'NY RTH'
  const nikkei =
    p.instrument === 'NIKKEI' ? ' Nikkei open = Tokyo cash, not US Range.' : ''
  if (p.openPrice == null) {
    return `OPENING TYPE: waiting (${src}${nikkei}). Do not invent Drive / Test-Drive / Rejection-Reverse / Auction.`
  }
  const dir =
    p.direction === 'up' ? ' ↑' : p.direction === 'down' ? ' ↓' : ''
  const fail = p.failedDrive
    ? p.testedRef
      ? 'TEST-DRIVE FAIL → '
      : 'DRIVE FAIL → '
    : ''
  const label =
    p.type === 'WAITING'
      ? 'WAITING'
      : p.type === 'OPEN_DRIVE'
        ? 'Open-Drive'
        : p.type === 'OPEN_TEST_DRIVE'
          ? 'Open-Test-Drive'
          : p.type === 'OPEN_REJECTION_REVERSE'
            ? 'Open-Rejection-Reverse'
            : 'Open-Auction'
  const lines = [
    `OPENING TYPE (Dalton — ground truth, same helper as the live/sim chip):`,
    `Source: ${src} session ${p.sessionDate ?? 'n/a'} first 5m cash bar.${nikkei}`,
    `${fail}${label}${dir} · open ${p.openPrice} · first-bar ${p.rangeLow}–${p.rangeHigh}${
      p.testedRef ? ` · tested ${p.testedRef}` : ''
    }`,
    p.playLine,
  ]
  return lines.join('\n')
}

export function openingActivityBadgeText(p: OpeningActivity): string {
  if (p.failedDrive) return p.testedRef ? 'TD FAIL' : 'DRIVE FAIL'
  if (p.type === 'WAITING') return 'WAIT'
  const dir = p.direction === 'up' ? ' ↑' : p.direction === 'down' ? ' ↓' : ''
  if (p.type === 'OPEN_DRIVE') return `DRIVE${dir}`
  if (p.type === 'OPEN_TEST_DRIVE') return `TEST-DRIVE${dir}`
  if (p.type === 'OPEN_REJECTION_REVERSE') return 'REJ-REV'
  return 'AUCTION'
}

export function openingActivityPaintKey(
  visible: boolean,
  p: OpeningActivity
): string {
  if (!visible) return 'off'
  return [
    p.instrument,
    p.sessionDate,
    p.type,
    p.direction,
    p.openPrice,
    p.rangeHigh,
    p.rangeLow,
    p.testedRef,
    p.failedDrive,
  ].join('|')
}

export type OpeningLineSpec = {
  price: number
  title: string
  color: string
  dashed?: boolean
}

export function openingActivityLineSpecs(p: OpeningActivity): OpeningLineSpec[] {
  if (p.openPrice == null || p.rangeHigh == null || p.rangeLow == null) {
    return []
  }
  const color = p.failedDrive
    ? OPENING_ACTIVITY_COLORS.fail
    : OPENING_ACTIVITY_COLORS.range
  const openColor = p.failedDrive
    ? OPENING_ACTIVITY_COLORS.fail
    : OPENING_ACTIVITY_COLORS.open
  return [
    { price: p.openPrice, title: 'Open', color: openColor },
    { price: p.rangeHigh, title: 'Open H', color, dashed: true },
    { price: p.rangeLow, title: 'Open L', color, dashed: true },
  ]
}
