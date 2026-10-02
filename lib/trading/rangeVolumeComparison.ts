/**
 * Range Volume Comparison & Support/Resistance Readiness Engine
 *
 * Computes deterministic volume, volume velocity (per minute), delta,
 * and comparative metrics across user-drawn chart range boxes and levels.
 *
 * Evaluates whether volume increased or decreased between ranges and
 * classifies their readiness as Good vs Bad Support, and Good vs Bad Resistance
 * according to Dalton Auction Market Theory and institutional order flow.
 */

export interface RangeCandleBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface RangeVolumeData {
  id: string
  label: string
  priceHigh: number
  priceLow: number
  midPrice: number
  heightPts: number
  timeStart: number
  timeEnd: number
  startTimeEt: string
  endTimeEt: string
  durationMin: number
  totalVolume: number
  inRangeVolume: number
  volumeRatePerMin: number
  buyVolume: number
  sellVolume: number
  delta: number
  buyRatioPct: number
  poc?: number
  candleCount: number
  priceRelation: 'INSIDE' | 'ABOVE' | 'BELOW'
  positionPct: number
}

export type SupportClassification =
  | 'GOOD_SUPPORT'
  | 'BAD_SUPPORT'
  | 'ACCUMULATION_SUPPORT'
  | 'NEUTRAL'

export type ResistanceClassification =
  | 'GOOD_RESISTANCE'
  | 'BAD_RESISTANCE'
  | 'DISTRIBUTION_RESISTANCE'
  | 'NEUTRAL'

export interface SupportReadiness {
  classification: SupportClassification
  label: string
  reasoning: string
  tacticalRead: string
}

export interface ResistanceReadiness {
  classification: ResistanceClassification
  label: string
  reasoning: string
  tacticalRead: string
}

export interface RangeComparisonResult {
  rangeA: RangeVolumeData
  rangeB: RangeVolumeData
  volumeChangePts: number
  volumeChangePct: number
  volumeTrend: 'DECREASED' | 'INCREASED' | 'SIMILAR'
  volumeRateChangePct: number
  rateTrend: 'DECREASED' | 'INCREASED' | 'SIMILAR'
  deltaShift: number
  deltaTrend:
    | 'BUYER_EXPANSION'
    | 'SELLER_EXPANSION'
    | 'BUYER_EXHAUSTION'
    | 'SELLER_EXHAUSTION'
    | 'BALANCED'
  priceShift: 'HIGHER' | 'LOWER' | 'OVERLAPPING'
  supportReadiness: SupportReadiness
  resistanceReadiness: ResistanceReadiness
  summary: string
}

export function formatEtTime(unixSec: number): string {
  try {
    const d = new Date(unixSec * 1000)
    return (
      d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' ET'
    )
  } catch {
    return `${unixSec}`
  }
}

/**
 * Computes detailed volume and order-flow metrics for a single Range Box
 * using the available chart candlestick history.
 */
export function computeRangeVolumeMetrics(
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  candles: RangeCandleBar[] = [],
  currentPrice?: number | null,
  label: string = 'Range Box',
  id: string = `range-${Date.now()}`
): RangeVolumeData {
  const priceHigh = Math.max(p1.price, p2.price)
  const priceLow = Math.min(p1.price, p2.price)
  const midPrice = Number(((priceHigh + priceLow) / 2).toFixed(2))
  const heightPts = Number((priceHigh - priceLow).toFixed(2))

  const timeStart = Math.min(p1.time, p2.time)
  const timeEnd = Math.max(p1.time, p2.time)
  const durationMin = Math.max(1, Math.round((timeEnd - timeStart) / 60))

  let priceRelation: 'INSIDE' | 'ABOVE' | 'BELOW' = 'INSIDE'
  let positionPct = 50

  if (currentPrice != null && Number.isFinite(currentPrice)) {
    if (currentPrice > priceHigh) {
      priceRelation = 'ABOVE'
      positionPct = 100 + ((currentPrice - priceHigh) / (heightPts || 1)) * 100
    } else if (currentPrice < priceLow) {
      priceRelation = 'BELOW'
      positionPct = -(((priceLow - currentPrice) / (heightPts || 1)) * 100)
    } else {
      priceRelation = 'INSIDE'
      positionPct = heightPts > 0 ? Math.round(((currentPrice - priceLow) / heightPts) * 100) : 50
    }
  }

  // Filter candles that intersect the range's time interval
  // Allow a small buffer (up to 300s / 1 bar) so edge candles are included
  const scopedCandles = candles.filter((c) => {
    if (!Number.isFinite(c.time) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) return false
    return c.time >= timeStart - 60 && c.time <= timeEnd + 60
  })

  let totalVolume = 0
  let inRangeVolume = 0
  let buyVolume = 0
  let sellVolume = 0

  const bucketMap = new Map<number, number>()
  const bucketStep = heightPts > 0 ? Math.max(0.25, heightPts / 20) : 1

  for (const c of scopedCandles) {
    const vol = Math.max(0, c.volume > 0 ? c.volume : 1)
    totalVolume += vol

    const isUp = c.close >= c.open
    if (isUp) {
      buyVolume += vol
    } else {
      sellVolume += vol
    }

    // Calculate proportional price overlap
    const barSpan = Math.max(0.01, c.high - c.low)
    const overlapHi = Math.min(c.high, priceHigh)
    const overlapLo = Math.max(c.low, priceLow)
    const overlapSpan = Math.max(0, overlapHi - overlapLo)
    const overlapRatio = Math.min(1, overlapSpan / barSpan)

    inRangeVolume += vol * overlapRatio

    // Accumulate into price bucket for POC calculation
    const candleMid = (c.high + c.low + c.close) / 3
    const bucket = Math.round(candleMid / bucketStep) * bucketStep
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + vol)
  }

  // Find POC inside range
  let poc = midPrice
  let maxBucketVol = -1
  for (const [price, bVol] of bucketMap.entries()) {
    if (bVol > maxBucketVol) {
      maxBucketVol = bVol
      poc = Number(price.toFixed(2))
    }
  }

  const roundedTotal = Math.round(totalVolume)
  const roundedInRange = Math.round(inRangeVolume)
  const roundedBuy = Math.round(buyVolume)
  const roundedSell = Math.round(sellVolume)
  const delta = roundedBuy - roundedSell
  const buyRatioPct = roundedTotal > 0 ? Math.round((roundedBuy / roundedTotal) * 100) : 50
  const volumeRatePerMin = Number((roundedTotal / durationMin).toFixed(1))

  return {
    id,
    label,
    priceHigh,
    priceLow,
    midPrice,
    heightPts,
    timeStart,
    timeEnd,
    startTimeEt: formatEtTime(timeStart),
    endTimeEt: formatEtTime(timeEnd),
    durationMin,
    totalVolume: roundedTotal,
    inRangeVolume: roundedInRange,
    volumeRatePerMin,
    buyVolume: roundedBuy,
    sellVolume: roundedSell,
    delta,
    buyRatioPct,
    poc,
    candleCount: scopedCandles.length,
    priceRelation,
    positionPct: Math.round(positionPct),
  }
}

/**
 * Compares two ranges (typically Range A [earlier / baseline] vs Range B [later / retest])
 * and evaluates whether volume increased or decreased, predicting support/resistance quality.
 */
export function compareTwoRanges(
  rangeA: RangeVolumeData,
  rangeB: RangeVolumeData,
  _currentPrice?: number | null
): RangeComparisonResult {
  const volumeChangePts = rangeB.totalVolume - rangeA.totalVolume
  const volumeChangePct =
    rangeA.totalVolume > 0
      ? Number((((rangeB.totalVolume - rangeA.totalVolume) / rangeA.totalVolume) * 100).toFixed(1))
      : 0

  const volumeTrend: 'DECREASED' | 'INCREASED' | 'SIMILAR' =
    volumeChangePct <= -12 ? 'DECREASED' : volumeChangePct >= 12 ? 'INCREASED' : 'SIMILAR'

  const rateChangePct =
    rangeA.volumeRatePerMin > 0
      ? Number(
          (
            ((rangeB.volumeRatePerMin - rangeA.volumeRatePerMin) / rangeA.volumeRatePerMin) *
            100
          ).toFixed(1)
        )
      : 0

  const rateTrend: 'DECREASED' | 'INCREASED' | 'SIMILAR' =
    rateChangePct <= -12 ? 'DECREASED' : rateChangePct >= 12 ? 'INCREASED' : 'SIMILAR'

  const deltaShift = rangeB.delta - rangeA.delta
  const buyRatioShift = rangeB.buyRatioPct - rangeA.buyRatioPct

  let deltaTrend: RangeComparisonResult['deltaTrend'] = 'BALANCED'
  if (buyRatioShift >= 10 || (rangeB.delta > 0 && rangeA.delta <= 0)) {
    deltaTrend = 'BUYER_EXPANSION'
  } else if (buyRatioShift <= -10 || (rangeB.delta < 0 && rangeA.delta >= 0)) {
    deltaTrend = 'SELLER_EXPANSION'
  } else if (volumeTrend === 'DECREASED' && rangeB.buyRatioPct < rangeA.buyRatioPct) {
    deltaTrend = 'BUYER_EXHAUSTION'
  } else if (volumeTrend === 'DECREASED' && rangeB.buyRatioPct > rangeA.buyRatioPct) {
    deltaTrend = 'SELLER_EXHAUSTION'
  }

  const priceShift: 'HIGHER' | 'LOWER' | 'OVERLAPPING' =
    rangeB.priceLow > rangeA.priceHigh
      ? 'HIGHER'
      : rangeB.priceHigh < rangeA.priceLow
      ? 'LOWER'
      : 'OVERLAPPING'

  // ── Support Readiness Evaluation ──
  let supportReadiness: SupportReadiness
  if (volumeTrend === 'DECREASED') {
    // Low volume on test/pullback = supply exhaustion = GOOD SUPPORT
    supportReadiness = {
      classification: 'GOOD_SUPPORT',
      label: '🟢 GOOD SUPPORT (High Probability Hold)',
      reasoning: `Volume decreased by ${Math.abs(volumeChangePct).toFixed(1)}% (rate down ${Math.abs(rateChangePct).toFixed(1)}%). This signals supply exhaustion and an absence of aggressive selling. Sellers lack the inventory/conviction to break down through this floor.`,
      tacticalRead: `Favorable location for responsive long entries. As market rotates into this level, watch for bullish reversal candle (Bullish Engulfing / Hammer) or positive CVD tick. Place stop loss tightly below range low (${Math.min(rangeA.priceLow, rangeB.priceLow).toLocaleString()}).`,
    }
  } else if (volumeTrend === 'INCREASED' && rangeB.buyRatioPct >= 52) {
    // High volume absorbed by buyers = ACCUMULATION SUPPORT
    supportReadiness = {
      classification: 'ACCUMULATION_SUPPORT',
      label: '🛡️ STRONG ACCUMULATION SUPPORT (Institutional Wall)',
      reasoning: `Volume expanded by +${volumeChangePct.toFixed(1)}% with buyer dominance (${rangeB.buyRatioPct}% buy ratio, delta +${rangeB.delta.toLocaleString()}). Passive institutional bids absorbed market selling at this support zone.`,
      tacticalRead: `High-conviction support floor. Institutional participation is active. Enter longs on confirmation with protected stop below the accumulation base (${Math.min(rangeA.priceLow, rangeB.priceLow).toLocaleString()}).`,
    }
  } else if (volumeTrend === 'INCREASED' && rangeB.buyRatioPct < 48) {
    // High volume with seller dominance = BAD SUPPORT / BREAKDOWN IMMINENT
    supportReadiness = {
      classification: 'BAD_SUPPORT',
      label: '🔴 BAD / VULNERABLE SUPPORT (Breakdown Threat)',
      reasoning: `Volume surged by +${volumeChangePct.toFixed(1)}% on heavy aggressive selling (${100 - rangeB.buyRatioPct}% sell pressure, delta ${rangeB.delta.toLocaleString()}). Aggressive institutional sellers are driving downward into the level.`,
      tacticalRead: `Do NOT blindly buy or catch the falling knife. The support is fragile and at high risk of giving way. Stand aside or prepare for a breakdown short if price accepts below ${Math.min(rangeA.priceLow, rangeB.priceLow).toLocaleString()}.`,
    }
  } else {
    // Similar / Neutral
    supportReadiness = {
      classification: 'NEUTRAL',
      label: '⚪ NEUTRAL SUPPORT (Wait for Candle / CVD Confirmation)',
      reasoning: `Volume between the ranges is balanced (${volumeChangePct >= 0 ? '+' : ''}${volumeChangePct.toFixed(1)}%). Neither supply exhaustion nor aggressive distribution is dominant yet.`,
      tacticalRead: `Require confirmed candlestick signal (Bullish Engulfing) and positive CVD turn before initiating longs at this support.`,
    }
  }

  // ── Resistance Readiness Evaluation ──
  let resistanceReadiness: ResistanceReadiness
  if (volumeTrend === 'DECREASED') {
    // Decreased volume into highs/overhead = buyer exhaustion = GOOD RESISTANCE
    resistanceReadiness = {
      classification: 'GOOD_RESISTANCE',
      label: '🟢 GOOD RESISTANCE (Strong Rejection Ceiling)',
      reasoning: `Volume decreased by ${Math.abs(volumeChangePct).toFixed(1)}% (rate down ${Math.abs(rateChangePct).toFixed(1)}%) as price explored higher levels. This demonstrates buyer exhaustion and lack of demand at premium prices. Price cannot facilitate trade higher without volume.`,
      tacticalRead: `High-probability ceiling for responsive short entries or locking in long profits. Look for rejection wicks (Shooting Star / Bearish Engulfing). Stop loss placed tightly above range high (${Math.max(rangeA.priceHigh, rangeB.priceHigh).toLocaleString()}).`,
    }
  } else if (volumeTrend === 'INCREASED' && rangeB.buyRatioPct <= 48) {
    // High volume absorbed by sellers = DISTRIBUTION RESISTANCE
    resistanceReadiness = {
      classification: 'DISTRIBUTION_RESISTANCE',
      label: '🛡️ STRONG DISTRIBUTION RESISTANCE (Institutional Wall)',
      reasoning: `Volume increased by +${volumeChangePct.toFixed(1)}% with heavy seller absorption (${100 - rangeB.buyRatioPct}% sell pressure, delta ${rangeB.delta.toLocaleString()}). Large institutional sellers capped the rally with overhead limit supply.`,
      tacticalRead: `Strong overhead supply shelf. Enter shorts on retest rejection with stop loss placed above the distribution high (${Math.max(rangeA.priceHigh, rangeB.priceHigh).toLocaleString()}).`,
    }
  } else if (volumeTrend === 'INCREASED' && rangeB.buyRatioPct > 52) {
    // High volume with buyer dominance = BAD RESISTANCE / BREAKOUT IMMINENT
    resistanceReadiness = {
      classification: 'BAD_RESISTANCE',
      label: '🔴 BAD / VULNERABLE RESISTANCE (Breakout Threat)',
      reasoning: `Volume surged by +${volumeChangePct.toFixed(1)}% with aggressive buyer initiative (${rangeB.buyRatioPct}% buy ratio, delta +${rangeB.delta.toLocaleString()}). Buyers are actively absorbing and chewing through overhead limit offers.`,
      tacticalRead: `Do NOT short into this momentum. Overhead resistance is weak and likely to blow out. Stand aside or trade the confirmed breakout long above ${Math.max(rangeA.priceHigh, rangeB.priceHigh).toLocaleString()}.`,
    }
  } else {
    // Similar / Neutral
    resistanceReadiness = {
      classification: 'NEUTRAL',
      label: '⚪ NEUTRAL RESISTANCE (Wait for Order Flow Confirmation)',
      reasoning: `Volume between ranges is relatively unchanged (${volumeChangePct >= 0 ? '+' : ''}${volumeChangePct.toFixed(1)}%). Two-way auction equilibrium is intact.`,
      tacticalRead: `Watch order flow CVD at the boundary. Only short if CVD shows clear bearish exhaustion or absorption divergence.`,
    }
  }

  const summary = `${rangeA.label} vs ${rangeB.label}: Volume ${volumeTrend} (${volumeChangePct >= 0 ? '+' : ''}${volumeChangePct.toFixed(1)}% | ${rangeA.totalVolume.toLocaleString()} → ${rangeB.totalVolume.toLocaleString()} contracts). Support verdict: ${supportReadiness.classification}. Resistance verdict: ${resistanceReadiness.classification}.`

  return {
    rangeA,
    rangeB,
    volumeChangePts,
    volumeChangePct,
    volumeTrend,
    volumeRateChangePct: rateChangePct,
    rateTrend,
    deltaShift,
    deltaTrend,
    priceShift,
    supportReadiness,
    resistanceReadiness,
    summary,
  }
}

/**
 * Compares an array of ranges pairwise (chronologically or by user selection).
 */
export function compareMultipleRanges(
  ranges: RangeVolumeData[],
  currentPrice?: number | null
): RangeComparisonResult[] {
  if (ranges.length < 2) return []

  // Sort ranges chronologically by timeStart
  const sorted = [...ranges].sort((a, b) => a.timeStart - b.timeStart)
  const results: RangeComparisonResult[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const rA = sorted[i]!
    const rB = sorted[i + 1]!
    results.push(compareTwoRanges(rA, rB, currentPrice))
  }

  // If there are exactly 2 ranges or more than 2, also compare the first vs the latest
  if (sorted.length > 2) {
    results.push(compareTwoRanges(sorted[0]!, sorted[sorted.length - 1]!, currentPrice))
  }

  return results
}

/**
 * Formats a clean, high-signal institutional markdown report of range volume comparisons
 * for Leo's system prompt or interactive response.
 */
export function formatRangeVolumeComparisonReport(comparisons: RangeComparisonResult[]): string {
  if (comparisons.length === 0) return 'No range comparisons available.'

  return comparisons
    .map((c, idx) => {
      const volSign = c.volumeChangePct >= 0 ? '+' : ''
      const rateSign = c.volumeRateChangePct >= 0 ? '+' : ''
      const deltaSign = c.rangeB.delta >= 0 ? '+' : ''

      return `### 📊 Range Comparison #${idx + 1}: ${c.rangeA.label} vs. ${c.rangeB.label}

**1. Volume & Velocity Delta:**
- **${c.rangeA.label}:** ${c.rangeA.totalVolume.toLocaleString()} contracts (${c.rangeA.volumeRatePerMin} vol/min, ${c.rangeA.durationMin}m duration, ${c.rangeA.buyRatioPct}% buy, delta ${c.rangeA.delta >= 0 ? '+' : ''}${c.rangeA.delta.toLocaleString()})
- **${c.rangeB.label}:** ${c.rangeB.totalVolume.toLocaleString()} contracts (${c.rangeB.volumeRatePerMin} vol/min, ${c.rangeB.durationMin}m duration, ${c.rangeB.buyRatioPct}% buy, delta ${deltaSign}${c.rangeB.delta.toLocaleString()})
- **Volume Change:** **${c.volumeTrend} by ${volSign}${c.volumeChangePct}%** (${c.volumeChangePts >= 0 ? '+' : ''}${c.volumeChangePts.toLocaleString()} contracts)
- **Velocity Rate Change:** **${rateSign}${c.volumeRateChangePct}% per minute**
- **Delta Shift:** **${c.deltaTrend.replace('_', ' ')}** (Buy ratio shifted from ${c.rangeA.buyRatioPct}% to ${c.rangeB.buyRatioPct}%)

**2. Support Readiness Assessment:**
- **Status:** **${c.supportReadiness.label}**
- **Auction Mechanics:** ${c.supportReadiness.reasoning}
- **Desk Execution Read:** ${c.supportReadiness.tacticalRead}

**3. Resistance Readiness Assessment:**
- **Status:** **${c.resistanceReadiness.label}**
- **Auction Mechanics:** ${c.resistanceReadiness.reasoning}
- **Desk Execution Read:** ${c.resistanceReadiness.tacticalRead}`
    })
    .join('\n\n---\n\n')
}
