import type { UTCTimestamp } from 'lightweight-charts'
import {
  type SessionBar,
  computeVwapFromCustomAnchor,
} from '@/lib/chart/sessionVwap'
import { computeTrueRange, smoothSeries } from '@/lib/chart/atrIndicator'
import {
  parseCalendarEventMs,
  isHighImpact,
} from '@/lib/trading/deskNewsHazard'
import type { DeskCalendarEvent } from '@/lib/trading/deskNews'

export interface NewsCatalystInfo {
  id: string
  title: string
  country: string
  impact: string
  eventTimeUnix: number
  eventTimeFormatted: string
  barTimeUnix: number
  barIndex: number
  atrAtRelease: number
  baselineAtr: number
  atrSurgeRatio: number
  barRange: number
  actual?: string | number | null
  estimate?: string | number | null
  prev?: string | number | null
}

export interface NewsCatalystVwapResult {
  catalyst: NewsCatalystInfo
  availableCatalysts: NewsCatalystInfo[]
  bands: {
    vwap: { time: UTCTimestamp; value: number }[]
    upper1: { time: UTCTimestamp; value: number }[]
    lower1: { time: UTCTimestamp; value: number }[]
    upper2: { time: UTCTimestamp; value: number }[]
    lower2: { time: UTCTimestamp; value: number }[]
    upper3: { time: UTCTimestamp; value: number }[]
    lower3: { time: UTCTimestamp; value: number }[]
  }
  latestVwap: number
  latestSigma1Upper: number
  latestSigma1Lower: number
  latestSigma2Upper: number
  latestSigma2Lower: number
  latestSigma3Upper: number
  latestSigma3Lower: number
}

function formatCatalystTime(unixSec: number): string {
  try {
    const d = new Date(unixSec * 1000)
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d) + ' ET'
  } catch {
    return new Date(unixSec * 1000).toISOString().slice(0, 16)
  }
}

function getNyHourMinute(unixSec: number): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date(unixSec * 1000))
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return { hour: h, minute: m }
  } catch {
    return { hour: 0, minute: 0 }
  }
}

/**
 * Scan candles and calendar events to discover the latest major news catalysts
 * that produced exceptional market volatility and high ATR surges.
 */
export function detectNewsCatalysts(
  candles: SessionBar[],
  newsEvents: DeskCalendarEvent[] = [],
  maxLookbackDays = 35
): NewsCatalystInfo[] {
  if (!candles || candles.length < 5) return []

  const lastBar = candles[candles.length - 1]!
  const lastBarTime = lastBar.time
  const minLookbackTime = lastBarTime - maxLookbackDays * 86400

  // 1. Calculate True Range and 14-period RMA ATR
  const trs = computeTrueRange(candles)
  const atrs = smoothSeries(trs, 14, 'RMA')

  // Calculate rolling baseline ATR (median of prior 30 bars or global median)
  const baselineAtrs: number[] = new Array(candles.length).fill(0)
  for (let i = 0; i < candles.length; i++) {
    const windowStart = Math.max(0, i - 30)
    const slice: number[] = []
    for (let j = windowStart; j <= i; j++) {
      const v = atrs[j]
      if (v != null && Number.isFinite(v) && v > 0) slice.push(v)
    }
    if (slice.length > 0) {
      slice.sort((a, b) => a - b)
      baselineAtrs[i] = slice[Math.floor(slice.length / 2)]!
    } else {
      baselineAtrs[i] = (candles[i]!.high - candles[i]!.low) || 1
    }
  }

  const detected: NewsCatalystInfo[] = []
  const claimedBarIndices = new Set<number>()

  // 2. Cross-reference with calendar events
  for (const ev of newsEvents) {
    let ms = parseCalendarEventMs(ev.time, lastBarTime * 1000)
    if (!ms || !Number.isFinite(ms)) {
      const parsed = Date.parse(ev.time)
      if (Number.isFinite(parsed)) ms = parsed
    }
    if (!ms || !Number.isFinite(ms)) continue
    const evSec = Math.floor(ms / 1000)
    if (evSec < minLookbackTime || evSec > lastBarTime + 3600) continue

    // Find nearest bar within +-30m (1800s)
    let bestIdx = -1
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < candles.length; i++) {
      const dist = Math.abs(candles[i]!.time - evSec)
      if (dist < bestDist && dist <= 1800) {
        bestDist = dist
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      const c = candles[bestIdx]!
      const barRange = c.high - c.low
      const baseAtr = Math.max(0.1, baselineAtrs[bestIdx] || 1)
      const curAtr = atrs[bestIdx] ?? baseAtr

      // Look at ATR and range surge across the release window (bar to bar + 3)
      let peakRange = barRange
      let peakAtr = curAtr
      for (let w = bestIdx; w < Math.min(candles.length, bestIdx + 4); w++) {
        const r = candles[w]!.high - candles[w]!.low
        if (r > peakRange) peakRange = r
        const a = atrs[w]
        if (a && a > peakAtr) peakAtr = a
      }

      const surgeRatio = Math.max(peakRange / baseAtr, peakAtr / baseAtr)
      const high = isHighImpact(ev.impact)

      // Include if high impact OR significant surge
      if (high || surgeRatio >= 1.4) {
        detected.push({
          id: ev.id || `cal-${evSec}-${ev.event}`,
          title: ev.event,
          country: ev.country || 'US',
          impact: ev.impact || 'High',
          eventTimeUnix: evSec,
          eventTimeFormatted: formatCatalystTime(evSec),
          barTimeUnix: c.time,
          barIndex: bestIdx,
          atrAtRelease: Number(peakAtr.toFixed(2)),
          baselineAtr: Number(baseAtr.toFixed(2)),
          atrSurgeRatio: Number(surgeRatio.toFixed(2)),
          barRange: Number(peakRange.toFixed(2)),
          actual: ev.actual,
          estimate: ev.estimate,
          prev: ev.prev,
        })
        for (let b = Math.max(0, bestIdx - 1); b <= Math.min(candles.length - 1, bestIdx + 4); b++) {
          claimedBarIndices.add(b)
        }
      }
    }
  }

  // 3. Scan for pure candle volatility explosions (ATR surges) not already claimed
  for (let i = 14; i < candles.length; i++) {
    const c = candles[i]!
    if (c.time < minLookbackTime) continue
    if (claimedBarIndices.has(i)) continue

    const baseAtr = Math.max(0.1, baselineAtrs[i] || 1)
    const curAtr = atrs[i] ?? baseAtr
    const barRange = c.high - c.low
    const surgeRatio = barRange / baseAtr

    // High bar range surge (>= 2.3x normal ATR) or major ATR elevation
    if (surgeRatio >= 2.2 || (curAtr / baseAtr >= 1.8 && surgeRatio >= 1.7)) {
      const { hour, minute } = getNyHourMinute(c.time)
      let title = 'Major Market Volatility Catalyst'
      if (hour === 8 && minute >= 25 && minute <= 40) {
        title = 'US Macro Catalyst (08:30 ET CPI / NFP / PPI)'
      } else if (hour === 10 && minute <= 15) {
        title = 'US 10:00 ET Macro Catalyst (ISM / JOLTS)'
      } else if (hour === 14 && minute <= 15) {
        title = 'FOMC Rate Decision & Policy (14:00 ET)'
      } else if (hour === 14 && minute >= 25 && minute <= 45) {
        title = 'Fed Chair Press Conference (14:30 ET)'
      } else if (hour === 9 && minute >= 30 && minute <= 45) {
        title = 'US Cash Opening Volatility Shock (09:30 ET)'
      }

      detected.push({
        id: `bar-surge-${c.time}`,
        title,
        country: 'US',
        impact: 'High',
        eventTimeUnix: c.time,
        eventTimeFormatted: formatCatalystTime(c.time),
        barTimeUnix: c.time,
        barIndex: i,
        atrAtRelease: Number(curAtr.toFixed(2)),
        baselineAtr: Number(baseAtr.toFixed(2)),
        atrSurgeRatio: Number(surgeRatio.toFixed(2)),
        barRange: Number(barRange.toFixed(2)),
      })

      for (let b = Math.max(0, i - 1); b <= Math.min(candles.length - 1, i + 4); b++) {
        claimedBarIndices.add(b)
      }
    }
  }

  // 4. Score catalysts to prioritize the latest major news that really moved the market
  // Recency factor mildly scales down events as they get closer to maxLookbackDays
  const scored = detected.map((cat) => {
    const ageDays = Math.max(0, (lastBarTime - cat.barTimeUnix) / 86400)
    const recencyWeight = Math.max(0.4, 1.0 - (ageDays / maxLookbackDays) * 0.45)
    const impactWeight = isHighImpact(cat.impact) ? 1.4 : 1.0
    // Combined catalyst score emphasizing high ATR surge and high bar range
    const score = Math.pow(cat.atrSurgeRatio, 1.3) * impactWeight * recencyWeight
    return { cat, score }
  })

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score)

  return scored.map((s) => s.cat)
}

/**
 * Compute Anchored VWAP and ±1σ, ±2σ, ±3σ standard deviation bands
 * from the selected news catalyst release candle.
 */
export function computeNewsCatalystVwap(
  candles: SessionBar[],
  newsEvents: DeskCalendarEvent[] = [],
  selectedCatalystId?: string | null
): NewsCatalystVwapResult | null {
  if (!candles || candles.length === 0) return null

  const catalysts = detectNewsCatalysts(candles, newsEvents)
  if (catalysts.length === 0) return null

  const chosen =
    (selectedCatalystId ? catalysts.find((c) => c.id === selectedCatalystId) : null) ??
    catalysts[0]!

  const bands = computeVwapFromCustomAnchor(candles, chosen.barTimeUnix)
  if (!bands || bands.vwap.length === 0) return null

  const lastV = bands.vwap[bands.vwap.length - 1]!.value
  const lastU1 = bands.upper1[bands.upper1.length - 1]?.value ?? lastV
  const lastL1 = bands.lower1[bands.lower1.length - 1]?.value ?? lastV
  const lastU2 = bands.upper2[bands.upper2.length - 1]?.value ?? lastV
  const lastL2 = bands.lower2[bands.lower2.length - 1]?.value ?? lastV
  const lastU3 = bands.upper3[bands.upper3.length - 1]?.value ?? lastV
  const lastL3 = bands.lower3[bands.lower3.length - 1]?.value ?? lastV

  return {
    catalyst: chosen,
    availableCatalysts: catalysts,
    bands,
    latestVwap: lastV,
    latestSigma1Upper: lastU1,
    latestSigma1Lower: lastL1,
    latestSigma2Upper: lastU2,
    latestSigma2Lower: lastL2,
    latestSigma3Upper: lastU3,
    latestSigma3Lower: lastL3,
  }
}
