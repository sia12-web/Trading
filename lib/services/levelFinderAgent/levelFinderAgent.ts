/**
 * Level Finder Agent Service
 * Analyzes price action using Claude API to identify key support/resistance levels and VWAP
 * Single API call per session, 5-minute timeout
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import {
  computeAnchoredVwap,
  deskClockFor,
  lastNTradingSessions,
} from '@/lib/chart/sessionVwap'
import { sessionFor } from '@/lib/trading/sessionGate'
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

const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022'
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes
const DUPLICATE_THRESHOLD_PIPS = 50
const MAX_LEVELS = 10

class LevelFinderAgent {
  private claudeClient: Anthropic | null = null

  async initialize(): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set')
    }
    this.claudeClient = new Anthropic({ apiKey })
  }

  async analyzePriceAction(request: AnalysisRequestWithContext): Promise<{
    levels: LevelIdentification[]
    usage: ClaudeUsage
  }> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized')
    }

    const prompt = this.buildAnalysisPrompt(request)
    const systemPrompt = this.buildSystemPrompt(
      request.index,
      request.historicalContext
    )

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS)

      let response

      try {
        response = await this.claudeClient.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
          { signal: controller.signal as any }
        )
      } finally {
        clearTimeout(timeoutId)
      }

      const content = response.content[0]
      if (!content || content.type !== 'text') {
        throw new Error('Unexpected response format from Claude')
      }

      const levels = this.parseClaudeResponse(content.text)

      return {
        levels: levels.slice(0, MAX_LEVELS),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Claude API request timeout (exceeded 5 minutes)')
      }

      if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
          throw new Error('Claude API rate limited. Try again in a moment.')
        }
        if (error.status === 500) {
          throw new Error('Claude API service error. Try again shortly.')
        }
        throw new Error(`Claude API error: ${error.message}`)
      }

      throw error
    }
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
- Prefer: (1) stop-liquidity pools beyond equal highs/lows or session extremes, (2) unmitigated impulse origins, (3) absorption / initiative volume, (4) AVWAP confluence — never naked session highs/lows or round numbers.
- Ask every time: "Where did retail put stops?" That answer IS your entry zone. "Short the London high" / "buy the Asia low" is retail — reject it.

WHAT TO LOOK FOR IN THE CANDLES:
1. Origins of impulse — the last down-candle before a strong rally (demand) or last up-candle before a strong drop (supply), especially if price hasn't returned there yet.
2. Liquidity / stop pools — clusters of equal highs/lows OR Asia/London/prior-day extremes: mark the price JUST BEYOND the bait where retail stops live. That is where desks enter. Say so in the reasoning.
3. Volume anomalies — bars with outsized volume and small range (absorption) or wide range closing near the extreme (initiative).
4. Rejection quality — one strong wick THROUGH the bait into stops WITH follow-through beats many weak touches AT the bait.
5. VWAP/AVWAP — institutions benchmark to it; ±2σ/±3σ extremes often mean-revert after a stop-hunt through a session extreme.

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
- Every level you return is treated by the desk as a zone of ±0.12% around your price, with the stop placed beyond the zone's far edge. So do not agonize over exactness to the tick — return the DEFENDED EDGE of the institutional zone: for support the price where resting demand starts (inside the buy-side stop pool), for resistance where supply starts (inside the sell-side stop pool).
- The retail stop cluster should sit INSIDE your zone (that is the liquidity), not outside it. Your protective stop sits beyond the far edge of that zone.

REASONING REQUIREMENTS (critical):
- Each level's reasoning MUST be specific to THAT level and cite evidence from the provided candles (e.g. "retail longs stop under equal lows 44,120 — liquidity buy ~44,085" or "retail shorts stop above London high — sell liquidity there").
- Never write generic reasoning like "strong support" or "round number". If two levels would have the same reasoning, drop the weaker one.
- Say explicitly which retail stop pool you are targeting (e.g. "buy where stops under Asia low get taken").
- Conviction reflects evidence quality: 8-10 only for clear stop-pool + volume/confluence; 5-7 single strong signal; below 5 don't include it.`

    if (!historicalContext || historicalContext.levels.length === 0) {
      // No historical context available, use base prompt
      return basePrompt + `

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40287.50, "type": "resistance", "conviction": 8, "reasoning": "Retail shorts stop ~37pts above equal highs at 40250 — sell into that stop liquidity; last touch rejected on 2x avg volume", "timeframe": "4H"},
  {"level": 40062.00, "type": "support", "conviction": 7, "reasoning": "Unmitigated origin of the strongest H1 rally in the data (wide-range bar, close at high); price has not returned since — resting demand likely", "timeframe": "H1"}
]`
    }

    // Build enhanced prompt with historical context
    const summary = historicalContext.summary
    const successfulTypes = historicalContext.summary.most_reliable_type
    const avgSuccessRate = (summary.avg_success_rate * 100).toFixed(0)

    // Format successful and unreliable levels for context
    const successfulLevelsList = summary.successful_levels
      .slice(0, 5)
      .map(l => `- ${l.level} (${l.type}, conviction ${l.conviction}, success rate ${(l.success_rate * 100).toFixed(0)}%, "${l.reasoning}")`)
      .join('\n')

    const unreliableLevelsList = summary.unreliable_levels
      .slice(0, 3)
      .map(l => `- ${l.level} (${l.type}, success rate ${(l.success_rate * 100).toFixed(0)}%)`)
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

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40287.50, "type": "resistance", "conviction": 8, "reasoning": "Retail shorts stop ~37pts above equal highs at 40250 — sell into that stop liquidity; last touch rejected on 2x avg volume", "timeframe": "4H"},
  {"level": 40062.00, "type": "support", "conviction": 7, "reasoning": "Unmitigated origin of the strongest H1 rally in the data (wide-range bar, close at high); price has not returned since — resting demand likely", "timeframe": "H1"}
]`
  }

  /**
   * The SAME 5-session anchored VWAP the trader sees on the live and sim
   * charts (lib/chart/sessionVwap) — computed here so the AI reasons against
   * the exact AVWAP/bands on screen, not its own approximation.
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
5-SESSION ANCHORED VWAP (exact AVWAP on the trader's chart — anchored at ${clock.openLabel} five sessions back; same construction for DOW/NASDAQ/NIKKEI):
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

    const clock = deskClockFor(request.index)
    const s = sessionFor(request.index)
    const tzLabel = request.index === 'NIKKEI' ? 'JST' : 'ET'

    return `Analyze these price charts for ${request.symbol} (${request.index}):

Current Price: ${request.current_price}
Desk clock: ${clock.openLabel} open · entries until ${s.entryClose.slice(0, 5)} ${tzLabel} · lunch ${s.lunchClose.slice(0, 5)} ${tzLabel}
Methodology is identical for DOW, NASDAQ, and NIKKEI — only this clock differs.

${format4hCandles}

${formatDailyCandles}

${formatH1Candles}
${vwapSection}
Work through this before choosing levels:
1. Where are retail traders ENTERING right now (obvious support/resistance, Asia/London highs/lows, round numbers)?
2. WHERE DID THEY PUT THEIR STOP LOSSES relative to those entries? That stop cluster IS the liquidity.
3. Which stop pool is most likely to get hunted next for a fill — and that price is YOUR level (buy below bait lows / sell above bait highs).
4. Where are unmitigated impulse origins, and which levels show absorption / initiative volume?

Then identify 2-5 levels where INSTITUTIONS ENTER — i.e. retail stop-loss liquidity pools. Rules:
- HARD BAN: do NOT return yesterday's exact high/low, overnight exact high/low, Asia/London session high/low, or a round number. Those are retail entries. Return the stop-pool price JUST BEYOND them and name which stops you are targeting.
- Especially: NEVER short the London session high or buy the Asia/London session low. Short ABOVE that high (into short-stops); buy BELOW that low (into long-stops).
- Offset guide: ~0.05–0.12% of price (or ~6–10% of yesterday's range) past the bait into the stop pool.
- Each reasoning must cite evidence and say explicitly: "retail stops at X — institutional entry into that liquidity."
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
      const time = new Date(c.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
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
