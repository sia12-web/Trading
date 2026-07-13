/**
 * Level Finder Agent Service
 * Analyzes price action using Claude API to identify key support/resistance levels and VWAP
 * Single API call per session, 5-minute timeout
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
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
    const systemPrompt = this.buildSystemPrompt(request.historicalContext)

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

  private buildSystemPrompt(historicalContext?: HistoricalContext): string {
    const basePrompt = `You are an expert technical analyst specializing in institutional price action.
Analyze price data to identify key support/resistance levels and VWAP.
Focus on high-probability areas where institutions likely have positions.

For DOW: Analyze round numbers, major swing points, and 200/50 SMA zones.
For NASDAQ: Focus on previous day high/low, VWAP, and 5-min VWAP zones.`

    if (!historicalContext || historicalContext.levels.length === 0) {
      // No historical context available, use base prompt
      return basePrompt + `

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40250.50, "type": "resistance", "conviction": 8, "reasoning": "Previous day high", "timeframe": "D"},
  {"level": 40100.00, "type": "support", "conviction": 7, "reasoning": "Round number + VWAP", "timeframe": "4H"}
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

HISTORICAL PERFORMANCE CONTEXT (Last 30 days):
Your historical level accuracy: ${avgSuccessRate}% average success rate (tested ${summary.total_levels} levels)
Most reliable pattern: ${successfulTypes} levels (highest success rate)
Average conviction score: ${summary.avg_conviction.toFixed(1)}/10

Past Successful Levels:
${successfulLevelsList || '(none yet)'}

${unreliableLevelsList ? `Patterns to avoid:\n${unreliableLevelsList}` : ''}

RECOMMENDATIONS:
1. Prioritize ${successfulTypes} levels when available - they have highest success rate
2. Target conviction scores similar to your successful past levels
3. Validate new levels against established patterns
4. De-emphasize level types with lower success rates`

    return basePrompt + historicalSection + `

Return ONLY valid JSON array. No additional text. Example:
[
  {"level": 40250.50, "type": "resistance", "conviction": 8, "reasoning": "Previous day high", "timeframe": "D"},
  {"level": 40100.00, "type": "support", "conviction": 7, "reasoning": "Round number + VWAP", "timeframe": "4H"}
]`
  }

  private buildAnalysisPrompt(request: AnalysisRequest): string {
    const format4hCandles = this.formatCandles(request.candles_4h, '4H')
    const formatDailyCandles = this.formatCandles(request.candles_daily, 'D')
    const formatH1Candles = this.formatCandles(request.candles_h1, 'H1')

    return `Analyze these price charts for ${request.symbol} (${request.index}):

Current Price: ${request.current_price}

${format4hCandles}

${formatDailyCandles}

${formatH1Candles}

Identify 2-5 key levels where price is likely to react (support/resistance/VWAP).
For each level, provide:
- Price level (precise to 0.50)
- Type: support, resistance, or vwap
- Conviction: 1-10 (10 = very high probability)
- Reasoning: why this level matters (1-2 sentences)
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
