/**
 * Level Finder Agent Service
 * Proposer LLM (Claude Opus by default) + deterministic anti-hallucination
 * grounding + optional Gemini Flash verifier. Usage logged to llm_usage.
 */

import {
  computeAnchoredVwap,
  deskClockFor,
  lastNTradingSessions,
} from '@/lib/chart/sessionVwap'
import { computeVolumeProfile } from '@/lib/chart/volumeProfile'
import { filterByConfluence } from '@/lib/trading/levelConfluence'
import { sessionFor } from '@/lib/trading/sessionGate'
import { createClient } from '@/lib/supabase/server'
import { groundLevels, onlyGrounded } from '@/lib/llm/antiHallucination'
import { llmComplete } from '@/lib/llm/complete'
import {
  isProviderConfigured,
  llmConfigSnapshot,
  llmModel,
  llmProvider,
} from '@/lib/llm/config'
import { logLlmUsage } from '@/lib/llm/usageLog'
import { verifyLevelsKeepDrop } from '@/lib/llm/verifier'
import { logger } from '@/lib/utils/logger'
import type {
  AnalysisRequest,
  LevelIdentification,
  ValidationResult,
  StoredLevel,
  Candle,
  ClaudeUsage,
  AnalysisRequestWithContext,
  HistoricalContext,
} from './types'

const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000
const DUPLICATE_THRESHOLD_PIPS = 50
const MAX_LEVELS = 10

class LevelFinderAgent {
  async initialize(): Promise<void> {
    const cfg = llmConfigSnapshot()
    // Live or sim proposer must be available (same Anthropic key covers both by default)
    if (!cfg.proposer.configured && !cfg.sim_proposer.configured) {
      throw new Error(
        `LLM proposer not configured (live=${cfg.proposer.provider}, sim=${cfg.sim_proposer.provider}). Set ANTHROPIC_API_KEY or GEMINI_API_KEY.`
      )
    }
    logger.info('level_finder.init', cfg)
  }

  async analyzePriceAction(request: AnalysisRequestWithContext): Promise<{
    levels: LevelIdentification[]
    usage: ClaudeUsage
  }> {
    const tier = request.llm_tier === 'sim' ? 'sim' : 'live'
    const provider = llmProvider('proposer', tier)
    const model = llmModel('proposer', tier)
    if (!isProviderConfigured(provider)) {
      throw new Error(
        `LLM provider ${provider} not configured for ${tier} tier (set ANTHROPIC_API_KEY or GEMINI_API_KEY)`
      )
    }

    const prompt = this.buildAnalysisPrompt(request)
    const systemPrompt = this.buildSystemPrompt(request.index, request.historicalContext)
    const avwapBands = this.extractAvwapBandPrices(request)
    const vpAnchors = this.extractVolumeProfileAnchors(request)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS)

    let proposerUsage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 }
    let proposedCount = 0
    let acceptedCount = 0
    let rejectedCount = 0
    const proposerRoute =
      tier === 'sim' ? 'level_finder.proposer.sim' : 'level_finder.proposer'

    try {
      let text: string
      try {
        const result = await llmComplete(
          {
            provider,
            model,
            system: systemPrompt,
            user: prompt,
            maxTokens: 1024,
            temperature: 0.2,
          },
          controller.signal
        )
        text = result.text
        proposerUsage = {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          provider: result.usage.provider,
          model: result.usage.model,
        }
        result.usage.role = 'proposer'
        await logLlmUsage({
          usage: result.usage,
          route: proposerRoute,
          instrument: request.index,
          sessionId: request.session_id,
          success: true,
          meta: { tier },
        })
      } finally {
        clearTimeout(timeoutId)
      }

      const parsed = this.parseClaudeResponse(text)
      proposedCount = parsed.length

      const allCandles = [
        ...request.candles_daily,
        ...request.candles_4h,
        ...request.candles_h1,
      ]
      const grounded = groundLevels(parsed, {
        candles: allCandles,
        currentPrice: request.current_price,
        avwapBands,
        vpAnchors,
        snap: false,
      })
      const afterGround = onlyGrounded(grounded)
      rejectedCount = proposedCount - afterGround.length

      logger.info('level_finder.grounded', {
        instrument: request.index,
        proposed: proposedCount,
        grounded: afterGround.length,
        rejected: rejectedCount,
        rejects: grounded
          .filter((g) => !g.grounded)
          .map((g) => ({ level: g.level, reason: g.reject_reason })),
      })

      const verified = await verifyLevelsKeepDrop(afterGround, {
        instrument: request.index,
        currentPrice: request.current_price,
      })
      if (verified.usage) {
        await logLlmUsage({
          usage: verified.usage,
          route: 'level_finder.verifier',
          instrument: request.index,
          sessionId: request.session_id,
          success: true,
          levelsProposed: afterGround.length,
          levelsAccepted: verified.kept.length,
          levelsRejected: afterGround.length - verified.kept.length,
        })
      }

      // Confluence gate: ≥2 of stop-pool / AVWAP / POC-HVN (same for live + sim)
      const deskBars = request.candles_h1
        .map((c) => ({
          time: Math.floor(new Date(c.timestamp).getTime() / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        .filter((b) => Number.isFinite(b.time))
      const openUnix =
        deskBars.length > 0
          ? Math.max(...deskBars.map((b) => b.time)) + 1
          : Math.floor(Date.now() / 1000)
      const timeZone = sessionFor(request.index).tz
      const afterConfluence = filterByConfluence(verified.kept, {
        candles: deskBars,
        openUnix,
        timeZone,
        avwapBands,
        vpAnchors,
      })

      const levels = afterConfluence.slice(0, MAX_LEVELS)
      acceptedCount = levels.length

      logger.info('level_finder.done', {
        instrument: request.index,
        proposed: proposedCount,
        grounded: afterGround.length,
        verified: verified.kept.length,
        confluence: acceptedCount,
        rejected:
          rejectedCount +
          (afterGround.length - verified.kept.length) +
          (verified.kept.length - acceptedCount),
        model,
        provider,
        vpAnchors: vpAnchors.length,
      })

      return { levels, usage: proposerUsage }
    } catch (error) {
      clearTimeout(timeoutId)
      const msg = error instanceof Error ? error.message : 'LLM failed'
      await logLlmUsage({
        usage: {
          provider,
          model,
          role: 'proposer',
          input_tokens: proposerUsage.input_tokens,
          output_tokens: proposerUsage.output_tokens,
        },
        route: proposerRoute,
        instrument: request.index,
        sessionId: request.session_id,
        success: false,
        errorMessage: msg,
        meta: { tier },
      })

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('LLM request timeout (exceeded 5 minutes)')
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private extractAvwapBandPrices(request: AnalysisRequest): number[] {
    const bars = request.candles_h1
      .map((c) => ({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
      .filter((b) => Number.isFinite(b.time))
      .sort((a, b) => a.time - b.time)

    if (bars.length === 0) return []

    const clock = deskClockFor(request.index)
    const scoped = lastNTradingSessions(bars, 5, clock)
    const bands = computeAnchoredVwap(scoped.length > 0 ? scoped : bars, clock)
    if (!bands || bands.vwap.length === 0) return []

    const i = bands.vwap.length - 1
    return [
      bands.vwap[i]!.value,
      bands.upper1[i]!.value,
      bands.lower1[i]!.value,
      bands.upper2[i]!.value,
      bands.lower2[i]!.value,
      bands.upper3[i]!.value,
      bands.lower3[i]!.value,
    ].filter((n) => Number.isFinite(n) && n > 0)
  }

  /** Prefer H1 bars (as-of open upstream); fall back to 4H if thin. */
  private extractVolumeProfileAnchors(request: AnalysisRequest): number[] {
    const profile = this.computeRequestVolumeProfile(request)
    return profile?.anchors ?? []
  }

  private computeRequestVolumeProfile(request: AnalysisRequest) {
    const toBars = (candles: Candle[]) =>
      candles
        .map((c) => ({
          time: Math.floor(new Date(c.timestamp).getTime() / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: Math.max(0, c.volume || 0),
        }))
        .filter((b) => Number.isFinite(b.time))
        .sort((a, b) => a.time - b.time)

    let bars = toBars(request.candles_h1)
    let profile = computeVolumeProfile(bars)
    if (!profile) {
      bars = toBars(request.candles_4h)
      profile = computeVolumeProfile(bars)
    }
    return profile
  }

  private buildVolumeProfileSection(request: AnalysisRequest): string {
    const profile = this.computeRequestVolumeProfile(request)
    if (!profile) return ''

    const fmt = (n: number) => n.toFixed(2)
    const hvnLine =
      profile.hvn.length > 0
        ? profile.hvn.map((h, i) => `HVN${i + 1}: ${fmt(h.price)}`).join(' · ')
        : '(no secondary HVN)'

    return `
VOLUME-BY-PRICE (deterministic profile from as-of-open H1/4H bars — NOT invented):
- POC (point of control / highest volume price): ${fmt(profile.poc.price)}
- ${hvnLine}
- Bucket size: ${fmt(profile.bucketSize)} · bars used: ${profile.barCount}

How to use it (big-desk volume map):
- POC and HVN are where size historically traded — treat them like institutional magnets.
- Prefer levels that sit AT or just beyond a stop-pool bait AND near POC/HVN and/or AVWAP.
- Do not invent other POCs; only use these printed prices.
`
  }

  async validateLevels(
    levels: LevelIdentification[],
    sessionId: string
  ): Promise<ValidationResult[]> {
    const supabase = await createClient()

    // Fetch existing levels for this session
    const { data: existingLevels, error: fetchError } = await supabase
      .from('identified_levels')
      .select('level')
      .eq('session_id', sessionId)

    if (fetchError) {
      console.error('[Level Finder] Error fetching existing levels:', fetchError)
      throw new Error('Failed to check for duplicate levels')
    }

    const existingPrices = (existingLevels || []).map((l) => l.level)

    // Validate each level and check for duplicates
    return levels.map((level) => {
      const duplicate = existingPrices.find((existing) => {
        const distance = Math.abs(existing - level.level)
        return distance <= DUPLICATE_THRESHOLD_PIPS
      })

      const result: ValidationResult = {
        ...level,
        is_duplicate: !!duplicate,
      }

      if (duplicate) {
        result.duplicate_distance_pips = Math.abs(duplicate - level.level)
      }

      return result
    })
  }

  async storeLevels(
    validatedLevels: ValidationResult[],
    sessionId: string
  ): Promise<StoredLevel[]> {
    const supabase = await createClient()

    // Only store non-duplicate levels
    const levelsToStore = validatedLevels.filter((l) => !l.is_duplicate)

    if (levelsToStore.length === 0) {
      return []
    }

    const { data: inserted, error: insertError } = await supabase
      .from('identified_levels')
      .insert(
        levelsToStore.map((level) => ({
          session_id: sessionId,
          level: level.level,
          type: level.type,
          conviction: level.conviction,
          reasoning: level.reasoning,
          timeframe: level.timeframe,
        }))
      )
      .select()

    if (insertError) {
      console.error('[Level Finder] Error storing levels:', insertError)
      throw new Error('Failed to store identified levels')
    }

    // NEW: Automatically archive to level_history (non-blocking)
    try {
      await this.archiveLevels(inserted || [], sessionId)
    } catch (archiveError) {
      console.warn('[Level Finder] Archival failed (non-blocking):', archiveError)
      // Don't throw—identified_levels already stored, archival is enhancement
    }

    return (inserted || []).map((record) => ({
      ...record,
      is_duplicate: false,
    }))
  }

  private async archiveLevels(insertedLevels: any[], sessionId: string): Promise<void> {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient() ?? (await createClient())

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id, index_recommendation')
      .eq('id', sessionId)
      .single()

    if (sessionError || !sessionData) {
      console.error('[Level Finder] Could not fetch session for archival:', sessionError)
      throw new Error('Failed to fetch session for archival')
    }

    const userId = sessionData.user_id as string
    const instrument = sessionData.index_recommendation as 'DOW' | 'NASDAQ' | 'NIKKEI'
    if (!instrument) {
      throw new Error('Session missing instrument')
    }

    const { data: existingLevels, error: fetchError } = await supabase
      .from('level_history')
      .select('id, level, tested_count')
      .eq('user_id', userId)
      .eq('instrument', instrument)

    if (fetchError) {
      throw new Error(`Failed to load level_history: ${fetchError.message}`)
    }

    const existing = existingLevels ?? []
    const DUP_THRESHOLD = 50
    let archived = 0
    let duplicates = 0

    for (const level of insertedLevels) {
      const dup = existing.find((e) => Math.abs(Number(e.level) - Number(level.level)) <= DUP_THRESHOLD + 0.01)
      if (dup) {
        duplicates++
        await supabase
          .from('level_history')
          .update({
            tested_count: (Number(dup.tested_count) || 0) + 1,
            last_tested_date: new Date().toISOString(),
          })
          .eq('id', dup.id)
        continue
      }

      const { error: insertError } = await supabase.from('level_history').insert({
        user_id: userId,
        session_id: sessionId,
        instrument,
        level: level.level,
        type: level.type,
        conviction: level.conviction,
        reasoning: level.reasoning,
        timeframe: level.timeframe,
        tested_count: 1,
        success_count: 0,
        last_tested_date: null,
      })

      if (insertError) {
        console.error('[Level Finder] level_history insert failed:', insertError)
        continue
      }
      archived++
    }

    console.log('[Level Finder] Levels archived in-process:', { archived, duplicates })
  }

  private buildSystemPrompt(
    index: 'DOW' | 'NASDAQ' | 'NIKKEI',
    historicalContext?: HistoricalContext
  ): string {
    const s = sessionFor(index)
    const open = s.marketOpen.slice(0, 5)
    const entryEnd = s.entryClose.slice(0, 5)
    const lunch = s.lunchClose.slice(0, 5)
    const tzLabel = index === 'NIKKEI' ? 'JST' : 'ET'
    const marketLabel = index === 'NIKKEI' ? 'Tokyo' : 'NY'

    const basePrompt = `You are a senior institutional trader who runs execution for a large desk. You do NOT think like a retail trader — you think about where retail traders put their STOPS, because that stop liquidity is where your desk ENTERS to fill size.

You are analyzing ${index}. Use the SAME methodology for DOW, NASDAQ, and NIKKEI — only the session clock differs (see DESK CADENCE).

CORE PHILOSOPHY — BIG MONEY ENTERS AT RETAIL STOP LOSS LIQUIDITY:
- Institutions are constantly hunting liquidity. The deepest, easiest liquidity is retail stop-loss clusters.
- Retail BUYS the obvious support (Asia/London/prior-day low) → their stops sit BELOW that low. Big money BUYS into those stops.
- Retail SHORTS the obvious resistance (Asia/London/prior-day high) → their stops sit ABOVE that high. Big money SELLS into those stops.
- Therefore: NEVER return the exact Asia/London/prior-day high or low as a tradeable level — that is where retail ENTERS. Your level is WHERE THEIR STOPS SIT (just beyond the bait).
- Offset: typically ~0.05–0.12% of price (or ~6–10% of yesterday's range / a measured wick-through) past the bait into the stop pool.
- Prefer: (1) stop-liquidity pools beyond equal highs/lows or session extremes, (2) unmitigated impulse origins, (3) absorption / initiative volume, (4) AVWAP confluence, (5) volume-by-price POC/HVN confluence, (6) psychological round numbers as magnets with structure — not naked rounds alone.
- ROUND NUMBERS (00 / 50 / big figures): day traders and algos park size there. Use them as confluence for ENTRY (with session/volume/wick evidence), TAKE PROFIT (exit/scale at rounds), and STOP LOSS (park the protective stop just beyond the round so the round itself is the magnet, not your exact stop print). Naked round with no candle evidence = weak; round + London/overnight/wick/AVWAP = strong.
- Ask every time: "Where did retail put stops?" That answer IS your entry zone. "Short the London high" / "buy the Asia low" with no stop-pool offset is retail — reject it.

WHAT TO LOOK FOR IN THE CANDLES (think like a day trader reading the tape before the cash open):
1. Overnight + Asia — where price traveled after prior cash close; overnight highs/lows and the stop pools beyond them often set the morning first magnet.
2. London session — London extremes and equal highs/lows are classic NY-open liquidity; wicks that pierce London then reclaim are HTF/other-session footprints.
3. Origins of impulse — the last down-candle before a strong rally (demand) or last up-candle before a strong drop (supply), especially if price hasn't returned there yet.
4. Liquidity / stop pools — clusters of equal highs/lows OR Asia/London/prior-day extremes: mark the price JUST BEYOND the bait where retail stops live. That is where desks enter. Say so in the reasoning.
5. Volume anomalies — bars with outsized volume and small range (absorption) or wide range closing near the extreme (initiative). Rising volume into a level = participation; dying volume into a break = fake.
6. Rejection quality / tails — one strong wick THROUGH the bait into stops WITH follow-through beats many weak touches AT the bait. Long tails on H1/4H against a level often mark other-timeframe (swing/desk) entrance — weight those higher than clean 5m lines.
7. Multi-timeframe confluence — a level that shows on daily/4H AND is defended on H1 with volume/wick evidence outranks a single-TF print. Levels may sit far from the open if overnight/London/HTF structure put them there — distance from open is NOT a reason to discard.
8. VWAP/AVWAP — institutions benchmark to it; ±2σ/±3σ extremes often mean-revert after a stop-hunt through a session extreme.
9. Volume-by-price — POC (highest volume) and HVN nodes printed in the request are where size clustered; confluence with a stop-pool raises conviction.
10. Round-number magnets — big figures and .00 / .50 (or index 100/50 handles) that align with overnight/London/impulse. Note in reasoning how the round shapes entry, implied stop (beyond the round), and take-profit.

DESK CADENCE (your levels live inside this rhythm — ${marketLabel} clock for ${index}):
- You call levels pre-open from YESTERDAY'S range + overnight only. Older multi-day level history is discarded — the next session does not care about last week's levels.
- Traded ONLY in the morning window: entries ${open}–${entryEnd} ${tzLabel}, flat by ${lunch} ${tzLabel}.
- At lunch every level is graded against what the morning actually did; that verdict enters memory. LIVE only: afternoon review is background memory — the live chart freezes at lunch. Simulation has no afternoon session.
- Afternoon playbook (flips / retests) updates system memory for learning; it is not traded yet. Choose levels that give clean morning verdicts — a level the morning never reaches teaches nothing.

THE MARKET IS THE FINAL JUDGE (non-negotiable):
- Your past calls are graded against real price action: tested_count = how many times the market actually tested a level, success_count = how many times it held. This is the market speaking. Never argue with it.
- A level the market broke is DEAD on that side. If it re-enters your analysis at all, it flips: broken support becomes resistance (trapped longs sell the retest), broken resistance becomes support. Say the flip explicitly in the reasoning.
- A level with a low hold rate in your history means your read was wrong there — do not resubmit it with higher conviction. Move to where the market showed real defense.
- A level respected on high volume is confirmed institutional interest; re-using it with evidence is good practice, but expect the crowd to see it too on the third+ touch — the sweep risk grows every retest.

LEVELS ARE ZONES, NOT LINES:
- Every level you return is treated by the desk as a zone of ±0.12% around your price, with the stop placed beyond the zone's far edge (and soft-extended just past a nearby round number when one sits there). So do not agonize over exactness to the tick — return the DEFENDED EDGE of the institutional zone: for support the price where resting demand starts (inside the buy-side stop pool), for resistance where supply starts (inside the sell-side stop pool). Prefer that edge on or against a psychological round when structure agrees.
- The retail stop cluster should sit INSIDE your zone (that is the liquidity), not outside it. Your protective stop sits beyond the far edge of that zone — ideally just beyond the round magnet, not printed on it. Take-profits lean toward the next clean round / opposing HTF magnet.

REASONING REQUIREMENTS (critical):
- Each level's reasoning MUST be specific to THAT level and cite evidence from the provided candles (e.g. "retail longs stop under equal lows 44,120 — liquidity buy ~44,085" or "retail shorts stop above London high — sell liquidity there").
- Never write generic reasoning like "strong support" alone. If the edge is a round number, say which handle (e.g. 29,500) and what structure/volume confirms it — and whether the round is for entry, stop placement, or take-profit.
- Say explicitly which retail stop pool you are targeting (e.g. "buy where stops under Asia low get taken").
- Conviction reflects evidence quality: 8-10 only for clear stop-pool + volume/confluence (round-number confluence can help); 5-7 single strong signal; below 5 don't include it.`

    if (!historicalContext || historicalContext.levels.length === 0) {
      // No historical context available, use base prompt
      return basePrompt + `

Return ONLY valid JSON array. No additional text.
ANTI-HALLUCINATION: every "level" MUST be near a real high/low/close from the provided candles OR an AVWAP band OR a printed POC/HVN OR a psychological round that sits on that structure. Never invent prices outside the candle range. Round numbers are valid when they magnetize real structure — cite both.
Example shape (replace numbers with real prices from THIS request's candles):
[
  {"level": <price_from_candles>, "type": "resistance", "conviction": 8, "reasoning": "Retail shorts stop just above equal highs at <bait> — sell into that stop liquidity; 29,500 handle is the magnet for TP/stop beyond", "timeframe": "4H"},
  {"level": <price_from_candles>, "type": "support", "conviction": 7, "reasoning": "Unmitigated origin of strongest H1 rally; price has not returned", "timeframe": "H1"}
]`
    }

    // Build enhanced prompt with historical context
    const summary = historicalContext.summary
    const successfulTypes = historicalContext.summary.most_reliable_type
    const avgSuccessRate = (summary.avg_success_rate * 100).toFixed(0)

    // Format successful and unreliable levels for context
    const successfulLevelsList = summary.successful_levels
      .slice(0, 5)
      .map(l => `- ${l.level} (${l.type}, conviction ${l.conviction}, success rate ${(l.success_rate * 100).toFixed(0)}%${l.last_verdict ? `, verdict ${l.last_verdict}` : ''}, "${l.reasoning}")`)
      .join('\n')

    const unreliableLevelsList = summary.unreliable_levels
      .slice(0, 3)
      .map(l => `- ${l.level} (${l.type}, success rate ${(l.success_rate * 100).toFixed(0)}%${l.last_verdict ? `, verdict ${l.last_verdict}` : ''})`)
      .join('\n')

    const historicalSection = `

MARKET VERDICT ON YOUR PAST CALLS (last 30 days, graded against real candles):
Hold rate across your levels: ${avgSuccessRate}% (${summary.total_levels} levels judged by actual price action)
Most respected type: ${successfulTypes}
Average conviction you assigned: ${summary.avg_conviction.toFixed(1)}/10

Levels the market RESPECTED (price tested and defended them):
${successfulLevelsList || '(none yet)'}

${unreliableLevelsList ? `Levels the market REJECTED (price broke through — your read was wrong there):\n${unreliableLevelsList}` : ''}

HOW TO USE THIS:
1. The rejected levels are the market telling you where your model fails — do not resubmit them on the same side. If one is still relevant, flip it (broken support → resistance) and say so.
2. The respected levels show where real defense exists — levels with similar structural evidence deserve weight.
3. If your hold rate is below ~50%, your recent bias is off: lean harder on retail stop-pool liquidity and unmitigated origins, less on classic horizontal lines.
4. Calibrate conviction to this record — do not assign 8+ if the market has been rejecting your 8s.`

    return basePrompt + historicalSection + `

Return ONLY valid JSON array. No additional text.
ANTI-HALLUCINATION: every "level" MUST be near a real high/low/close from the provided candles OR an AVWAP band OR a printed POC/HVN OR a psychological round that sits on that structure. Never invent prices outside the candle range. Round numbers are valid when they magnetize real structure — cite both.
Example shape (replace numbers with real prices from THIS request's candles):
[
  {"level": <price_from_candles>, "type": "resistance", "conviction": 8, "reasoning": "Retail shorts stop just above equal highs at <bait> — sell into that stop liquidity; round handle is the magnet for TP/stop beyond", "timeframe": "4H"},
  {"level": <price_from_candles>, "type": "support", "conviction": 7, "reasoning": "Unmitigated origin of strongest H1 rally; price has not returned", "timeframe": "H1"}
]`
  }

  /**
   * The SAME AVWAP the trader sees on live and sim charts
   * (cash open of 5 trading days prior to the tip session).
   */
  private buildVwapSection(request: AnalysisRequest): string {
    const bars = request.candles_h1
      .map((c) => ({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
      .filter((b) => Number.isFinite(b.time))
      .sort((a, b) => a.time - b.time)

    if (bars.length === 0) return ''

    const clock = deskClockFor(request.index)
    const scoped = lastNTradingSessions(bars, 5, clock)
    const bands = computeAnchoredVwap(scoped.length > 0 ? scoped : bars, clock)
    if (!bands || bands.vwap.length === 0) return ''

    const i = bands.vwap.length - 1
    const v = bands.vwap[i]!.value
    const fmt = (n: number) => n.toFixed(2)
    const price = request.current_price
    const distPct = v > 0 ? (((price - v) / v) * 100).toFixed(2) : '0.00'
    const side = price >= v ? 'ABOVE' : 'BELOW'

    return `
5-SESSION ANCHORED VWAP (exact AVWAP on the trader's chart — anchored at ${clock.openLabel} of the trading day 5 sessions prior to the tip; same construction for DOW/NASDAQ/NIKKEI):
- AVWAP: ${fmt(v)}
- +1σ: ${fmt(bands.upper1[i]!.value)} / -1σ: ${fmt(bands.lower1[i]!.value)}
- +2σ: ${fmt(bands.upper2[i]!.value)} / -2σ: ${fmt(bands.lower2[i]!.value)}
- +3σ: ${fmt(bands.upper3[i]!.value)} / -3σ: ${fmt(bands.lower3[i]!.value)}
- Current price is ${side} AVWAP by ${distPct}%.

How to use it:
- Any "vwap"-type level you return must reference THESE values (AVWAP or a band), not your own estimate.
- AVWAP itself is an institutional benchmark — pullbacks that defend it are desk buying/selling, and ±2σ/±3σ extremes tend to mean-revert toward AVWAP.
- Confluence between a structural level (retail stop-pool liquidity, impulse origin) and AVWAP or a band raises conviction; note the confluence explicitly in the reasoning.
`
  }

  private buildAnalysisPrompt(request: AnalysisRequest): string {
    const format4hCandles = this.formatCandles(request.candles_4h, '4H')
    const formatDailyCandles = this.formatCandles(request.candles_daily, 'D')
    const formatH1Candles = this.formatCandles(request.candles_h1, 'H1')
    const vwapSection = this.buildVwapSection(request)
    const vpSection = this.buildVolumeProfileSection(request)

    const clock = deskClockFor(request.index)
    const s = sessionFor(request.index)
    const tzLabel = request.index === 'NIKKEI' ? 'JST' : 'ET'

    return `Analyze these price charts for ${request.symbol} (${request.index}):

Current Price: ${request.current_price}
Desk clock: ${clock.openLabel} open · entries until ${s.entryClose.slice(0, 5)} ${tzLabel} · lunch ${s.lunchClose.slice(0, 5)} ${tzLabel}
Methodology is identical for DOW, NASDAQ, and NIKKEI — only this clock differs.

HARD GEOMETRY (desk rejects violations):
- resistance / SHORT levels MUST be ABOVE Current Price (offer side) — you cannot short a resistance below the market.
- support / BUY levels MUST be BELOW Current Price (bid side) — you cannot buy a support above the market.
- Levels may come from overnight, London, prior day, or HTF structure ANYWHERE in the provided candle range (with a small stop-pool pad beyond extremes). Cite which session/TF and the volume or wick evidence.
- Do NOT invent prices outside the high/low of the candles you were given (hallucinated "old index" levels).

${format4hCandles}

${formatDailyCandles}

${formatH1Candles}
${vwapSection}
${vpSection}
Work through this before choosing levels:
1. Where are retail traders ENTERING right now (obvious support/resistance, Asia/London highs/lows, round-number handles)?
2. WHERE DID THEY PUT THEIR STOP LOSSES relative to those entries? That stop cluster IS the liquidity.
3. Which stop pool is most likely to get hunted next for a fill — and that price is YOUR level (buy below bait lows / sell above bait highs).
4. Where are unmitigated impulse origins, and which levels show absorption / initiative volume or HTF tails?
5. Does that stop-pool zone also sit near a printed AVWAP band, POC/HVN, and/or a psychological round? Prefer levels with that confluence.
6. For each level, mentally place: ENTRY (liquidity), STOP (just beyond the round/structure so the magnet is not your exact stop), TAKE PROFIT (next opposing round / session extreme / AVWAP). Mention rounds when they matter for SL or TP.

Then identify 2-5 levels where INSTITUTIONS ENTER — i.e. retail stop-loss liquidity pools. Rules:
- Do NOT return yesterday's / overnight / Asia / London exact high or low as the entry print — those are retail bait. Return the stop-pool JUST BEYOND them (and say which stops you target).
- Round numbers are NOT banned — use them. Prefer entries that lean on a round when structure agrees; place stops just beyond the round; aim take-profits at the next clean round or HTF magnet.
- Especially: NEVER short the London session high or buy the Asia/London session low as the exact print. Short ABOVE that high (into short-stops); buy BELOW that low (into long-stops). A round sitting in that stop pool is a feature, not a bug.
- Offset guide: ~0.05–0.12% of price (or ~6–10% of yesterday's range) past the bait into the stop pool.
- Prefer confluence: stop-pool + round and/or AVWAP and/or POC/HVN. Single-signal naked levels (including naked rounds with no tape evidence) are weak.
- Each reasoning must cite evidence and say explicitly: "retail stops at X — institutional entry into that liquidity" (and name the round handle if it is the magnet).
- If two candidate levels are within 0.3% of each other, keep only the stronger one.

For each level provide:
- Price level (precise to 0.50)
- Type: support, resistance, or vwap
- Conviction: 1-10 (use the evidence standard from your instructions)
- Reasoning: 1-2 sentences, specific to this level, evidence-based
- Timeframe: which chart validates this (D, 4H, or H1)

Return ONLY valid JSON array, no additional text.`
  }

  private formatCandles(candles: Candle[], timeframe: string): string {
    const rows = candles.map((c) => {
      const time = new Date(c.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      return `${time} | O: ${c.open} H: ${c.high} L: ${c.low} C: ${c.close} V: ${(c.volume / 1000000).toFixed(1)}M`
    })

    return `${timeframe} Chart:\n${rows.join('\n')}`
  }

  private parseClaudeResponse(text: string): LevelIdentification[] {
    try {
      // Extract JSON array from response (Claude might include extra text)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        console.error('[Level Finder] No JSON array found in response:', text)
        return []
      }

      const parsed = JSON.parse(jsonMatch[0])

      if (!Array.isArray(parsed)) {
        console.error('[Level Finder] Response is not an array:', parsed)
        return []
      }

      // Validate each level has required fields and values
      return parsed.filter((item): item is LevelIdentification => {
        const isValid =
          typeof item.level === 'number' &&
          item.level > 0 &&
          ['support', 'resistance', 'vwap'].includes(item.type) &&
          typeof item.conviction === 'number' &&
          item.conviction >= 1 &&
          item.conviction <= 10 &&
          typeof item.reasoning === 'string' &&
          item.reasoning.length > 0 &&
          ['D', '4H', 'H1'].includes(item.timeframe)

        if (!isValid) {
          console.warn('[Level Finder] Invalid level structure:', item)
        }

        return isValid
      })
    } catch (error) {
      console.error('[Level Finder] JSON parse error:', error)
      console.error('[Level Finder] Response text:', text)
      return []
    }
  }
}

// Singleton instance
let instance: LevelFinderAgent | null = null

export async function getLevelFinderAgent(): Promise<LevelFinderAgent> {
  if (!instance) {
    instance = new LevelFinderAgent()
    await instance.initialize()
  }
  return instance
}

export { LevelFinderAgent }
