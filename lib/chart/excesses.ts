/**
 * Auction Market Theory - 5-Day Session Extremes, Spikes & Distribution Reference Points
 *
 * 1. Session Extremes (Highest and Lowest of the Sessions):
 *    Absolute High and Low established in each session (Asia, London, New York).
 *    Volume at these extreme boundaries represents responsive buying or selling.
 *    Subsequent tests compare retest volume to determine absorption vs breakout.
 *
 * 2. Spikes (Late-Session Aggressive Imbalance):
 *    Rapid unidirectional price drive in the late session (or initiative drive outside balance).
 *    Reference points: Spike High, Spike Low/Base, and acceptance/rejection levels.
 *
 * 3. Trend Day & Double Distribution Day Reference Points:
 *    - Trend Day: Trend Extreme (High/Low), 50% Pullback Midpoint, and Day Open.
 *    - Double Distribution: Upper Distribution POC, Lower Distribution POC,
 *      and the Separating Single-Print Zone (Separation Level).
 *
 * 4. Rounded Numbers: Psychological whole numbers.
 */

import { sessionInstanceKeyAt } from '@/lib/chart/sessionVwap'

export interface SessionExtreme {
  id: string
  session: 'Asia' | 'London' | 'New York'
  sessionKey: string
  label: string
  type: 'HIGH' | 'LOW'
  price: number
  time: number
  volume: number
  isRetested: boolean
  retestTime?: number
  retestVolume?: number
  retestVolumeRatio?: number
  sessionStartTime?: number
  sessionEndTime?: number
}

export interface SpikeReference {
  id: string
  sessionDate: string
  direction: 'UP' | 'DOWN'
  spikeHigh: number
  spikeLow: number
  spikeBase: number
  startTime: number
  endTime: number
  volume: number
}

export interface DistributionReference {
  id: string
  sessionDate: string
  dayType: 'TREND_BULL' | 'TREND_BEAR' | 'DOUBLE_DISTRIBUTION'
  label: string
  startTime?: number
  endTime?: number
  upperPoc?: number
  lowerPoc?: number
  /** Separating single-print level for Double Distribution (key pivot) */
  separationLevel?: number
  trendExtreme?: number
  /** 50% midpoint pullback reference for Trend Days */
  trendMidpoint?: number
  trendOpen?: number
}

export interface MarketExcess {
  id: string
  type: 'BUYING_EXCESS' | 'SELLING_EXCESS'
  time: number
  price: number
  volume: number
  candleOpen: number
  candleClose: number
  candleHigh: number
  candleLow: number
  isRetested: boolean
  retestTime?: number
  retestVolume?: number
  retestVolumeRatio?: number
  session?: 'Asia' | 'London' | 'New York'
  label?: string
}

export interface ExcessBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const ROUNDED_NUMBER_STEP: Record<string, number> = {
  DOW: 500,
  NASDAQ: 250,
  NIKKEI: 500,
  GOLD: 50,
  CRUDE: 5,
}

/**
 * Return psychological rounded numbers spanning [minPrice, maxPrice].
 */
export function getRoundedNumbers(
  minPrice: number,
  maxPrice: number,
  instrument: string = 'DOW'
): number[] {
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice >= maxPrice) {
    return []
  }

  const instUpper = instrument.toUpperCase()
  const step = ROUNDED_NUMBER_STEP[instUpper] ?? 100

  const start = Math.ceil(minPrice / step) * step
  const rounded: number[] = []

  for (let p = start; p <= maxPrice; p += step) {
    rounded.push(Number(p.toFixed(2)))
  }

  return rounded
}

/**
 * Detect TRUE Highest and Lowest of each session (Asia, London, New York).
 * Replaces noisy intra-session wick markers with clean session extremes.
 */
export function detect5DaySessionExtremes(
  bars: ExcessBar[],
  _instrument: string = 'DOW',
  anchorUnix?: number
): SessionExtreme[] {
  if (!bars || bars.length === 0) return []

  const scoped = anchorUnix != null ? bars.filter((b) => b.time >= anchorUnix) : bars
  if (scoped.length === 0) return []

  // Group bars by session instance key
  const sessionGroups = new Map<string, { session: 'Asia' | 'London' | 'New York'; bars: ExcessBar[] }>()

  for (const b of scoped) {
    const info = sessionInstanceKeyAt(b.time, _instrument)
    if (!info) continue
    let group = sessionGroups.get(info.key)
    if (!group) {
      group = { session: info.name, bars: [] }
      sessionGroups.set(info.key, group)
    }
    group.bars.push(b)
  }

  const extremes: SessionExtreme[] = []

  for (const [key, group] of Array.from(sessionGroups.entries())) {
    if (group.bars.length < 3) continue

    let peakBar = group.bars[0]!
    let troughBar = group.bars[0]!

    for (const b of group.bars) {
      if (b.high > peakBar.high) peakBar = b
      if (b.low < troughBar.low) troughBar = b
    }

    const sessPrefix = group.session === 'Asia' ? 'AH' : group.session === 'London' ? 'LH' : 'NYH'
    const sessLowPrefix = group.session === 'Asia' ? 'AL' : group.session === 'London' ? 'LL' : 'NYL'

    // Check retests across subsequent bars in the entire dataset
    const peakIndex = scoped.findIndex((b) => b.time === peakBar.time)
    let peakRetested = false
    let peakRetestVol: number | undefined
    const peakTol = Math.max(0.05, peakBar.high * 0.0006)

    if (peakIndex >= 0) {
      for (let j = peakIndex + 1; j < scoped.length; j++) {
        const next = scoped[j]!
        if (Math.abs(next.high - peakBar.high) <= peakTol || (next.high >= peakBar.high - peakTol && next.low <= peakBar.high)) {
          peakRetested = true
          peakRetestVol = Math.max(0, next.volume > 0 ? next.volume : 1)
          break
        }
      }
    }

    const troughIndex = scoped.findIndex((b) => b.time === troughBar.time)
    let troughRetested = false
    let troughRetestVol: number | undefined
    const troughTol = Math.max(0.05, troughBar.low * 0.0006)

    if (troughIndex >= 0) {
      for (let j = troughIndex + 1; j < scoped.length; j++) {
        const next = scoped[j]!
        if (Math.abs(next.low - troughBar.low) <= troughTol || (next.low <= troughBar.low + troughTol && next.high >= troughBar.low)) {
          troughRetested = true
          troughRetestVol = Math.max(0, next.volume > 0 ? next.volume : 1)
          break
        }
      }
    }

    const peakVol = Math.max(0, peakBar.volume > 0 ? peakBar.volume : 1)
    const troughVol = Math.max(0, troughBar.volume > 0 ? troughBar.volume : 1)
    const sessStart = group.bars[0]!.time
    const sessEnd = group.bars[group.bars.length - 1]!.time

    extremes.push({
      id: `${key}-high`,
      session: group.session,
      sessionKey: key,
      label: `${sessPrefix} ${peakBar.high.toFixed(2)}`,
      type: 'HIGH',
      price: Number(peakBar.high.toFixed(2)),
      time: peakBar.time,
      volume: peakVol,
      isRetested: peakRetested,
      retestVolume: peakRetestVol,
      retestVolumeRatio: peakRetestVol && peakVol > 0 ? Number((peakRetestVol / peakVol).toFixed(2)) : undefined,
      sessionStartTime: sessStart,
      sessionEndTime: sessEnd,
    })

    extremes.push({
      id: `${key}-low`,
      session: group.session,
      sessionKey: key,
      label: `${sessLowPrefix} ${troughBar.low.toFixed(2)}`,
      type: 'LOW',
      price: Number(troughBar.low.toFixed(2)),
      time: troughBar.time,
      volume: troughVol,
      isRetested: troughRetested,
      retestVolume: troughRetestVol,
      retestVolumeRatio: troughRetestVol && troughVol > 0 ? Number((troughRetestVol / troughVol).toFixed(2)) : undefined,
      sessionStartTime: sessStart,
      sessionEndTime: sessEnd,
    })
  }

  return extremes
}

/**
 * Detect Late-Session Spikes (Dalton Spike).
 * A spike occurs when price drives aggressively in the last 30-45 minutes of a session.
 */
export function detectSpikes(
  bars: ExcessBar[],
  _instrument: string = 'DOW',
  anchorUnix?: number
): SpikeReference[] {
  if (!bars || bars.length < 12) return []

  const scoped = anchorUnix != null ? bars.filter((b) => b.time >= anchorUnix) : bars
  if (scoped.length < 12) return []

  const dayGroups = new Map<string, ExcessBar[]>()
  for (const b of scoped) {
    const info = sessionInstanceKeyAt(b.time, _instrument)
    if (!info || info.name !== 'New York') continue
    const date = info.key.split('_')[0]!
    let list = dayGroups.get(date)
    if (!list) {
      list = []
      dayGroups.set(date, list)
    }
    list.push(b)
  }

  const spikes: SpikeReference[] = []

  for (const [date, nyBars] of Array.from(dayGroups.entries())) {
    if (nyBars.length < 12) continue

    // Late session bars (final 6–8 bars, ~30–40 mins)
    const lateBars = nyBars.slice(-8)
    const priorBars = nyBars.slice(0, -8)
    if (priorBars.length < 6) continue

    let priorHigh = -Infinity
    let priorLow = Infinity
    for (const b of priorBars) {
      if (b.high > priorHigh) priorHigh = b.high
      if (b.low < priorLow) priorLow = b.low
    }

    let lateHigh = -Infinity
    let lateLow = Infinity
    let lateVol = 0
    for (const b of lateBars) {
      if (b.high > lateHigh) lateHigh = b.high
      if (b.low < lateLow) lateLow = b.low
      lateVol += Math.max(0, b.volume > 0 ? b.volume : 1)
    }

    const priorRange = priorHigh - priorLow
    if (priorRange <= 0) continue

    // Upward Spike: broke out above prior range into close
    if (lateHigh > priorHigh + priorRange * 0.15) {
      spikes.push({
        id: `spike-up-${date}`,
        sessionDate: date,
        direction: 'UP',
        spikeHigh: Number(lateHigh.toFixed(2)),
        spikeLow: Number(lateLow.toFixed(2)),
        spikeBase: Number(priorHigh.toFixed(2)),
        startTime: lateBars[0]!.time,
        endTime: lateBars[lateBars.length - 1]!.time,
        volume: lateVol,
      })
    }
    // Downward Spike: broke out below prior range into close
    else if (lateLow < priorLow - priorRange * 0.15) {
      spikes.push({
        id: `spike-down-${date}`,
        sessionDate: date,
        direction: 'DOWN',
        spikeHigh: Number(lateHigh.toFixed(2)),
        spikeLow: Number(lateLow.toFixed(2)),
        spikeBase: Number(priorLow.toFixed(2)),
        startTime: lateBars[0]!.time,
        endTime: lateBars[lateBars.length - 1]!.time,
        volume: lateVol,
      })
    }
  }

  return spikes
}

/**
 * Detect Trend Day and Double Distribution Day Reference Points (Dalton framework).
 */
export function detectDistributionReferences(
  bars: ExcessBar[],
  _instrument: string = 'DOW',
  anchorUnix?: number
): DistributionReference[] {
  if (!bars || bars.length < 12) return []

  const scoped = anchorUnix != null ? bars.filter((b) => b.time >= anchorUnix) : bars
  if (scoped.length < 12) return []

  const dayGroups = new Map<string, ExcessBar[]>()
  for (const b of scoped) {
    const info = sessionInstanceKeyAt(b.time, _instrument)
    if (!info || info.name !== 'New York') continue
    const date = info.key.split('_')[0]!
    let list = dayGroups.get(date)
    if (!list) {
      list = []
      dayGroups.set(date, list)
    }
    list.push(b)
  }

  const refs: DistributionReference[] = []

  for (const [date, nyBars] of Array.from(dayGroups.entries())) {
    if (nyBars.length < 18) continue

    let dayHigh = -Infinity
    let dayLow = Infinity
    for (const b of nyBars) {
      if (b.high > dayHigh) dayHigh = b.high
      if (b.low < dayLow) dayLow = b.low
    }

    const dayRange = dayHigh - dayLow
    if (dayRange <= 0) continue

    const openPrice = nyBars[0]!.open
    const closePrice = nyBars[nyBars.length - 1]!.close

    // 1. Check for Double Distribution:
    // Split day into first half (morning IB + early rotation) and second half (afternoon breakout)
    const midIdx = Math.floor(nyBars.length / 2)
    const firstHalf = nyBars.slice(0, midIdx)
    const secondHalf = nyBars.slice(midIdx)

    let h1 = -Infinity, l1 = Infinity
    for (const b of firstHalf) {
      if (b.high > h1) h1 = b.high
      if (b.low < l1) l1 = b.low
    }
    let h2 = -Infinity, l2 = Infinity
    for (const b of secondHalf) {
      if (b.high > h2) h2 = b.high
      if (b.low < l2) l2 = b.low
    }

    // A Double Distribution has two distinct balance areas with little to no overlap
    const isDoubleDistUp = l2 > (h1 + l1) / 2 && h2 > h1 + dayRange * 0.25
    const isDoubleDistDown = h2 < (h1 + l1) / 2 && l2 < l1 - dayRange * 0.25

    const sessStart = nyBars[0]!.time
    const sessEnd = nyBars[nyBars.length - 1]!.time

    if (isDoubleDistUp || isDoubleDistDown) {
      const poc1 = Number(((h1 + l1) / 2).toFixed(2))
      const poc2 = Number(((h2 + l2) / 2).toFixed(2))
      const separation = Number(((h1 + l2) / 2).toFixed(2))

      refs.push({
        id: `dd-${date}`,
        sessionDate: date,
        dayType: 'DOUBLE_DISTRIBUTION',
        label: `DD Sep ${separation.toFixed(2)}`,
        startTime: sessStart,
        endTime: sessEnd,
        upperPoc: Math.max(poc1, poc2),
        lowerPoc: Math.min(poc1, poc2),
        separationLevel: separation,
      })
      continue
    }

    // 2. Check for Trend Day:
    // Sustained one-time framing where close is near day extreme (within 18% of range)
    const isTrendBull = closePrice >= dayHigh - dayRange * 0.18 && openPrice <= dayLow + dayRange * 0.25
    const isTrendBear = closePrice <= dayLow + dayRange * 0.18 && openPrice >= dayHigh - dayRange * 0.25

    if (isTrendBull || isTrendBear) {
      const midpoint = Number(((dayHigh + dayLow) / 2).toFixed(2))
      refs.push({
        id: `trend-${date}`,
        sessionDate: date,
        dayType: isTrendBull ? 'TREND_BULL' : 'TREND_BEAR',
        label: isTrendBull ? `Trend H ${dayHigh.toFixed(2)}` : `Trend L ${dayLow.toFixed(2)}`,
        startTime: sessStart,
        endTime: sessEnd,
        trendExtreme: isTrendBull ? Number(dayHigh.toFixed(2)) : Number(dayLow.toFixed(2)),
        trendMidpoint: midpoint,
        trendOpen: Number(openPrice.toFixed(2)),
      })
    }
  }

  return refs
}

/**
 * Backwards-compatible export mapping to session extremes.
 */
export function detect5DayExcesses(
  bars: ExcessBar[],
  instrument: string = 'DOW',
  anchorUnix?: number
): MarketExcess[] {
  const extremes = detect5DaySessionExtremes(bars, instrument, anchorUnix)
  return extremes.map((ex) => ({
    id: ex.id,
    type: ex.type === 'HIGH' ? 'SELLING_EXCESS' : 'BUYING_EXCESS',
    time: ex.time,
    price: ex.price,
    volume: ex.volume,
    candleOpen: ex.price,
    candleClose: ex.price,
    candleHigh: ex.price,
    candleLow: ex.price,
    isRetested: ex.isRetested,
    retestTime: ex.retestTime,
    retestVolume: ex.retestVolume,
    retestVolumeRatio: ex.retestVolumeRatio,
    session: ex.session,
    label: ex.label,
  }))
}
