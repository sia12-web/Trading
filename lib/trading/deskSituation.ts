/**
 * Dalton special situations (Mind Over Markets pp. 238–262).
 * Advise only. Never gates CALL. Never stretches 1.5R. Never auto-flattens.
 *
 * Priority: Gap → Spike → 3:1 / NEUT (next-open, first ~90m) → VA-rule → BAL.
 * Yesterday = last completed NY cash day (YH/YL + 70% TPO VA).
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import { computeInitialBalance } from '@/lib/trading/deskLevels'
import { computeLongTermRegion } from '@/lib/trading/longTermBracket'
import { computeYesterdayProfile, type YesterdayBar } from '@/lib/trading/yesterdayProfile'

export type SitKind =
  | 'NONE'
  | 'GAP'
  | 'SPIKE'
  | 'THREE_TO_ONE'
  | 'NEUT'
  | 'VA'
  | 'BAL'

export type SitBar = YesterdayBar

export type DeskSituation = {
  kind: SitKind
  badgeText: string
  playLine: string
  spikeHigh: number | null
  spikeLow: number | null
  /** Gap still holding (not erased) — manage HOLD with the book */
  gapHold: boolean
  gapDead: boolean
  spikeReject: boolean
}

export const SIT_COLORS = {
  spike: '#71717a',
} as const

const EPS = 1e-8
const TPO_PERIOD_SEC = 30 * 60
const NEXT_OPEN_SEC = 90 * 60
const SPIKE_FRAC = 0.4
const CLOSE_EXTREME = 0.2
const TICKET =
  'CALL side unchanged. Ticket stays 1.5R.'

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

type RthDay = { ymd: string; openU: number; closeU: number }

function collectRthDays(candles: SitBar[], clock: DeskClock): RthDay[] {
  const seen = new Map<string, RthDay>()
  for (const c of candles) {
    const ymd = dayKey(c.time, clock.timeZone)
    if (!isWeekdayYmd(ymd, clock.timeZone)) continue
    if (!seen.has(ymd)) {
      const openU = cashOpenUnixForYmd(ymd, clock)
      const closeU = cashCloseUnixForYmd(ymd, clock)
      if (closeU > openU) seen.set(ymd, { ymd, openU, closeU })
    }
  }
  return Array.from(seen.values())
    .filter((d) => candles.some((c) => c.time >= d.openU && c.time < d.closeU))
    .sort((a, b) => a.openU - b.openU)
}

function none(extra?: Partial<DeskSituation>): DeskSituation {
  return {
    kind: 'NONE',
    badgeText: 'NONE',
    playLine: `SIT NONE — no special situation. ${TICKET}`,
    spikeHigh: extra?.spikeHigh ?? null,
    spikeLow: extra?.spikeLow ?? null,
    gapHold: false,
    gapDead: false,
    spikeReject: false,
  }
}

function dayBars(candles: SitBar[], day: RthDay, until: number): SitBar[] {
  return candles.filter(
    (c) => c.time >= day.openU && c.time < day.closeU && c.time <= until
  )
}

function dayHl(bars: SitBar[]): { yh: number; yl: number } | null {
  if (bars.length < 2) return null
  let yh = -Infinity
  let yl = Infinity
  for (const b of bars) {
    if (b.high > yh) yh = b.high
    if (b.low < yl) yl = b.low
  }
  if (!(yh > yl)) return null
  return { yh: px(yh), yl: px(yl) }
}

function tpoPeriods(
  bars: SitBar[],
  openU: number
): Array<{ high: number; low: number; idx: number }> {
  const periods = new Map<number, { high: number; low: number }>()
  for (const b of bars) {
    const idx = Math.floor((b.time - openU) / TPO_PERIOD_SEC)
    const prev = periods.get(idx)
    if (!prev) periods.set(idx, { high: b.high, low: b.low })
    else {
      prev.high = Math.max(prev.high, b.high)
      prev.low = Math.min(prev.low, b.low)
    }
  }
  return Array.from(periods.entries())
    .map(([idx, p]) => ({ idx, high: p.high, low: p.low }))
    .sort((a, b) => a.idx - b.idx)
}

function tpoCountSides(
  periods: Array<{ high: number; low: number }>,
  mid: number
): { up: number; down: number } {
  let up = 0
  let down = 0
  for (const p of periods) {
    const span = Math.max(EPS, p.high - p.low)
    const above = Math.max(0, p.high - Math.max(p.low, mid))
    const below = Math.max(0, Math.min(p.high, mid) - p.low)
    up += above / span
    down += below / span
  }
  return { up, down }
}

type SpikeRead = {
  high: number
  low: number
  dir: 'buy' | 'sell'
}

function detectSpike(
  bars: SitBar[],
  openU: number,
  yh: number,
  yl: number
): SpikeRead | null {
  const periods = tpoPeriods(bars, openU)
  if (periods.length < 4) return null
  const last2 = periods.slice(-2)
  const prior = periods.slice(0, -2)
  const preHigh = Math.max(...prior.map((p) => p.high))
  const preLow = Math.min(...prior.map((p) => p.low))
  const spikeHigh = Math.max(...last2.map((p) => p.high))
  const spikeLow = Math.min(...last2.map((p) => p.low))
  const dayRange = yh - yl
  if (!(dayRange > 0)) return null
  const buyExt = spikeHigh - preHigh
  const sellExt = preLow - spikeLow
  if (buyExt >= dayRange * SPIKE_FRAC && spikeHigh >= yh - EPS) {
    return { high: px(spikeHigh), low: px(Math.max(spikeLow, preHigh)), dir: 'buy' }
  }
  if (sellExt >= dayRange * SPIKE_FRAC && spikeLow <= yl + EPS) {
    return { high: px(Math.min(spikeHigh, preLow)), low: px(spikeLow), dir: 'sell' }
  }
  return null
}

type DayScore = {
  threeToOne: 'buy' | 'sell' | null
  neut: 'high' | 'low' | null
  spike: SpikeRead | null
  yh: number
  yl: number
  close: number
}

function scoreCompletedDay(
  candles: SitBar[],
  day: RthDay
): DayScore | null {
  const bars = dayBars(candles, day, day.closeU)
  const hl = dayHl(bars)
  if (!hl) return null
  const last = bars[bars.length - 1]
  if (!last) return null
  const ib = computeInitialBalance(
    bars.map((b) => ({ ...b, volume: 1 })),
    day.openU,
    day.closeU,
    60
  )
  const periods = tpoPeriods(bars, day.openU)
  const mid = (hl.yh + hl.yl) / 2
  const sides = tpoCountSides(periods, mid)
  const first = periods[0]
  const buyingTail = first != null && first.low <= hl.yl + EPS
  const sellingTail = first != null && first.high >= hl.yh - EPS
  const reUp = ib != null && hl.yh > ib.high + EPS
  const reDown = ib != null && hl.yl < ib.low - EPS
  const tpoBuy = sides.up > sides.down
  const tpoSell = sides.down > sides.up
  let threeToOne: 'buy' | 'sell' | null = null
  if (buyingTail && reUp && tpoBuy && !reDown) threeToOne = 'buy'
  else if (sellingTail && reDown && tpoSell && !reUp) threeToOne = 'sell'

  const close = last.close
  const loc = (close - hl.yl) / (hl.yh - hl.yl)
  let neut: 'high' | 'low' | null = null
  if (reUp && reDown) {
    if (loc >= 1 - CLOSE_EXTREME) neut = 'high'
    else if (loc <= CLOSE_EXTREME) neut = 'low'
  }

  return {
    threeToOne,
    neut,
    spike: detectSpike(bars, day.openU, hl.yh, hl.yl),
    yh: hl.yh,
    yl: hl.yl,
    close: px(close),
  }
}

function sessionOpenPrice(bars: SitBar[]): number | null {
  const first = bars[0]
  if (!first) return null
  return px(first.open)
}

function lettersInsideVa(
  bars: SitBar[],
  openU: number,
  vah: number,
  val: number
): number {
  const periods = tpoPeriods(bars, openU)
  let n = 0
  for (const p of periods) {
    const overlap = p.low < vah + EPS && p.high > val - EPS
    if (overlap) n += 1
  }
  return n
}

export function deskSitLineSpecs(
  p: DeskSituation
): Array<{ price: number; color: string; title: string }> {
  if (p.spikeHigh == null || p.spikeLow == null) return []
  if (!(p.spikeHigh > p.spikeLow)) return []
  return [
    { price: p.spikeHigh, color: SIT_COLORS.spike, title: 'Sp H' },
    { price: p.spikeLow, color: SIT_COLORS.spike, title: 'Sp L' },
  ]
}

export function computeDeskSituation(args: {
  instrument: string
  candles: SitBar[]
  asOfUnix: number
}): DeskSituation {
  const instrument = String(args.instrument || '')
  if (!Number.isFinite(args.asOfUnix) || !instrument) return none()
  const candles = (Array.isArray(args.candles) ? args.candles : []).filter(
    (c) => c && Number.isFinite(c.time) && c.time <= args.asOfUnix
  )
  const clock = deskClockFor(instrument)
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) return none()

  const todayOpen = cashOpenUnixForYmd(ymd, clock)
  const todayClose = cashCloseUnixForYmd(ymd, clock)
  const days = collectRthDays(candles, clock)
  const prior = days.filter((d) => d.openU < todayOpen).pop() ?? null
  if (!prior) return none()

  const ydayScore = scoreCompletedDay(candles, prior)
  if (!ydayScore) return none()

  const yday = computeYesterdayProfile({
    instrument,
    candles,
    asOfUnix: args.asOfUnix,
  })
  const yh = yday?.yh ?? ydayScore.yh
  const yl = yday?.yl ?? ydayScore.yl
  const vah = yday?.vah ?? null
  const val = yday?.val ?? null

  const todayBars = dayBars(
    candles,
    { ymd, openU: todayOpen, closeU: todayClose },
    args.asOfUnix
  )
  const elapsed = Math.max(0, args.asOfUnix - todayOpen)
  const inNextOpenWindow =
    args.asOfUnix >= todayOpen && elapsed < NEXT_OPEN_SEC
  const cashOpen = sessionOpenPrice(todayBars)
  const tip = todayBars.length
    ? px(todayBars[todayBars.length - 1]!.close)
    : cashOpen

  const spike = ydayScore.spike

  const withTicket = (line: string) => `${line} ${TICKET}`

  // 1. Gap — open outside yesterday's RANGE
  if (cashOpen != null && yh > yl) {
    const gapUp = cashOpen > yh + EPS
    const gapDown = cashOpen < yl - EPS
    if (gapUp || gapDown) {
      const edge = gapUp ? yh : yl
      const through = gapUp
        ? todayBars.some((b) => b.low <= edge + EPS)
        : todayBars.some((b) => b.high >= edge - EPS)
      const toward =
        tip != null &&
        (gapUp ? tip < cashOpen - EPS && tip > edge + EPS : tip > cashOpen + EPS && tip < edge - EPS)
      if (through) {
        return {
          kind: 'GAP',
          badgeText: 'GAP · dead',
          playLine: withTicket(
            'SIT GAP · dead — responsive activity erased the gap. Gap is no longer a guide.'
          ),
          spikeHigh: spike?.high ?? null,
          spikeLow: spike?.low ?? null,
          gapHold: false,
          gapDead: true,
          spikeReject: false,
        }
      }
      const testing = toward && elapsed < 60 * 60
      return {
        kind: 'GAP',
        badgeText: testing ? 'GAP · test' : 'GAP · hold',
        playLine: withTicket(
          testing
            ? 'SIT GAP · test — auctioning back toward yesterday’s extreme. First hour; CALL unchanged.'
            : 'SIT GAP · hold — open outside yesterday’s range. Trade with initiative; stop is the ticket stop, not gap-erasure as a new flatten.'
        ),
        spikeHigh: spike?.high ?? null,
        spikeLow: spike?.low ?? null,
        gapHold: !testing,
        gapDead: false,
        spikeReject: false,
      }
    }
  }

  // 2. Spike — today’s open vs yesterday’s late spike
  if (spike && cashOpen != null) {
    const inSpike =
      cashOpen <= spike.high + EPS && cashOpen >= spike.low - EPS
    const beyond =
      spike.dir === 'buy'
        ? cashOpen > spike.high + EPS
        : cashOpen < spike.low - EPS
    const reject =
      spike.dir === 'buy'
        ? cashOpen < spike.low - EPS
        : cashOpen > spike.high + EPS
    if (inSpike || beyond || reject) {
      const badge = inSpike
        ? 'SPIKE · in'
        : beyond
          ? 'SPIKE · with'
          : 'SPIKE · rej'
      const play = inSpike
        ? 'SIT SPIKE · in — open inside yesterday’s late spike. Rotational / balancing inside the spike.'
        : beyond
          ? 'SIT SPIKE · with — open beyond the spike in its direction. Continuation geography.'
          : 'SIT SPIKE · rej — open opposite the spike base. Spike rejected; not a reverse CALL.'
      return {
        kind: 'SPIKE',
        badgeText: badge,
        playLine: withTicket(play),
        spikeHigh: spike.high,
        spikeLow: spike.low,
        gapHold: false,
        gapDead: false,
        spikeReject: reject,
      }
    }
  }

  // 3. 3-to-1 / Neutral-extreme — next-open note, first ~90m
  if (inNextOpenWindow) {
    if (ydayScore.threeToOne) {
      const side = ydayScore.threeToOne === 'buy' ? 'buy' : 'sell'
      return {
        kind: 'THREE_TO_ONE',
        badgeText: `3:1 · ${side}`,
        playLine: withTicket(
          `SIT 3:1 · ${side} — yesterday initiative tail + TPO + IB extension. First 90m often better than yday VA. Next-open note, not an overnight hold.`
        ),
        spikeHigh: spike?.high ?? null,
        spikeLow: spike?.low ?? null,
        gapHold: false,
        gapDead: false,
        spikeReject: false,
      }
    }
    if (ydayScore.neut) {
      return {
        kind: 'NEUT',
        badgeText: `NEUT · ${ydayScore.neut}`,
        playLine: withTicket(
          `SIT NEUT · ${ydayScore.neut} — yesterday two-sided IB then closed on the extreme. Next-open note, not a second Control.`
        ),
        spikeHigh: spike?.high ?? null,
        spikeLow: spike?.low ?? null,
        gapHold: false,
        gapDead: false,
        spikeReject: false,
      }
    }
  }

  // 4. Value-area rule — advise traverse, never fade CALL
  if (
    cashOpen != null &&
    vah != null &&
    val != null &&
    vah > val &&
    (cashOpen > vah + EPS || cashOpen < val - EPS)
  ) {
    const inside = lettersInsideVa(todayBars, todayOpen, vah, val)
    if (inside >= 2) {
      return {
        kind: 'VA',
        badgeText: 'VA · thru',
        playLine: withTicket(
          'SIT VA · thru — accepted back into yesterday’s VA (two 30m letters). Traverse possible; width/near-open/Region still matter. Does not fade CALL.'
        ),
        spikeHigh: spike?.high ?? null,
        spikeLow: spike?.low ?? null,
        gapHold: false,
        gapDead: false,
        spikeReject: false,
      }
    }
  }

  // 5. BAL — only if 5-day region already TREND
  const region = computeLongTermRegion({
    instrument,
    candles,
    asOfUnix: args.asOfUnix,
  })
  if (region.ready && region.mode === 'TREND') {
    return {
      kind: 'BAL',
      badgeText: 'BAL · with',
      playLine: withTicket(
        'SIT BAL · with — today’s value accepted outside the 5-day body. Go with the breakout geography. CALL side unchanged.'
      ),
      spikeHigh: spike?.high ?? null,
      spikeLow: spike?.low ?? null,
      gapHold: false,
      gapDead: false,
      spikeReject: false,
    }
  }

  if (spike) {
    return none({ spikeHigh: spike.high, spikeLow: spike.low })
  }
  return none()
}
