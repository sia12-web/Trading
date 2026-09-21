/**
 * lightweight-charts treats every timestamp as UTC for tick placement.
 * Desk charts show America/Toronto (Montreal) for every instrument.
 * Instrument clocks (America/New_York / Asia/Tokyo) stay for session logic only.
 *
 * Shift real unix → "chart time" so UTC components equal the trader wall clock,
 * then format axis labels with UTC getters. Reverse with fromChartTime for
 * crosshair / clicks. See: https://tradingview.github.io/lightweight-charts/docs/time-zones
 */

import { zonedCivilToUnix } from '@/lib/chart/sessionVwap'

type WallParts = {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

const partsCache = new Map<string, WallParts>()

function wallParts(unixSec: number, timeZone: string): WallParts {
  const key = `${Math.floor(unixSec)}|${timeZone}`
  const hit = partsCache.get(key)
  if (hit) return hit
  if (partsCache.size > 24_000) partsCache.clear()

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(new Date(unixSec * 1000))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value || 0)
  let h = get('hour')
  if (h === 24) h = 0
  const out: WallParts = {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    h,
    mi: get('minute'),
    s: get('second'),
  }
  partsCache.set(key, out)
  return out
}

/** lightweight-charts daily bar. Bars sit next to each other; weekends are not plotted. */
export type ChartBusinessDay = { year: number; month: number; day: number }

export function isBusinessDay(time: unknown): time is ChartBusinessDay {
  return (
    !!time &&
    typeof time === 'object' &&
    Number.isFinite((time as ChartBusinessDay).year) &&
    Number.isFinite((time as ChartBusinessDay).month) &&
    Number.isFinite((time as ChartBusinessDay).day)
  )
}

/**
 * Calendar date of a daily futures bar.
 * Yahoo stamps CME dailies at NY midnight (04:00 / 05:00 UTC) or an odd cash-session
 * time on shortened days — the UTC date of that stamp is the trading day, and reading
 * UTC midnight back through America/New_York would shift winter bars back one day.
 */
export function unixToBusinessDay(unixSec: number): ChartBusinessDay {
  const d = new Date(unixSec * 1000)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

/** UTC midnight of a business day — stable numeric key for matching / snapping. */
export function businessDayToUtcMidnight(d: ChartBusinessDay): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 1000)
}

/** Collapse any intra-day stamp onto UTC midnight of its NY session date. */
export function snapDailyUnix(unixSec: number): number {
  if (!Number.isFinite(unixSec)) return unixSec
  return businessDayToUtcMidnight(unixToBusinessDay(unixSec))
}

export function businessDayKey(d: ChartBusinessDay): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** Crosshair / tick formatter: unix seconds or a BusinessDay object. */
export function chartTimeToUnix(time: unknown): number {
  if (typeof time === 'number' && Number.isFinite(time)) return time
  if (isBusinessDay(time)) return businessDayToUtcMidnight(time)
  return NaN
}

/** Real unix seconds → lightweight-charts time (UTC comps = desk wall clock). */
export function toChartTime(unixSec: number, timeZone: string): number {
  if (!Number.isFinite(unixSec)) return unixSec
  const p = wallParts(unixSec, timeZone)
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) / 1000)
}

/** Chart time → real unix (DST-safe). */
export function fromChartTime(chartSec: number, timeZone: string): number {
  if (!Number.isFinite(chartSec)) return chartSec
  const d = new Date(chartSec * 1000)
  const y = d.getUTCFullYear()
  const mo = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const h = d.getUTCHours()
  const mi = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  const ymd = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return zonedCivilToUnix(ymd, h + mi / 60 + s / 3600, timeZone)
}

/** Map { time } points for setData — leaves other fields intact. */
export function mapTimesToChart<T extends { time: number }>(
  rows: T[],
  timeZone: string
): T[] {
  if (rows.length === 0) return rows
  return rows.map((r) => ({ ...r, time: toChartTime(r.time, timeZone) }))
}

/** Format chart-time (already desk-shifted) as HH:MM using UTC comps. */
export function formatChartClock(
  chartSec: number,
  withSeconds = false
): string {
  const d = new Date(chartSec * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  if (!withSeconds) return `${hh}:${mm}`
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** Format chart-time date label (UTC comps = desk civil date). */
export function formatChartDate(
  chartSec: number,
  style: 'day' | 'month' | 'year' = 'day'
): string {
  const d = new Date(chartSec * 1000)
  if (style === 'year') return String(d.getUTCFullYear())
  if (style === 'month') {
    return d.toLocaleString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
  }
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
