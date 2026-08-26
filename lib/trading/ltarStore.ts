import {
    HTFContextState,
    HTFDirectionalPerformanceGrade,
    HTFValueAreaPlacement,
    HTFValueAreaWidth,
} from './htfSpecialist'

export type LTARActivityRecord = {
    date: string
    market: string
    attemptedDirection: {
        rotationFactorScore: number
        rotationFactorDir: 'BUYER' | 'SELLER' | 'NEUTRAL'
        rangeExtension: string
        tails: { buyerTail: boolean; sellerTail: boolean }
        buyingSellingComposite: 'BUYING' | 'SELLING' | 'BALANCING'
        overallAttemptedDirection: 'HIGHER' | 'LOWER' | 'NEUTRAL'
        comments: string
    }
    directionalPerformance: {
        dailyVolume: number
        dailyVolumeVsAvg: 'HIGHER' | 'LOWER' | 'UNCHANGED'
        auctionAverageVolume: number
        auctionAvgVsAvg: 'HIGHER' | 'LOWER' | 'UNCHANGED'
        valueAreaPlacement: HTFValueAreaPlacement
        valueAreaWidth: HTFValueAreaWidth
        performanceGrade: HTFDirectionalPerformanceGrade
        comments: string
    }
    expectedResults: {
        longerTermDirective: string
        shorterTermDirective: string
        summary: string
    }
}

// In-memory persistent cache for LTAR records indexed by date-instrument
const ltarCache = new Map<string, LTARActivityRecord>()

/**
 * Generate a complete LTAR Activity Record from HTFContextState (Figure 4.65 - Page 173).
 */
export function generateDailyLTARRecord(
    htfState: HTFContextState,
    dateStr?: string
): LTARActivityRecord {
    const today = dateStr || new Date().toISOString().split('T')[0]!
    const key = `${today}_${htfState.instrument}`

    if (ltarCache.has(key)) {
        return ltarCache.get(key)!
    }

    const rf = htfState.macroContext.rotationFactor
    const perf = htfState.directionalPerformance
    const primaryExcess = htfState.primaryExcess

    // Part 1: Attempted Direction
    const rotationFactorScore = rf.score
    const rotationFactorDir: 'BUYER' | 'SELLER' | 'NEUTRAL' =
        rf.score > 1 ? 'BUYER' : rf.score < -1 ? 'SELLER' : 'NEUTRAL'

    const buyerTail = primaryExcess?.type === 'BUYING_EXCESS'
    const sellerTail = primaryExcess?.type === 'SELLING_EXCESS'

    let rangeExtension = 'None'
    if (htfState.profileShape === 'P_PROFILE_SHORT_COVER') rangeExtension = 'Short Covering Extension'
    else if (htfState.profileShape === 'B_PROFILE_LONG_LIQ') rangeExtension = 'Long Liquidation Extension'
    else if (rf.trend === 'OTF_BUYER_CONTROL') rangeExtension = 'Buying Range Extension'
    else if (rf.trend === 'OTF_SELLER_CONTROL') rangeExtension = 'Selling Range Extension'

    let buyingSellingComposite: 'BUYING' | 'SELLING' | 'BALANCING' = 'BALANCING'
    if (rf.trend === 'OTF_BUYER_CONTROL') buyingSellingComposite = 'BUYING'
    else if (rf.trend === 'OTF_SELLER_CONTROL') buyingSellingComposite = 'SELLING'

    let overallAttemptedDirection: 'HIGHER' | 'LOWER' | 'NEUTRAL' = 'NEUTRAL'
    if (buyingSellingComposite === 'BUYING' && rotationFactorScore >= 2) overallAttemptedDirection = 'HIGHER'
    else if (buyingSellingComposite === 'SELLING' && rotationFactorScore <= -2) overallAttemptedDirection = 'LOWER'

    let attemptedComments = 'Balancing day structure — expected rotational trade.'
    if (overallAttemptedDirection === 'HIGHER') attemptedComments = 'Strong buying trend structure with OTF buyer rotation.'
    else if (overallAttemptedDirection === 'LOWER') attemptedComments = 'Strong selling trend structure with OTF seller rotation.'

    // Part 2: Directional Performance
    let perfComments = 'Volume is healthy; trade facilitation aligned with value placement.'
    if (perf.grade === 'VERY_STRONG') {
        perfComments = 'Extremely high volume — trade facilitated aggressively all day.'
    } else if (perf.grade === 'SLOWING') {
        perfComments = 'Volume dropping at higher prices — trade facilitation is slowing.'
    } else if (perf.grade === 'FAILING_DIVERGENCE') {
        perfComments = 'WARNING: Attempted direction contradicts value placement! Buyers failing to facilitate trade.'
    }

    // Part 3: Expected Results (Playbook Directives)
    let longerTermDirective = 'Monitor for developing conviction today.'
    let shorterTermDirective = 'Stay responsive between 15m/30m range extremes.'

    if (perf.grade === 'VERY_STRONG') {
        longerTermDirective = 'Longer-term traders should HOLD trend positions for HTF extension targets.'
        shorterTermDirective = 'Shorter-term traders should BUY dips at VAL / 15m Floor.'
    } else if (perf.grade === 'SLOWING' || perf.grade === 'WEAK') {
        longerTermDirective = 'Longer-term traders should TIGHTEN stops / trim position size.'
        shorterTermDirective = 'Shorter-term traders should scalp mean-reversion; avoid holding runners.'
    } else if (perf.grade === 'FAILING_DIVERGENCE') {
        longerTermDirective = 'Longer-term traders should EXIT trend positions — trade facilitation failed.'
        shorterTermDirective = 'Shorter-term traders prepare for fade / reversal opportunities.'
    }

    const record: LTARActivityRecord = {
        date: today,
        market: htfState.instrument,
        attemptedDirection: {
            rotationFactorScore,
            rotationFactorDir,
            rangeExtension,
            tails: { buyerTail, sellerTail },
            buyingSellingComposite,
            overallAttemptedDirection,
            comments: attemptedComments,
        },
        directionalPerformance: {
            dailyVolume: 120000,
            dailyVolumeVsAvg: perf.volumeRel,
            auctionAverageVolume: 110000,
            auctionAvgVsAvg: 'HIGHER',
            valueAreaPlacement: perf.vaPlacement,
            valueAreaWidth: perf.vaWidth,
            performanceGrade: perf.grade,
            comments: perfComments,
        },
        expectedResults: {
            longerTermDirective,
            shorterTermDirective,
            summary: `Expected R:R Target ${perf.dynamicRR.targetMultiplier}x (${perf.dynamicRR.expectedRR}) — ${perf.dynamicRR.holdingDirective}`,
        },
    }

    ltarCache.set(key, record)
    return record
}
