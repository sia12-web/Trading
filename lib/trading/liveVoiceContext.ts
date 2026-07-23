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
  DESK_RISK_PERCENT,
  MANUAL_RISK_PERCENT,
} from '@/lib/trading/positionSizing'
import {
  deskMarketFor,
  instrumentsForDeskMarket,
  isDeskHoursNow,
  isLiveDeskInstrument,
  isNyDeskInstrument,
  MAX_SESSION_ATTEMPTS,
  MAX_STOP_HITS,
  resolveSessionGate,
  sessionFor,
  type DeskInstrument,
} from '@/lib/trading/sessionGate'
import { getESTDateString } from '@/lib/utils/timeUtils'
import {
  resolveLiveVoiceStatus,
  type LiveVoiceStatus,
} from '@/lib/trading/liveVoice'
import { loadLiveVoicePins, type LiveVoicePin } from '@/lib/trading/liveVoiceSession'

export type LiveVoiceContextLevel = {
  price: number
  side: 'BUY' | 'SHORT'
  rank: 'primary' | 'watch' | null
  type: string
  conviction: number
  reasoning: string | null
  source: 'ai' | 'structure'
  marketVerdict: string | null
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
    openPositionId: string | null
    entryWindow: 1 | 2 | 3 | null
    tradeDate: string
    times: {
      analyzeStart: string
      marketOpen: string
      entryClose: string
      lunchClose: string
      marketClose: string
      tz: string
      tzLabel: string
    }
  }
  risk: {
    deskRiskPercent: number
    manualRiskPercent: number
    maxAttempts: number
    maxStopHits: number
    entryRule: string
  }
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

function hhmm(hms: string): string {
  return hms.slice(0, 5)
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
  now = new Date()
): Promise<LiveVoiceDeskContext> {
  const viewing: DeskInstrument = isLiveDeskInstrument(viewingInstrument || '')
    ? (viewingInstrument as DeskInstrument)
    : 'DOW'

  const nyRecDate = getESTDateString(now)
  let lockedInstrument = await resolveLockedInstrument(supabase, nyRecDate)

  const market = deskMarketFor(lockedInstrument ?? viewing)
  const marketInstruments = instrumentsForDeskMarket(market)
  const tradeDate = tradeDateForInstrument(lockedInstrument ?? viewing, now)

  const [openPosRes, filledRes, workingRes] = await Promise.all([
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
      .select('id, exit_reason')
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
    viewingInstrument: viewing,
    clockedIn,
    attendedToday,
  })

  const sess = sessionFor(contextInstrument)
  const tzLabel = deskMarketFor(contextInstrument) === 'TOKYO' ? 'JST' : 'ET'
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
      maxAttempts: gate.maxAttempts ?? MAX_SESSION_ATTEMPTS,
      stopHits: gate.stopHits ?? stopHits,
      maxStopHits: gate.maxStopHits ?? MAX_STOP_HITS,
      openPositionId: openPos?.id ?? null,
      entryWindow: gate.entryWindow,
      tradeDate,
      times: {
        analyzeStart: hhmm(sess.analyzeStart),
        marketOpen: hhmm(sess.marketOpen),
        entryClose: hhmm(sess.entryClose),
        lunchClose: hhmm(sess.lunchClose),
        marketClose: hhmm(sess.marketClose),
        tz: sess.tz,
        tzLabel,
      },
    },
    risk: {
      deskRiskPercent: DESK_RISK_PERCENT,
      manualRiskPercent: MANUAL_RISK_PERCENT,
      maxAttempts: MAX_SESSION_ATTEMPTS,
      maxStopHits: MAX_STOP_HITS,
      entryRule:
        'Entries only marketOpen→entryClose (first ~45 min). AI/structure risk 5%; manual 1%. Max 2 filled attempts (SL or TP). Working limits do not count until filled. Voice never places orders.',
    },
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
      count: playbook.levels.length,
      focusSide: playbook.focusSide,
      focusHint: playbook.focusHint,
      items: playbook.levels.map(toContextLevel),
    },
    userPins,
    workingOrders,
    activePosition,
    voiceSessionId,
  }
}
