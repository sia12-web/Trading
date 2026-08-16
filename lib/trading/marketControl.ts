/**
 * Dalton Rotation Factor + developing time-POC (Mind Over Markets).
 * Control layer on existing cash clocks: period A = OR30, A+B = IB.
 *
 * Closed 30m cash periods only (aggregated from 5m). NY 09:30 ET /
 * Tokyo 09:00 JST. Advise-only — does not change 1:1.5, the dollar ladder,
 * ±10, Open type, or OR30 / IB / lunch windows.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
  NY_DESK_CLOCK,
  zonedCivilToUnix,
  type DeskClock,
} from '@/lib/chart/sessionVwap'
import { tpoTickSize } from '@/lib/trading/yesterdayProfile'

export type ControlBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type ControlLabel =
  | 'WAIT'
  | 'ONE-TF BUY'
  | 'ONE-TF SELL'
  | 'TWO-TF'

export type ControlDpocDir = 'up' | 'down' | 'stuck'

export type MarketControl = {
  instrument: string
  sourceSession: 'NY_RTH' | 'TOKYO_CASH'
  sessionDate: string | null
  label: ControlLabel
  rf: number | null
  rfTop: number | null
  rfBot: number | null
  dpoc: number | null
  dpocDir: ControlDpocDir | null
  amRf: number | null
  amDpoc: number | null
  periodCount: number
  playLine: string
}

export type ControlPeriod = {
  idx: number
  start: number
  end: number
  high: number
  low: number
}

export const CONTROL_PERIOD_SEC = 30 * 60
export const CONTROL_RF_TWO_TF_ABS = 1

export const CONTROL_COLORS = {
  dpoc: '#818cf8',
} as const

const EPS = 1e-8
const NYC_LUNCH_HOUR = 12

export { resolveYesterdayAsOfUnix as resolveMarketControlAsOfUnix } from '@/lib/trading/yesterdayProfile'

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

function cmpLevel(curr: number, prev: number): -1 | 0 | 1 {
  if (curr > prev + EPS) return 1
  if (curr < prev - EPS) return -1
  return 0
}

/** Dalton Figure 4.28: high and low each score +1 / −1 / 0 vs the prior period. */
export function rotationStep(
  prev: { high: number; low: number },
  curr: { high: number; low: number }
): { top: number; bot: number } {
  return {
    top: cmpLevel(curr.high, prev.high),
    bot: cmpLevel(curr.low, prev.low),
  }
}

function playLineFor(label: ControlLabel, tokyo: boolean): string {
  const nikkei = tokyo ? ' Nikkei control = Tokyo cash letters, not US Range.' : ''
  const ticket =
    'CONTROL is advise-only — still hunt the active range stop pool, 1.5R, ladder. Does not unlock off-band. Does not change Open type or the OR30/IB/lunch window. Ticket stays $400→$250→$150.'
  if (label === 'WAIT') {
    return `CONTROL waiting — period B (IB) has not closed. Do not invent Rotation Factor or developing POC.${nikkei} ${ticket}`
  }
  if (label === 'ONE-TF BUY') {
    return `CONTROL: ONE-TF BUY — RF positive and dPOC migrating up. Other timeframe buyers attempting and succeeding.${nikkei} ${ticket}`
  }
  if (label === 'ONE-TF SELL') {
    return `CONTROL: ONE-TF SELL — RF negative and dPOC migrating down. Other timeframe sellers attempting and succeeding.${nikkei} ${ticket}`
  }
  return `CONTROL: TWO-TF — attempting and succeeding disagree, or RF is near zero. Rotational / two-timeframe.${nikkei} ${ticket}`
}

function waiting(
  instrument: string,
  extra?: Partial<MarketControl>
): MarketControl {
  const tokyo = instrument === 'NIKKEI'
  const label: ControlLabel = extra?.label ?? 'WAIT'
  return {
    instrument,
    sourceSession: tokyo ? 'TOKYO_CASH' : 'NY_RTH',
    sessionDate: extra?.sessionDate ?? null,
    label,
    rf: extra?.rf ?? null,
    rfTop: extra?.rfTop ?? null,
    rfBot: extra?.rfBot ?? null,
    dpoc: extra?.dpoc ?? null,
    dpocDir: extra?.dpocDir ?? null,
    amRf: extra?.amRf ?? null,
    amDpoc: extra?.amDpoc ?? null,
    periodCount: extra?.periodCount ?? 0,
    playLine: extra?.playLine ?? playLineFor(label, tokyo),
  }
}

function bucketPrice(price: number, tick: number): number {
  return Math.round(price / tick) * tick
}

/** Developing time-POC from closed 30m periods. Same tick as yesterday TPO. */
export function developingPoc(periods: ControlPeriod[]): number | null {
  if (periods.length < 1) return null
  let yh = -Infinity
  let yl = Infinity
  for (const p of periods) {
    if (!Number.isFinite(p.high) || !Number.isFinite(p.low)) continue
    if (p.high > yh) yh = p.high
    if (p.low < yl) yl = p.low
  }
  if (!Number.isFinite(yh) || !Number.isFinite(yl)) return null
  if (yh < yl) return null
  if (yh === yl) return px(yh)

  const tick = tpoTickSize((yh + yl) / 2)
  if (!(tick > 0)) return null
  const tpos = new Map<number, number>()
  for (const p of periods) {
    if (!Number.isFinite(p.high) || !Number.isFinite(p.low) || p.high < p.low) {
      continue
    }
    const start = bucketPrice(p.low, tick)
    const end = bucketPrice(p.high, tick)
    const steps = Math.max(0, Math.round((end - start) / tick))
    const capped = Math.min(steps, 4000)
    for (let i = 0; i <= capped; i++) {
      const k = bucketPrice(start + i * tick, tick)
      tpos.set(k, (tpos.get(k) ?? 0) + 1)
    }
  }
  if (tpos.size < 1) return null

  const rows = Array.from(tpos.entries())
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price)
  const mid = (yh + yl) / 2
  let pocIdx = 0
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i]!
    const best = rows[pocIdx]!
    if (
      cur.count > best.count ||
      (cur.count === best.count &&
        Math.abs(cur.price - mid) < Math.abs(best.price - mid))
    ) {
      pocIdx = i
    }
  }
  return px(rows[pocIdx]!.price)
}

function dpocDirection(
  periods: ControlPeriod[],
  dpoc: number | null
): ControlDpocDir {
  if (dpoc == null || periods.length < 2) return 'stuck'
  const prior = developingPoc(periods.slice(0, -1))
  if (prior == null) return 'stuck'
  let yh = -Infinity
  let yl = Infinity
  for (const p of periods) {
    if (p.high > yh) yh = p.high
    if (p.low < yl) yl = p.low
  }
  const tick = tpoTickSize((yh + yl) / 2)
  const step = tick > 0 ? tick : 1
  if (dpoc >= prior + step - EPS) return 'up'
  if (dpoc <= prior - step + EPS) return 'down'
  return 'stuck'
}

function classifyLabel(
  rf: number,
  dpocDir: ControlDpocDir
): Exclude<ControlLabel, 'WAIT'> {
  if (Math.abs(rf) <= CONTROL_RF_TWO_TF_ABS) return 'TWO-TF'
  if (rf > 0 && dpocDir === 'up') return 'ONE-TF BUY'
  if (rf < 0 && dpocDir === 'down') return 'ONE-TF SELL'
  return 'TWO-TF'
}

export function closedControlPeriods(
  candles: ControlBar[],
  openU: number,
  closeU: number,
  asOfUnix: number
): ControlPeriod[] {
  const horizon = Math.min(asOfUnix, closeU)
  const map = new Map<number, ControlPeriod>()
  for (const c of candles) {
    if (!Number.isFinite(c.time) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
      continue
    }
    if (c.high < c.low) continue
    if (c.time < openU - 30 || c.time >= closeU) continue
    // Yahoo/OANDA can stamp the 09:30/09:00 print a few seconds early.
    const idx =
      c.time < openU ? 0 : Math.floor((c.time - openU) / CONTROL_PERIOD_SEC)
    if (idx < 0) continue
    const start = openU + idx * CONTROL_PERIOD_SEC
    const end = start + CONTROL_PERIOD_SEC
    if (end > horizon || end > closeU) continue
    const prev = map.get(idx)
    if (!prev) {
      map.set(idx, { idx, start, end, high: c.high, low: c.low })
    } else {
      prev.high = Math.max(prev.high, c.high)
      prev.low = Math.min(prev.low, c.low)
    }
  }
  return Array.from(map.values()).sort((a, b) => a.idx - b.idx)
}

function scorePeriods(periods: ControlPeriod[]): {
  rf: number
  rfTop: number
  rfBot: number
} {
  let rfTop = 0
  let rfBot = 0
  for (let i = 1; i < periods.length; i++) {
    const step = rotationStep(periods[i - 1]!, periods[i]!)
    rfTop += step.top
    rfBot += step.bot
  }
  return { rf: rfTop + rfBot, rfTop, rfBot }
}

function coreAt(
  instrument: string,
  sessionDate: string,
  candles: ControlBar[],
  openU: number,
  closeU: number,
  asOfUnix: number
): MarketControl {
  const tokyo = instrument === 'NIKKEI'
  const periods = closedControlPeriods(candles, openU, closeU, asOfUnix)
  const base = waiting(instrument, {
    sessionDate,
    periodCount: periods.length,
  })
  if (periods.length < 2) return base

  const { rf, rfTop, rfBot } = scorePeriods(periods)
  const dpoc = developingPoc(periods)
  const dpocDir = dpocDirection(periods, dpoc)
  const label = classifyLabel(rf, dpocDir)
  return {
    ...base,
    label,
    rf,
    rfTop,
    rfBot,
    dpoc,
    dpocDir,
    periodCount: periods.length,
    playLine: playLineFor(label, tokyo),
  }
}

export function computeMarketControl(args: {
  instrument: string
  candles: ControlBar[]
  asOfUnix: number
}): MarketControl {
  const instrument = args.instrument
  if (!Number.isFinite(args.asOfUnix)) return waiting(instrument)
  const candles = Array.isArray(args.candles) ? args.candles : []
  const clock = deskClockFor(instrument)
  const tokyo = instrument === 'NIKKEI'
  const ymd = dayKey(args.asOfUnix, clock.timeZone)
  if (!isWeekdayYmd(ymd, clock.timeZone)) {
    return waiting(instrument)
  }

  const openU = cashOpenUnixForYmd(ymd, clock)
  const closeU = cashCloseUnixForYmd(ymd, clock)
  if (args.asOfUnix < openU) {
    return waiting(instrument, { sessionDate: ymd })
  }

  const full = coreAt(
    instrument,
    ymd,
    candles,
    openU,
    closeU,
    args.asOfUnix
  )

  if (tokyo) return full

  const lunchU = zonedCivilToUnix(ymd, NYC_LUNCH_HOUR, NY_DESK_CLOCK.timeZone)
  if (args.asOfUnix >= lunchU && lunchU > openU) {
    const am = coreAt(instrument, ymd, candles, openU, closeU, lunchU)
    return { ...full, amRf: am.rf, amDpoc: am.dpoc }
  }
  return full
}

export function formatMarketControlForPrompt(p: MarketControl): string {
  const src = p.sourceSession === 'TOKYO_CASH' ? 'Tokyo cash' : 'NY RTH'
  const nikkei =
    p.instrument === 'NIKKEI' ? ' Nikkei control = Tokyo cash, not US Range.' : ''
  if (p.label === 'WAIT' || p.rf == null) {
    return `CONTROL (Dalton — RF + dPOC): waiting (${src}${nikkei}). Do not invent Rotation Factor or developing POC until IB period B closes.`
  }
  const dir =
    p.dpocDir === 'up'
      ? 'migrating up'
      : p.dpocDir === 'down'
        ? 'migrating down'
        : 'stuck'
  const rfSign = p.rf > 0 ? `+${p.rf}` : String(p.rf)
  const lines = [
    `CONTROL (Dalton — RF + dPOC):`,
    `Source: ${src} session ${p.sessionDate ?? 'n/a'} 30m letters (A = OR30, B completes IB).${nikkei}`,
    `RF ${rfSign} (top ${p.rfTop} bot ${p.rfBot}) · dPOC ${p.dpoc ?? 'n/a'} ${dir} · ${p.label}`,
  ]
  if (p.amRf != null) {
    lines.push(
      `CONTROL AM: RF ${p.amRf > 0 ? `+${p.amRf}` : String(p.amRf)} · dPOC ${
        p.amDpoc ?? 'n/a'
      } frozen for the lunch box. Letters keep scoring; lunch H/L is still the playbook.`
    )
  }
  lines.push(p.playLine)
  return lines.join('\n')
}

export function marketControlBadgeText(p: MarketControl): string {
  if (p.label === 'WAIT' || p.rf == null) return 'RF WAIT'
  if (p.rf > 0) return `RF +${p.rf} ↑`
  if (p.rf < 0) return `RF ${p.rf} ↓`
  return 'RF 0 ROT'
}

export function marketControlPaintKey(
  visible: boolean,
  p: MarketControl
): string {
  if (!visible) return 'off'
  return [
    p.instrument,
    p.sessionDate,
    p.label,
    p.rf,
    p.dpoc,
    p.dpocDir,
    p.amRf,
    p.amDpoc,
  ].join('|')
}

export type ControlLineSpec = {
  price: number
  title: string
  color: string
}

export function marketControlLineSpecs(p: MarketControl): ControlLineSpec[] {
  if (p.dpoc == null) return []
  return [{ price: p.dpoc, title: 'dPOC', color: CONTROL_COLORS.dpoc }]
}
