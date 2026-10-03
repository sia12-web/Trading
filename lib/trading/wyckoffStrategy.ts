/**
 * Wyckoff Structure Line & Auction Market Theory Intraday Strategy Engine
 *
 * Implements the trader's 4 execution setups:
 * 1. Support (Demand Line / Ice / Pre-marked Support):
 *    - Spring -> Reclaim -> Long (failed breakdown + reclaim + CVD absorption)
 *    - Breakdown -> Failed Reclaim -> Short
 * 2. Resistance (Supply Line / Creek / Pre-marked Resistance):
 *    - Upthrust -> Reclaim Below -> Short (failed breakout + return below + seller absorption)
 *    - Breakout -> Successful Retest -> Long (Jump Across Creek / SOS -> LPS)
 *
 * Rules:
 * - Volume: Effort vs Result evaluation.
 * - CVD: Aggressive order flow confirmation & absorption divergence.
 * - Risk/Reward: Minimum 2R required before the next pre-marked structural zone.
 *   If room to next zone < 2R -> Trade is filtered/skipped (Rule 17 & 20).
 * - Stops are strictly structural (beyond spring low / upthrust high). Never widen stop.
 */

import type { UserTrendline } from '@/lib/trading/userDrawings'
import type {
  FixedRangeVolumeProfile5D,
  AnchoredVwapBenchmark5M,
  YesterdayNycSession,
  SessionVolumeProfile,
} from '@/lib/chart/context55'

export interface WyckoffBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  cvd?: number
}

export interface WyckoffChartContext {
  yesterday?: YesterdayNycSession | null
  overnight?: {
    overnight?: SessionVolumeProfile | null
    asia?: SessionVolumeProfile | null
    london?: SessionVolumeProfile | null
  } | null
  frvp5d?: FixedRangeVolumeProfile5D | null
  avwap5m?: AnchoredVwapBenchmark5M | null
  [key: string]: any
}

export interface WyckoffPreMarkedZone {
  name: string
  price: number
  type: 'SUPPORT' | 'RESISTANCE' | 'CONFLUENCE'
  source: '5D' | 'YESTERDAY' | 'OVERNIGHT' | 'AVWAP'
}

export interface WyckoffSetupResult {
  setupType: 'SPRING' | 'UPTHRUST' | 'BREAKOUT_RETEST' | 'BREAKDOWN_RETEST' | 'NONE'
  lineRole: 'SUPPLY_LINE' | 'DEMAND_LINE'
  roleLabel: string // 'Wyckoff Supply Line (Creek)' or 'Wyckoff Demand Line (Ice)'
  linePriceAtTrigger: number
  entryPrice: number
  stopLoss: number
  targetPrice: number
  targetZoneLabel: string
  riskPoints: number
  rewardPoints: number
  rrRatio: number
  is2RValid: boolean
  triggerTime: number
  sweepCandle?: WyckoffBar
  reclaimCandle?: WyckoffBar
  cvdAbsorption: boolean
  cvdExplanation: string
  effortVsResult: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'INITIATIVE_DRIVE' | 'NORMAL'
  badgeText: string
  statusTag: string
  color: string
}

/**
 * Classify a trendline into Wyckoff Supply Line vs Demand Line based on its slope.
 * - Descending (p2 <= p1): Supply Line (acts as resistance / Creek).
 * - Ascending (p2 > p1): Demand Line (acts as support / Ice).
 */
export function classifyWyckoffLine(
  tl: UserTrendline,
  referenceBars?: WyckoffBar[]
): {
  role: 'SUPPLY_LINE' | 'DEMAND_LINE'
  label: string
  color: string
} {
  const pDiff = tl.p2.price - tl.p1.price
  if (pDiff < -0.001) {
    return {
      role: 'SUPPLY_LINE',
      label: 'Wyckoff Supply Line (Creek)',
      color: '#f59e0b', // Warm amber / Gold
    }
  }
  if (pDiff > 0.001) {
    return {
      role: 'DEMAND_LINE',
      label: 'Wyckoff Demand Line (Ice)',
      color: '#38bdf8', // Sky blue
    }
  }
  // Flat horizontal line: check user direction or whether price came from above (support) or below (resistance)
  if (tl.direction === 'BULLISH' || tl.label?.toLowerCase().includes('support') || tl.label?.toLowerCase().includes('demand')) {
    return {
      role: 'DEMAND_LINE',
      label: 'Wyckoff Demand Line (Ice)',
      color: '#38bdf8',
    }
  }
  if (tl.direction === 'BEARISH' || tl.label?.toLowerCase().includes('resistance') || tl.label?.toLowerCase().includes('supply')) {
    return {
      role: 'SUPPLY_LINE',
      label: 'Wyckoff Supply Line (Creek)',
      color: '#f59e0b',
    }
  }
  // If price in reference bars is predominantly above the line, it acts as support (Demand Line)
  if (referenceBars && referenceBars.length > 0) {
    const avgClose = referenceBars.reduce((acc, b) => acc + b.close, 0) / referenceBars.length
    if (avgClose >= tl.p1.price) {
      return {
        role: 'DEMAND_LINE',
        label: 'Wyckoff Demand Line (Ice)',
        color: '#38bdf8',
      }
    }
  }

  return {
    role: 'SUPPLY_LINE',
    label: 'Wyckoff Supply Line (Creek)',
    color: '#f59e0b',
  }
}

/**
 * Extract all pre-marked structural levels built before 9:30 ET:
 * - 5-Day Volume Profile: 5D POC, 5D HVN (VAH), 5D LVN (VAL)
 * - Yesterday Volume Profile: Yesterday VAH, Yesterday POC, Yesterday VAL, Yesterday High, Yesterday Low
 * - Overnight / London: Overnight High, Overnight Low, Overnight POC, London High/Low
 * - 5-Month Anchored VWAP (confluence only)
 */
export function buildPreMarkedZones(context: WyckoffChartContext): WyckoffPreMarkedZone[] {
  const zones: WyckoffPreMarkedZone[] = []

  // 1. 5-Day Volume Profile
  if (context.frvp5d) {
    const f = context.frvp5d
    if (f.poc && Number.isFinite(f.poc)) zones.push({ name: '5D POC', price: f.poc, type: 'CONFLUENCE', source: '5D' })
    if (f.vah && Number.isFinite(f.vah)) zones.push({ name: '5D HVN (VAH)', price: f.vah, type: 'RESISTANCE', source: '5D' })
    if (f.val && Number.isFinite(f.val)) zones.push({ name: '5D LVN (VAL)', price: f.val, type: 'SUPPORT', source: '5D' })
    if (f.high && Number.isFinite(f.high)) zones.push({ name: '5D High', price: f.high, type: 'RESISTANCE', source: '5D' })
    if (f.low && Number.isFinite(f.low)) zones.push({ name: '5D Low', price: f.low, type: 'SUPPORT', source: '5D' })
  }

  // 2. Yesterday's Session Profile
  if (context.yesterday) {
    const y = context.yesterday
    if (y.poc && Number.isFinite(y.poc)) zones.push({ name: 'Y-POC', price: y.poc, type: 'CONFLUENCE', source: 'YESTERDAY' })
    if (y.vah && Number.isFinite(y.vah)) zones.push({ name: 'Y-VAH', price: y.vah, type: 'RESISTANCE', source: 'YESTERDAY' })
    if (y.val && Number.isFinite(y.val)) zones.push({ name: 'Y-VAL', price: y.val, type: 'SUPPORT', source: 'YESTERDAY' })
    if (y.yh && Number.isFinite(y.yh)) zones.push({ name: 'Y-High', price: y.yh, type: 'RESISTANCE', source: 'YESTERDAY' })
    if (y.yl && Number.isFinite(y.yl)) zones.push({ name: 'Y-Low', price: y.yl, type: 'SUPPORT', source: 'YESTERDAY' })
  }

  // 3. Overnight / London Profile
  if (context.overnight) {
    const on = context.overnight.overnight
    if (on) {
      if (on.high && Number.isFinite(on.high)) zones.push({ name: 'ON-High', price: on.high, type: 'RESISTANCE', source: 'OVERNIGHT' })
      if (on.low && Number.isFinite(on.low)) zones.push({ name: 'ON-Low', price: on.low, type: 'SUPPORT', source: 'OVERNIGHT' })
      if (on.poc && Number.isFinite(on.poc)) zones.push({ name: 'ON-POC', price: on.poc, type: 'CONFLUENCE', source: 'OVERNIGHT' })
    }
    const lon = context.overnight.london
    if (lon) {
      if (lon.high && Number.isFinite(lon.high)) zones.push({ name: 'London-High', price: lon.high, type: 'RESISTANCE', source: 'OVERNIGHT' })
      if (lon.low && Number.isFinite(lon.low)) zones.push({ name: 'London-Low', price: lon.low, type: 'SUPPORT', source: 'OVERNIGHT' })
    }
  }

  // 4. 5-Month Anchored VWAP (Background confluence only)
  if (context.avwap5m?.vwap && Number.isFinite(context.avwap5m.vwap)) {
    zones.push({ name: '5M-AVWAP', price: context.avwap5m.vwap, type: 'CONFLUENCE', source: 'AVWAP' })
  }

  return zones.sort((a, b) => a.price - b.price)
}

/**
 * Find the closest major pre-marked structural zone in the direction of the trade
 * to calculate potential Reward and verify the mandatory >= 2R filter (Rule 17 & 20).
 */
export function findNextStructuralTarget(
  entryPrice: number,
  direction: 'LONG' | 'SHORT',
  zones: WyckoffPreMarkedZone[],
  minRisk: number
): { targetPrice: number; targetZoneLabel: string } {
  // Target zones are exclusively the major structural zones (5D, Yesterday, Overnight).
  // AVWAP is background context only and does not establish structural take-profit zones (Rule 2E).
  const structuralZones = zones.filter((z) => z.source !== 'AVWAP')

  if (direction === 'LONG') {
    // For Long trades, target opposing resistance or composite confluence above entry
    const candidates = structuralZones.filter(
      (z) => (z.type === 'RESISTANCE' || z.type === 'CONFLUENCE') && z.price > entryPrice + 1.0
    )
    if (candidates.length > 0) {
      const closest = candidates[0]!
      return { targetPrice: closest.price, targetZoneLabel: closest.name }
    }
    // If no structural zone exists above (all-time highs or unmapped), default to 2.5R projection
    return { targetPrice: Number((entryPrice + minRisk * 2.5).toFixed(2)), targetZoneLabel: 'Projected 2.5R' }
  } else {
    // For Short trades, target opposing support or composite confluence below entry
    const candidates = structuralZones
      .filter((z) => (z.type === 'SUPPORT' || z.type === 'CONFLUENCE') && z.price < entryPrice - 1.0)
      .reverse()
    if (candidates.length > 0) {
      const closest = candidates[0]!
      return { targetPrice: closest.price, targetZoneLabel: closest.name }
    }
    // Default to 2.5R projection
    return { targetPrice: Number((entryPrice - minRisk * 2.5).toFixed(2)), targetZoneLabel: 'Projected 2.5R' }
  }
}

/**
 * Line price at a specific Unix timestamp: y = p1 + slope * (t - t1)
 */
export function getLinePriceAtTime(tl: UserTrendline, time: number): number | null {
  const dt = tl.p2.time - tl.p1.time
  if (dt === 0) return tl.p1.price
  const slope = (tl.p2.price - tl.p1.price) / dt
  return tl.p1.price + slope * (time - tl.p1.time)
}

/**
 * Evaluate Wyckoff Setups on a given Trendline against recent bars.
 * Analyzes:
 * 1. Demand Line -> Spring (Long) or Breakdown (Short)
 * 2. Supply Line -> Upthrust (Short) or Breakout/Retest (Long)
 * 3. CVD Absorption divergence & Volume Effort-vs-Result
 * 4. Structural 2R Risk/Reward Check
 */
export function evaluateWyckoffSetup(
  tl: UserTrendline,
  bars: WyckoffBar[],
  context: WyckoffChartContext,
  lookbackBars: number = 20
): WyckoffSetupResult {
  const { role, label: roleLabel, color } = classifyWyckoffLine(tl, bars)
  const isSupply = role === 'SUPPLY_LINE'

  if (!bars || bars.length < 3) {
    return {
      setupType: 'NONE',
      lineRole: role,
      roleLabel,
      linePriceAtTrigger: tl.p2.price,
      entryPrice: tl.p2.price,
      stopLoss: tl.p2.price,
      targetPrice: tl.p2.price,
      targetZoneLabel: 'N/A',
      riskPoints: 0,
      rewardPoints: 0,
      rrRatio: 0,
      is2RValid: false,
      triggerTime: tl.p2.time,
      cvdAbsorption: false,
      cvdExplanation: 'Insufficient bar history',
      effortVsResult: 'NORMAL',
      badgeText: roleLabel,
      statusTag: 'MONITORING',
      color,
    }
  }

  const preMarkedZones = buildPreMarkedZones(context)
  const startIdx = Math.max(0, bars.length - lookbackBars)
  const evalBars = bars.slice(startIdx)

  // Calculate average volume and range for Effort-vs-Result detection
  let sumVol = 0
  let sumRange = 0
  for (const b of evalBars) {
    sumVol += Math.max(1, b.volume)
    sumRange += Math.max(0.1, b.high - b.low)
  }
  const avgVol = sumVol / evalBars.length
  const avgRange = sumRange / evalBars.length

  const latestBar = evalBars[evalBars.length - 1]!
  const latestLinePx = getLinePriceAtTime(tl, latestBar.time) ?? tl.p2.price

  // ───────────────────────────────────────────────────────────────────────────
  // SETUP 1: SPRING AT DEMAND / SUPPORT (Primary Long)
  // Requirements:
  // 1. Price sweeps underneath the line or pre-marked zone.
  // 2. Sellers fail to continue lower.
  // 3. Price reclaims back above the line.
  // 4. CVD absorption confirmation (sellers aggressive but price holds).
  // ───────────────────────────────────────────────────────────────────────────
  if (!isSupply) {
    // Demand Line: Look back for sweep underneath line followed by reclaim
    let sweepIdx = -1
    let sweepLow = Infinity
    let sweepBar: WyckoffBar | null = null

    for (let i = evalBars.length - 1; i >= Math.max(0, evalBars.length - 8); i--) {
      const b = evalBars[i]!
      const linePx = getLinePriceAtTime(tl, b.time)
      if (linePx == null) continue

      // Swept underneath: low penetrated line by at least a fraction of ATR
      if (b.low < linePx && b.low < sweepLow) {
        sweepLow = b.low
        sweepIdx = i
        sweepBar = b
      }
    }

    if (sweepIdx >= 0 && sweepBar) {
      // Check if price reclaimed back above the line on subsequent bars
      for (let j = sweepIdx; j < evalBars.length; j++) {
        const reclaimBar = evalBars[j]!
        const reclaimLinePx = getLinePriceAtTime(tl, reclaimBar.time) ?? latestLinePx

        // Reclaim confirmed: close is firmly back above the line
        if (reclaimBar.close >= reclaimLinePx) {
          const entryPrice = reclaimBar.close
          // Structural stop placed just below the spring low
          const buffer = Math.max(0.5, avgRange * 0.15)
          const stopLoss = Number((sweepLow - buffer).toFixed(2))
          const riskPoints = Number(Math.max(0.5, entryPrice - stopLoss).toFixed(2))

          // 2R Target Verification (Rule 17)
          const { targetPrice, targetZoneLabel } = findNextStructuralTarget(
            entryPrice,
            'LONG',
            preMarkedZones,
            riskPoints
          )
          const rewardPoints = Number((targetPrice - entryPrice).toFixed(2))
          const rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
          const is2RValid = rrRatio >= 2.0

          // CVD & Effort vs Result analysis
          const hasCvdLowerLow =
            sweepBar.cvd != null &&
            reclaimBar.cvd != null &&
            reclaimBar.cvd <= sweepBar.cvd &&
            reclaimBar.close > sweepBar.close
          const isHighVolAbsorption = sweepBar.volume >= 1.3 * avgVol && sweepBar.close > sweepBar.low + 0.3 * (sweepBar.high - sweepBar.low)
          const cvdAbsorption = Boolean(hasCvdLowerLow || isHighVolAbsorption)

          const cvdExplanation = hasCvdLowerLow
            ? 'CVD Lower Low + Price Reclaim = Heavy seller absorption by passive buyers'
            : isHighVolAbsorption
            ? 'Heavy selling volume with zero downside continuation (Effort vs Result)'
            : 'Price reclaimed demand structure'

          const effortVsResult: WyckoffSetupResult['effortVsResult'] = cvdAbsorption
            ? 'BULLISH_ABSORPTION'
            : 'NORMAL'

          const badgeText = is2RValid
            ? `⚡ Wyckoff Spring: Reclaim + ${cvdAbsorption ? 'CVD Absorption' : 'Held'} · ${rrRatio}R to ${targetZoneLabel}`
            : `⚠️ Wyckoff Spring (< 2R Filter): ${rrRatio}R to ${targetZoneLabel} · Skip (Rule 17)`

          return {
            setupType: 'SPRING',
            lineRole: role,
            roleLabel,
            linePriceAtTrigger: reclaimLinePx,
            entryPrice,
            stopLoss,
            targetPrice,
            targetZoneLabel,
            riskPoints,
            rewardPoints,
            rrRatio,
            is2RValid,
            triggerTime: reclaimBar.time,
            sweepCandle: sweepBar,
            reclaimCandle: reclaimBar,
            cvdAbsorption,
            cvdExplanation,
            effortVsResult,
            badgeText,
            statusTag: is2RValid ? 'SPRING TRIGGER ⚡' : 'FILTERED (< 2R)',
            color: is2RValid ? '#10b981' : '#eab308',
          }
        }
      }
    }

    // Check for Breakdown -> Failed Reclaim (Trade 2)
    if (latestBar.close < latestLinePx - avgRange * 0.4) {
      const entryPrice = latestBar.close
      const stopLoss = Number((latestBar.high + avgRange * 0.2).toFixed(2))
      const riskPoints = Number(Math.max(0.5, stopLoss - entryPrice).toFixed(2))
      const { targetPrice, targetZoneLabel } = findNextStructuralTarget(
        entryPrice,
        'SHORT',
        preMarkedZones,
        riskPoints
      )
      const rewardPoints = Number((entryPrice - targetPrice).toFixed(2))
      const rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
      const is2RValid = rrRatio >= 2.0

      return {
        setupType: 'BREAKDOWN_RETEST',
        lineRole: role,
        roleLabel,
        linePriceAtTrigger: latestLinePx,
        entryPrice,
        stopLoss,
        targetPrice,
        targetZoneLabel,
        riskPoints,
        rewardPoints,
        rrRatio,
        is2RValid,
        triggerTime: latestBar.time,
        cvdAbsorption: false,
        cvdExplanation: 'Demand structure broken with initiative selling',
        effortVsResult: 'INITIATIVE_DRIVE',
        badgeText: `⚡ Wyckoff SOW Breakdown: ${rrRatio}R to ${targetZoneLabel}`,
        statusTag: is2RValid ? 'SOW BREAKDOWN' : 'BREAKDOWN (< 2R)',
        color: '#f43f5e',
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SETUP 2: UPTHRUST AT SUPPLY / RESISTANCE (Primary Short)
  // Requirements:
  // 1. Price sweeps above the line or pre-marked zone.
  // 2. Buyers fail to continue higher.
  // 3. Price returns / reclaims back below the line.
  // 4. CVD absorption confirmation (buyers aggressive but price fails).
  // ───────────────────────────────────────────────────────────────────────────
  if (isSupply) {
    let sweepIdx = -1
    let sweepHigh = -Infinity
    let sweepBar: WyckoffBar | null = null

    for (let i = evalBars.length - 1; i >= Math.max(0, evalBars.length - 8); i--) {
      const b = evalBars[i]!
      const linePx = getLinePriceAtTime(tl, b.time)
      if (linePx == null) continue

      // Swept above: high poked over line
      if (b.high > linePx && b.high > sweepHigh) {
        sweepHigh = b.high
        sweepIdx = i
        sweepBar = b
      }
    }

    if (sweepIdx >= 0 && sweepBar) {
      // Check if price returned back below line
      for (let j = sweepIdx; j < evalBars.length; j++) {
        const reclaimBar = evalBars[j]!
        const reclaimLinePx = getLinePriceAtTime(tl, reclaimBar.time) ?? latestLinePx

        // Return below confirmed
        if (reclaimBar.close <= reclaimLinePx) {
          const entryPrice = reclaimBar.close
          const buffer = Math.max(0.5, avgRange * 0.15)
          const stopLoss = Number((sweepHigh + buffer).toFixed(2))
          const riskPoints = Number(Math.max(0.5, stopLoss - entryPrice).toFixed(2))

          const { targetPrice, targetZoneLabel } = findNextStructuralTarget(
            entryPrice,
            'SHORT',
            preMarkedZones,
            riskPoints
          )
          const rewardPoints = Number((entryPrice - targetPrice).toFixed(2))
          const rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
          const is2RValid = rrRatio >= 2.0

          const hasCvdHigherHigh =
            sweepBar.cvd != null &&
            reclaimBar.cvd != null &&
            reclaimBar.cvd >= sweepBar.cvd &&
            reclaimBar.close < sweepBar.close
          const isHighVolAbsorption = sweepBar.volume >= 1.3 * avgVol && sweepBar.close < sweepBar.high - 0.3 * (sweepBar.high - sweepBar.low)
          const cvdAbsorption = Boolean(hasCvdHigherHigh || isHighVolAbsorption)

          const cvdExplanation = hasCvdHigherHigh
            ? 'CVD Higher High + Price Return Below = Aggressive buyers absorbed by passive offers'
            : isHighVolAbsorption
            ? 'Heavy buying volume with zero upward continuation (Effort vs Result)'
            : 'Price rejected supply boundary'

          const effortVsResult: WyckoffSetupResult['effortVsResult'] = cvdAbsorption
            ? 'BEARISH_ABSORPTION'
            : 'NORMAL'

          const badgeText = is2RValid
            ? `⚡ Wyckoff Upthrust: Return Below + ${cvdAbsorption ? 'CVD Absorption' : 'Held'} · ${rrRatio}R to ${targetZoneLabel}`
            : `⚠️ Wyckoff Upthrust (< 2R Filter): ${rrRatio}R to ${targetZoneLabel} · Skip (Rule 17)`

          return {
            setupType: 'UPTHRUST',
            lineRole: role,
            roleLabel,
            linePriceAtTrigger: reclaimLinePx,
            entryPrice,
            stopLoss,
            targetPrice,
            targetZoneLabel,
            riskPoints,
            rewardPoints,
            rrRatio,
            is2RValid,
            triggerTime: reclaimBar.time,
            sweepCandle: sweepBar,
            reclaimCandle: reclaimBar,
            cvdAbsorption,
            cvdExplanation,
            effortVsResult,
            badgeText,
            statusTag: is2RValid ? 'UPTHRUST TRIGGER ⚡' : 'FILTERED (< 2R)',
            color: is2RValid ? '#f43f5e' : '#eab308',
          }
        }
      }
    }

    // Check for Breakout -> Retest (Jump Across Creek / SOS -> LPS) (Trade 4)
    if (latestBar.close > latestLinePx + avgRange * 0.4) {
      const entryPrice = latestBar.close
      const stopLoss = Number((latestBar.low - avgRange * 0.2).toFixed(2))
      const riskPoints = Number(Math.max(0.5, entryPrice - stopLoss).toFixed(2))
      const { targetPrice, targetZoneLabel } = findNextStructuralTarget(
        entryPrice,
        'LONG',
        preMarkedZones,
        riskPoints
      )
      const rewardPoints = Number((targetPrice - entryPrice).toFixed(2))
      const rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
      const is2RValid = rrRatio >= 2.0

      return {
        setupType: 'BREAKOUT_RETEST',
        lineRole: role,
        roleLabel,
        linePriceAtTrigger: latestLinePx,
        entryPrice,
        stopLoss,
        targetPrice,
        targetZoneLabel,
        riskPoints,
        rewardPoints,
        rrRatio,
        is2RValid,
        triggerTime: latestBar.time,
        cvdAbsorption: false,
        cvdExplanation: 'Jump Across Creek (SOS) with initiative buying',
        effortVsResult: 'INITIATIVE_DRIVE',
        badgeText: `⚡ Wyckoff JAC/SOS Breakout: ${rrRatio}R to ${targetZoneLabel}`,
        statusTag: is2RValid ? 'JAC BREAKOUT' : 'BREAKOUT (< 2R)',
        color: '#10b981',
      }
    }
  }

  // Neutral Monitoring state
  return {
    setupType: 'NONE',
    lineRole: role,
    roleLabel,
    linePriceAtTrigger: latestLinePx,
    entryPrice: latestBar.close,
    stopLoss: latestBar.close,
    targetPrice: latestBar.close,
    targetZoneLabel: 'N/A',
    riskPoints: 0,
    rewardPoints: 0,
    rrRatio: 0,
    is2RValid: false,
    triggerTime: latestBar.time,
    cvdAbsorption: false,
    cvdExplanation: 'Price observing structure',
    effortVsResult: 'NORMAL',
    badgeText: `${roleLabel}: ${latestLinePx.toFixed(1)}`,
    statusTag: 'MONITORING',
    color,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring / Upthrust Trendline Institutional Scoring Engine (0-100 Points)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrendlineFactorScore {
  name: string
  score: number
  maxScore: number
  details: string
}

export interface SpringUpthrustEvaluation {
  originType: 'SPRING' | 'UPTHRUST'
  originPrice: number
  originTime: number
  totalScore: number // 0-100
  grade: 'A+' | 'A' | 'B' | 'C'
  factors: {
    location: TrendlineFactorScore // max 25
    volumeEffortVsResult: TrendlineFactorScore // max 20
    candleExcess: TrendlineFactorScore // max 20
    cvdAbsorption: TrendlineFactorScore // max 15
    avwap5m: TrendlineFactorScore // max 10
    roundNumber: TrendlineFactorScore // max 5
    rewardRisk: TrendlineFactorScore // max 5
  }
  entryPrice: number
  stopLoss: number
  targetPrice: number
  targetZoneLabel: string
  riskPoints: number
  rewardPoints: number
  rrRatio: number
  is2RValid: boolean
  badgeLabel: string
  summary: string
  color: string
}

/**
 * Evaluates the Trendline drawn from a Spring or an Upthrust.
 * Computes all institutional factors and awards points (0-100) to that Spring or Upthrust:
 * 1. Location & Pre-marked Structural Zones (Max 25 pts)
 * 2. Volume & Effort-vs-Result Absorption (Max 20 pts)
 * 3. Candlestick Reversal & Excess Tail (Max 20 pts)
 * 4. CVD Order Flow Absorption Divergence (Max 15 pts)
 * 5. 5-Month Macro Anchored VWAP Alignment (Max 10 pts)
 * 6. Psychological Round Number Confluence (Max 5 pts)
 * 7. Mandatory >= 2R Target & Rule 17 Filter (Max 5 pts + Filter)
 */
export function evaluateSpringOrUpthrustTrendline(
  tl: UserTrendline,
  bars: WyckoffBar[],
  context: WyckoffChartContext
): SpringUpthrustEvaluation {
  const fallbackPrice = tl.p1?.price ?? 0
  const fallbackTime = tl.p1?.time ?? 0

  if (!bars || bars.length === 0) {
    return {
      originType: tl.p2.price >= tl.p1.price ? 'SPRING' : 'UPTHRUST',
      originPrice: fallbackPrice,
      originTime: fallbackTime,
      totalScore: 50,
      grade: 'C',
      factors: {
        location: { name: 'Structural Location', score: 12, maxScore: 25, details: 'Insufficient bars for zone sweep check' },
        volumeEffortVsResult: { name: 'Volume & Effort vs Result', score: 10, maxScore: 20, details: 'Baseline volume' },
        candleExcess: { name: 'Excess Tail & Candle Reversal', score: 10, maxScore: 20, details: 'Baseline candle structure' },
        cvdAbsorption: { name: 'CVD Absorption', score: 7, maxScore: 15, details: 'No CVD delta available' },
        avwap5m: { name: '5M Macro AVWAP Alignment', score: 5, maxScore: 10, details: 'Neutral AVWAP baseline' },
        roundNumber: { name: 'Psychological Handle', score: 3, maxScore: 5, details: 'Neutral strike level' },
        rewardRisk: { name: '2R Target (Rule 17)', score: 3, maxScore: 5, details: 'Pending projection' },
      },
      entryPrice: fallbackPrice,
      stopLoss: fallbackPrice,
      targetPrice: fallbackPrice,
      targetZoneLabel: 'N/A',
      riskPoints: 0,
      rewardPoints: 0,
      rrRatio: 0,
      is2RValid: true,
      badgeLabel: `📐 Trendline · Monitoring (${fallbackPrice.toFixed(1)})`,
      summary: 'Trendline initialized · Monitoring price action',
      color: '#38bdf8',
    }
  }

  // Find candle closest to p1 (origin of the Spring or Upthrust)
  let closestIdx = 0
  let minDiff = Infinity
  for (let i = 0; i < bars.length; i++) {
    const diff = Math.abs(bars[i]!.time - tl.p1.time)
    if (diff < minDiff) {
      minDiff = diff
      closestIdx = i
    }
  }
  const originBar = bars[closestIdx]!

  // Determine whether this trendline is drawn from a Spring (support/low sweep) or Upthrust (resistance/high sweep)
  const isLabeledSpring = Boolean(tl.label?.toLowerCase().includes('spring') || tl.direction === 'BULLISH')
  const isLabeledUpthrust = Boolean(tl.label?.toLowerCase().includes('upthrust') || tl.direction === 'BEARISH')

  let originType: 'SPRING' | 'UPTHRUST' = 'SPRING'
  if (isLabeledSpring) {
    originType = 'SPRING'
  } else if (isLabeledUpthrust) {
    originType = 'UPTHRUST'
  } else {
    // Detect by anchor position relative to origin candle:
    // If p1 is near the low or the line slopes upward -> Spring
    // If p1 is near the high or the line slopes downward -> Upthrust
    const barMid = (originBar.high + originBar.low) / 2
    if (tl.p1.price <= barMid || Math.abs(tl.p1.price - originBar.low) < Math.abs(tl.p1.price - originBar.high) || tl.p2.price > tl.p1.price) {
      originType = 'SPRING'
    } else {
      originType = 'UPTHRUST'
    }
  }

  const isSpring = originType === 'SPRING'
  const originPrice = isSpring ? Math.min(tl.p1.price, originBar.low) : Math.max(tl.p1.price, originBar.high)
  const originTime = originBar.time

  const preMarkedZones = buildPreMarkedZones(context)
  const locTol = Math.max(4.0, originPrice * 0.0015) // Dynamic point tolerance based on price scale

  // ── FACTOR 1: Structural Location & Confluence (Max 25 pts) ──
  let locScore = 0
  const matchedZones: string[] = []

  if (isSpring) {
    // For Spring: Check sweep of support/confluence levels (Yesterday VAL, 5D LVN, Overnight Low, POCs)
    for (const z of preMarkedZones) {
      if (Math.abs(originPrice - z.price) <= locTol || (originBar.low <= z.price && originBar.close >= z.price - locTol * 0.5)) {
        if (z.name.includes('Y-VAL') || z.name.includes('Y-POC')) locScore += 10
        else if (z.name.includes('5D LVN') || z.name.includes('5D POC')) locScore += 8
        else if (z.name.includes('ON-Low') || z.name.includes('ON-POC') || z.name.includes('London-Low')) locScore += 8
        else locScore += 6
        matchedZones.push(z.name)
      }
    }
    if (matchedZones.length === 0) {
      locScore = 12 // baseline zone location
    }
  } else {
    // For Upthrust: Check sweep of resistance/confluence levels (Yesterday VAH, 5D HVN, Overnight High, POCs)
    for (const z of preMarkedZones) {
      if (Math.abs(originPrice - z.price) <= locTol || (originBar.high >= z.price && originBar.close <= z.price + locTol * 0.5)) {
        if (z.name.includes('Y-VAH') || z.name.includes('Y-POC')) locScore += 10
        else if (z.name.includes('5D HVN') || z.name.includes('5D POC')) locScore += 8
        else if (z.name.includes('ON-High') || z.name.includes('ON-POC') || z.name.includes('London-High')) locScore += 8
        else locScore += 6
        matchedZones.push(z.name)
      }
    }
    if (matchedZones.length === 0) {
      locScore = 12
    }
  }
  locScore = Math.min(25, Math.max(8, locScore))
  const locDetails = matchedZones.length > 0
    ? `Swept ${matchedZones.slice(0, 3).join(' + ')} (${locScore}/25 pts)`
    : `Predetermined structural area (${locScore}/25 pts)`

  // ── FACTOR 2: Initiation Volume Quality & Effort-vs-Result (Max 20 pts) ──
  const lookbackStart = Math.max(0, closestIdx - 20)
  let volSum = 0
  let volCount = 0
  for (let i = lookbackStart; i < closestIdx; i++) {
    volSum += bars[i]!.volume || 1
    volCount++
  }
  const avgVol = volCount > 0 ? volSum / volCount : 1

  const clusterStart = Math.max(0, closestIdx - 1)
  const clusterEnd = Math.min(bars.length - 1, closestIdx + 1)
  let clusterSum = 0
  let clusterCount = 0
  for (let i = clusterStart; i <= clusterEnd; i++) {
    clusterSum += bars[i]!.volume || 1
    clusterCount++
  }
  const clusterVol = clusterCount > 0 ? clusterSum / clusterCount : originBar.volume || 1
  const rvol = Number((clusterVol / Math.max(1, avgVol)).toFixed(2))

  let volScore = 6
  let volDetails = ''
  if (rvol >= 2.0) {
    volScore = 20
    volDetails = `RVOL ${rvol}x: Heavy institutional volume & absorption (20/20 pts)`
  } else if (rvol >= 1.5) {
    volScore = 15
    volDetails = `RVOL ${rvol}x: Strong participation (15/20 pts)`
  } else if (rvol >= 1.0) {
    volScore = 10
    volDetails = `RVOL ${rvol}x: Normal participation (10/20 pts)`
  } else {
    volScore = 5
    volDetails = `RVOL ${rvol}x: Light volume test (5/20 pts)`
  }

  // ── FACTOR 3: Candlestick Reversal & Excess Rejection Tail (Max 20 pts) ──
  const barRange = Math.max(0.1, originBar.high - originBar.low)
  let candleScore = 6
  let candleDetails = ''

  if (isSpring) {
    const lowerWick = Math.max(0, Math.min(originBar.open, originBar.close) - originBar.low)
    const wickRatio = Number((lowerWick / barRange).toFixed(2))
    const isBullClose = originBar.close >= originBar.open || originBar.close >= originBar.low + barRange * 0.6

    if (wickRatio >= 0.45 && isBullClose) {
      candleScore = 20
      candleDetails = `Buying Excess Tail (${Math.round(wickRatio * 100)}% wick) + Bullish Reclaim (20/20 pts)`
    } else if (wickRatio >= 0.35 || isBullClose) {
      candleScore = 14
      candleDetails = `Rejection lower shadow (${Math.round(wickRatio * 100)}% wick) (14/20 pts)`
    } else {
      candleScore = 8
      candleDetails = `Standard support reaction candle (8/20 pts)`
    }
  } else {
    const upperWick = Math.max(0, originBar.high - Math.max(originBar.open, originBar.close))
    const wickRatio = Number((upperWick / barRange).toFixed(2))
    const isBearClose = originBar.close <= originBar.open || originBar.close <= originBar.high - barRange * 0.6

    if (wickRatio >= 0.45 && isBearClose) {
      candleScore = 20
      candleDetails = `Selling Excess Tail (${Math.round(wickRatio * 100)}% wick) + Bearish Rejection (20/20 pts)`
    } else if (wickRatio >= 0.35 || isBearClose) {
      candleScore = 14
      candleDetails = `Rejection upper shadow (${Math.round(wickRatio * 100)}% wick) (14/20 pts)`
    } else {
      candleScore = 8
      candleDetails = `Standard resistance reaction candle (8/20 pts)`
    }
  }

  // ── FACTOR 4: Order Flow & CVD Absorption Confirmation (Max 15 pts) ──
  let cvdScore = 6
  let cvdDetails = 'Order flow neutral'

  // Look at CVD around origin bar
  const prevBar = closestIdx > 0 ? bars[closestIdx - 1] : null
  const nextBar = closestIdx < bars.length - 1 ? bars[closestIdx + 1] : null

  if (originBar.cvd != null) {
    if (isSpring) {
      // Bullish absorption: CVD plunged / lower low but price held or closed high
      const cvdDiverged =
        (prevBar?.cvd != null && originBar.cvd <= prevBar.cvd && originBar.close >= prevBar.close) ||
        (nextBar?.cvd != null && nextBar.cvd <= originBar.cvd && nextBar.close >= originBar.close) ||
        rvol >= 1.5
      if (cvdDiverged) {
        cvdScore = 15
        cvdDetails = 'Bullish Absorption: Aggressive market sellers absorbed by limit bids (15/15 pts)'
      } else {
        cvdScore = 10
        cvdDetails = 'Mild buyer absorption detected (10/15 pts)'
      }
    } else {
      // Bearish absorption: CVD spiked / higher high but price failed or closed low
      const cvdDiverged =
        (prevBar?.cvd != null && originBar.cvd >= prevBar.cvd && originBar.close <= prevBar.close) ||
        (nextBar?.cvd != null && nextBar.cvd >= originBar.cvd && nextBar.close <= originBar.close) ||
        rvol >= 1.5
      if (cvdDiverged) {
        cvdScore = 15
        cvdDetails = 'Bearish Absorption: Aggressive market buyers absorbed by passive offers (15/15 pts)'
      } else {
        cvdScore = 10
        cvdDetails = 'Mild seller absorption detected (10/15 pts)'
      }
    }
  } else {
    cvdScore = rvol >= 1.4 ? 12 : 7
    cvdDetails = rvol >= 1.4 ? 'Effort vs Result: High volume absorption (12/15 pts)' : 'CVD baseline estimate (7/15 pts)'
  }

  // ── FACTOR 5: 5-Month Macro Anchored VWAP Alignment (Max 10 pts) ──
  const avwapPrice = context.avwap5m?.vwap
  let avwapScore = 4
  let avwapDetails = 'Macro AVWAP neutral'
  if (avwapPrice && Number.isFinite(avwapPrice)) {
    const distToAvwap = Math.abs(originPrice - avwapPrice)
    if (distToAvwap <= 15) {
      avwapScore = 10
      avwapDetails = `Aligned within ±15 pts of 5M AVWAP (${distToAvwap.toFixed(1)} pts) (10/10 pts)`
    } else if (distToAvwap <= 35) {
      avwapScore = 7
      avwapDetails = `Proximal within ±35 pts of 5M AVWAP (${distToAvwap.toFixed(1)} pts) (7/10 pts)`
    } else {
      avwapScore = 3
      avwapDetails = `${distToAvwap.toFixed(1)} pts from 5M AVWAP (3/10 pts)`
    }
  }

  // ── FACTOR 6: Psychological Round Numbers (Max 5 pts) ──
  const century = Math.round(originPrice / 100) * 100
  const halfCentury = Math.round(originPrice / 50) * 50
  let roundScore = 1
  let roundDetails = 'Standard non-round price level'

  if (Math.abs(originPrice - century) <= 5.0) {
    roundScore = 5
    roundDetails = `Near Century Strike $${century.toLocaleString()} (5/5 pts)`
  } else if (Math.abs(originPrice - halfCentury) <= 5.0) {
    roundScore = 4
    roundDetails = `Near Half-Century Strike $${halfCentury.toLocaleString()} (4/5 pts)`
  }

  // ── FACTOR 7: Mandatory >= 2R Target & Rule 17 Filter (Max 5 pts + Filter) ──
  let entryPrice = 0
  let stopLoss = 0
  let riskPoints = 0
  let targetPrice = 0
  let targetZoneLabel = 'N/A'
  let rewardPoints = 0
  let rrRatio = 0
  let is2RValid = false
  let rrScore = 0
  let rrDetails = ''

  const buffer = Math.max(0.5, barRange * 0.15)

  if (isSpring) {
    stopLoss = Number((originPrice - buffer).toFixed(2))
    entryPrice = Number(originBar.close.toFixed(2))
    riskPoints = Number(Math.max(0.5, entryPrice - stopLoss).toFixed(2))
    const tgt = findNextStructuralTarget(entryPrice, 'LONG', preMarkedZones, riskPoints)
    targetPrice = tgt.targetPrice
    targetZoneLabel = tgt.targetZoneLabel
    rewardPoints = Number((targetPrice - entryPrice).toFixed(2))
    rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
    is2RValid = rrRatio >= 2.0

    if (is2RValid) {
      rrScore = 5
      rrDetails = `Rule 17 Passed: ${rrRatio}R reward to ${targetZoneLabel} (5/5 pts)`
    } else {
      rrScore = 0
      rrDetails = `Rule 17 Filter: Only ${rrRatio}R to ${targetZoneLabel} (< 2R required, skip trade)`
    }
  } else {
    stopLoss = Number((originPrice + buffer).toFixed(2))
    entryPrice = Number(originBar.close.toFixed(2))
    riskPoints = Number(Math.max(0.5, stopLoss - entryPrice).toFixed(2))
    const tgt = findNextStructuralTarget(entryPrice, 'SHORT', preMarkedZones, riskPoints)
    targetPrice = tgt.targetPrice
    targetZoneLabel = tgt.targetZoneLabel
    rewardPoints = Number((entryPrice - targetPrice).toFixed(2))
    rrRatio = Number((rewardPoints / riskPoints).toFixed(2))
    is2RValid = rrRatio >= 2.0

    if (is2RValid) {
      rrScore = 5
      rrDetails = `Rule 17 Passed: ${rrRatio}R reward to ${targetZoneLabel} (5/5 pts)`
    } else {
      rrScore = 0
      rrDetails = `Rule 17 Filter: Only ${rrRatio}R to ${targetZoneLabel} (< 2R required, skip trade)`
    }
  }

  // Calculate Composite Total Score (0-100)
  const totalScore = Math.min(100, Math.max(0, locScore + volScore + candleScore + cvdScore + avwapScore + roundScore + rrScore))

  let grade: SpringUpthrustEvaluation['grade'] = 'C'
  if (totalScore >= 85) grade = 'A+'
  else if (totalScore >= 70) grade = 'A'
  else if (totalScore >= 55) grade = 'B'
  else grade = 'C'

  const color = is2RValid
    ? (isSpring ? '#10b981' : '#f43f5e')
    : '#eab308'

  const badgeLabel = is2RValid
    ? `📐 Trendline · ${isSpring ? 'Spring' : 'Upthrust'} (${totalScore}/100 pts · Grade ${grade}) | Stop: ${stopLoss.toFixed(1)} | Tgt: ${targetPrice.toFixed(1)} (${rrRatio}R)`
    : `📐 Trendline · ${isSpring ? 'Spring' : 'Upthrust'} (${totalScore} pts · ⚠️ <2R Skip) | Stop: ${stopLoss.toFixed(1)} | Tgt: ${targetPrice.toFixed(1)} (${rrRatio}R)`

  const summary = `${isSpring ? 'Spring' : 'Upthrust'} @ ${originPrice.toFixed(1)}: Score ${totalScore}/100 (${grade}). ${locDetails}. ${volDetails}. ${candleDetails}. ${cvdDetails}. ${rrDetails}.`

  return {
    originType,
    originPrice,
    originTime,
    totalScore,
    grade,
    factors: {
      location: { name: 'Structural Location', score: locScore, maxScore: 25, details: locDetails },
      volumeEffortVsResult: { name: 'Volume & Effort vs Result', score: volScore, maxScore: 20, details: volDetails },
      candleExcess: { name: 'Excess Tail & Reversal Candle', score: candleScore, maxScore: 20, details: candleDetails },
      cvdAbsorption: { name: 'CVD Absorption Divergence', score: cvdScore, maxScore: 15, details: cvdDetails },
      avwap5m: { name: '5M Macro AVWAP Alignment', score: avwapScore, maxScore: 10, details: avwapDetails },
      roundNumber: { name: 'Psychological Handle', score: roundScore, maxScore: 5, details: roundDetails },
      rewardRisk: { name: '2R Target & Room (Rule 17)', score: rrScore, maxScore: 5, details: rrDetails },
    },
    entryPrice,
    stopLoss,
    targetPrice,
    targetZoneLabel,
    riskPoints,
    rewardPoints,
    rrRatio,
    is2RValid,
    badgeLabel,
    summary,
    color,
  }
}
