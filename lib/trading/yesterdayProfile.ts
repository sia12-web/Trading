/**
 * Prior-session Market Profile (Dalton): YH / YL / 70% TPO value / time POC,
 * cash-open day type, and superimposed range estimate ±10%.
 *
 * TPO is time-based — never OANDA tick volume. NY RTH vs Tokyo cash use
 * deskClockFor(instrument). Superimpose waits for a holding IB extreme.
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
  computeIbSignals,
  computeInitialBalance,
  type InitialBalanceRange,
} from '@/lib/trading/deskLevels'

export type YesterdayOpenType =
  | 'WAITING'
  | 'IN_VALUE'
  | 'IN_RANGE'
  | 'OUTSIDE_RANGE'

export type SuperimposeStatus = 'WAITING' | 'READY' | 'INVALIDATED'

export type YesterdayBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type TpoValueArea = {
  yh: number
  yl: number
  vah: number
  val: number
  poc: number
  priorRangePoints: number
  tpoCount: number
}

export type YesterdayProfile = {
  instrument: string
  sourceSession: 'NY_RTH' | 'TOKYO_CASH'
  sessionDate: string
  yh: number
  yl: number
  vah: number
  val: number
  poc: number
  priorRangePoints: number
  cashOpen: number | null
  openType: YesterdayOpenType
  superimpose: SuperimposeStatus
  holdingExtreme: number | null
  holdingSide: 'low' | 'high' | null
  exact: number | null
  bandMin: number | null
  bandMax: number | null
  playLine: string
  slTpAdvice: string
}

const TPO_PERIOD_SEC = 30 * 60
const VALUE_AREA_FRAC = 0.7
const SUPERIMPOSE_BUFFER = 0.1
const AUCTION_AWAY_FRAC = 0.25

export const YDAY_COLORS = {
  range: '#d97706',
  value: '#f59e0b',
  poc: '#b45309',
  estimate: '#ca8a04',
  band: '#fbbf24',
} as const

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

/** Index TPO tick — coarse enough for DOW/NASDAQ/NIKKEI, fine enough for tests. */
export function tpoTickSize(mid: number): number {
  if (!(mid > 0)) return 1
  if (mid >= 10_000) return 5
  if (mid >= 1_000) return 1
  return 0.25
}

function bucketPrice(price: number, tick: number): number {
  return Math.round(price / tick) * tick
}

type RthDay = { ymd: string; openU: number; closeU: number }

function collectRthDays(candles: YesterdayBar[], clock: DeskClock): RthDay[] {
  const seen = new Map<string, RthDay>()
  for (const c of candles) {
    const ymd = dayKey(c.time, clock.timeZone)
    if (!isWeekdayYmd(ymd, clock.timeZone)) continue
    let day = seen.get(ymd)
    if (!day) {
      const openU = cashOpenUnixForYmd(ymd, clock)
      const closeU = cashCloseUnixForYmd(ymd, clock)
      if (!(closeU > openU)) continue
      day = { ymd, openU, closeU }
      seen.set(ymd, day)
    }
  }
  const withPrints = Array.from(seen.values()).filter((d) =>
    candles.some((c) => c.time >= d.openU && c.time < d.closeU)
  )
  withPrints.sort((a, b) => a.openU - b.openU)
  return withPrints
}

export function buildTpoValueArea(
  candles: YesterdayBar[],
  openU: number,
  closeU: number
): TpoValueArea | null {
  const bars = candles.filter((c) => c.time >= openU && c.time < closeU)
  if (bars.length < 6) return null

  let yh = -Infinity
  let yl = Infinity
  for (const b of bars) {
    if (b.high > yh) yh = b.high
    if (b.low < yl) yl = b.low
  }
  if (!(yh > yl) || !Number.isFinite(yh) || !Number.isFinite(yl)) return null

  const tick = tpoTickSize((yh + yl) / 2)
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
  if (periods.size < 2) return null

  const tpos = new Map<number, number>()
  for (const p of periods.values()) {
    const start = bucketPrice(p.low, tick)
    const end = bucketPrice(p.high, tick)
    const steps = Math.max(0, Math.round((end - start) / tick))
    const capped = Math.min(steps, 4000)
    for (let i = 0; i <= capped; i++) {
      const k = bucketPrice(start + i * tick, tick)
      tpos.set(k, (tpos.get(k) ?? 0) + 1)
    }
  }
  if (tpos.size < 3) return null

  const rows = Array.from(tpos.entries())
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price)
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (total < 4) return null

  const mid = (yh + yl) / 2
  let pocIdx = 0
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i]!
    const best = rows[pocIdx]!
    if (
      cur.count > best.count ||
      (cur.count === best.count && Math.abs(cur.price - mid) < Math.abs(best.price - mid))
    ) {
      pocIdx = i
    }
  }

  const target = total * VALUE_AREA_FRAC
  let lo = pocIdx
  let hi = pocIdx
  let covered = rows[pocIdx]!.count
  while (covered < target && (lo > 0 || hi < rows.length - 1)) {
    const up = hi < rows.length - 1 ? rows[hi + 1]!.count : -1
    const down = lo > 0 ? rows[lo - 1]!.count : -1
    if (up < 0 && down < 0) break
    if (up >= down) {
      hi += 1
      covered += rows[hi]!.count
    } else {
      lo -= 1
      covered += rows[lo]!.count
    }
  }

  const poc = px(rows[pocIdx]!.price)
  const val = px(rows[lo]!.price)
  const vah = px(rows[hi]!.price)
  return {
    yh: px(yh),
    yl: px(yl),
    vah,
    val,
    poc,
    priorRangePoints: px(yh - yl),
    tpoCount: total,
  }
}

export function classifyOpen(
  cashOpen: number | null,
  asOfUnix: number,
  sessionOpenUnix: number | null,
  va: Pick<TpoValueArea, 'yh' | 'yl' | 'vah' | 'val'>
): YesterdayOpenType {
  if (sessionOpenUnix == null || asOfUnix < sessionOpenUnix || cashOpen == null) {
    return 'WAITING'
  }
  if (cashOpen >= va.val && cashOpen <= va.vah) return 'IN_VALUE'
  if (cashOpen >= va.yl && cashOpen <= va.yh) return 'IN_RANGE'
  return 'OUTSIDE_RANGE'
}

function maxTail(
  bars: YesterdayBar[],
  ib: InitialBalanceRange
): { low: number; high: number } {
  let low = 0
  let high = 0
  for (const b of bars) {
    if (b.time < ib.openUnix || b.time >= ib.endUnix) continue
    const bodyLow = Math.min(b.open, b.close)
    const bodyHigh = Math.max(b.open, b.close)
    low = Math.max(low, bodyLow - b.low)
    high = Math.max(high, b.high - bodyHigh)
  }
  return { low, high }
}

export function resolveSuperimpose(args: {
  va: TpoValueArea
  ib: InitialBalanceRange | null
  candles: YesterdayBar[]
  asOfUnix: number
  sessionOpenUnix: number
  tip: number | null
}): {
  status: SuperimposeStatus
  holdingExtreme: number | null
  holdingSide: 'low' | 'high' | null
  exact: number | null
  bandMin: number | null
  bandMax: number | null
} {
  const empty = {
    status: 'WAITING' as const,
    holdingExtreme: null,
    holdingSide: null,
    exact: null,
    bandMin: null,
    bandMax: null,
  }
  const ib = args.ib
  if (!ib || args.asOfUnix < ib.endUnix) return empty

  const sessionBars = args.candles.filter(
    (c) => c.time >= args.sessionOpenUnix && c.time <= args.asOfUnix
  )
  if (sessionBars.length < 2) return empty

  let sessionHigh = -Infinity
  let sessionLow = Infinity
  for (const b of sessionBars) {
    sessionHigh = Math.max(sessionHigh, b.high)
    sessionLow = Math.min(sessionLow, b.low)
  }

  const signals = computeIbSignals(
    sessionBars.map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? 0,
    })),
    ib,
    { useVol: false }
  )
  const rejLow = signals.some((s) => s.type === 'REJECT_LOW')
  const rejHigh = signals.some((s) => s.type === 'REJECT_HIGH')
  const tails = maxTail(sessionBars, ib)
  const ibH = ib.high - ib.low
  const tip = args.tip ?? sessionBars[sessionBars.length - 1]!.close
  const lowIntact = sessionLow >= ib.low - 1e-6
  const highIntact = sessionHigh <= ib.high + 1e-6
  if (!lowIntact && !highIntact) {
    return {
      status: 'INVALIDATED',
      holdingExtreme: null,
      holdingSide: null,
      exact: null,
      bandMin: null,
      bandMax: null,
    }
  }
  const offLow = tip - ib.low
  const offHigh = ib.high - tip
  const lowAway = offLow >= ibH * AUCTION_AWAY_FRAC
  const highAway = offHigh >= ibH * AUCTION_AWAY_FRAC
  const lowOk = lowIntact && (rejLow || lowAway)
  const highOk = highIntact && (rejHigh || highAway)

  let side: 'low' | 'high' | null = null
  if (lowOk && highOk) {
    if (rejLow && !rejHigh) side = 'low'
    else if (rejHigh && !rejLow) side = 'high'
    else side = tails.low >= tails.high ? 'low' : 'high'
  } else if (lowOk) side = 'low'
  else if (highOk) side = 'high'
  else if (lowIntact && !highIntact) side = 'low'
  else if (highIntact && !lowIntact) side = 'high'
  if (!side) return empty

  const holding = side === 'low' ? ib.low : ib.high

  const R = args.va.priorRangePoints
  const exact = side === 'low' ? holding + R : holding - R
  const minR = R * (1 - SUPERIMPOSE_BUFFER)
  const maxR = R * (1 + SUPERIMPOSE_BUFFER)
  const bandA = side === 'low' ? holding + minR : holding - maxR
  const bandB = side === 'low' ? holding + maxR : holding - minR
  return {
    status: 'READY',
    holdingExtreme: px(holding),
    holdingSide: side,
    exact: px(exact),
    bandMin: px(Math.min(bandA, bandB)),
    bandMax: px(Math.max(bandA, bandB)),
  }
}

function playLineFor(
  openType: YesterdayOpenType,
  superimpose: SuperimposeStatus
): string {
  if (openType === 'WAITING') {
    return 'Cash open not printed — day type waiting.'
  }
  const extra =
    superimpose === 'WAITING'
      ? ' Superimpose waits for a holding IB extreme.'
      : superimpose === 'INVALIDATED'
        ? ' Holding extreme was taken out — drop the old projection.'
        : ''
  if (openType === 'IN_VALUE') {
    return `IN VALUE — in balance; low risk/opportunity; range rarely exceeds yesterday. Fade extremes toward POC.${extra}`
  }
  if (openType === 'IN_RANGE') {
    return `IN RANGE (outside value) — slightly out of balance; similar range, shifted. First look is extension through the near YH/YL.${extra}`
  }
  return `OUTSIDE RANGE — out of balance; high risk/opportunity. Superimpose is a floor on potential, not a cap. If the gap holds, trend; if rejected back in, look the other way.${extra}`
}

export function buildSlTpAdvice(p: {
  openType: YesterdayOpenType
  superimpose: SuperimposeStatus
  holdingExtreme: number | null
  holdingSide: 'low' | 'high' | null
  bandMin: number | null
  bandMax: number | null
  yh: number
  yl: number
  poc: number
}): string {
  const ticket =
    'Ticket stays $400→$250→$150 with initial SL beyond the active range edge and TP = 1.5R. Yesterday profile ADVISES better placement — it does not auto-move the ticket.'
  if (p.openType === 'WAITING') {
    return `${ticket} Day type waiting — do not invent SL/TP from Globex.`
  }
  const invalidation =
    p.superimpose === 'READY' && p.holdingExtreme != null
      ? p.holdingSide === 'low'
        ? `Structural invalidation for longs = holding low ${p.holdingExtreme} (SL beyond it).`
        : `Structural invalidation for shorts = holding high ${p.holdingExtreme} (SL beyond it).`
      : `Until a holding extreme locks, treat YL ${p.yl} / YH ${p.yh} as the prior-day invalidation magnets (not the ticket SL).`
  const magnet =
    p.superimpose === 'READY' && p.bandMin != null && p.bandMax != null
      ? `TP magnet = superimposed 90–110% band ${p.bandMin}–${p.bandMax} (POC ${p.poc} is the balance magnet on IN VALUE). If 1.5R is past the 110% band on an IN VALUE day, drag TP back to the band. If the band is farther than 1.5R, take 1.5R first and trail toward the band.`
      : `TP magnet = yesterday POC ${p.poc} / near YH ${p.yh} or YL ${p.yl} until superimpose is ready.`
  const outside =
    p.openType === 'OUTSIDE_RANGE'
      ? ' OUTSIDE RANGE: the band is a floor, not a cap — do not fade a held gap just to tag 1.5R early.'
      : ''
  return `${ticket} ${invalidation} ${magnet}${outside}`
}

export function computeYesterdayProfile(args: {
  instrument: string
  candles: YesterdayBar[]
  asOfUnix: number
}): YesterdayProfile | null {
  const instrument = args.instrument
  const clock = deskClockFor(instrument)
  const rth = collectRthDays(args.candles, clock)
  if (rth.length < 1) return null

  const current = rth.find((d) => args.asOfUnix >= d.openU && args.asOfUnix < d.closeU) ?? null
  const completed = rth.filter((d) => d.closeU <= args.asOfUnix)
  const prior = current
    ? rth.filter((d) => d.openU < current.openU).pop() ?? null
    : completed[completed.length - 1] ?? null
  if (!prior) {
    const sessionDay = dayKey(args.asOfUnix, clock.timeZone)
    const fallbackYmd = nthTradingDayBefore(sessionDay, 1, clock.timeZone)
    const openU = cashOpenUnixForYmd(fallbackYmd, clock)
    const closeU = cashCloseUnixForYmd(fallbackYmd, clock)
    const va = buildTpoValueArea(args.candles, openU, closeU)
    if (!va) return null
    return finishProfile({
      instrument,
      va,
      sessionDate: fallbackYmd,
      current,
      candles: args.candles,
      asOfUnix: args.asOfUnix,
    })
  }

  const va = buildTpoValueArea(args.candles, prior.openU, prior.closeU)
  if (!va) return null
  return finishProfile({
    instrument,
    va,
    sessionDate: prior.ymd,
    current,
    candles: args.candles,
    asOfUnix: args.asOfUnix,
  })
}

function finishProfile(args: {
  instrument: string
  va: TpoValueArea
  sessionDate: string
  current: RthDay | null
  candles: YesterdayBar[]
  asOfUnix: number
}): YesterdayProfile {
  const { va, current, candles, asOfUnix, instrument } = args
  const tokyo = instrument === 'NIKKEI'
  let cashOpen: number | null = null
  if (current) {
    const openBar = candles.find(
      (c) =>
        c.time >= current.openU &&
        c.time < current.closeU &&
        c.time <= asOfUnix
    )
    cashOpen = openBar ? px(openBar.open) : null
  }
  const openType = classifyOpen(
    cashOpen,
    asOfUnix,
    current?.openU ?? null,
    va
  )
  const tip = current
    ? candles.filter((c) => c.time <= asOfUnix && c.time >= current.openU).pop()?.close ??
      null
    : null
  const ib = current
    ? computeInitialBalance(
        candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        })),
        current.openU,
        asOfUnix
      )
    : null
  const sup = current
    ? resolveSuperimpose({
        va,
        ib,
        candles,
        asOfUnix,
        sessionOpenUnix: current.openU,
        tip,
      })
    : {
        status: 'WAITING' as const,
        holdingExtreme: null,
        holdingSide: null,
        exact: null,
        bandMin: null,
        bandMax: null,
      }

  const playLine = playLineFor(openType, sup.status)
  const slTpAdvice = buildSlTpAdvice({
    openType,
    superimpose: sup.status,
    holdingExtreme: sup.holdingExtreme,
    holdingSide: sup.holdingSide,
    bandMin: sup.bandMin,
    bandMax: sup.bandMax,
    yh: va.yh,
    yl: va.yl,
    poc: va.poc,
  })

  return {
    instrument,
    sourceSession: tokyo ? 'TOKYO_CASH' : 'NY_RTH',
    sessionDate: args.sessionDate,
    yh: va.yh,
    yl: va.yl,
    vah: va.vah,
    val: va.val,
    poc: va.poc,
    priorRangePoints: va.priorRangePoints,
    cashOpen,
    openType,
    superimpose: sup.status,
    holdingExtreme: sup.holdingExtreme,
    holdingSide: sup.holdingSide,
    exact: sup.exact,
    bandMin: sup.bandMin,
    bandMax: sup.bandMax,
    playLine,
    slTpAdvice,
  }
}

export function formatYesterdayProfileForPrompt(p: YesterdayProfile | null): string {
  if (!p) {
    return 'YESTERDAY PROFILE: not enough prior cash-session bars yet — do not invent YH/YL/VA/POC.'
  }
  const src = p.sourceSession === 'TOKYO_CASH' ? 'Tokyo cash' : 'NY RTH'
  const lines = [
    'YESTERDAY PROFILE (Dalton — ground truth, same helper as the Y overlay):',
    `Source: last completed ${src} session ${p.sessionDate} (not Globex, not Tradeify 18:00 roll${
      p.instrument === 'NIKKEI' ? ', not US Range' : ''
    }).`,
    `YH ${p.yh} · YL ${p.yl} · VAH ${p.vah} · VAL ${p.val} · POC ${p.poc} · R ${p.priorRangePoints} pts`,
    `Cash open ${p.cashOpen ?? 'n/a'} · day type ${p.openType}`,
    p.playLine,
    p.superimpose === 'READY' && p.holdingExtreme != null
      ? `Superimpose ${p.superimpose}: holding ${p.holdingSide} ${p.holdingExtreme} · exact ${p.exact} · 90–110% band ${p.bandMin}–${p.bandMax}`
      : `Superimpose ${p.superimpose}`,
    `SL/TP ADVICE: ${p.slTpAdvice}`,
    'Day type does not unlock off-band entries. ±10 of the shaped playbook range still required. Do not invent these prices.',
  ]
  return lines.join('\n')
}

export function yesterdayProfileBadgeText(p: YesterdayProfile | null): string {
  if (!p) return 'Yday —'
  if (p.openType === 'WAITING') return 'Yday waiting'
  const type =
    p.openType === 'IN_VALUE'
      ? 'IN VALUE'
      : p.openType === 'IN_RANGE'
        ? 'IN RANGE'
        : 'OUTSIDE'
  if (p.superimpose === 'READY' && p.bandMin != null && p.bandMax != null) {
    return `${type} · est ${p.bandMin}–${p.bandMax}`
  }
  if (p.superimpose === 'INVALIDATED') return `${type} · est out`
  return `${type} · est waiting`
}

/**
 * Live: during cash RTH, allow wall clock so IB lock / superimpose match the desk clock.
 * Sim: pass the same unix for lastBar and wall so replay never jumps to real now.
 */
export function resolveYesterdayAsOfUnix(
  instrument: string,
  lastBarUnix: number | null | undefined,
  wallUnix: number
): number {
  const last =
    lastBarUnix != null && Number.isFinite(lastBarUnix) && lastBarUnix > 0
      ? lastBarUnix
      : wallUnix
  const clock = deskClockFor(instrument)
  const ymd = dayKey(wallUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) return last
  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = cashCloseUnixForYmd(ymd, clock)
  if (wallUnix >= openU && wallUnix < closeU) return Math.max(last, wallUnix)
  return last
}

export function yesterdayProfilePaintKey(
  visible: boolean,
  p: YesterdayProfile | null
): string {
  if (!visible) return 'off'
  if (!p) return 'empty'
  return [
    p.sessionDate,
    p.yh,
    p.yl,
    p.vah,
    p.val,
    p.poc,
    p.openType,
    p.superimpose,
    p.holdingExtreme,
    p.holdingSide,
    p.exact,
    p.bandMin,
    p.bandMax,
  ].join('|')
}

export type YesterdayLineSpec = {
  price: number
  title: string
  color: string
  dashed?: boolean
  dotted?: boolean
}

export function yesterdayProfileLineSpecs(p: YesterdayProfile): YesterdayLineSpec[] {
  const specs: YesterdayLineSpec[] = [
    { price: p.yh, title: 'YH', color: YDAY_COLORS.range },
    { price: p.yl, title: 'YL', color: YDAY_COLORS.range },
    { price: p.vah, title: 'VAH', color: YDAY_COLORS.value, dashed: true },
    { price: p.val, title: 'VAL', color: YDAY_COLORS.value, dashed: true },
    { price: p.poc, title: 'POC', color: YDAY_COLORS.poc },
  ]
  if (p.superimpose === 'READY' && p.holdingExtreme != null) {
    specs.push({
      price: p.holdingExtreme,
      title: p.holdingSide === 'low' ? 'Hold L' : 'Hold H',
      color: YDAY_COLORS.estimate,
    })
  }
  if (p.exact != null) {
    specs.push({
      price: p.exact,
      title: 'Est',
      color: YDAY_COLORS.estimate,
      dashed: true,
    })
  }
  if (p.bandMin != null && p.bandMax != null) {
    specs.push(
      { price: p.bandMin, title: 'Est 90%', color: YDAY_COLORS.band, dotted: true },
      { price: p.bandMax, title: 'Est 110%', color: YDAY_COLORS.band, dotted: true }
    )
  }
  return specs
}
