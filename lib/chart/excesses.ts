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

import { sessionInstanceKeyAt, computeVwapFromCustomAnchor } from '@/lib/chart/sessionVwap'

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
 * Detect Tested Swing Highs and Lows across Daily candles.
 * Tracks structural daily pivot peaks and troughs, traded volumes, and retest confirmation.
 */
export function detectDailyExtremes(
  bars: ExcessBar[],
  maxCount: number = 28
): SessionExtreme[] {
  if (!bars || bars.length < 5) return []
  const extremes: SessionExtreme[] = []
  const window = 2

  for (let i = window; i < bars.length - 1; i++) {
    const cur = bars[i]!
    let isHigh = true
    let isLow = true

    for (let w = 1; w <= window; w++) {
      if (bars[i - w]!.high >= cur.high || (i + w < bars.length && bars[i + w]!.high >= cur.high)) {
        isHigh = false
      }
      if (bars[i - w]!.low <= cur.low || (i + w < bars.length && bars[i + w]!.low <= cur.low)) {
        isLow = false
      }
    }

    const tol = Math.max(0.05, cur.close * 0.001)

    if (isHigh) {
      let isRetested = false
      let retestVol: number | undefined
      let retestTime: number | undefined
      for (let j = i + 1; j < bars.length; j++) {
        const next = bars[j]!
        if (Math.abs(next.high - cur.high) <= tol || (next.high >= cur.high - tol && next.low <= cur.high)) {
          isRetested = true
          retestVol = Math.max(0, next.volume > 0 ? next.volume : 1)
          retestTime = next.time
          break
        }
      }
      const vol = Math.max(0, cur.volume > 0 ? cur.volume : 1)
      extremes.push({
        id: `daily-high-${cur.time}`,
        session: 'New York',
        sessionKey: `daily_${cur.time}`,
        label: `DH ${cur.high.toFixed(2)}`,
        type: 'HIGH',
        price: Number(cur.high.toFixed(2)),
        time: cur.time,
        volume: vol,
        isRetested,
        retestVolume: retestVol,
        retestVolumeRatio: retestVol && vol > 0 ? Number((retestVol / vol).toFixed(2)) : undefined,
        retestTime,
        sessionStartTime: cur.time,
        sessionEndTime: retestTime ?? Math.min(bars[bars.length - 1]!.time, cur.time + 86400 * 20),
      })
    }

    if (isLow) {
      let isRetested = false
      let retestVol: number | undefined
      let retestTime: number | undefined
      for (let j = i + 1; j < bars.length; j++) {
        const next = bars[j]!
        if (Math.abs(next.low - cur.low) <= tol || (next.low <= cur.low + tol && next.high >= cur.low)) {
          isRetested = true
          retestVol = Math.max(0, next.volume > 0 ? next.volume : 1)
          retestTime = next.time
          break
        }
      }
      const vol = Math.max(0, cur.volume > 0 ? cur.volume : 1)
      extremes.push({
        id: `daily-low-${cur.time}`,
        session: 'New York',
        sessionKey: `daily_${cur.time}`,
        label: `DL ${cur.low.toFixed(2)}`,
        type: 'LOW',
        price: Number(cur.low.toFixed(2)),
        time: cur.time,
        volume: vol,
        isRetested,
        retestVolume: retestVol,
        retestVolumeRatio: retestVol && vol > 0 ? Number((retestVol / vol).toFixed(2)) : undefined,
        retestTime,
        sessionStartTime: cur.time,
        sessionEndTime: retestTime ?? Math.min(bars[bars.length - 1]!.time, cur.time + 86400 * 20),
      })
    }
  }

  return extremes.slice(-maxCount)
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
  barCount?: number
  headlineSentence?: string
  avwapPoints?: Array<{ time: number; vwap: number; upper1: number; lower1: number }>
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
/**
 * Minimum move range (in points) required for a news announcement reaction to be considered "dramatic".
 * Routine candle fluctuations below these thresholds must NEVER be annotated as emotional news moves or flushes.
 */
const MIN_DRAMATIC_NEWS_MOVE_PTS: Record<string, number> = {
  DOW: 50.0,
  YM: 50.0,
  MYM: 50.0,
  US30: 50.0,
  NIKKEI: 100.0,
  NKD: 100.0,
  JP225: 100.0,
  NASDAQ: 35.0,
  NQ: 35.0,
  MNQ: 35.0,
  ES: 12.0,
  MES: 12.0,
  SPX: 12.0,
  RTY: 10.0,
  RUSSELL: 10.0,
  GOLD: 6.0,
  GC: 6.0,
  MGC: 6.0,
  SILVER: 0.30,
  SI: 0.30,
  CRUDE: 0.60,
  CL: 0.60,
  OIL: 0.60,
}

/**
 * Check if an economic calendar event corresponds directly to the traded instrument.
 */
export function isEventDomesticToInstrument(country: string | undefined, event: string, instrument: string): boolean {
  const c = (country || '').toUpperCase().trim()
  const ev = event.toLowerCase()
  const inst = instrument.toUpperCase().trim()

  const isUsIndex = /^(DOW|YM|MYM|US30|NASDAQ|NQ|MNQ|ES|MES|SPX|RTY|RUSSELL)$/.test(inst)
  const isGold = /^(GOLD|GC|MGC|SILVER|SI)$/.test(inst)
  const isNikkei = /^(NIKKEI|NKD|JP225)$/.test(inst)
  const isCrude = /^(CRUDE|CL|MCL|OIL)$/.test(inst)

  if (isUsIndex || isGold) {
    if (c === 'US' || c === 'USD' || c.includes('UNITED STATES')) return true
    if (/\b(fomc|fed\b|powell|cpi|ppi|nfp|non-farm|payroll|pce|gdp|ism\b|retail sales|jobless|michigan|rates|unemployment)\b/i.test(ev)) return true
    return false
  }

  if (isNikkei) {
    if (c === 'JP' || c === 'JPY' || c.includes('JAPAN')) return true
    if (/\b(boj\b|bank of japan|tokyo|yen)\b/i.test(ev)) return true
    if (c === 'US' || c === 'USD') return true
    return false
  }

  if (isCrude) {
    if (/\b(crude|oil|eia|petroleum|gasoline|opec|natural gas|api|distillates|refinery|inventory)\b/i.test(ev)) return true
    if (c === 'US' || c === 'USD') return true
    return false
  }

  return true
}

/**
 * Identify Tier-1 very important macroeconomic events that establish sustained trend regimes.
 * Filters out minor speeches, tertiary releases, and calendar noise.
 */
export function isVeryImportantMacroEvent(event: string, country?: string): boolean {
  const ev = event.toLowerCase()
  const c = (country || '').toUpperCase().trim()

  // Tier-1 catalysts: CPI, PPI, NFP / Jobs, FOMC / Fed, Powell, Rate Decisions, PCE, EIA Crude, Retail Sales, GDP, ISM
  const isKeyDriver =
    /\b(cpi|ppi|nfp|non-farm|payroll|fomc|fed\b|powell|rate decision|interest rate|pce\b|eia\b|petroleum|crude.*inventor|gdp|retail sales|ism manufacturing)\b/i.test(ev)

  if (isKeyDriver) return true

  if (c === 'US' || c === 'USD') {
    if (/\b(inflation|unemployment rate|interest rate decision|monetary policy)\b/i.test(ev)) return true
  }

  return false
}

/**
 * Determine whether an abnormal news move qualifies for an Event-Anchored VWAP line.
 * Requires BOTH:
 * 1. Tier-1 very important macro news or massive breaking news spike.
 * 2. Confirmed abnormal volatility effect on the chart (verified moveRange & ATR expansion).
 */
export function shouldAnchorVwapToNews(move: EmotionalNewsMove): boolean {
  // Only genuine Tier-1 macroeconomic events (FOMC, CPI, NFP, GDP, etc.) qualify for an anchored VWAP
  return isVeryImportantMacroEvent(move.eventName, move.country)
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
  instrument: string = 'DOW',
  anchorUnix?: number,
  nowMs: number = Date.now(),
  allowUnscheduledSpikes: boolean = false
): EmotionalNewsMove[] {
  if (!bars || bars.length < 5) return []

  const scoped = anchorUnix != null ? bars.filter((b) => b.time >= anchorUnix) : bars
  if (scoped.length < 5) return []

  const moves: EmotionalNewsMove[] = []
  const processedIndices = new Set<number>()

  const instKey = instrument.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const baseThreshold = MIN_DRAMATIC_NEWS_MOVE_PTS[instKey] ?? 20.0

  // 1. Process explicit economic calendar events that really impact the market
  for (const e of calendarEvents) {
    const impactRaw = (e.impact || '').toLowerCase()
    const isExplicitHigh = impactRaw.includes('high')
    const isKnownMacroDriver = /cpi|fomc|fed\b|nfp|non-farm|payroll|powell|rate decision|gdp|ppi|unemployment|retail sales|pce\b|ism\b/i.test(e.event)
    if (!isExplicitHigh && !isKnownMacroDriver) continue

    // Determine if the event corresponds directly to this instrument
    const isDomestic = isEventDomesticToInstrument(e.country, e.event, instrument)

    const eventUnix = parseCalendarTimeUnix(e.time, nowMs)
    if (!eventUnix) continue

    const barStep = scoped.length >= 2 ? Math.max(60, scoped[1]!.time - scoped[0]!.time) : 300

    let eventIdx = -1
    let minDiff = Infinity
    for (let i = 0; i < scoped.length; i++) {
      const bTime = scoped[i]!.time
      const nextTime = i + 1 < scoped.length ? scoped[i + 1]!.time : bTime + barStep
      if (eventUnix >= bTime && eventUnix < nextTime) {
        eventIdx = i
        break
      }
      const diff = Math.abs(bTime - eventUnix)
      if (diff <= barStep && diff < minDiff) {
        minDiff = diff
        eventIdx = i
      }
    }
    if (eventIdx === -1) continue

    // Reaction covers 2 or 3 bars: 3 bars on fast timeframes (<=5m), 2 bars on higher timeframes (15m/30m)
    const reactionSpanBars = barStep >= 900 ? 1 : 2
    const reactionEndIdx = Math.min(scoped.length - 1, eventIdx + reactionSpanBars)
    const reactionBars = scoped.slice(eventIdx, reactionEndIdx + 1)
    if (reactionBars.length === 0) continue

    const basePrice = eventIdx > 0 ? scoped[eventIdx - 1]!.close : scoped[eventIdx]!.open
    let nHigh = -Infinity
    let nLow = Infinity
    let nVol = 0
    let maxSingleBarRange = 0
    for (const b of reactionBars) {
      if (b.high > nHigh) nHigh = b.high
      if (b.low < nLow) nLow = b.low
      nVol += Math.max(0, b.volume > 0 ? b.volume : 1)
      const r = b.high - b.low
      if (r > maxSingleBarRange) maxSingleBarRange = r
    }
    const moveRange = Number((nHigh - nLow).toFixed(2))
    if (moveRange <= 0) continue

    // The move must be genuinely DRAMATIC / abnormal for the instrument:
    const minRequiredPts = Math.max(baseThreshold, basePrice > 0 ? basePrice * 0.0012 : baseThreshold) * (isDomestic ? 1.0 : 1.4)
    if (moveRange < minRequiredPts) {
      // Market did not move enough to qualify as abnormal volatility
      continue
    }

    // Verify that the market ACTUALLY reacted with abnormal expansion compared to pre-news baseline
    const lookback = Math.min(10, eventIdx)
    let preRangeSum = 0
    let preVolSum = 0
    if (lookback > 0) {
      for (let j = eventIdx - lookback; j < eventIdx; j++) {
        preRangeSum += scoped[j]!.high - scoped[j]!.low
        preVolSum += Math.max(0, scoped[j]!.volume > 0 ? scoped[j]!.volume : 1)
      }
    }
    const avgPreRange = lookback > 0 ? preRangeSum / lookback : (baseThreshold * 0.5)
    const avgPreVol = lookback > 0 ? preVolSum / lookback : 1
    const reactionExpansion = avgPreRange > 0 ? moveRange / avgPreRange : 1.5
    const volumeExpansion = avgPreVol > 0 ? (nVol / reactionBars.length) / avgPreVol : 1
    const singleBarExpansion = avgPreRange > 0 ? maxSingleBarRange / avgPreRange : 1.2

    const minReactionExp = isDomestic ? 1.4 : 1.85
    const isDramaticExpansion =
      reactionExpansion >= minReactionExp ||
      singleBarExpansion >= 1.4 ||
      maxSingleBarRange >= baseThreshold * 0.85 ||
      moveRange >= baseThreshold * 1.15 ||
      (reactionExpansion >= 1.25 && volumeExpansion >= 1.4)

    if (!isDramaticExpansion) {
      // Not abnormal volatility
      continue
    }

    for (let i = eventIdx; i <= reactionEndIdx; i++) {
      processedIndices.add(i)
    }

    const lastReactionClose = reactionBars[reactionBars.length - 1]!.close
    const upSpread = nHigh - basePrice
    const downSpread = basePrice - nLow
    let direction: 'WHIPSAW' | 'BULLISH_DRIVE' | 'BEARISH_DRIVE' = 'WHIPSAW'
    let description = ''

    // True Bearish Flush: Unidirectional impulsive selloff where price closed near the lows
    const isBearishFlush =
      downSpread >= 0.65 * moveRange &&
      lastReactionClose <= basePrice - 0.50 * moveRange &&
      upSpread <= 0.35 * moveRange

    // True Bullish Drive: Unidirectional impulsive rally where price closed near the highs
    const isBullishDrive =
      upSpread >= 0.65 * moveRange &&
      lastReactionClose >= basePrice + 0.50 * moveRange &&
      downSpread <= 0.35 * moveRange

    if (isBearishFlush) {
      direction = 'BEARISH_DRIVE'
      description = `Bearish news flush: impulsive selloff -${(basePrice - lastReactionClose).toFixed(1)} pts to low ${nLow}`
    } else if (isBullishDrive) {
      direction = 'BULLISH_DRIVE'
      description = `Bullish news drive: impulsive surge +${(lastReactionClose - basePrice).toFixed(1)} pts to high ${nHigh}`
    } else {
      direction = 'WHIPSAW'
      const isTwoWaySweep = upSpread >= 0.30 * moveRange && downSpread >= 0.30 * moveRange
      description = isTwoWaySweep
        ? `Two-way whipsaw: both High (${nHigh}) and Low (${nLow}) swept by ${moveRange.toFixed(1)} pts`
        : `Emotional news whipsaw: range expanded ${moveRange.toFixed(1)} pts`
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

    const impact: 'High' | 'Medium' | 'Low' = isExplicitHigh ? 'High' : 'Medium'

    const cleanEventName = e.event
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*m\/m|\s*y\/y|\s*q\/q/gi, '')
      .trim()
    const dirWord = direction === 'BULLISH_DRIVE' ? '▲ Surge' : direction === 'BEARISH_DRIVE' ? '▼ Flush' : '± Whipsaw'
    const barCount = reactionBars.length
    const barText = `${barCount} bar${barCount > 1 ? 's' : ''}`
    const ptsText = `${moveRange.toFixed(moveRange < 10 ? 2 : 1)}pts`
    const volExpansionStr = reactionExpansion >= 1.6 ? ` · Abnormal ${reactionExpansion.toFixed(1)}x Vol` : ' · Abnormal Volatility'
    const headlineSentence = `⚡ ${cleanEventName}: ${dirWord} ${ptsText} (${barText})${volExpansionStr}`

    let avwapPoints: Array<{ time: number; vwap: number; upper1: number; lower1: number }> | undefined
    if (isVeryImportantMacroEvent(e.event, e.country)) {
      const vwapRes = computeVwapFromCustomAnchor(scoped, scoped[eventIdx]!.time)
      if (vwapRes && vwapRes.vwap.length >= 2) {
        avwapPoints = vwapRes.vwap.map((pt, idx) => ({
          time: Number(pt.time),
          vwap: pt.value,
          upper1: vwapRes.upper1[idx]?.value ?? pt.value,
          lower1: vwapRes.lower1[idx]?.value ?? pt.value,
        }))
      }
    }

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
      barCount,
      headlineSentence,
      avwapPoints,
    })
  }

  // 2. Unscheduled Volatility Spikes (only if explicitly enabled)
  if (allowUnscheduledSpikes && scoped.length >= 6) {
    const barStep = scoped.length >= 2 ? Math.max(60, scoped[1]!.time - scoped[0]!.time) : 300
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

      const isAbnormalSpike =
        avgRange > 0 &&
        curRange >= 2.0 * avgRange &&
        curRange >= baseThreshold &&
        (avgVol <= 1 || curVol >= 1.3 * avgVol || curRange >= 2.8 * avgRange)

      if (isAbnormalSpike) {
        const spikeEndIdx = Math.min(scoped.length - 1, i + (barStep >= 900 ? 0 : 1))
        const spikeBars = scoped.slice(i, spikeEndIdx + 1)
        const barCount = spikeBars.length
        let sHigh = -Infinity
        let sLow = Infinity
        let sVol = 0
        for (const b of spikeBars) {
          if (b.high > sHigh) sHigh = b.high
          if (b.low < sLow) sLow = b.low
          sVol += Math.max(0, b.volume > 0 ? b.volume : 1)
        }
        const spikeRange = Number((sHigh - sLow).toFixed(2))
        const basePrice = curBar.open
        const upSpread = sHigh - basePrice
        const downSpread = basePrice - sLow
        const lastReactionClose = spikeBars[spikeBars.length - 1]!.close
        const isBearishFlush = downSpread >= 0.60 * spikeRange && lastReactionClose <= basePrice - 0.40 * spikeRange
        const isBullishDrive = upSpread >= 0.60 * spikeRange && lastReactionClose >= basePrice + 0.40 * spikeRange
        const direction: 'WHIPSAW' | 'BULLISH_DRIVE' | 'BEARISH_DRIVE' = isBearishFlush
          ? 'BEARISH_DRIVE'
          : isBullishDrive
            ? 'BULLISH_DRIVE'
            : 'WHIPSAW'

        let status: EmotionalNewsMove['status'] = 'WITHIN_RANGE'
        let isRetested = false
        let retestTime: number | undefined
        for (let k = spikeEndIdx + 1; k < scoped.length; k++) {
          const b = scoped[k]!
          if (b.close > sHigh) status = 'BROKEN_ABOVE'
          else if (b.close < sLow) status = 'BROKEN_BELOW'
          else if (b.high >= sHigh - 0.15 * spikeRange && b.close < sHigh - 0.25 * spikeRange) {
            status = 'REJECTED_HIGH'
            isRetested = true
            retestTime = b.time
          } else if (b.low <= sLow + 0.15 * spikeRange && b.close > sLow + 0.25 * spikeRange) {
            status = 'REJECTED_LOW'
            isRetested = true
            retestTime = b.time
          }
        }

        const dirWord = direction === 'BULLISH_DRIVE' ? '▲ Surge' : direction === 'BEARISH_DRIVE' ? '▼ Flush' : '± Spike'
        const barText = `${barCount} bar${barCount > 1 ? 's' : ''}`
        const ptsText = `${spikeRange.toFixed(spikeRange < 10 ? 2 : 1)}pts`
        const headlineSentence = `⚡ Volatility Spike: ${dirWord} ${ptsText} (${barText} · ${(curRange / avgRange).toFixed(1)}x ATR)`

        let avwapPoints: Array<{ time: number; vwap: number; upper1: number; lower1: number }> | undefined
        if (curRange >= 2.5 * avgRange) {
          const vwapRes = computeVwapFromCustomAnchor(scoped, curBar.time)
          if (vwapRes && vwapRes.vwap.length >= 2) {
            avwapPoints = vwapRes.vwap.map((pt, idx) => ({
              time: Number(pt.time),
              vwap: pt.value,
              upper1: vwapRes.upper1[idx]?.value ?? pt.value,
              lower1: vwapRes.lower1[idx]?.value ?? pt.value,
            }))
          }
        }

        moves.push({
          id: `news-spike-${curBar.time}`,
          eventName: 'Breaking News Volatility Spike',
          impact: 'High',
          newsTime: curBar.time,
          reactionStartTime: curBar.time,
          reactionEndTime: scoped[spikeEndIdx]!.time,
          newsHigh: Number(sHigh.toFixed(2)),
          newsLow: Number(sLow.toFixed(2)),
          basePrice: Number(basePrice.toFixed(2)),
          moveRange: spikeRange,
          volume: sVol,
          direction,
          description: `Sudden volatility impulse: ${spikeRange.toFixed(1)} pts (${(curRange / avgRange).toFixed(1)}x ATR)`,
          status,
          isRetested,
          retestTime,
          barCount,
          headlineSentence,
          avwapPoints,
        })

        for (let k = i; k <= spikeEndIdx; k++) {
          processedIndices.add(k)
        }
      }
    }
  }

  return moves
}
