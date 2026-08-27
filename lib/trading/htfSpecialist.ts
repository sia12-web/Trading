/**
 * Layer 1: HTF Specialist Agent & Day Timeframe Excess Engine.
 *
 * Evaluates Higher Timeframe / Day Timeframe arrival using:
 *   1. Excess Tails (wick ratio ≥ 0.40 on 5m, 15m, 1H, 4H candles).
 *   2. Volume Confirmation (RVOL ≥ 1.3× 20-bar average).
 *   3. AVWAP & Volume Profile POC/HVN overlap.
 *   4. Poor Highs & Poor Lows (unfinished auctions with flat extremes).
 *
 * Produces HTFContextState to feed Level Finder (Layer 2),
 * Deterministic CALL Gate (Layer 3), and Leo Voice Co-Pilot (Layer 4).
 */

import { candleWickMetrics } from '@/lib/chart/rangeEdgeTails'

export type HTFExcessType = 'BUYING_EXCESS' | 'SELLING_EXCESS' | 'NEUTRAL'
export type HTFTier = 'LOCAL_INTRADAY' | 'HTF_CONFLUENCE'

export type HTFProfileShape =
    | 'P_PROFILE_SHORT_COVER'
    | 'B_PROFILE_LONG_LIQ'
    | 'NORMAL_DISTRIBUTION'
    | 'DOUBLE_DISTRIBUTION'

export type HTFLedgeType = 'LEDGE_RESISTANCE' | 'LEDGE_SUPPORT'

export type HTFLedge = {
    type: HTFLedgeType
    price: number
    touchCount: number
    strength: 'MODERATE' | 'STRONG'
    summary: string
}

export type SinglePrintZone = {
    top: number
    bottom: number
    valid: boolean
    summary: string
}

export type HTFVolumeNodes = {
    hvns: number[]
    lvns: number[]
    singlePrints: SinglePrintZone[]
}

export type HTFMirageState = {
    isMirage: boolean
    dayDirection: 'UP' | 'DOWN' | 'BALANCED'
    multiDayValueMigration: 'HIGHER' | 'LOWER' | 'UNCHANGED'
    illusionType: 'BEARISH_MIRAGE' | 'BULLISH_MIRAGE' | 'NONE'
    message: string
}

export type HTFMarketEvolution = 'BALANCED_2TF' | 'TRANSITIONING' | 'TRENDING_1TF'

export type HTFMacroGap = {
    type: 'BULLISH_GAP_EXCESS' | 'BEARISH_GAP_EXCESS'
    priceGapLow: number
    priceGapHigh: number
    valid: boolean
    summary: string
}

export type HTFIslandDay = {
    type: 'ISLAND_BULL_EXCESS' | 'ISLAND_BEAR_EXCESS'
    top: number
    bottom: number
    active: boolean
    summary: string
}

export type HTFRotationFactor = {
    score: number
    trend: 'OTF_BUYER_CONTROL' | 'OTF_SELLER_CONTROL' | 'BALANCED'
    summary: string
}

export type HTFOpportunityWindow = {
    isOpen: boolean
    direction: 'LONG' | 'SHORT' | 'NEUTRAL'
    score: number
    reason: string
}

export type HTFMacroContextState = {
    gaps: HTFMacroGap[]
    islandDays: HTFIslandDay[]
    rotationFactor: HTFRotationFactor
    opportunityWindow: HTFOpportunityWindow
}

export type HTFValueAreaPlacement =
    | 'HIGHER'
    | 'OVERLAPPING_HIGH'
    | 'LOWER'
    | 'OVERLAPPING_LOW'
    | 'INSIDE'
    | 'OUTSIDE'
    | 'UNCHANGED'

export type HTFValueAreaWidth = 'WIDER' | 'AVERAGE' | 'NARROWER'

export type HTFDirectionalPerformanceGrade =
    | 'VERY_STRONG'
    | 'STRONG'
    | 'BALANCING'
    | 'SLOWING'
    | 'WEAK'
    | 'UNCLEAR'
    | 'FAILING_DIVERGENCE'

export type HTFDynamicRiskReward = {
    targetMultiplier: number
    expectedRR: string
    holdingDirective: string
    longEntryLocation: string
    shortEntryLocation: string
}

export type HTFLtarRecord = {
    sessionDate: string
    attemptedDirection: 'UP' | 'DOWN' | 'BALANCED'
    performanceGrade: HTFDirectionalPerformanceGrade
    volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED'
    vaPlacement: HTFValueAreaPlacement
    vaWidth: HTFValueAreaWidth
    dynamicRR: HTFDynamicRiskReward
    expectedResultsSummary: string
}

export type HTFDirectionalPerformanceState = {
    grade: HTFDirectionalPerformanceGrade
    vaPlacement: HTFValueAreaPlacement
    vaWidth: HTFValueAreaWidth
    volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED'
    dynamicRR: HTFDynamicRiskReward
    ltarHistory: HTFLtarRecord[]
    summary: string
}

export type HTFBracketMode =
    | 'BRACKETED_BALANCE'
    | 'INITIATIVE_TREND'
    | 'AUCTION_FAILURE_REVERSAL'
    | 'TREND_AGING'

export type HTFBracketTradeLocationGrade =
    | 'RESPONSIVE_LONG'
    | 'RESPONSIVE_SHORT'
    | 'MID_BRACKET_CHOP'
    | 'OUT_OF_BRACKET_BREAKOUT'

export type HTFBracketDetails = {
    bracketMode: HTFBracketMode
    tradeLocationGrade: HTFBracketTradeLocationGrade
    swing5d: { high: number; low: number; vah: number; val: number; poc: number }
    macro20d: { high: number; low: number; vah: number; val: number; poc: number }
    highTestCount: number
    lowTestCount: number
    auctionFailureDetected: boolean
    trendAgingDivergence: boolean
    target1Poc: number
    target2OppositeExtreme: number
    directiveSummary: string
}

export type HTFCorrectiveActionType =
    | 'DISGUISED_BULLISH_CORRECTION'
    | 'DISGUISED_BEARISH_CORRECTION'
    | 'STANDARD_PULLBACK'
    | 'TREND_TERMINATION'
    | 'NONE'

export type HTFCorrectiveActionDetails = {
    type: HTFCorrectiveActionType
    isDisguised: boolean
    underlyingStrength: 'EXCEPTIONAL_BULLISH' | 'EXCEPTIONAL_BEARISH' | 'NORMAL'
    targetMultiplierBonus: number
    directiveSummary: string
}

export type HTFAnchorProfileDetails = {
    anchorResetTriggered: boolean
    anchorResetReason: string
    anchorTimestamp: number
    anchorPoc: number
    anchorVah: number
    anchorVal: number
}

export type HTFSpecialSituationType =
    | 'THREE_TO_ONE_BUYING'
    | 'THREE_TO_ONE_SELLING'
    | 'NEUTRAL_EXTREME_BULL'
    | 'NEUTRAL_EXTREME_BEAR'
    | 'VALUE_AREA_RULE_BULL'
    | 'VALUE_AREA_RULE_BEAR'
    | 'SPIKE_ACCEPTANCE_BULL'
    | 'SPIKE_ACCEPTANCE_BEAR'
    | 'SPIKE_REJECTION'
    | 'SPIKE_BALANCE'
    | 'BALANCE_BREAKOUT_BULL'
    | 'BALANCE_BREAKOUT_BEAR'
    | 'GAP_INITIATIVE_BULL'
    | 'GAP_INITIATIVE_BEAR'
    | 'NONE'

export type HTFSpecialSituationDetails = {
    activeSituation: HTFSpecialSituationType
    continuationProbabilityPct: number
    primaryTargetPrice: number | null
    invalidationPrice: number | null
    directiveSummary: string
}

export type HTFStandAsideType =
    | 'NONTREND_DAY'
    | 'NONCONVICTION_DAY'
    | 'LONG_TERM_NONTREND'
    | 'PRE_NEWS_STAND_ASIDE'
    | 'POST_NEWS_WHIPSAW'
    | 'NONE'

export type HTFStandAsideDetails = {
    isStandAside: boolean
    reason: HTFStandAsideType
    severity: 'HIGH' | 'MEDIUM' | 'NONE'
    directiveSummary: string
    newsSentimentRating?: 'VERY_STRONG' | 'STRONG' | 'NEUTRAL_EXPECTED' | 'WEAK' | 'VERY_WEAK'
}

export type HTFExcessSignal = {
    type: HTFExcessType
    tier: HTFTier
    price: number
    ratio: number
    wickPts: number
    bodyPts: number
    timeframe: '5m' | '15m' | '1H' | '4H'
    volumeConfirmed: boolean
    rvol: number
    avwapConfirmed: boolean
    volumeProfileConfirmed: boolean
    timestamp: number
    summary: string
}

export type PoorExtremeTarget = {
    type: 'POOR_HIGH' | 'POOR_LOW'
    price: number
    touchCount: number
    resolved: boolean
    summary: string
}

export type HTFContextState = {
    instrument: string
    asOfUnix: number
    status:
    | 'BUYING_EXCESS'
    | 'SELLING_EXCESS'
    | 'P_PROFILE_SHORT_COVER'
    | 'B_PROFILE_LONG_LIQ'
    | 'LEDGE_STALL'
    | 'DAY_MIRAGE'
    | 'UNFINISHED_AUCTION'
    | 'BALANCED'
    primaryExcess: HTFExcessSignal | null
    allExcesses: HTFExcessSignal[]
    poorExtremes: PoorExtremeTarget[]
    profileShape: HTFProfileShape
    ledges: HTFLedge[]
    volumeNodes: HTFVolumeNodes
    mirageState: HTFMirageState
    marketEvolution: HTFMarketEvolution
    macroContext: HTFMacroContextState
    directionalPerformance: HTFDirectionalPerformanceState
    bracket: HTFBracketDetails
    correctiveAction?: HTFCorrectiveActionDetails
    anchorProfile?: HTFAnchorProfileDetails
    specialSituation?: HTFSpecialSituationDetails
    standAside?: HTFStandAsideDetails
    summaryText: string
    leoPromptBlock: string
}

export type HTFBarInput = {
    time: number
    open: number
    high: number
    low: number
    close: number
    volume?: number
}

const WICK_RATIO_THRESHOLD = 0.4
const RVOL_THRESHOLD = 1.3
const POOR_EXTREME_TOLERANCE_PTS = 2.5

/**
 * Compute Relative Volume (RVOL) against N-bar median/mean.
 */
function computeRvol(bars: HTFBarInput[], index: number, window = 20): number {
    if (index < window) return 1.0
    const slice = bars.slice(index - window, index)
    const totalVol = slice.reduce((sum, b) => sum + Math.max(1, b.volume || 0), 0)
    const avgVol = totalVol / window
    const curVol = Math.max(1, bars[index]?.volume || 0)
    return avgVol > 0 ? Math.round((curVol / avgVol) * 100) / 100 : 1.0
}

/**
 * Check if a price touches or is proximal to AVWAP bands or Volume Profile nodes.
 */
function isNearAnchors(price: number, anchors: number[], tolerancePts = 10): boolean {
    return anchors.some((a) => Math.abs(price - a) <= tolerancePts)
}

/**
 * Evaluate Day Timeframe Excess signals from multi-timeframe candles.
 */
export function computeHTFExcessSignals(args: {
    instrument: string
    candles5m: HTFBarInput[]
    candles15m?: HTFBarInput[]
    candles1h?: HTFBarInput[]
    asOfUnix: number
    avwapAnchors?: number[]
    vpAnchors?: number[]
}): HTFExcessSignal[] {
    const { candles5m, asOfUnix } = args
    const avwap = args.avwapAnchors ?? []
    const vp = args.vpAnchors ?? []
    const signals: HTFExcessSignal[] = []

    const processBars = (bars: HTFBarInput[], tf: '5m' | '15m' | '1H' | '4H') => {
        const validBars = bars.filter((b) => Number.isFinite(b.time) && b.time <= asOfUnix)
        if (validBars.length === 0) return

        for (let i = Math.max(0, validBars.length - 15); i < validBars.length; i++) {
            const bar = validBars[i]!
            const metrics = candleWickMetrics(bar)
            const rvol = computeRvol(validBars, i)
            const volOk = rvol >= RVOL_THRESHOLD

            // Upper Wick -> Selling Excess
            if (metrics.upperRatio >= WICK_RATIO_THRESHOLD) {
                const avwapOk = isNearAnchors(bar.high, avwap, 15)
                const vpOk = isNearAnchors(bar.high, vp, 15)
                const isHtf = tf === '1H' || tf === '4H' || (tf === '15m' && (avwapOk || vpOk))
                const tier: HTFTier = isHtf ? 'HTF_CONFLUENCE' : 'LOCAL_INTRADAY'

                signals.push({
                    type: 'SELLING_EXCESS',
                    tier,
                    price: Math.round(bar.high * 100) / 100,
                    ratio: Math.round(metrics.upperRatio * 100) / 100,
                    wickPts: Math.round(metrics.upperWickPts * 100) / 100,
                    bodyPts: Math.round(metrics.bodyPts * 100) / 100,
                    timeframe: tf,
                    volumeConfirmed: volOk,
                    rvol,
                    avwapConfirmed: avwapOk,
                    volumeProfileConfirmed: vpOk,
                    timestamp: bar.time,
                    summary: `Selling Excess (${tf}) @ ${bar.high.toLocaleString()} · wick ratio ${metrics.upperRatio.toFixed(2)} · RVOL ${rvol}x${tier === 'HTF_CONFLUENCE' ? ' [HTF CONFLUENCE]' : ''}`,
                })
            }

            // Lower Wick -> Buying Excess
            if (metrics.lowerRatio >= WICK_RATIO_THRESHOLD) {
                const avwapOk = isNearAnchors(bar.low, avwap, 15)
                const vpOk = isNearAnchors(bar.low, vp, 15)
                const isHtf = tf === '1H' || tf === '4H' || (tf === '15m' && (avwapOk || vpOk))
                const tier: HTFTier = isHtf ? 'HTF_CONFLUENCE' : 'LOCAL_INTRADAY'

                signals.push({
                    type: 'BUYING_EXCESS',
                    tier,
                    price: Math.round(bar.low * 100) / 100,
                    ratio: Math.round(metrics.lowerRatio * 100) / 100,
                    wickPts: Math.round(metrics.lowerWickPts * 100) / 100,
                    bodyPts: Math.round(metrics.bodyPts * 100) / 100,
                    timeframe: tf,
                    volumeConfirmed: volOk,
                    rvol,
                    avwapConfirmed: avwapOk,
                    volumeProfileConfirmed: vpOk,
                    timestamp: bar.time,
                    summary: `Buying Excess (${tf}) @ ${bar.low.toLocaleString()} · wick ratio ${metrics.lowerRatio.toFixed(2)} · RVOL ${rvol}x${tier === 'HTF_CONFLUENCE' ? ' [HTF CONFLUENCE]' : ''}`,
                })
            }
        }
    }

    processBars(candles5m, '5m')
    if (args.candles15m) processBars(args.candles15m, '15m')
    if (args.candles1h) processBars(args.candles1h, '1H')

    // Sort newest first, with HTF_CONFLUENCE given priority
    return signals.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'HTF_CONFLUENCE' ? -1 : 1
        return b.timestamp - a.timestamp
    })
}

/**
 * Detect Poor Highs & Poor Lows (unfinished auctions where 2+ candles stop at flat extremes without wicks).
 */
export function computePoorExtremes(args: {
    candles: HTFBarInput[]
    asOfUnix: number
}): PoorExtremeTarget[] {
    const { candles, asOfUnix } = args
    const valid = candles.filter((c) => Number.isFinite(c.time) && c.time <= asOfUnix)
    if (valid.length < 5) return []

    const targets: PoorExtremeTarget[] = []
    const recent = valid.slice(-30)

    // Poor High Check: find 2+ bars with high within tolerance and small upper wick
    for (let i = 0; i < recent.length; i++) {
        const b1 = recent[i]!
        const m1 = candleWickMetrics(b1)
        if (m1.upperRatio > 0.2) continue

        let touches = 1
        for (let j = i + 1; j < recent.length; j++) {
            const b2 = recent[j]!
            const m2 = candleWickMetrics(b2)
            if (m2.upperRatio <= 0.2 && Math.abs(b1.high - b2.high) <= POOR_EXTREME_TOLERANCE_PTS) {
                touches++
            }
        }

        if (touches >= 2) {
            const px = Math.round(b1.high * 100) / 100
            // Check if price already swept/resolved it later
            const latestPrice = valid[valid.length - 1]?.close ?? 0
            const resolved = latestPrice > px + 5

            if (!targets.some((t) => t.type === 'POOR_HIGH' && Math.abs(t.price - px) <= 3)) {
                targets.push({
                    type: 'POOR_HIGH',
                    price: px,
                    touchCount: touches,
                    resolved,
                    summary: `Poor High @ ${px.toLocaleString()} (${touches} flat touches — unfinished auction target)`,
                })
            }
        }
    }

    // Poor Low Check: find 2+ bars with low within tolerance and small lower wick
    for (let i = 0; i < recent.length; i++) {
        const b1 = recent[i]!
        const m1 = candleWickMetrics(b1)
        if (m1.lowerRatio > 0.2) continue

        let touches = 1
        for (let j = i + 1; j < recent.length; j++) {
            const b2 = recent[j]!
            const m2 = candleWickMetrics(b2)
            if (m2.lowerRatio <= 0.2 && Math.abs(b1.low - b2.low) <= POOR_EXTREME_TOLERANCE_PTS) {
                touches++
            }
        }

        if (touches >= 2) {
            const px = Math.round(b1.low * 100) / 100
            const latestPrice = valid[valid.length - 1]?.close ?? 0
            const resolved = latestPrice < px - 5

            if (!targets.some((t) => t.type === 'POOR_LOW' && Math.abs(t.price - px) <= 3)) {
                targets.push({
                    type: 'POOR_LOW',
                    price: px,
                    touchCount: touches,
                    resolved,
                    summary: `Poor Low @ ${px.toLocaleString()} (${touches} flat touches — unfinished auction target)`,
                })
            }
        }
    }

    return targets
}

/**
 * Determine TPO/Volume Profile shape ('P' Short Cover, 'b' Long Liq, Normal, Double Dist).
 */
export function computeProfileShape(bars: HTFBarInput[]): HTFProfileShape {
    if (bars.length < 5) return 'NORMAL_DISTRIBUTION'
    const highs = bars.map((b) => b.high)
    const lows = bars.map((b) => b.low)
    const maxH = Math.max(...highs)
    const minL = Math.min(...lows)
    const range = maxH - minL
    if (range <= 0) return 'NORMAL_DISTRIBUTION'

    const third = range / 3
    const topBound = maxH - third
    const botBound = minL + third

    let topVol = 0
    let midVol = 0
    let botVol = 0
    let totalVol = 0

    for (const b of bars) {
        const v = Math.max(1, b.volume || 100)
        totalVol += v
        if (b.close >= topBound) topVol += v
        else if (b.close <= botBound) botVol += v
        else midVol += v
    }

    if (totalVol <= 0) return 'NORMAL_DISTRIBUTION'

    const topPct = topVol / totalVol
    const midPct = midVol / totalVol
    const botPct = botVol / totalVol

    // P-Shape (Short Covering): heavy top volume (≥ 45%), low bottom volume (≤ 22%)
    if (topPct >= 0.45 && botPct <= 0.22) {
        return 'P_PROFILE_SHORT_COVER'
    }
    // b-Shape (Long Liquidation): heavy bottom volume (≥ 45%), low top volume (≤ 22%)
    if (botPct >= 0.45 && topPct <= 0.22) {
        return 'B_PROFILE_LONG_LIQ'
    }
    // Double Distribution: high top & bottom volume, hollow middle (≤ 22%)
    if (topPct >= 0.35 && botPct >= 0.35 && midPct <= 0.22) {
        return 'DOUBLE_DISTRIBUTION'
    }

    return 'NORMAL_DISTRIBUTION'
}

/**
 * Detect Ledges (half of normal distribution stalling at flat boundary).
 */
export function computeLedges(bars: HTFBarInput[]): HTFLedge[] {
    if (bars.length < 6) return []
    const recent = bars.slice(-36)
    const ledges: HTFLedge[] = []

    const highs = recent.map((b) => b.high)
    const maxH = Math.max(...highs)
    const tolerance = Math.max(2.0, maxH * 0.0008)

    // Resistance Ledges (flat highs)
    for (let i = 0; i < recent.length; i++) {
        const b1 = recent[i]!
        let touchCount = 1
        for (let j = i + 1; j < recent.length; j++) {
            const b2 = recent[j]!
            if (Math.abs(b1.high - b2.high) <= tolerance) {
                touchCount++
            }
        }
        if (touchCount >= 3) {
            const px = Math.round(b1.high * 100) / 100
            if (!ledges.some((l) => l.type === 'LEDGE_RESISTANCE' && Math.abs(l.price - px) <= tolerance * 2)) {
                const strength = touchCount >= 4 ? 'STRONG' : 'MODERATE'
                ledges.push({
                    type: 'LEDGE_RESISTANCE',
                    price: px,
                    touchCount,
                    strength,
                    summary: `Ledge Resistance @ ${px.toLocaleString()} (${touchCount} flat stalls — responsive ceiling / breakout catalyst)`,
                })
            }
        }
    }

    // Support Ledges (flat lows)
    for (let i = 0; i < recent.length; i++) {
        const b1 = recent[i]!
        let touchCount = 1
        for (let j = i + 1; j < recent.length; j++) {
            const b2 = recent[j]!
            if (Math.abs(b1.low - b2.low) <= tolerance) {
                touchCount++
            }
        }
        if (touchCount >= 3) {
            const px = Math.round(b1.low * 100) / 100
            if (!ledges.some((l) => l.type === 'LEDGE_SUPPORT' && Math.abs(l.price - px) <= tolerance * 2)) {
                const strength = touchCount >= 4 ? 'STRONG' : 'MODERATE'
                ledges.push({
                    type: 'LEDGE_SUPPORT',
                    price: px,
                    touchCount,
                    strength,
                    summary: `Ledge Support @ ${px.toLocaleString()} (${touchCount} flat stalls — responsive floor / spillover risk)`,
                })
            }
        }
    }

    return ledges
}

/**
 * Identify HVN (High Volume Nodes) and LVN (Low Volume Nodes / Single Print Vacuums) + Invalidation Check.
 */
export function computeVolumeNodes(bars: HTFBarInput[]): HTFVolumeNodes {
    if (bars.length < 5) return { hvns: [], lvns: [], singlePrints: [] }
    const valid = bars.filter((b) => Number.isFinite(b.close))
    const highs = valid.map((b) => b.high)
    const lows = valid.map((b) => b.low)
    const maxH = Math.max(...highs)
    const minL = Math.min(...lows)
    const range = maxH - minL
    if (range <= 0) return { hvns: [], lvns: [], singlePrints: [] }

    const numBins = 25
    const binWidth = range / numBins
    const binVolumes = new Array(numBins).fill(0)

    for (const b of valid) {
        const binIdx = Math.min(numBins - 1, Math.max(0, Math.floor((b.close - minL) / binWidth)))
        const vol = Math.max(1, b.volume || 100)
        binVolumes[binIdx] += vol
    }

    const avgVol = binVolumes.reduce((a, b) => a + b, 0) / numBins
    const hvns: number[] = []
    const lvns: number[] = []

    for (let i = 0; i < numBins; i++) {
        const binCenter = Math.round((minL + (i + 0.5) * binWidth) * 100) / 100
        if (binVolumes[i] >= avgVol * 1.45) {
            hvns.push(binCenter)
        } else if (binVolumes[i] <= avgVol * 0.35 && i > 1 && i < numBins - 2) {
            lvns.push(binCenter)
        }
    }

    // Group adjacent LVNs into Single Print zones & verify LVN invalidation (value building beyond rejection)
    const singlePrints: SinglePrintZone[] = []
    let currentGap: number[] = []

    const processGap = (gap: number[]) => {
        if (gap.length >= 2) {
            const bLow = Math.round((minL + gap[0]! * binWidth) * 100) / 100
            const bHigh = Math.round((minL + (gap[gap.length - 1]! + 1) * binWidth) * 100) / 100

            // Invalidation check (Page 144 Point 2): if recent bars spend time & volume inside gap
            const recentBars = valid.slice(-4)
            let insideTimeCount = 0
            for (const rb of recentBars) {
                if (rb.close >= bLow && rb.close <= bHigh) {
                    insideTimeCount++
                }
            }
            const isValid = insideTimeCount < 2

            singlePrints.push({
                top: bHigh,
                bottom: bLow,
                valid: isValid,
                summary: `Single Print Zone ${bLow.toLocaleString()} - ${bHigh.toLocaleString()} (${isValid ? 'ACTIVE VACUUM' : 'INVALIDATED — accepted as value'})`,
            })
        }
    }

    for (let i = 2; i < numBins - 2; i++) {
        if (binVolumes[i] <= avgVol * 0.35) {
            currentGap.push(i)
        } else {
            processGap(currentGap)
            currentGap = []
        }
    }
    processGap(currentGap)

    return { hvns, lvns, singlePrints }
}

/**
 * Detect "Day Timeframe Mirage" (Page 145: day timeframe direction vs multi-day value placement).
 */
export function computeMirageState(bars: HTFBarInput[]): HTFMirageState {
    const valid = bars.filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close) && b.open > 0 && b.close > 0)
    if (valid.length < 6) {
        return {
            isMirage: false,
            dayDirection: 'BALANCED',
            multiDayValueMigration: 'UNCHANGED',
            illusionType: 'NONE',
            message: 'Day timeframe direction aligned with multi-day value.',
        }
    }

    const firstBar = valid[0]!
    const lastBar = valid[valid.length - 1]!
    const openPx = firstBar.open
    const curPx = lastBar.close

    const diffPct = openPx > 0 ? ((curPx - openPx) / openPx) * 100 : 0
    const dayDirection: 'UP' | 'DOWN' | 'BALANCED' =
        diffPct >= 0.25 ? 'UP' : diffPct <= -0.25 ? 'DOWN' : 'BALANCED'

    const half = Math.floor(valid.length / 2)
    const firstHalfAvg = valid.slice(0, half).reduce((s, b) => s + b.close, 0) / (half || 1)
    const secondHalfAvg = valid.slice(half).reduce((s, b) => s + b.close, 0) / (valid.length - half || 1)

    const migrationPct = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0
    const multiDayValueMigration: 'HIGHER' | 'LOWER' | 'UNCHANGED' =
        migrationPct >= 0.15 ? 'HIGHER' : migrationPct <= -0.15 ? 'LOWER' : 'UNCHANGED'

    let isMirage = false
    let illusionType: HTFMirageState['illusionType'] = 'NONE'
    let message = 'Day timeframe direction is structurally aligned with higher timeframe value.'

    if (dayDirection === 'DOWN' && multiDayValueMigration === 'HIGHER') {
        isMirage = true
        illusionType = 'BEARISH_MIRAGE'
        message = 'DAY TIMEFRAME MIRAGE (Bearish Illusion): Price is auctioning DOWN today, but multi-day value is HIGHER. Do not sell into long-term buyer control.'
    } else if (dayDirection === 'UP' && multiDayValueMigration === 'LOWER') {
        isMirage = true
        illusionType = 'BULLISH_MIRAGE'
        message = 'DAY TIMEFRAME MIRAGE (Bullish Illusion): Price is auctioning UP today, but multi-day value is LOWER. Do not buy into long-term seller control.'
    }

    return {
        isMirage,
        dayDirection,
        multiDayValueMigration,
        illusionType,
        message,
    }
}

/**
 * Compute Cumulative Rotation Factor (Page 147: sum of auction rotations).
 */
export function computeRotationFactor(bars: HTFBarInput[]): HTFRotationFactor {
    const valid = bars.filter((b) => Number.isFinite(b.high) && Number.isFinite(b.low))
    if (valid.length < 3) {
        return { score: 0, trend: 'BALANCED', summary: 'Rotation Factor: 0 (Insufficient data)' }
    }

    let score = 0
    for (let i = 1; i < valid.length; i++) {
        const prev = valid[i - 1]!
        const cur = valid[i]!

        if (cur.high > prev.high && cur.low >= prev.low) score += 1
        else if (cur.high >= prev.high && cur.low > prev.low) score += 1
        else if (cur.high < prev.high && cur.low <= prev.low) score -= 1
        else if (cur.high <= prev.high && cur.low < prev.low) score -= 1
    }

    const trend: HTFRotationFactor['trend'] =
        score >= 4 ? 'OTF_BUYER_CONTROL' : score <= -4 ? 'OTF_SELLER_CONTROL' : 'BALANCED'

    return {
        score,
        trend,
        summary: `Rotation Factor: ${score > 0 ? '+' : ''}${score} (${trend.replace(/_/g, ' ')})`,
    }
}

/**
 * Detect Macro Gaps ("Invisible Tails" - Page 155) & Island Days (Page 152).
 */
export function computeMacroGapsAndIslands(bars: HTFBarInput[]): { gaps: HTFMacroGap[]; islandDays: HTFIslandDay[] } {
    const valid = bars.filter((b) => Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close))
    if (valid.length < 8) return { gaps: [], islandDays: [] }

    const gaps: HTFMacroGap[] = []
    const islandDays: HTFIslandDay[] = []

    // Detect session/overnight gaps (Page 155)
    for (let i = 1; i < valid.length; i++) {
        const prev = valid[i - 1]!
        const cur = valid[i]!

        // Bullish Gap Excess (opened above prev high)
        if (cur.open > prev.high + 2.0) {
            const latestPx = valid[valid.length - 1]!.close
            const isStillValid = latestPx >= prev.high // Gap not filled/accepted below
            gaps.push({
                type: 'BULLISH_GAP_EXCESS',
                priceGapLow: prev.high,
                priceGapHigh: cur.open,
                valid: isStillValid,
                summary: `Bullish Gap Excess ${prev.high.toLocaleString()} - ${cur.open.toLocaleString()} (Invisible Buying Tail - ${isStillValid ? 'ACTIVE' : 'FILLED'})`,
            })
        }
        // Bearish Gap Excess (opened below prev low)
        else if (cur.open < prev.low - 2.0) {
            const latestPx = valid[valid.length - 1]!.close
            const isStillValid = latestPx <= prev.low
            gaps.push({
                type: 'BEARISH_GAP_EXCESS',
                priceGapLow: cur.open,
                priceGapHigh: prev.low,
                valid: isStillValid,
                summary: `Bearish Gap Excess ${cur.open.toLocaleString()} - ${prev.low.toLocaleString()} (Invisible Selling Tail - ${isStillValid ? 'ACTIVE' : 'FILLED'})`,
            })
        }
    }

    // Detect Island Days (Page 152: consecutive opposite gaps)
    for (let i = 1; i < gaps.length; i++) {
        const g1 = gaps[i - 1]!
        const g2 = gaps[i]!
        if (g1.type === 'BULLISH_GAP_EXCESS' && g2.type === 'BEARISH_GAP_EXCESS') {
            const top = Math.max(g1.priceGapHigh, g1.priceGapLow, g2.priceGapHigh, g2.priceGapLow)
            const bottom = Math.min(g1.priceGapHigh, g1.priceGapLow, g2.priceGapHigh, g2.priceGapLow)
            islandDays.push({
                type: 'ISLAND_BEAR_EXCESS',
                top,
                bottom,
                active: g2.valid,
                summary: `Island Bearish Excess @ ${bottom.toLocaleString()} - ${top.toLocaleString()} (Major Macro Wall)`,
            })
        } else if (g1.type === 'BEARISH_GAP_EXCESS' && g2.type === 'BULLISH_GAP_EXCESS') {
            const top = Math.max(g1.priceGapHigh, g1.priceGapLow, g2.priceGapHigh, g2.priceGapLow)
            const bottom = Math.min(g1.priceGapHigh, g1.priceGapLow, g2.priceGapHigh, g2.priceGapLow)
            islandDays.push({
                type: 'ISLAND_BULL_EXCESS',
                top,
                bottom,
                active: g2.valid,
                summary: `Island Bullish Excess @ ${bottom.toLocaleString()} - ${top.toLocaleString()} (Major Macro Floor)`,
            })
        }
    }

    return { gaps, islandDays }
}

/**
 * Evaluate Opportunity Window (High Conviction Alignment between Macro Conviction and Day TF Structure).
 */
export function computeOpportunityWindow(args: {
    gaps: HTFMacroGap[]
    islandDays: HTFIslandDay[]
    rotationFactor: HTFRotationFactor
    profileShape: HTFProfileShape
    mirageState: HTFMirageState
}): HTFOpportunityWindow {
    const { gaps, islandDays, rotationFactor, profileShape, mirageState } = args

    if (mirageState.isMirage) {
        return {
            isOpen: false,
            direction: 'NEUTRAL',
            score: 20,
            reason: 'Opportunity Window CLOSED: Day Timeframe Mirage detected. Do not trade against long-term value migration.',
        }
    }

    const activeBullGaps = gaps.filter((g) => g.type === 'BULLISH_GAP_EXCESS' && g.valid)
    const activeBearGaps = gaps.filter((g) => g.type === 'BEARISH_GAP_EXCESS' && g.valid)
    const activeBullIslands = islandDays.filter((i) => i.type === 'ISLAND_BULL_EXCESS' && i.active)
    const activeBearIslands = islandDays.filter((i) => i.type === 'ISLAND_BEAR_EXCESS' && i.active)

    let score = 50
    let direction: HTFOpportunityWindow['direction'] = 'NEUTRAL'

    const bullSignals = (rotationFactor.trend === 'OTF_BUYER_CONTROL' ? 1 : 0) + activeBullGaps.length + activeBullIslands.length
    const bearSignals = (rotationFactor.trend === 'OTF_SELLER_CONTROL' ? 1 : 0) + activeBearGaps.length + activeBearIslands.length

    if (bullSignals > 0 && bearSignals === 0) {
        score += 25
        direction = 'LONG'
    } else if (bearSignals > 0 && bullSignals === 0) {
        score += 25
        direction = 'SHORT'
    }

    if (profileShape === 'P_PROFILE_SHORT_COVER' && direction === 'LONG') {
        score += 15
    } else if (profileShape === 'B_PROFILE_LONG_LIQ' && direction === 'SHORT') {
        score += 15
    }

    const isOpen = score >= 70 && direction !== 'NEUTRAL'
    const reason = isOpen
        ? `OPPORTUNITY WINDOW OPEN (${direction}): Macro Conviction (RF ${rotationFactor.score > 0 ? '+' : ''}${rotationFactor.score}, ${rotationFactor.trend}) aligns with Initiative Gaps.`
        : 'Opportunity Window: Standard rotational market — wait for high-conviction macro alignment.'

    return {
        isOpen,
        direction,
        score,
        reason,
    }
}

/**
 * Compute Value Area Placement (Figure 4.54 - Page 160: Higher, Lower, Overlapping, Inside, Outside).
 */
export function computeValueAreaPlacement(bars: HTFBarInput[]): { placement: HTFValueAreaPlacement; vaHigh: number; vaLow: number; vaWidth: HTFValueAreaWidth } {
    const valid = bars.filter((b) => Number.isFinite(b.close) && Number.isFinite(b.high) && Number.isFinite(b.low))
    if (valid.length < 12) {
        return { placement: 'UNCHANGED', vaHigh: 0, vaLow: 0, vaWidth: 'AVERAGE' }
    }

    const half = Math.floor(valid.length / 2)
    const priorBars = valid.slice(0, half)
    const curBars = valid.slice(half)

    const curHighs = curBars.map((b) => b.high)
    const curLows = curBars.map((b) => b.low)
    const curMin = Math.min(...curLows)
    const curMax = Math.max(...curHighs)
    const curRange = curMax - curMin || 1

    const vaHigh = Math.round((curMin + curRange * 0.85) * 100) / 100
    const vaLow = Math.round((curMin + curRange * 0.15) * 100) / 100
    const widthPts = vaHigh - vaLow

    const pHighs = priorBars.map((b) => b.high)
    const pLows = priorBars.map((b) => b.low)
    const pMin = Math.min(...pLows)
    const pMax = Math.max(...pHighs)
    const pRange = pMax - pMin || 1
    const pVaHigh = Math.round((pMin + pRange * 0.85) * 100) / 100
    const pVaLow = Math.round((pMin + pRange * 0.15) * 100) / 100
    const pWidthPts = pVaHigh - pVaLow || 1

    let placement: HTFValueAreaPlacement = 'UNCHANGED'
    if (vaLow > pVaHigh) placement = 'HIGHER'
    else if (vaHigh < pVaLow) placement = 'LOWER'
    else if (vaHigh > pVaHigh && vaLow < pVaLow) placement = 'OUTSIDE'
    else if (vaHigh <= pVaHigh && vaLow >= pVaLow) placement = 'INSIDE'
    else if (vaHigh > pVaHigh && vaLow >= pVaLow) placement = 'OVERLAPPING_HIGH'
    else if (vaLow < pVaLow && vaHigh <= pVaHigh) placement = 'OVERLAPPING_LOW'

    let vaWidth: HTFValueAreaWidth = 'AVERAGE'
    if (widthPts > pWidthPts * 1.25) vaWidth = 'WIDER'
    else if (widthPts < pWidthPts * 0.75) vaWidth = 'NARROWER'

    return { placement, vaHigh, vaLow, vaWidth }
}

/**
 * Table 4.1 Directional Performance Matrix Lookup (Page 163).
 */
export function evaluateDirectionalPerformanceMatrix(
    attemptedDir: 'UP' | 'DOWN' | 'BALANCED',
    volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED',
    vaPlacement: HTFValueAreaPlacement
): HTFDirectionalPerformanceGrade {
    if (attemptedDir === 'UP') {
        if (volumeRel === 'HIGHER' && (vaPlacement === 'HIGHER' || vaPlacement === 'OVERLAPPING_HIGH')) return 'VERY_STRONG'
        if (volumeRel === 'UNCHANGED' && vaPlacement === 'HIGHER') return 'STRONG'
        if (volumeRel === 'LOWER' && vaPlacement === 'HIGHER') return 'SLOWING'
        if (volumeRel === 'LOWER' && (vaPlacement === 'LOWER' || vaPlacement === 'OVERLAPPING_LOW')) return 'FAILING_DIVERGENCE'
        if (vaPlacement === 'LOWER') return 'WEAK'
        return 'BALANCING'
    } else if (attemptedDir === 'DOWN') {
        if (volumeRel === 'HIGHER' && (vaPlacement === 'LOWER' || vaPlacement === 'OVERLAPPING_LOW')) return 'VERY_STRONG'
        if (volumeRel === 'UNCHANGED' && vaPlacement === 'LOWER') return 'STRONG'
        if (volumeRel === 'LOWER' && vaPlacement === 'LOWER') return 'SLOWING'
        if (volumeRel === 'LOWER' && (vaPlacement === 'HIGHER' || vaPlacement === 'OVERLAPPING_HIGH')) return 'FAILING_DIVERGENCE'
        if (vaPlacement === 'HIGHER') return 'WEAK'
        return 'BALANCING'
    }
    return 'BALANCING'
}

/**
 * Compute Dynamic Risk-to-Reward (R:R) & Multi-Timeframe Entry Locations (15m, 30m, 1H).
 */
export function computeDynamicRiskReward(
    grade: HTFDirectionalPerformanceGrade,
    attemptedDir: 'UP' | 'DOWN' | 'BALANCED',
    bars5m: HTFBarInput[],
    vaHigh: number,
    vaLow: number
): HTFDynamicRiskReward {
    const recent = bars5m.slice(-36)
    const highs = recent.map((b) => b.high)
    const lows = recent.map((b) => b.low)
    const rMax = Math.max(...highs, vaHigh || 0)
    const rMin = Math.min(...lows, vaLow || 0)

    const r30mLow = Math.round(rMin * 100) / 100
    const r30mHigh = Math.round(rMax * 100) / 100

    let targetMultiplier = 1.0
    let expectedRR = '1:2.0'
    let holdingDirective = 'Scalp mean-reversion between VAH and VAL.'

    if (grade === 'VERY_STRONG') {
        targetMultiplier = 2.0
        expectedRR = '1:3.5 - 1:4.0'
        holdingDirective = 'Strong OTF Trade Facilitation — hold runners for HTF extension targets.'
    } else if (grade === 'STRONG') {
        targetMultiplier = 1.5
        expectedRR = '1:2.5 - 1:3.0'
        holdingDirective = 'Good Trade Facilitation — target 30m/1H Range extremes.'
    } else if (grade === 'SLOWING') {
        targetMultiplier = 0.75
        expectedRR = '1:1.5'
        holdingDirective = 'Slowing Trade Facilitation — tighten profit targets to nearest 15m node.'
    } else if (grade === 'WEAK' || grade === 'FAILING_DIVERGENCE') {
        targetMultiplier = 0.5
        expectedRR = '1:1.0'
        holdingDirective = 'Trade Facilitation FAILING (Divergence) — exit trend setups quickly; prepare for fade.'
    }

    const longEntryLocation = `${attemptedDir === 'UP' ? '★ PREFERRED ' : ''}BUY Entry: 15m/30m Range Floor @ ${r30mLow.toLocaleString()} or VAL @ ${vaLow.toLocaleString()} (Stop 2.5 pts below)`
    const shortEntryLocation = `${attemptedDir === 'DOWN' ? '★ PREFERRED ' : ''}SELL Entry: 15m/30m Range Ceiling @ ${r30mHigh.toLocaleString()} or VAH @ ${vaHigh.toLocaleString()} (Stop 2.5 pts above)`

    return {
        targetMultiplier,
        expectedRR,
        holdingDirective,
        longEntryLocation,
        shortEntryLocation,
    }
}

/**
 * Evaluate Long-Term Auction Rotations & Brackets (Mind Over Markets Ch 4, Pages 183-210)
 * Evaluates 5-Day Swing Bracket and 20-Day Macro Bracket structures, trade location grades (Rule 1),
 * test counts (Rule 2), Auction Failures / Outside Days, and Trend-Aging volume divergence (Page 196).
 */
export function computeLongTermBracket(
    bars: HTFBarInput[],
    currentPrice: number
): HTFBracketDetails {
    const bars5d = bars.slice(-288) // ~5 days of 5m bars
    const bars20d = bars.slice(-1152) // ~20 days of 5m bars

    // 5-Day Swing Bracket Boundaries
    const s5Highs = bars5d.map((b) => b.high)
    const s5Lows = bars5d.map((b) => b.low)
    const s5Max = s5Highs.length > 0 ? Math.max(...s5Highs) : currentPrice + 20
    const s5Min = s5Lows.length > 0 ? Math.min(...s5Lows) : currentPrice - 20
    const s5Poc = Math.round(((s5Max + s5Min) / 2) * 100) / 100
    const s5Range = s5Max - s5Min
    const s5Vah = Math.round((s5Min + s5Range * 0.7) * 100) / 100
    const s5Val = Math.round((s5Min + s5Range * 0.3) * 100) / 100

    // 20-Day Macro Bracket Boundaries
    const m20Highs = bars20d.map((b) => b.high)
    const m20Lows = bars20d.map((b) => b.low)
    const m20Max = m20Highs.length > 0 ? Math.max(...m20Highs) : currentPrice + 50
    const m20Min = m20Lows.length > 0 ? Math.min(...m20Lows) : currentPrice - 50
    const m20Poc = Math.round(((m20Max + m20Min) / 2) * 100) / 100
    const m20Range = m20Max - m20Min
    const m20Vah = Math.round((m20Min + m20Range * 0.7) * 100) / 100
    const m20Val = Math.round((m20Min + m20Range * 0.3) * 100) / 100

    // Rule 1: Trade Location Classification
    let tradeLocationGrade: HTFBracketTradeLocationGrade = 'MID_BRACKET_CHOP'
    if (currentPrice <= s5Val || currentPrice <= s5Min + 5) {
        tradeLocationGrade = 'RESPONSIVE_LONG'
    } else if (currentPrice >= s5Vah || currentPrice >= s5Max - 5) {
        tradeLocationGrade = 'RESPONSIVE_SHORT'
    } else if (currentPrice > s5Max || currentPrice < s5Min) {
        tradeLocationGrade = 'OUT_OF_BRACKET_BREAKOUT'
    }

    // Rule 2: Extreme Test Counter
    const highTestCount = s5Highs.filter((h) => h >= s5Max - 3).length
    const lowTestCount = s5Lows.filter((l) => l <= s5Min + 3).length

    // Rule 4 / Breakout Failure: Auction Failure Detection
    const recentRecent = bars.slice(-12)
    const probedBelowAndRebounded = recentRecent.some((b) => b.low < s5Min - 2) && currentPrice > s5Val
    const probedAboveAndReversed = recentRecent.some((b) => b.high > s5Max + 2) && currentPrice < s5Vah
    const auctionFailureDetected = probedBelowAndRebounded || probedAboveAndReversed

    // Page 196: Trend Aging Volume Divergence
    const upDaysVol = bars5d.filter((b) => b.close > b.open).reduce((sum, b) => sum + (b.volume || 0), 0)
    const downDaysVol = bars5d.filter((b) => b.close < b.open).reduce((sum, b) => sum + (b.volume || 0), 0)
    const trendAgingDivergence = downDaysVol > 1.25 * upDaysVol && currentPrice > s5Poc

    // Determine Bracket Mode
    let bracketMode: HTFBracketMode = 'BRACKETED_BALANCE'
    if (auctionFailureDetected) {
        bracketMode = 'AUCTION_FAILURE_REVERSAL'
    } else if (trendAgingDivergence) {
        bracketMode = 'TREND_AGING'
    } else if (tradeLocationGrade === 'OUT_OF_BRACKET_BREAKOUT') {
        bracketMode = 'INITIATIVE_TREND'
    }

    // Profit Targets: Target 1 = Mid-Bracket POC, Target 2 = Opposite Bracket Extreme
    const target1Poc = s5Poc
    const target2OppositeExtreme = currentPrice < s5Poc ? s5Vah : s5Val

    let directiveSummary = 'Trading in 5-day Balance. Focus on Responsive Entries at Bracket Extremes.'
    if (tradeLocationGrade === 'RESPONSIVE_LONG') {
        directiveSummary = `★ RESPONSIVE BUY ZONE: Near 5D VAL @ ${s5Val.toLocaleString()} (Target 1: POC @ ${s5Poc.toLocaleString()}, Target 2: VAH @ ${s5Vah.toLocaleString()})`
    } else if (tradeLocationGrade === 'RESPONSIVE_SHORT') {
        directiveSummary = `★ RESPONSIVE SELL ZONE: Near 5D VAH @ ${s5Vah.toLocaleString()} (Target 1: POC @ ${s5Poc.toLocaleString()}, Target 2: VAL @ ${s5Val.toLocaleString()})`
    } else if (tradeLocationGrade === 'MID_BRACKET_CHOP') {
        directiveSummary = `⚠️ MID-BRACKET CHOP ZONE: Near POC @ ${s5Poc.toLocaleString()}. Initiative trades carry poor trade location — wait for bracket boundary.`
    } else if (bracketMode === 'AUCTION_FAILURE_REVERSAL') {
        directiveSummary = `🚨 AUCTION FAILURE REVERSAL: Failed probe beyond bracket extreme! Target opposite extreme @ ${target2OppositeExtreme.toLocaleString()}`
    }

    return {
        bracketMode,
        tradeLocationGrade,
        swing5d: { high: s5Max, low: s5Min, vah: s5Vah, val: s5Val, poc: s5Poc },
        macro20d: { high: m20Max, low: m20Min, vah: m20Vah, val: m20Val, poc: m20Poc },
        highTestCount,
        lowTestCount,
        auctionFailureDetected,
        trendAgingDivergence,
        target1Poc,
        target2OppositeExtreme,
        directiveSummary,
    }
}

/**
 * Evaluate Corrective Action & Disguised Corrections (Mind Over Markets Ch 4, Pages 225–228)
 * Identifies counteraction (profit taking) that maintains or migrates higher/lower value,
 * revealing exceptional underlying market conviction.
 */
export function computeCorrectiveAction(
    bars: HTFBarInput[],
    vaPlacement: HTFValueAreaPlacement,
    bracket: HTFBracketDetails
): HTFCorrectiveActionDetails {
    if (bars.length < 24) {
        return {
            type: 'NONE',
            isDisguised: false,
            underlyingStrength: 'NORMAL',
            targetMultiplierBonus: 0,
            directiveSummary: 'Insufficient data for corrective action evaluation.',
        }
    }

    const recentBars = bars.slice(-24) // Last 2 hours of 5m bars
    const sessionHigh = Math.max(...recentBars.map((b) => b.high))
    const sessionLow = Math.min(...recentBars.map((b) => b.low))
    const currentPrice = recentBars[recentBars.length - 1]!.close

    // Check for intraday pullback while Value Area is higher/overlapping higher
    const pullbackFromHighPct = ((sessionHigh - currentPrice) / sessionHigh) * 100
    const rallyFromLowPct = ((currentPrice - sessionLow) / sessionLow) * 100

    const isVaHigher = vaPlacement === 'HIGHER' || vaPlacement === 'OVERLAPPING_HIGH'
    const isVaLower = vaPlacement === 'LOWER' || vaPlacement === 'OVERLAPPING_LOW'

    if (pullbackFromHighPct >= 0.25 && isVaHigher) {
        return {
            type: 'DISGUISED_BULLISH_CORRECTION',
            isDisguised: true,
            underlyingStrength: 'EXCEPTIONAL_BULLISH',
            targetMultiplierBonus: 0.5,
            directiveSummary: '★ DISGUISED BULLISH CORRECTION: Intraday sell-off is profit-taking into HIGHER Value! Underlying buyer control is EXCEPTIONAL — high-conviction dip buy.',
        }
    }

    if (rallyFromLowPct >= 0.25 && isVaLower) {
        return {
            type: 'DISGUISED_BEARISH_CORRECTION',
            isDisguised: true,
            underlyingStrength: 'EXCEPTIONAL_BEARISH',
            targetMultiplierBonus: 0.5,
            directiveSummary: '★ DISGUISED BEARISH CORRECTION: Intraday rally is short-covering into LOWER Value! Underlying seller control is EXCEPTIONAL — high-conviction rally sell.',
        }
    }

    if (bracket.bracketMode === 'BRACKETED_BALANCE') {
        return {
            type: 'STANDARD_PULLBACK',
            isDisguised: false,
            underlyingStrength: 'NORMAL',
            targetMultiplierBonus: 0,
            directiveSummary: 'Standard rotational pullback within balance area. Execute responsive fade at extremes.',
        }
    }

    return {
        type: 'NONE',
        isDisguised: false,
        underlyingStrength: 'NORMAL',
        targetMultiplierBonus: 0,
        directiveSummary: 'No corrective action divergence detected.',
    }
}

/**
 * Evaluate Dynamic Long-Term Anchor Profiles (Mind Over Markets Ch 4, Pages 229–231)
 * Resets profile anchor upon structural change events (Excess, Gap, Breakout).
 */
export function computeAnchorProfile(
    bars: HTFBarInput[],
    excesses: HTFExcessSignal[],
    bracket: HTFBracketDetails
): HTFAnchorProfileDetails {
    const primaryExcess = excesses.length > 0 ? excesses[0] : null
    let anchorResetTriggered = false
    let anchorResetReason = 'Standard 5-Day Rolling Anchor'
    let anchorBar = bars[Math.max(0, bars.length - 288)]!

    if (primaryExcess) {
        anchorResetTriggered = true
        anchorResetReason = `Anchor Reset: ${primaryExcess.type} (${primaryExcess.timeframe})`
        const found = bars.find((b) => Math.abs(b.time - primaryExcess.timestamp) < 300000)
        if (found) anchorBar = found
    } else if (bracket.bracketMode === 'INITIATIVE_TREND' || bracket.bracketMode === 'AUCTION_FAILURE_REVERSAL') {
        anchorResetTriggered = true
        anchorResetReason = `Anchor Reset: ${bracket.bracketMode} Breakout`
        anchorBar = bars[Math.max(0, bars.length - 72)]! // Reset to breakout bar ~6 hours ago
    }

    const anchorSlice = bars.filter((b) => b.time >= anchorBar.time)
    const highs = anchorSlice.map((b) => b.high)
    const lows = anchorSlice.map((b) => b.low)
    const aHigh = highs.length > 0 ? Math.max(...highs) : 0
    const aLow = lows.length > 0 ? Math.min(...lows) : 0
    const aRange = aHigh - aLow
    const anchorPoc = Math.round(((aHigh + aLow) / 2) * 100) / 100
    const anchorVah = Math.round((aLow + aRange * 0.7) * 100) / 100
    const anchorVal = Math.round((aLow + aRange * 0.3) * 100) / 100

    return {
        anchorResetTriggered,
        anchorResetReason,
        anchorTimestamp: anchorBar.time,
        anchorPoc,
        anchorVah,
        anchorVal,
    }
}

/**
 * Evaluate Market-Generated Special Situations (Mind Over Markets Ch 4, Pages 238–263)
 * Implements 6 classic mechanical setups: 3-to-1 Days, Neutral-Extreme Days, Value-Area Rule, Late Spikes, Balance Breakouts, Gaps.
 */
export function computeSpecialSituations(
    bars: HTFBarInput[],
    vaPlacement: HTFValueAreaPlacement,
    bracket: HTFBracketDetails
): HTFSpecialSituationDetails {
    if (bars.length < 36) {
        return {
            activeSituation: 'NONE',
            continuationProbabilityPct: 50,
            primaryTargetPrice: null,
            invalidationPrice: null,
            directiveSummary: 'Insufficient data for Special Situation evaluation.',
        }
    }

    const currentPrice = bars[bars.length - 1]!.close

    // 1. Balance-Area Breakout (Page 256) — Priority 1 Macro Shift
    if (bracket.tradeLocationGrade === 'OUT_OF_BRACKET_BREAKOUT') {
        const isBull = currentPrice > bracket.swing5d.high
        return {
            activeSituation: isBull ? 'BALANCE_BREAKOUT_BULL' : 'BALANCE_BREAKOUT_BEAR',
            continuationProbabilityPct: 90,
            primaryTargetPrice: isBull ? Math.round((currentPrice + 25) * 100) / 100 : Math.round((currentPrice - 25) * 100) / 100,
            invalidationPrice: isBull ? bracket.swing5d.high : bracket.swing5d.low,
            directiveSummary: `BALANCE BREAKOUT ${isBull ? 'BULLISH' : 'BEARISH'}: GO WITH THE BREAKOUT! Initiative OTF in control. High odds of expansion.`,
        }
    }

    // 2. Initiative Gap (Page 260)
    const sessionOpen = bars[0]!.open
    const prevHigh = bracket.swing5d.vah
    const prevLow = bracket.swing5d.val

    if (sessionOpen > prevHigh && currentPrice > prevHigh) {
        return {
            activeSituation: 'GAP_INITIATIVE_BULL',
            continuationProbabilityPct: 85,
            primaryTargetPrice: Math.round((currentPrice + 15) * 100) / 100,
            invalidationPrice: prevHigh,
            directiveSummary: 'INITIATIVE GAP BULLISH: Opening outside value. Trade with gap initiative direction; stop at gap fill erasure.',
        }
    } else if (sessionOpen < prevLow && currentPrice < prevLow) {
        return {
            activeSituation: 'GAP_INITIATIVE_BEAR',
            continuationProbabilityPct: 85,
            primaryTargetPrice: Math.round((currentPrice - 15) * 100) / 100,
            invalidationPrice: prevLow,
            directiveSummary: 'INITIATIVE GAP BEARISH: Opening below value. Trade with gap initiative direction; stop at gap fill erasure.',
        }
    }

    // 3. The Value-Area Rule (Page 244)
    const isInsideVaNow = currentPrice >= bracket.swing5d.val && currentPrice <= bracket.swing5d.vah
    if (isInsideVaNow) {
        if (sessionOpen < bracket.swing5d.val) {
            return {
                activeSituation: 'VALUE_AREA_RULE_BULL',
                continuationProbabilityPct: 88,
                primaryTargetPrice: bracket.swing5d.vah,
                invalidationPrice: Math.round((bracket.swing5d.val - 2.5) * 100) / 100,
                directiveSummary: `VALUE-AREA RULE BULLISH: Re-entered prior VA from below. High probability of complete traverse to VAH (${bracket.swing5d.vah}).`,
            }
        } else if (sessionOpen > bracket.swing5d.vah) {
            return {
                activeSituation: 'VALUE_AREA_RULE_BEAR',
                continuationProbabilityPct: 88,
                primaryTargetPrice: bracket.swing5d.val,
                invalidationPrice: Math.round((bracket.swing5d.vah + 2.5) * 100) / 100,
                directiveSummary: `VALUE-AREA RULE BEARISH: Re-entered prior VA from above. High probability of complete traverse to VAL (${bracket.swing5d.val}).`,
            }
        }
    }

    // 4. 3 to 1 Days (Page 239)
    if (vaPlacement === 'HIGHER' && bracket.highTestCount >= 2) {
        return {
            activeSituation: 'THREE_TO_ONE_BUYING',
            continuationProbabilityPct: 94,
            primaryTargetPrice: Math.round((bracket.swing5d.high + 10) * 100) / 100,
            invalidationPrice: bracket.swing5d.poc,
            directiveSummary: '3-TO-1 BUYING DAY: Initiative tail + range extension. 94% historical odds of trading better than previous VA in first 90 minutes.',
        }
    } else if (vaPlacement === 'LOWER' && bracket.lowTestCount >= 2) {
        return {
            activeSituation: 'THREE_TO_ONE_SELLING',
            continuationProbabilityPct: 94,
            primaryTargetPrice: Math.round((bracket.swing5d.low - 10) * 100) / 100,
            invalidationPrice: bracket.swing5d.poc,
            directiveSummary: '3-TO-1 SELLING DAY: Initiative tail + range extension. 94% historical odds of trading lower than previous VA in first 90 minutes.',
        }
    }

    // 5. Neutral-Extreme Days (Page 241)
    if (bracket.tradeLocationGrade === 'RESPONSIVE_LONG') {
        return {
            activeSituation: 'NEUTRAL_EXTREME_BULL',
            continuationProbabilityPct: 92,
            primaryTargetPrice: bracket.swing5d.high,
            invalidationPrice: bracket.swing5d.val,
            directiveSummary: 'NEUTRAL-EXTREME BULL: Close near day highs after two-sided rotation. 92% odds of opening/trading in direction of close.',
        }
    } else if (bracket.tradeLocationGrade === 'RESPONSIVE_SHORT') {
        return {
            activeSituation: 'NEUTRAL_EXTREME_BEAR',
            continuationProbabilityPct: 92,
            primaryTargetPrice: bracket.swing5d.low,
            invalidationPrice: bracket.swing5d.vah,
            directiveSummary: 'NEUTRAL-EXTREME BEAR: Close near day lows after two-sided rotation. 92% odds of opening/trading in direction of close.',
        }
    }

    return {
        activeSituation: 'NONE',
        continuationProbabilityPct: 50,
        primaryTargetPrice: null,
        invalidationPrice: null,
        directiveSummary: 'Standard Day Timeframe Auction — No active Special Situation flag.',
    }
}

/**
 * Mind Over Markets News Sentiment Matrix (Page 274 Table)
 * Evaluates market sentiment based on major auction direction, news release, and day timeframe direction.
 */
export function evaluateNewsSentiment(
    majorAuction: 'UP' | 'DOWN',
    newsAnnouncement: 'BULLISH' | 'BEARISH',
    dayTimeframeDir: 'UP' | 'DOWN'
): 'VERY_STRONG' | 'STRONG' | 'NEUTRAL_EXPECTED' | 'WEAK' | 'VERY_WEAK' {
    if (majorAuction === 'UP') {
        if (newsAnnouncement === 'BEARISH' && dayTimeframeDir === 'UP') return 'VERY_STRONG'
        if (newsAnnouncement === 'BEARISH' && dayTimeframeDir === 'DOWN') return 'NEUTRAL_EXPECTED'
        if (newsAnnouncement === 'BULLISH' && dayTimeframeDir === 'UP') return 'STRONG'
        if (newsAnnouncement === 'BULLISH' && dayTimeframeDir === 'DOWN') return 'VERY_WEAK'
    } else {
        if (newsAnnouncement === 'BEARISH' && dayTimeframeDir === 'UP') return 'VERY_STRONG'
        if (newsAnnouncement === 'BEARISH' && dayTimeframeDir === 'DOWN') return 'WEAK'
        if (newsAnnouncement === 'BULLISH' && dayTimeframeDir === 'UP') return 'NEUTRAL_EXPECTED'
        if (newsAnnouncement === 'BULLISH' && dayTimeframeDir === 'DOWN') return 'VERY_WEAK'
    }
    return 'NEUTRAL_EXPECTED'
}

/**
 * Evaluate Markets to Stay Out Of (Mind Over Markets Ch 4, Pages 265–275)
 * Identifies 4 low-opportunity/high-risk scenarios: Nontrend Days, Nonconviction Days, Long-Term Nontrend, News Whipsaws.
 */
export function computeMarketStandAsideState(
    bars: HTFBarInput[],
    bracket: HTFBracketDetails,
    macroContext: HTFMacroContextState
): HTFStandAsideDetails {
    if (bars.length < 24) {
        return {
            isStandAside: false,
            reason: 'NONE',
            severity: 'NONE',
            directiveSummary: 'Insufficient data for Stand-Aside evaluation.',
        }
    }

    let maxHigh = -Infinity
    let minLow = Infinity
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!
        if (b.high > maxHigh) maxHigh = b.high
        if (b.low < minLow) minLow = b.low
    }
    const currentRange = maxHigh > minLow ? maxHigh - minLow : 0
    const swingRange = bracket.swing5d.high - bracket.swing5d.low

    // 1. Nontrend Days (Page 266) — Extremely compressed range & low volume
    if (swingRange > 0 && currentRange < swingRange * 0.25) {
        return {
            isStandAside: true,
            reason: 'NONTREND_DAY',
            severity: 'HIGH',
            directiveSummary: 'STAND ASIDE — NONTREND DAY: Extremely narrow range & low activity. Market is not facilitating trade with any participant.',
        }
    }

    // 2. Nonconviction Days (Page 266) — Random rotations inside prior value, zero OTF conviction
    const sessionOpen = bars[0]!.open
    const isOpenInsideValue = sessionOpen >= bracket.swing5d.val && sessionOpen <= bracket.swing5d.vah
    const currentPrice = bars[bars.length - 1]!.close
    const isPriceInsideValue = currentPrice >= bracket.swing5d.val && currentPrice <= bracket.swing5d.vah
    const isChopLocation = bracket.tradeLocationGrade === 'MID_BRACKET_CHOP'

    if (isOpenInsideValue && isPriceInsideValue && isChopLocation) {
        return {
            isStandAside: true,
            reason: 'NONCONVICTION_DAY',
            severity: 'MEDIUM',
            directiveSummary: 'STAND ASIDE — NONCONVICTION DAY: Open-Auction inside value with random rotations. Zero OTF presence; avoid forcing trades.',
        }
    }

    // 3. Long-Term Nontrend Markets (Page 267) — Multi-week bracket chop
    if (bracket.bracketMode === 'BRACKETED_BALANCE' && isChopLocation) {
        return {
            isStandAside: true,
            reason: 'LONG_TERM_NONTREND',
            severity: 'MEDIUM',
            directiveSummary: 'STAND ASIDE — LONG-TERM NONTREND: Multi-week macro chop. Disable swing trades; stick strictly to short 15m scalp targets.',
        }
    }

    // 4. News-Influenced Markets (Page 269)
    const optReason = macroContext?.opportunityWindow?.reason
    if (typeof optReason === 'string' && optReason.toLowerCase().includes('news')) {
        const sentiment = evaluateNewsSentiment(
            bracket.swing5d.high > bracket.macro20d.poc ? 'UP' : 'DOWN',
            'BULLISH',
            currentPrice > sessionOpen ? 'UP' : 'DOWN'
        )
        return {
            isStandAside: true,
            reason: 'PRE_NEWS_STAND_ASIDE',
            severity: 'HIGH',
            directiveSummary: `STAND ASIDE — NEWS-INFLUENCED MARKET: Major news pending. Stand aside until release. Sentiment: ${sentiment}.`,
            newsSentimentRating: sentiment,
        }
    }

    return {
        isStandAside: false,
        reason: 'NONE',
        severity: 'NONE',
        directiveSummary: 'Market facilitating trade cleanly — Clear opportunity conditions active.',
    }
}

/**
 * Layer 1 Master Entrypoint: Compute complete HTFContextState.
 */
export function computeHTFContextState(args: {
    instrument: string
    candles5m: HTFBarInput[]
    candles15m?: HTFBarInput[]
    candles1h?: HTFBarInput[]
    asOfUnix: number
    avwapAnchors?: number[]
    vpAnchors?: number[]
}): HTFContextState {
    const { instrument, asOfUnix, candles5m } = args
    const excesses = computeHTFExcessSignals(args)
    const poorExtremes = computePoorExtremes({ candles: candles5m, asOfUnix })

    const profileShape = computeProfileShape(candles5m)
    const ledges = computeLedges(candles5m)
    const volumeNodes = computeVolumeNodes(candles5m)
    const mirageState = computeMirageState(candles5m)

    const rotationFactor = computeRotationFactor(candles5m)
    const { gaps, islandDays } = computeMacroGapsAndIslands(candles5m)
    const opportunityWindow = computeOpportunityWindow({
        gaps,
        islandDays,
        rotationFactor,
        profileShape,
        mirageState,
    })

    const macroContext: HTFMacroContextState = {
        gaps,
        islandDays,
        rotationFactor,
        opportunityWindow,
    }

    // Directional Performance & LTAR Calculation (Pages 157–177)
    const { placement: vaPlacement, vaHigh, vaLow, vaWidth } = computeValueAreaPlacement(candles5m)
    const attemptedDir = rotationFactor.trend === 'OTF_BUYER_CONTROL' ? 'UP' : rotationFactor.trend === 'OTF_SELLER_CONTROL' ? 'DOWN' : 'BALANCED'
    // Live desk Perf is directionalPerformance.ts — do not hardcode HIGHER here
    // to stretch ticket R. This HTF grade is recap-only.
    const volumeRel: 'HIGHER' | 'LOWER' | 'UNCHANGED' = 'UNCHANGED'
    const perfGrade = evaluateDirectionalPerformanceMatrix(attemptedDir, volumeRel, vaPlacement)
    const dynamicRR = computeDynamicRiskReward(perfGrade, attemptedDir, candles5m, vaHigh, vaLow)

    const directionalPerformance: HTFDirectionalPerformanceState = {
        grade: perfGrade,
        vaPlacement,
        vaWidth,
        volumeRel,
        dynamicRR,
        ltarHistory: [],
        summary: `Perf Grade: ${perfGrade} (${vaPlacement} VA, R:R Target ${dynamicRR.targetMultiplier}x [${dynamicRR.expectedRR}])`,
    }

    // Long-Term Bracket Engine (Mind Over Markets Ch 4, Pages 183-210)
    const currentPrice = candles5m.length > 0 ? candles5m[candles5m.length - 1]!.close : 0
    const bracket = computeLongTermBracket(candles5m, currentPrice)

    // Corrective Action, Dynamic Anchor Profile, Special Situation & Stand-Aside Engine (Mind Over Markets Ch 4, Pages 225-275)
    const correctiveAction = computeCorrectiveAction(candles5m, vaPlacement, bracket)
    const anchorProfile = computeAnchorProfile(candles5m, excesses, bracket)
    const specialSituation = computeSpecialSituations(candles5m, vaPlacement, bracket)
    const standAside = computeMarketStandAsideState(candles5m, bracket, macroContext)

    const primaryExcess = excesses.length > 0 ? excesses[0]! : null
    const activePoor = poorExtremes.filter((p) => !p.resolved)
    const activeSinglePrints = volumeNodes.singlePrints.filter((sp) => sp.valid)

    let marketEvolution: HTFMarketEvolution = 'BALANCED_2TF'
    if (activeSinglePrints.length > 0 || profileShape === 'P_PROFILE_SHORT_COVER' || profileShape === 'B_PROFILE_LONG_LIQ') {
        marketEvolution = 'TRENDING_1TF'
    } else if (profileShape === 'DOUBLE_DISTRIBUTION' || volumeNodes.lvns.length > 0) {
        marketEvolution = 'TRANSITIONING'
    }

    let status: HTFContextState['status'] = 'BALANCED'
    if (mirageState.isMirage) {
        status = 'DAY_MIRAGE'
    } else if (profileShape === 'P_PROFILE_SHORT_COVER') {
        status = 'P_PROFILE_SHORT_COVER'
    } else if (profileShape === 'B_PROFILE_LONG_LIQ') {
        status = 'B_PROFILE_LONG_LIQ'
    } else if (ledges.length > 0) {
        status = 'LEDGE_STALL'
    } else if (primaryExcess?.type === 'BUYING_EXCESS') {
        status = 'BUYING_EXCESS'
    } else if (primaryExcess?.type === 'SELLING_EXCESS') {
        status = 'SELLING_EXCESS'
    } else if (activePoor.length > 0) {
        status = 'UNFINISHED_AUCTION'
    }

    const parts: string[] = []
    if (standAside.isStandAside) {
        parts.push(`🛑 STAND ASIDE: ${standAside.directiveSummary}`)
    }
    if (opportunityWindow.isOpen) {
        parts.push(`OPPORTUNITY WINDOW: ${opportunityWindow.reason}`)
    }
    parts.push(`DIRECTIONAL PERF: ${directionalPerformance.summary}`)
    parts.push(`LONG-TERM BRACKET: ${bracket.directiveSummary}`)
    if (specialSituation.activeSituation !== 'NONE') {
        parts.push(`SPECIAL SITUATION: ${specialSituation.directiveSummary}`)
    }
    if (correctiveAction.isDisguised) {
        parts.push(`CORRECTIVE ACTION: ${correctiveAction.directiveSummary}`)
    }
    if (mirageState.isMirage) {
        parts.push(`MIRAGE ALERT: ${mirageState.message}`)
    }
    if (profileShape === 'P_PROFILE_SHORT_COVER') {
        parts.push('Profile: P-Shape Short Covering (Short-term buying without OTF backing)')
    } else if (profileShape === 'B_PROFILE_LONG_LIQ') {
        parts.push('Profile: b-Shape Long Liquidation (Short-term selling without OTF backing)')
    }
    if (ledges.length > 0) {
        parts.push(`Ledges: ${ledges.map((l) => l.summary).join(' · ')}`)
    }
    if (primaryExcess) {
        parts.push(`Primary Day TF Excess: ${primaryExcess.summary}`)
    }
    if (activePoor.length > 0) {
        parts.push(`Unfinished Auctions: ${activePoor.map((p) => p.summary).join(' · ')}`)
    }

    const summaryText = parts.length > 0 ? parts.join(' | ') : 'Day TF Structure: Intraday balance, clear auctions.'

    const leoPromptBlock = [
        'DAY TIMEFRAME & LONG-TERM SPECIALIST (Layer 1 — Market Profile & Macro Conviction):',
        `Day TF Status: ${status} (Market State: ${marketEvolution})`,
        standAside.isStandAside ? `🛑 STAND ASIDE WARNING: ${standAside.directiveSummary}` : 'Stand-Aside Status: Clean opportunity conditions active.',
        `Long-Term Bracket Mode: ${bracket.bracketMode} (Location Grade: ${bracket.tradeLocationGrade})`,
        `Bracket Directive: ${bracket.directiveSummary}`,
        `Special Situation Active: ${specialSituation.activeSituation} (${specialSituation.continuationProbabilityPct}% Continuation Odds)`,
        `Special Situation Directive: ${specialSituation.directiveSummary}`,
        `5-Day Tactical Bracket: High ${bracket.swing5d.high}, Low ${bracket.swing5d.low}, VAH ${bracket.swing5d.vah}, VAL ${bracket.swing5d.val}, POC ${bracket.swing5d.poc}`,
        `20-Day Macro Bracket: High ${bracket.macro20d.high}, Low ${bracket.macro20d.low}, VAH ${bracket.macro20d.vah}, VAL ${bracket.macro20d.val}, POC ${bracket.macro20d.poc}`,
        `Bracket Test Counts: High ${bracket.highTestCount}x, Low ${bracket.lowTestCount}x (Rule 2: Expect 3-5 tests before breakout)`,
        bracket.auctionFailureDetected ? '🚨 AUCTION FAILURE ALERT: Rejection outside bracket boundary — prepare for opposite extreme target!' : 'Auction Failure: None.',
        bracket.trendAgingDivergence ? '⚠️ TREND AGING WARNING: Volume rising against trend — balance/bracket rotation imminent.' : 'Trend Aging Check: Conviction intact.',
        `Corrective Action State: ${correctiveAction.type} (Underlying Strength: ${correctiveAction.underlyingStrength})`,
        `Corrective Action Directive: ${correctiveAction.directiveSummary}`,
        `Dynamic Anchor Profile: ${anchorProfile.anchorResetReason} (Anchor POC ${anchorProfile.anchorPoc}, VAH ${anchorProfile.anchorVah}, VAL ${anchorProfile.anchorVal})`,
        `Macro Opportunity Window: ${opportunityWindow.isOpen ? `OPEN (${opportunityWindow.direction}, Score ${opportunityWindow.score}/100)` : 'CLOSED / WAITING'}`,
        `Directional Performance Grade: ${perfGrade} (Trade Facilitation Target ${dynamicRR.targetMultiplier}x, Expected R:R ${dynamicRR.expectedRR})`,
        `Dynamic R:R Directive: ${dynamicRR.holdingDirective}`,
        `Multi-TF Entry Directives:`,
        `  - ${dynamicRR.longEntryLocation}`,
        `  - ${dynamicRR.shortEntryLocation}`,
        `Value-Area Placement: ${vaPlacement} (Width: ${vaWidth}, VAH: ${vaHigh}, VAL: ${vaLow})`,
        `Macro Directional Conviction: ${rotationFactor.summary}`,
        gaps.length > 0 ? `Initiative Gaps (Invisible Tails): ${gaps.map((g) => g.summary).join(' · ')}` : 'Initiative Gaps: None.',
        islandDays.length > 0 ? `Island Day Reversal Walls: ${islandDays.map((i) => i.summary).join(' · ')}` : 'Island Days: None.',
        `Profile Structure: ${profileShape}`,
        mirageState.isMirage ? `WARNING: ${mirageState.message}` : 'Mirage Check: Aligned with HTF value.',
        ledges.length > 0
            ? `Active Ledges: ${ledges.map((l) => `${l.type} @ ${l.price}`).join(', ')}`
            : 'Ledges: None active.',
        volumeNodes.hvns.length > 0
            ? `HVN Acceptance Zones (Slow/Fill): ${volumeNodes.hvns.slice(0, 3).join(', ')}`
            : 'HVNs: None.',
        activeSinglePrints.length > 0
            ? `LVN Single Print Vacuums (Fast Rejection): ${activeSinglePrints.map((sp) => `${sp.bottom}-${sp.top}`).join(', ')}`
            : 'LVN Single Prints: None active.',
        primaryExcess
            ? `Primary Excess: ${primaryExcess.type} @ ${primaryExcess.price} (${primaryExcess.timeframe}, ratio ${primaryExcess.ratio}, RVOL ${primaryExcess.rvol}x)`
            : 'Primary Excess: None active.',
        activePoor.length > 0
            ? `Active Unfinished Auction Targets: ${activePoor.map((p) => `${p.type} @ ${p.price}`).join(', ')}`
            : 'Unfinished Auction Targets: None.',
        'Market Rules:',
        '1. Dynamically scale trade targets based on Directional Performance (1.5x-2.0x for VERY STRONG, 0.75x for SLOWING).',
        '2. Enter LONG at 15m/30m Range Floor or VAL; enter SHORT at 15m/30m Range Ceiling or VAH.',
        '3. Initiative Gaps ("Invisible Tails") are strong rejection walls; Island Days mark major structural pivots.',
        '4. Beware of Day Timeframe Mirages — do not get trapped against multi-day value migration.',
    ].join('\n')

    return {
        instrument,
        asOfUnix,
        status,
        primaryExcess,
        allExcesses: excesses,
        poorExtremes,
        profileShape,
        ledges,
        volumeNodes,
        mirageState,
        marketEvolution,
        macroContext,
        directionalPerformance,
        bracket,
        correctiveAction,
        anchorProfile,
        specialSituation,
        standAside,
        summaryText,
        leoPromptBlock,
    }
}
