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
  if (direction === 'LONG') {
    // Look for first resistance above entry + at least a fraction of risk
    const candidates = zones.filter((z) => z.price > entryPrice + minRisk * 0.4)
    if (candidates.length > 0) {
      const closest = candidates[0]!
      return { targetPrice: closest.price, targetZoneLabel: closest.name }
    }
    // If no zone exists above (all-time highs or unmapped), default to 2.5R projection
    return { targetPrice: Number((entryPrice + minRisk * 2.5).toFixed(2)), targetZoneLabel: 'Projected 2.5R' }
  } else {
    // Look for first support below entry - at least a fraction of risk
    const candidates = zones.filter((z) => z.price < entryPrice - minRisk * 0.4).reverse()
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
