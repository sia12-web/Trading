/**
 * Live Voice desk context snapshot (Slice 2).
 * Assembles only from existing desk sources — never invents prices/levels.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AVWAP_LOOKBACK_TRADING_DAYS,
  cashOpenUnixForYmd,
  deskClockFor,
} from '@/lib/chart/sessionVwap'
import { TRADER_DISPLAY_LABEL, TRADER_DISPLAY_TZ, deskLocalHmsAsTraderDisplay, deskLocalRangeAsTraderDisplay } from '@/lib/chart/traderDisplayTz'
import {
  AI_LEVELS_QUERY,
  buildDeskPlaybook,
  levelSide,
  mapAiLevels,
  resolveDeskLevels,
  type DeskBias,
  type DeskLevel,
} from '@/lib/trading/deskLevels'
import {
  getTodayAttendance,
  tradeDateForInstrument,
} from '@/lib/trading/deskAttendance'
import {
  riskPercentForSessionAttempt,
} from '@/lib/trading/positionSizing'
import {
  MAX_DAY_ATTEMPTS,
  MAX_STOP_HITS,
  deskMarketFor,
  instrumentsForDeskMarket,
  isDeskHoursNow,
  isLiveDeskInstrument,
  isNyDeskInstrument,
  ibStrategyStartHms,
  ibStrategyEndHms,
  lunchRangeEntryStartHms,
  lunchRangeEntryEndHms,
  resolveSessionGate,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { attemptLadderFromCounts, formatAttemptLadderShort } from '@/lib/trading/attemptLadder'
import {
  deskPlaybookTitle,
  deskPlaybookAnalysisMode,
  resolveDeskPlaybookMode,
} from '@/lib/trading/deskPlaybookMode'
import { getESTDateString } from '@/lib/utils/timeUtils'
import {
  resolveLiveVoiceStatus,
  type LiveVoiceStatus,
} from '@/lib/trading/liveVoice'
import { loadLiveVoicePins, type LiveVoicePin } from '@/lib/trading/liveVoiceSession'
import { buildRangeEdgeTailBrief } from '@/lib/trading/rangeEdgeTailBrief'
import {
  buildRangeLiquidityBrief,
  formatRangeLiquidityBriefForPrompt,
} from '@/lib/trading/rangeLiquidityBrief'
import {
  formatOpenBookManageForPrompt,
  structureFromRangeBrief,
} from '@/lib/trading/manageOpenBook'
import { computeRvol } from '@/lib/trading/manageSignals'
import {
  buildLeoSessionTiming,
  type LeoSessionTiming,
} from '@/lib/trading/leoSessionTiming'
import {
  tradeifyLeoEntryRule,
  type TradeifyLeoSnapshot,
} from '@/lib/trading/tradeifyLeoBlock'
import {
  loadTradeifySessionSnapshot,
  toTradeifyLeoSnapshot,
} from '@/lib/trading/tradeifySessionState'
import { computeHTFContextState, type HTFContextState, type HTFBarInput } from '@/lib/trading/htfSpecialist'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { getOandaCandles } from '@/lib/oanda/candles'

export type LiveVoiceContextLevel = {
  price: number
  side: 'BUY' | 'SHORT'
  rank: 'primary' | 'watch' | null
  type: string
  conviction: number
  reasoning: string | null
  source: 'ai' | 'structure'
  marketVerdict: string | null
  testedCount: number | null
  successCount: number | null
}

export type LiveVoiceDeskContext = {
  voice: LiveVoiceStatus
  session: {
    phase: string
    message: string
    lockedInstrument: DeskInstrument | null
    viewingInstrument: DeskInstrument
    canPlaceEntry: boolean
    canManagePosition: boolean
    attemptsUsed: number
    maxAttempts: number
    stopHits: number
    maxStopHits: number
    morningAttempts: number
    ibAttempts: number
    lunchAttempts: number
    maxMorningAttempts: number
    maxIbAttempts: number
    maxLunchAttempts: number
    ibEligible: boolean
    lunchEligible: boolean
    attemptLadderLabel: string
    openPositionId: string | null
    entryWindow: 1 | 2 | 3 | null
    rangeStrategy: 'or30' | 'ib' | 'us_range' | null
    playbookMode: 'morning' | 'or30' | 'ib' | 'us_range' | 'lunch_break' | 'done'
    playbookTitle: string
    tradeDate: string
    times: {
      analyzeStart: string
      marketOpen: string
      entryClose: string
      lunchClose: string
      marketClose: string
      ibEntry: string
      lunchRangeEntry: string
      tz: string
      tzLabel: string
    }
    /** Fresh wall-clock OR30 / IB / lunch (or Nikkei US / Tokyo IB) status for Leo. */
    timing: LeoSessionTiming
  }
  risk: {
    deskRiskPercent: number
    manualRiskPercent: number
    maxAttempts: number
    maxStopHits: number
    entryRule: string
  }
  /** Present only when Tradeify $50k profile is on — Leo/Telegram stay silent otherwise. */
  tradeify?: TradeifyLeoSnapshot | null
  /** Printed OR30 / slot-2 / slot-3 bait facts for Leo (optional). */
  rangeLiquidityBriefText?: string | null
  /** When a book is filled — leave / pullback / reverse facts for Leo. */
  openBookManageText?: string | null
  /** Latest good/strong ±10 range-edge tail (other-TF footprint). */
  rangeTail?: {
    present: boolean
    edge: 'high' | 'low' | null
    tier: 'light' | 'good' | 'strong' | null
    ratio: number | null
    label: string | null
    text: string | null
    ageSec: number | null
    wickPts: number | null
    bodyPts: number | null
  } | null
  htfContext?: import('@/lib/trading/htfSpecialist').HTFContextState | null
  avwap: {
    openLabel: string
    lookbackTradingDays: number
    timeZone: string
    cashOpenHour: number
    bandNote: string
  }
  overnight: {
    ready: boolean
    regime: string | null
    regimeConfidence: number | null
    recommendationConfidence: number | null
    gapPercent: number | null
    overnightOhlc: {
      open: number | null
      high: number | null
      low: number | null
      close: number | null
    } | null
    newsSummary: string | null
    source: 'regime_cache' | 'none'
  }
  market: {
    livePrice: number | null
  }
  levels: {
    source: 'ai' | 'empty'
    count: number
    focusSide: 'BUY' | 'SHORT' | 'BOTH'
    focusHint: string
    items: LiveVoiceContextLevel[]
  }
  userPins: LiveVoicePin[]
  workingOrders: Array<{
    id: string
    instrument: string
    direction: string
    entryLevel: number
    stopLoss: number
    takeProfit: number | null
    entrySource: string
  }>
  activePosition: {
    id: string
    instrument: string
    direction: string
    fillPrice: number
    stopLoss: number
    takeProfit: number | null
    entrySource: string
  } | null
  voiceSessionId: string | null
}

function biasFromRegime(regime: string | null | undefined): DeskBias {
  if (regime === 'bullish') return 'bullish'
  if (regime === 'bearish') return 'bearish'
  return 'none'
}

function toContextLevel(l: DeskLevel): LiveVoiceContextLevel {
  return {
    price: l.level,
    side: l.side ?? levelSide(l.type),
    rank: l.rank ?? null,
    type: l.type,
    conviction: l.conviction,
    reasoning: l.reasoning?.trim() ? l.reasoning : null,
    source: l.source,
    marketVerdict: l.marketVerdict ?? null,
    testedCount: l.testedCount ?? null,
    successCount: l.successCount ?? null,
  }
}

async function resolveLockedInstrument(
  supabase: SupabaseClient,
  nyRecDate: string
): Promise<DeskInstrument | null> {
  const { data: rec } = await supabase
    .from('market_recommendations')
    .select('recommended_instrument')
    .eq('date', nyRecDate)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let locked: DeskInstrument | null = null
  if (rec?.recommended_instrument && isNyDeskInstrument(rec.recommended_instrument)) {
    locked = rec.recommended_instrument
  } else {
    const { data: regimes } = await supabase
      .from('regime_cache')
      .select('instrument, recommendation_confidence')
      .eq('date', nyRecDate)
      .in('instrument', ['DOW', 'NASDAQ'])
      .order('recommendation_confidence', { ascending: false })
      .limit(1)
    const top = regimes?.[0]
    if (top?.instrument && isNyDeskInstrument(top.instrument)) {
      locked = top.instrument
    }
  }

  if (isDeskHoursNow(new Date(), 'NIKKEI').open) {
    locked = 'NIKKEI'
  }
  return locked
}

/**
 * Build Live Voice context from desk DB + pure helpers only.
 * Caller must enforce auth. Clock-in is reflected in `voice` / session.
 */
export async function buildLiveVoiceDeskContext(
  supabase: SupabaseClient,
  userId: string,
  viewingInstrument: string | null | undefined,
  now = new Date(),
  _opts?: { riskProfile?: string | null; cookieHeader?: string | null }
): Promise<LiveVoiceDeskContext> {
  const viewing: DeskInstrument = isLiveDeskInstrument(viewingInstrument || '')
    ? (viewingInstrument as DeskInstrument)
    : 'DOW'

  const nyRecDate = getESTDateString(now)
  let lockedInstrument = await resolveLockedInstrument(supabase, nyRecDate)

  const market = deskMarketFor(lockedInstrument ?? viewing)
  const marketInstruments = instrumentsForDeskMarket(market)
  const tradeDate = tradeDateForInstrument(lockedInstrument ?? viewing, now)

  const [openPosRes, filledRes, workingRes, tradeifySnap] = await Promise.all([
    supabase
      .from('trades_journal')
      .select('id, instrument, direction, fill_price, entry_level, stop_loss, take_profit, entry_source')
      .eq('user_id', userId)
      .eq('trade_date', tradeDate)
      .in('instrument', marketInstruments)
      .eq('fill_status', 'filled')
      .is('exit_timestamp', null)
      .maybeSingle(),
    supabase
      .from('trades_journal')
      .select('id, instrument, exit_reason, entry_timestamp, created_at, range_bucket')
      .eq('user_id', userId)
      .eq('trade_date', tradeDate)
      .in('instrument', marketInstruments)
      .eq('fill_status', 'filled'),
    supabase
      .from('trades_journal')
      .select('id, instrument, direction, entry_level, stop_loss, take_profit, entry_source')
      .eq('user_id', userId)
      .eq('trade_date', tradeDate)
      .in('instrument', marketInstruments)
      .eq('fill_status', 'working'),
    loadTradeifySessionSnapshot(supabase, userId, now),
  ])

  const openPos = openPosRes.data
  if (openPos?.instrument && isLiveDeskInstrument(openPos.instrument)) {
    lockedInstrument = openPos.instrument as DeskInstrument
  }

  const filledTrades = filledRes.data ?? []
  const attemptsUsed = filledTrades.length
  const stopHits = filledTrades.filter((t) => t.exit_reason === 'stop_hit').length

  const workingOrders = (workingRes.data || []).map((w) => ({
    id: w.id as string,
    instrument: w.instrument as string,
    direction: w.direction as string,
    entryLevel: Number(w.entry_level ?? 0),
    stopLoss: Number(w.stop_loss ?? 0),
    takeProfit: w.take_profit != null ? Number(w.take_profit) : null,
    entrySource: (w.entry_source as string) || 'manual_pin',
  }))

  const activePosition = openPos
    ? {
      id: openPos.id as string,
      instrument: openPos.instrument as string,
      direction: openPos.direction as string,
      fillPrice: Number(openPos.fill_price ?? openPos.entry_level ?? 0),
      stopLoss: Number(openPos.stop_loss ?? 0),
      takeProfit: openPos.take_profit != null ? Number(openPos.take_profit) : null,
      entrySource: (openPos.entry_source as string) || 'manual_pin',
    }
    : null

  const attendance = await getTodayAttendance(supabase, userId, market, now)
  const clockedIn = attendance?.status === 'clocked_in'
  const attendedToday = !!attendance

  const contextInstrument = (lockedInstrument ?? viewing) as DeskInstrument
  const attemptFills = filledTrades.map((t) => ({
    instrument: (t.instrument as string) || contextInstrument,
    entryTimestamp: t.entry_timestamp || t.created_at || null,
    exitReason: (t.exit_reason as string) || null,
    rangeBucket:
      (t as { range_bucket?: string | null }).range_bucket as
      | 'morning'
      | 'ib'
      | 'lunch_range'
      | 'other'
      | null
      | undefined,
  }))
  const voice = resolveLiveVoiceStatus({
    now,
    instrument: contextInstrument,
    clockedIn,
  })

  const gate = resolveSessionGate({
    now,
    lockedInstrument,
    hasOpenPosition: !!openPos,
    attemptsUsed,
    stopLossHitCount: stopHits,
    attemptFills,
    viewingInstrument: viewing,
    clockedIn,
    attendedToday,
  })

  const sess = sessionFor(contextInstrument)
  const tzLabel = TRADER_DISPLAY_LABEL
  const clock = deskClockFor(contextInstrument)

  // Overnight / regime from regime_cache (live source — not simOvernightBias)
  const { data: regimeRow } = await supabase
    .from('regime_cache')
    .select(
      'regime, regime_confidence, recommendation_confidence, gap_percent, overnight_open, overnight_high, overnight_low, overnight_close, news_headlines'
    )
    .eq('date', nyRecDate)
    .eq('instrument', contextInstrument)
    .maybeSingle()

  const overnight = regimeRow
    ? {
      ready: Number(regimeRow.recommendation_confidence ?? 0) >= 65,
      regime: typeof regimeRow.regime === 'string' ? regimeRow.regime : null,
      regimeConfidence:
        regimeRow.regime_confidence != null
          ? Number(regimeRow.regime_confidence)
          : null,
      recommendationConfidence:
        regimeRow.recommendation_confidence != null
          ? Number(regimeRow.recommendation_confidence)
          : null,
      gapPercent:
        regimeRow.gap_percent != null ? Number(regimeRow.gap_percent) : null,
      overnightOhlc: {
        open:
          regimeRow.overnight_open != null
            ? Number(regimeRow.overnight_open)
            : null,
        high:
          regimeRow.overnight_high != null
            ? Number(regimeRow.overnight_high)
            : null,
        low:
          regimeRow.overnight_low != null
            ? Number(regimeRow.overnight_low)
            : null,
        close:
          regimeRow.overnight_close != null
            ? Number(regimeRow.overnight_close)
            : null,
      },
      newsSummary: Array.isArray(regimeRow.news_headlines)
        ? regimeRow.news_headlines
          .slice(0, 3)
          .map((h: { headline?: string }) => h?.headline)
          .filter(Boolean)
          .join(' | ') || null
        : null,
      source: 'regime_cache' as const,
    }
    : {
      ready: false,
      regime: null,
      regimeConfidence: null,
      recommendationConfidence: null,
      gapPercent: null,
      overnightOhlc: null,
      newsSummary: null,
      source: 'none' as const,
    }

  // AI levels from level_history — query by instrument (fallback across desk history if needed)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - AI_LEVELS_QUERY.days)

  let { data: levelRows } = await supabase
    .from('level_history')
    .select(
      'level, type, conviction, reasoning, last_verdict, last_outcome, tested_count, success_count'
    )
    .eq('instrument', contextInstrument)
    .gte('created_at', cutoff.toISOString())
    .gte('conviction', AI_LEVELS_QUERY.minConviction)
    .order('created_at', { ascending: false })
    .limit(AI_LEVELS_QUERY.limit)

  if (!levelRows || levelRows.length === 0) {
    // Fallback: fetch most recent levels for this instrument regardless of cutoff date
    const { data: fallbackRows } = await supabase
      .from('level_history')
      .select(
        'level, type, conviction, reasoning, last_verdict, last_outcome, tested_count, success_count'
      )
      .eq('instrument', contextInstrument)
      .order('created_at', { ascending: false })
      .limit(AI_LEVELS_QUERY.limit)
    levelRows = fallbackRows
  }

  let mapped = mapAiLevels(levelRows ?? [])
  const bias = biasFromRegime(overnight.regime)

  if (mapped.length === 0) {
    // Generate structural levels (AVWAP bands, stop pools, round handles) so Leo NEVER sees empty levels
    const openUnix = cashOpenUnixForYmd(voice.tradeDate, clock)
    const resolved = resolveDeskLevels([], [], openUnix, clock.timeZone, bias)
    mapped = resolved.levels
  }

  const playbook = buildDeskPlaybook(mapped, bias)

  let userPins: LiveVoicePin[] = []
  let voiceSessionId: string | null = null
  if (clockedIn) {
    const { data: voiceSession } = await supabase
      .from('live_voice_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('instrument', contextInstrument)
      .eq('trade_date', voice.tradeDate)
      .maybeSingle()
    if (voiceSession?.id) {
      voiceSessionId = voiceSession.id as string
      userPins = await loadLiveVoicePins(supabase, voiceSessionId, userId)
    }
  }

  const activeLivePrice =
    playbook.levels.length > 0
      ? playbook.levels[0]!.level
      : userPins.length > 0
        ? userPins[0]!.price
        : null

  const morningAttempts = gate.morningAttempts ?? 0
  const ibAttempts = gate.ibAttempts ?? 0
  const lunchAttempts = gate.lunchAttempts ?? 0
  const maxMorningAttempts = gate.maxMorningAttempts ?? 2
  const maxIbAttempts = gate.maxIbAttempts ?? 2
  const maxLunchAttempts = gate.maxLunchAttempts ?? 2
  const ladder = attemptLadderFromCounts({
    morningAttempts,
    ibAttempts,
    lunchAttempts,
    morningStopHits: gate.stopHits ?? stopHits,
  })
  const playbookMode = resolveDeskPlaybookMode({
    instrument: contextInstrument,
    now,
    rangeStrategy: gate.rangeStrategy,
    ladder,
  })

  // Always rebuild from this request's `now` — never reuse a stale snapshot.
  const timing = buildLeoSessionTiming({
    instrument: contextInstrument,
    now,
    ladder,
  })

  const rangeTail = await buildRangeEdgeTailBrief({
    instrument: contextInstrument,
    now,
    ladder,
    rangeStrategy: gate.rangeStrategy ?? null,
    morningAttempts,
  })

  let rangeLiquidityBriefText: string | null = null
  let openBookManageText: string | null = null
  let m5Bars: HTFBarInput[] = []
  try {
    const analysisMode = deskPlaybookAnalysisMode(playbookMode, contextInstrument)
    const [h1, m5Yahoo, m5Oanda, quote] = await Promise.all([
      getYahooCandles(contextInstrument, '60', 10),
      getYahooCandles(contextInstrument, '5', 12),
      getOandaCandles(contextInstrument, '5', 12).catch(() => null),
      getYahooQuote(contextInstrument),
    ])
    const m5 = m5Yahoo?.candles?.length ? m5Yahoo : m5Oanda
    const h1Bars = (h1?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
    m5Bars = (m5?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
    const tip =
      quote?.price ??
      (h1Bars.length ? h1Bars[h1Bars.length - 1]!.close : null) ??
      activeLivePrice
    if (tip != null && tip > 0 && h1Bars.length >= 2) {
      const brief = buildRangeLiquidityBrief({
        instrument: contextInstrument,
        candlesH1: h1Bars,
        tip,
        nowUnix: Math.floor(now.getTime() / 1000),
        analysisMode,
        candles5m: m5Bars.length ? m5Bars : undefined,
        bookLocked:
          (gate.attemptsUsed ?? attemptsUsed) >= MAX_DAY_ATTEMPTS ||
          !!gate.dayLocked ||
          !!openPos ||
          workingOrders.length > 0,
      })
      if (brief) rangeLiquidityBriefText = formatRangeLiquidityBriefForPrompt(brief)
      if (brief && activePosition) {
        const structure = structureFromRangeBrief({
          direction: activePosition.direction,
          tip,
          brief,
        })
        openBookManageText = formatOpenBookManageForPrompt({
          direction: activePosition.direction,
          fillPrice: activePosition.fillPrice,
          livePrice: tip,
          stopLoss: activePosition.stopLoss,
          takeProfit: activePosition.takeProfit,
          rvol: computeRvol(m5Bars.map((b) => b.volume || 0)),
          structure,
        })
      }
    }
  } catch {
    /* optional — Leo still has system ATR rules */
  }
  if (!openBookManageText && activePosition) {
    openBookManageText = formatOpenBookManageForPrompt({
      direction: activePosition.direction,
      fillPrice: activePosition.fillPrice,
      livePrice: activeLivePrice,
      stopLoss: activePosition.stopLoss,
      takeProfit: activePosition.takeProfit,
    })
  }

  let htfContext: HTFContextState | null = null
  try {
    if (m5Bars.length > 0) {
      htfContext = computeHTFContextState({
        instrument: contextInstrument,
        candles5m: m5Bars,
        asOfUnix: Math.floor(now.getTime() / 1000),
      })
    }
  } catch {
    htfContext = null
  }

  let levelItems = playbook.levels.map(toContextLevel)
  if (rangeTail.present && (rangeTail.tier === 'good' || rangeTail.tier === 'strong')) {
    levelItems = levelItems
      .map((l) => {
        const matchHigh = rangeTail.edge === 'high' && l.side === 'SHORT'
        const matchLow = rangeTail.edge === 'low' && l.side === 'BUY'
        if (!matchHigh && !matchLow) return l
        return { ...l, conviction: Math.min(10, l.conviction + 2) }
      })
      .sort((a, b) => b.conviction - a.conviction)
  }

  return {
    voice,
    session: {
      phase: gate.phase,
      message: gate.message,
      lockedInstrument: gate.lockedInstrument,
      viewingInstrument: viewing,
      canPlaceEntry: !!gate.canPlaceEntry,
      canManagePosition: !!gate.canManagePosition,
      attemptsUsed: gate.attemptsUsed ?? attemptsUsed,
      maxAttempts: gate.maxAttempts ?? MAX_DAY_ATTEMPTS,
      stopHits: gate.stopHits ?? stopHits,
      maxStopHits: gate.maxStopHits ?? MAX_STOP_HITS,
      morningAttempts,
      ibAttempts,
      lunchAttempts,
      maxMorningAttempts,
      maxIbAttempts,
      maxLunchAttempts,
      ibEligible: ladder.ibEligible,
      lunchEligible: ladder.lunchEligible,
      attemptLadderLabel:
        gate.attemptLadderLabel ||
        formatAttemptLadderShort(ladder, contextInstrument),
      openPositionId: openPos?.id ?? null,
      entryWindow: gate.entryWindow,
      rangeStrategy: gate.rangeStrategy ?? null,
      playbookMode,
      playbookTitle: deskPlaybookTitle(playbookMode, contextInstrument),
      tradeDate,
      times: {
        analyzeStart: deskLocalHmsAsTraderDisplay(sess.analyzeStart, sess.tz, now),
        marketOpen: deskLocalHmsAsTraderDisplay(sess.marketOpen, sess.tz, now),
        entryClose: deskLocalHmsAsTraderDisplay(sess.entryClose, sess.tz, now),
        lunchClose: deskLocalHmsAsTraderDisplay(sess.lunchClose, sess.tz, now),
        marketClose: deskLocalHmsAsTraderDisplay(sess.marketClose, sess.tz, now),
        ibEntry: deskLocalRangeAsTraderDisplay(
          ibStrategyStartHms(market),
          ibStrategyEndHms(market),
          sess.tz,
          now
        ).replace(` ${TRADER_DISPLAY_LABEL}`, ''),
        lunchRangeEntry: deskLocalRangeAsTraderDisplay(
          lunchRangeEntryStartHms(market),
          lunchRangeEntryEndHms(market),
          sess.tz,
          now
        ).replace(` ${TRADER_DISPLAY_LABEL}`, ''),
        tz: TRADER_DISPLAY_TZ,
        tzLabel,
      },
      timing,
    },
    risk: {
      deskRiskPercent: riskPercentForSessionAttempt(gate.attemptsUsed ?? attemptsUsed),
      manualRiskPercent: riskPercentForSessionAttempt(gate.attemptsUsed ?? attemptsUsed),
      maxAttempts: MAX_DAY_ATTEMPTS,
      maxStopHits: MAX_STOP_HITS,
      entryRule: tradeifyLeoEntryRule(contextInstrument),
    },
    tradeify: toTradeifyLeoSnapshot(tradeifySnap, now),
    rangeLiquidityBriefText,
    openBookManageText,
    rangeTail,
    htfContext,
    avwap: {
      openLabel: clock.openLabel,
      lookbackTradingDays: AVWAP_LOOKBACK_TRADING_DAYS,
      timeZone: clock.timeZone,
      cashOpenHour: clock.cashOpenHour,
      bandNote: `${clock.openLabel} · ${AVWAP_LOOKBACK_TRADING_DAYS} trading days prior · ±1/2/3σ`,
    },
    overnight,
    market: {
      livePrice: activeLivePrice,
    },
    levels: {
      source: playbook.levels.length > 0 ? 'ai' : 'empty',
      count: levelItems.length,
      focusSide: playbook.focusSide,
      focusHint: playbook.focusHint,
      items: levelItems,
    },
    userPins,
    workingOrders,
    activePosition,
    voiceSessionId,
  }
}
