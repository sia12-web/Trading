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

export interface EmotionalNewsMove {
  id: string
  eventName: string
  impact: 'High' | 'Medium' | 'Low'
  country?: string
  newsTime: number
  reactionStartTime: number
  reactionEndTime: number
  newsHigh: number
  newsLow: number
  basePrice: number
  moveRange: number
  volume: number
  direction: 'WHIPSAW' | 'BULLISH_DRIVE' | 'BEARISH_DRIVE'
  description: string
  status: 'WITHIN_RANGE' | 'REJECTED_HIGH' | 'REJECTED_LOW' | 'BROKEN_ABOVE' | 'BROKEN_BELOW'
  isRetested: boolean
  retestTime?: number
}

export interface CalendarEventParam {
  id?: string
  time: string | number
  event: string
  impact?: string
  country?: string
}

function parseCalendarTimeUnix(time: string | number | null | undefined, _nowMs: number): number | null {
  if (time == null) return null
  if (typeof time === 'number') {
    return time > 1e11 ? Math.floor(time / 1000) : time
  }
  const str = String(time).trim()
  if (!str) return null
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str)
    return n > 1e11 ? Math.floor(n / 1000) : n
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`
    const ms = Date.parse(iso)
    if (Number.isFinite(ms)) return Math.floor(ms / 1000)
  }
  return null
}

/**
 * Detect Emotional News Moves (sudden high & low spikes upon economic news announcements).
 * Captures:
 * 1. News Reaction High & News Reaction Low
 * 2. Pre-news base price
 * 3. Direction / Whipsaw classification
 * 4. Post-news acceptance vs rejection
 * 5. Unscheduled breaking news volatility spikes (>2.5x ATR)
 */
export function detectEmotionalNewsMoves(
  bars: ExcessBar[],
  calendarEvents: CalendarEventParam[] = [],
  _instrument: string = 'DOW',
  anchorUnix?: number,
  nowMs: number = Date.now()
): EmotionalNewsMove[] {
  if (!bars || bars.length < 5) return []

  const scoped = anchorUnix != null ? bars.filter((b) => b.time >= anchorUnix) : bars
  if (scoped.length < 5) return []

  const moves: EmotionalNewsMove[] = []
  const processedIndices = new Set<number>()

  // 1. Process explicit economic calendar events
  for (const e of calendarEvents) {
    const eventUnix = parseCalendarTimeUnix(e.time, nowMs)
    if (!eventUnix) continue

    let eventIdx = -1
    let minDiff = Infinity
    for (let i = 0; i < scoped.length; i++) {
      const diff = Math.abs(scoped[i]!.time - eventUnix)
      if (diff <= 300 && diff < minDiff) {
        minDiff = diff
        eventIdx = i
      }
    }
    if (eventIdx === -1) continue

    const reactionEndIdx = Math.min(scoped.length - 1, eventIdx + 2)
    const reactionBars = scoped.slice(eventIdx, reactionEndIdx + 1)
    if (reactionBars.length === 0) continue

    for (let i = eventIdx; i <= reactionEndIdx; i++) {
      processedIndices.add(i)
    }

    const basePrice = eventIdx > 0 ? scoped[eventIdx - 1]!.close : scoped[eventIdx]!.open
    let nHigh = -Infinity
    let nLow = Infinity
    let nVol = 0
    for (const b of reactionBars) {
      if (b.high > nHigh) nHigh = b.high
      if (b.low < nLow) nLow = b.low
      nVol += Math.max(0, b.volume > 0 ? b.volume : 1)
    }
    const moveRange = Number((nHigh - nLow).toFixed(2))
    if (moveRange <= 0) continue

    const lastReactionClose = reactionBars[reactionBars.length - 1]!.close
    const upSpread = nHigh - basePrice
    const downSpread = basePrice - nLow
    let direction: 'WHIPSAW' | 'BULLISH_DRIVE' | 'BEARISH_DRIVE' = 'WHIPSAW'
    let description = ''

    if (upSpread >= 0.35 * moveRange && downSpread >= 0.35 * moveRange) {
      direction = 'WHIPSAW'
      description = `Two-way whipsaw: both High (${nHigh}) and Low (${nLow}) swept by ${moveRange.toFixed(1)} pts`
    } else if (lastReactionClose >= basePrice + 0.25 * moveRange) {
      direction = 'BULLISH_DRIVE'
      description = `Bullish news drive: impulsive surge +${(lastReactionClose - basePrice).toFixed(1)} pts to high ${nHigh}`
    } else if (lastReactionClose <= basePrice - 0.25 * moveRange) {
      direction = 'BEARISH_DRIVE'
      description = `Bearish news flush: impulsive selloff -${(basePrice - lastReactionClose).toFixed(1)} pts to low ${nLow}`
    } else {
      direction = 'WHIPSAW'
      description = `Emotional news whipsaw: range expanded ${moveRange.toFixed(1)} pts`
    }

    let status: EmotionalNewsMove['status'] = 'WITHIN_RANGE'
    let isRetested = false
    let retestTime: number | undefined

    const subsequentBars = scoped.slice(reactionEndIdx + 1)
    for (const b of subsequentBars) {
      if (b.close > nHigh) {
        status = 'BROKEN_ABOVE'
      } else if (b.close < nLow) {
        status = 'BROKEN_BELOW'
      } else if (b.high >= nHigh - 0.15 * moveRange && b.close < nHigh - 0.25 * moveRange) {
        status = 'REJECTED_HIGH'
        isRetested = true
        retestTime = b.time
      } else if (b.low <= nLow + 0.15 * moveRange && b.close > nLow + 0.25 * moveRange) {
        status = 'REJECTED_LOW'
        isRetested = true
        retestTime = b.time
      }
    }

    const impactRaw = (e.impact || '').toLowerCase()
    const impact: 'High' | 'Medium' | 'Low' = impactRaw.includes('high') ? 'High' : impactRaw.includes('med') ? 'Medium' : 'Low'

    moves.push({
      id: `news-move-${eventUnix}-${e.event.replace(/\s+/g, '-').toLowerCase()}`,
      eventName: e.event,
      impact,
      country: e.country,
      newsTime: eventUnix,
      reactionStartTime: scoped[eventIdx]!.time,
      reactionEndTime: scoped[reactionEndIdx]!.time,
      newsHigh: Number(nHigh.toFixed(2)),
      newsLow: Number(nLow.toFixed(2)),
      basePrice: Number(basePrice.toFixed(2)),
      moveRange,
      volume: nVol,
      direction,
      description,
      status,
      isRetested,
      retestTime,
    })
  }

  // 2. Detect Unscheduled Sudden Volatility Spikes (>2.5x ATR)
  if (scoped.length >= 6) {
    const minLookback = 5
    for (let i = minLookback; i < scoped.length; i++) {
      if (processedIndices.has(i)) continue

      const lookback = Math.min(10, i)
      let sumRange = 0
      let sumVol = 0
      for (let j = i - lookback; j < i; j++) {
        sumRange += scoped[j]!.high - scoped[j]!.low
        sumVol += Math.max(0, scoped[j]!.volume > 0 ? scoped[j]!.volume : 1)
      }
      const avgRange = sumRange / lookback
      const avgVol = sumVol / lookback

      const curBar = scoped[i]!
      const curRange = curBar.high - curBar.low
      const curVol = Math.max(0, curBar.volume > 0 ? curBar.volume : 1)

      if (avgRange > 0 && curRange >= 2.5 * avgRange && curVol >= 1.8 * avgVol) {
        const basePrice = curBar.open
        const upSpread = curBar.high - basePrice
        const downSpread = basePrice - curBar.low
        const isWhipsaw = upSpread >= 0.35 * curRange && downSpread >= 0.35 * curRange
        const direction: 'WHIPSAW' | 'BULLISH_DRIVE' | 'BEARISH_DRIVE' = isWhipsaw
          ? 'WHIPSAW'
          : curBar.close >= basePrice
            ? 'BULLISH_DRIVE'
            : 'BEARISH_DRIVE'

        let status: EmotionalNewsMove['status'] = 'WITHIN_RANGE'
        let isRetested = false
        let retestTime: number | undefined
        for (let k = i + 1; k < scoped.length; k++) {
          const b = scoped[k]!
          if (b.close > curBar.high) status = 'BROKEN_ABOVE'
          else if (b.close < curBar.low) status = 'BROKEN_BELOW'
          else if (b.high >= curBar.high - 0.15 * curRange && b.close < curBar.high - 0.25 * curRange) {
            status = 'REJECTED_HIGH'
            isRetested = true
            retestTime = b.time
          } else if (b.low <= curBar.low + 0.15 * curRange && b.close > curBar.low + 0.25 * curRange) {
            status = 'REJECTED_LOW'
            isRetested = true
            retestTime = b.time
          }
        }

        moves.push({
          id: `news-spike-${curBar.time}`,
          eventName: 'Breaking News Volatility Spike',
          impact: 'High',
          newsTime: curBar.time,
          reactionStartTime: curBar.time,
          reactionEndTime: curBar.time,
          newsHigh: Number(curBar.high.toFixed(2)),
          newsLow: Number(curBar.low.toFixed(2)),
          basePrice: Number(basePrice.toFixed(2)),
          moveRange: Number(curRange.toFixed(2)),
          volume: curVol,
          direction,
          description: `Sudden volatility impulse: ${curRange.toFixed(1)} pts (${(curRange / avgRange).toFixed(1)}x ATR)`,
          status,
          isRetested,
          retestTime,
        })

        processedIndices.add(i)
        processedIndices.add(i + 1)
      }
    }
  }

  return moves
}
