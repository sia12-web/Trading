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
  ArchiveRequest,
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
    const supabase = await createClient()

    // Fetch session to get instrument
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id, index_recommendation')
      .eq('id', sessionId)
      .single()

    if (sessionError || !sessionData) {
      console.error('[Level Finder] Could not fetch session for archival:', sessionError)
      throw new Error('Failed to fetch session for archival')
    }

    const instrument = sessionData.index_recommendation // DOW, NASDAQ, NIKKEI
    if (!instrument) {
      console.error('[Level Finder] Session has no instrument')
      throw new Error('Session missing instrument')
    }

    // Prepare archive payload
    const archivePayload: ArchiveRequest = {
      session_id: sessionId,
      instrument: instrument as 'DOW' | 'NASDAQ' | 'NIKKEI',
      levels: insertedLevels.map((level) => ({
        level: level.level,
        type: level.type,
        conviction: level.conviction,
        reasoning: level.reasoning,
        timeframe: level.timeframe,
      })),
    }

    // Call archive endpoint
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      if (!baseUrl) {
        throw new Error('NEXT_PUBLIC_BASE_URL environment variable is not set')
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5-second timeout

      try {
        const response = await fetch(`${baseUrl}/api/levels/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(archivePayload),
          signal: controller.signal as any,
        })

        if (!response.ok) {
          const error = await response.json()
          console.warn('[Level Finder] Archive endpoint returned error:', error)
          throw new Error(`Archive failed: ${error.error || 'Unknown error'}`)
        }

        const result = await response.json()
        console.log('[Level Finder] Levels archived successfully:', {
          archived: result.archived_count,
          duplicates: result.duplicate_count,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[Level Finder] Archive request timeout (exceeded 5 seconds)')
        throw new Error('Archive request timeout')
      }
      console.error('[Level Finder] Archival network error:', fetchError)
      throw fetchError
    }
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

    const basePrompt = `You are a senior institutional trader who runs execution for a large desk. You do NOT think like a retail trader — you think about where retail traders will be positioned, because their stops and entries are the liquidity your desk uses to fill size.

You are analyzing ${index}. Use the SAME methodology for DOW, NASDAQ, and NIKKEI — only the session clock differs (see DESK CADENCE).

CORE PHILOSOPHY — THINK LIKE THE MANIPULATOR, NOT THE VICTIM:
- You are modeling where SMART MONEY engineers liquidity, not where retail draws horizontal lines.
- Asia session highs/lows and London session highs/lows are the MOST obvious bait on the chart. Big desks INTENTIONALLY push price through those extremes to trigger stops, then reverse. NEVER return the exact Asia/London/prior-day high or low as a tradeable level.
- The real institutional level is where that stop-run EXHAUSTS — typically a measured distance beyond the bait (recent wick depth past the swing, or ~0.08–0.15% of price / ~10–15% of yesterday's range). Shorts live ABOVE the obvious high; longs live BELOW the obvious low.
- Prefer: (1) sweep-exhaustion beyond equal highs/lows or session range extremes, (2) unmitigated impulse origins (where the real move started, not where it peaked), (3) absorption / initiative volume bars, (4) AVWAP band confluence — never naked session highs/lows or round numbers.
- A "short at London high" or "buy at Asia low" idea is retail. Reject it. Ask: where do their stops sit, and where does the engineered run die?

WHAT TO LOOK FOR IN THE CANDLES:
1. Origins of impulse — the last down-candle before a strong rally (demand) or last up-candle before a strong drop (supply), especially if price hasn't returned there yet.
2. Sweep zones — clusters of equal highs/lows OR Asia/London/prior-day extremes: mark the level BEYOND the bait where the stop-run would exhaust, then reverse. Say so in the reasoning.
3. Volume anomalies — bars with outsized volume and small range (absorption) or wide range closing near the extreme (initiative).
4. Rejection quality — one strong wick WITH follow-through through the bait beats many weak touches AT the bait.
5. VWAP/AVWAP — institutions benchmark to it; ±2σ/±3σ extremes often mean-revert after a sweep of a session extreme.

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
- Every level you return is treated by the desk as a zone of ±0.12% around your price, with the stop placed beyond the zone's far edge. So do not agonize over exactness to the tick — return the DEFENDED EDGE of the institutional zone: for support the price where resting demand starts (upper edge of accumulation), for resistance where supply starts.
- Choose the price such that a stop just beyond the zone survives one liquidity sweep. If your zone's far side sits exactly at an obvious retail stop cluster, shift the level so the cluster falls INSIDE the zone, not beyond it.

REASONING REQUIREMENTS (critical):
- Each level's reasoning MUST be specific to THAT level and cite evidence from the provided candles (e.g. "origin of the 09:35 impulse, unmitigated, high-volume bar" or "equal lows at 44,120/44,118 — expect sweep to ~44,085 then reversal").
- Never write generic reasoning like "strong support" or "round number". If two levels would have the same reasoning, drop the weaker one.
- Say explicitly which side of the crowd the level exploits (e.g. "retail stops below the double bottom feed longs here").
- Conviction reflects evidence quality: 8-10 only for unmitigated origin + volume + confluence; 5-7 single strong signal; below 5 don't include it.`

    if (!historicalContext || historicalContext.levels.length === 0) {
      // No historical context available, use base prompt
      return basePrompt + `

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40287.50, "type": "resistance", "conviction": 8, "reasoning": "Sweep-exhaustion zone 37pts above equal highs at 40250 — retail breakout buyers and short stops provide exit liquidity; last touch rejected on 2x avg volume", "timeframe": "4H"},
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
3. If your hold rate is below ~50%, your recent bias is off: lean harder on sweep-exhaustion and unmitigated origins, less on classic horizontal lines.
4. Calibrate conviction to this record — do not assign 8+ if the market has been rejecting your 8s.`

    return basePrompt + historicalSection + `

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40287.50, "type": "resistance", "conviction": 8, "reasoning": "Sweep-exhaustion zone 37pts above equal highs at 40250 — retail breakout buyers and short stops provide exit liquidity; last touch rejected on 2x avg volume", "timeframe": "4H"},
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
- Confluence between a structural level (sweep-exhaustion, impulse origin) and AVWAP or a band raises conviction; note the confluence explicitly in the reasoning.
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
1. Where are retail traders positioned right now (obvious support/resistance, round numbers, prior day high/low)? Where do their stops cluster?
2. Which of those clusters is most likely to get swept for liquidity, and where would that sweep exhaust?
3. Where are the unmitigated impulse origins (demand/supply) that price has not yet returned to?
4. Which levels show absorption or initiative volume in the data above?

Then identify 2-5 levels where INSTITUTIONAL orders likely sit — not where retail is looking. Rules:
- HARD BAN: do NOT return yesterday's exact high/low, overnight exact high/low, Asia/London session high/low, or a round number. If that zone matters, return the sweep-exhaustion price BEYOND it and say which bait you are fading.
- Especially: NEVER short the London session high or buy the Asia/London session low. Those are engineered stop magnets. Shorts belong ABOVE the London/Asia high after the sweep; longs belong BELOW the Asia/London low after the grab.
- Offset guide: place ~0.10–0.20% of price (or ~12–18% of yesterday's range) beyond the bait extreme you are fading.
- Each reasoning must cite specific evidence (time, wick through bait, volume) and name the retail stops being hunted.
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
