import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLevelFinderAgent } from '@/lib/services/levelFinderAgent'
import type { AnalysisRequest, Candle, ValidationResult, HistoricalContext, HistoricalLevelData, ContextSummary } from '@/lib/services/levelFinderAgent/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Validates candle array has required fields with correct types
 */
const validateCandleStructure = (candles: any[]): candles is Candle[] => {
  return candles.every((c) =>
    typeof c.open === 'number' &&
    typeof c.high === 'number' &&
    typeof c.low === 'number' &&
    typeof c.close === 'number' &&
    typeof c.volume === 'number' &&
    typeof c.timestamp === 'string'
  )
}

/**
 * Validates candle array values (volume > 0, OHLC relationships)
 */
const validateCandleValues = (candles: Candle[]): boolean => {
  return candles.every((c) => {
    if (c.volume <= 0) return false
    if (c.high < c.low) return false
    if (c.high < c.open || c.high < c.close) return false
    if (c.low > c.open || c.low > c.close) return false
    return true
  })
}

/**
 * Validates candles are in chronological order
 */
const validateCandleOrder = (candles: Candle[]): boolean => {
  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].timestamp).getTime()
    const currTime = new Date(candles[i].timestamp).getTime()
    if (currTime < prevTime) return false
  }
  return true
}

/**
 * Validates request body structure and values
 */
function validateRequest(body: any): { valid: true; data: AnalysisRequest } | { valid: false; error: string } {
  const { session_id, candles_4h, candles_daily, candles_h1, symbol, index, current_price } = body

  // Validate required fields
  if (!session_id || !candles_4h || !candles_daily || !candles_h1 || !symbol || !index || current_price === undefined) {
    return { valid: false, error: 'Missing required fields' }
  }

  // Validate array types and lengths
  if (!Array.isArray(candles_4h) || !Array.isArray(candles_daily) || !Array.isArray(candles_h1)) {
    return { valid: false, error: 'Candle fields must be arrays' }
  }

  if (candles_4h.length < 20 || candles_daily.length < 6 || candles_h1.length < 6) {
    return { valid: false, error: 'Insufficient candles' }
  }

  // Validate candle structure for all timeframes
  const candleArrays = [
    [candles_4h, 'candles_4h'],
    [candles_daily, 'candles_daily'],
    [candles_h1, 'candles_h1'],
  ] as const

  for (const [candles, name] of candleArrays) {
    if (!validateCandleStructure(candles)) {
      return { valid: false, error: `Invalid candle structure in ${name}` }
    }
    if (!validateCandleValues(candles)) {
      return { valid: false, error: `Invalid candle values in ${name}` }
    }
    if (!validateCandleOrder(candles)) {
      return { valid: false, error: `Candles in ${name} not in chronological order` }
    }
  }

  // Validate index and current_price
  if (!['DOW', 'NASDAQ'].includes(index)) {
    return { valid: false, error: 'Invalid index' }
  }

  if (typeof current_price !== 'number' || current_price <= 0) {
    return { valid: false, error: 'Invalid current_price' }
  }

  return { valid: true, data: body as AnalysisRequest }
}

/**
 * Verifies session exists and belongs to user
 */
async function verifySessionOwnership(supabase: SupabaseClient<any>, sessionId: string, userId: string): Promise<{ valid: true } | { valid: false; error: string }> {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (sessionError || !session) {
    return { valid: false, error: 'Invalid session or unauthorized access' }
  }

  return { valid: true }
}

/**
 * Performs price action analysis via Claude API
 */
async function performAnalysis(agent: any, request: AnalysisRequest): Promise<{ levels: any[]; usage: any } | { error: string }> {
  try {
    const analysisResult = await agent.analyzePriceAction(request)
    return { levels: analysisResult.levels, usage: analysisResult.usage }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'

    if (errorMsg.includes('timeout') || errorMsg.includes('exceeded')) {
      return { error: 'Analysis timeout: Claude API took too long (exceeded 5 minutes)' }
    }

    console.error('[Agent API] Claude analysis error:', errorMsg)
    return { error: `Analysis failed: ${errorMsg}` }
  }
}

/**
 * Validates and stores levels, handling duplicates
 */
async function processAndStore(agent: any, levels: any[], sessionId: string): Promise<{ levels: ValidationResult[] } | { error: string }> {
  if (!levels || levels.length === 0) {
    return { levels: [] }
  }

  try {
    const validatedLevels = await agent.validateLevels(levels, sessionId)
    await agent.storeLevels(validatedLevels, sessionId)
    return { levels: validatedLevels }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Agent API] Processing error:', errorMsg)
    return { error: `Processing failed: ${errorMsg}` }
  }
}

/**
 * Fetches and summarizes historical level context for a user and instrument
 */
async function fetchHistoricalContext(supabase: SupabaseClient<any>, userId: string, instrument: string, days: number = 30, limit: number = 20): Promise<HistoricalContext | null> {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const { data: levels, error: fetchError } = await supabase
      .from('level_history')
      .select('level, type, conviction, reasoning, timeframe, tested_count, success_count, last_tested_date')
      .eq('user_id', userId)
      .eq('instrument', instrument)
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit)

    if (fetchError || !levels || levels.length === 0) {
      return null
    }

    // Transform data
    const historicalLevels: HistoricalLevelData[] = levels.map((level: any) => ({
      level: level.level,
      type: level.type,
      conviction: level.conviction,
      reasoning: level.reasoning,
      timeframe: level.timeframe,
      tested_count: level.tested_count,
      success_count: level.success_count,
      success_rate: level.tested_count > 0 ? (level.success_count / level.tested_count) : 0,
      last_tested_date: level.last_tested_date,
    }))

    // Calculate summary statistics
    const avgConviction = historicalLevels.length > 0
      ? historicalLevels.reduce((sum, l) => sum + l.conviction, 0) / historicalLevels.length
      : 0

    const avgSuccessRate = historicalLevels.length > 0
      ? historicalLevels.reduce((sum, l) => sum + l.success_rate, 0) / historicalLevels.length
      : 0

    // Identify most reliable type
    const typeStats = historicalLevels.reduce(
      (acc, l) => {
        acc[l.type] = (acc[l.type] || 0) + l.success_rate
        return acc
      },
      {} as Record<string, number>
    )

    const mostReliableType = Object.entries(typeStats).length > 0
      ? (Object.entries(typeStats).sort(([, a], [, b]) => b - a)[0][0] as 'support' | 'resistance' | 'vwap')
      : null

    // Separate successful and unreliable levels
    const successfulLevels = historicalLevels.filter(l => l.success_rate >= 0.60)
    const unreliableLevels = historicalLevels.filter(l => l.success_rate < 0.40)

    const summary: ContextSummary = {
      total_levels: historicalLevels.length,
      avg_conviction: avgConviction,
      avg_success_rate: avgSuccessRate,
      most_reliable_type: mostReliableType,
      successful_levels: successfulLevels.sort((a, b) => b.success_rate - a.success_rate),
      unreliable_levels: unreliableLevels.sort((a, b) => a.success_rate - b.success_rate),
    }

    return {
      levels: historicalLevels,
      summary,
    }
  } catch (error) {
    console.error('[Agent API] Error fetching historical context:', error)
    return null
  }
}

/**
 * GET /api/agents/find-levels/history
 * Fetch historical level context for the current user and instrument
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const instrument = searchParams.get('instrument')
    const daysParam = searchParams.get('days')
    const limitParam = searchParams.get('limit')

    // Validate instrument (required)
    if (!instrument) {
      return NextResponse.json({ error: 'Missing required parameter: instrument' }, { status: 400 })
    }

    if (!['DOW', 'NASDAQ', 'NIKKEI'].includes(instrument)) {
      return NextResponse.json({ error: 'Invalid instrument' }, { status: 400 })
    }

    // Validate days (optional, default 30, max 90)
    let days = 30
    if (daysParam) {
      const daysParsed = parseInt(daysParam)
      if (isNaN(daysParsed) || daysParsed < 1 || daysParsed > 90) {
        return NextResponse.json({ error: 'Days must be between 1 and 90' }, { status: 400 })
      }
      days = daysParsed
    }

    // Validate limit (optional, default 20, max 50)
    let limit = 20
    if (limitParam) {
      const limitParsed = parseInt(limitParam)
      if (isNaN(limitParsed) || limitParsed < 1 || limitParsed > 50) {
        return NextResponse.json({ error: 'Limit must be between 1 and 50' }, { status: 400 })
      }
      limit = limitParsed
    }

    // Fetch historical context
    const context = await fetchHistoricalContext(supabase, user.id, instrument, days, limit)

    if (!context) {
      return NextResponse.json(
        {
          levels: [],
          summary: {
            total_levels: 0,
            avg_conviction: 0,
            avg_success_rate: 0,
            most_reliable_type: null,
            successful_levels: [],
            unreliable_levels: [],
          },
        },
        { status: 200 }
      )
    }

    return NextResponse.json(context, { status: 200 })
  } catch (error) {
    console.error('[Agent API] Unexpected error in GET /history:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents/find-levels
 * Trigger Agent 1 (Level Finder) to analyze price action and identify levels
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Validate auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Validate request
    const validation = validateRequest(body)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Verify session ownership
    const sessionCheck = await verifySessionOwnership(supabase, validation.data.session_id, user.id)
    if (!sessionCheck.valid) {
      return NextResponse.json({ error: sessionCheck.error }, { status: 403 })
    }

    // Fetch historical context for enhanced analysis (optional, doesn't fail if unavailable)
    const historicalContext = await fetchHistoricalContext(supabase, user.id, validation.data.index, 30, 20)

    // Perform analysis with optional historical context
    const agent = await getLevelFinderAgent()
    const requestWithContext = { ...validation.data, historicalContext: historicalContext || undefined }
    const analysisResult = await performAnalysis(agent, requestWithContext)

    if ('error' in analysisResult) {
      return NextResponse.json({ error: analysisResult.error }, { status: analysisResult.error.includes('timeout') ? 408 : 500 })
    }

    // Process and store levels
    const storageResult = await processAndStore(agent, analysisResult.levels, validation.data.session_id)

    if ('error' in storageResult) {
      return NextResponse.json({ error: storageResult.error }, { status: 500 })
    }

    // Return response
    return NextResponse.json(
      {
        levels: storageResult.levels,
        session_id: validation.data.session_id,
        analysis_timestamp: new Date().toISOString(),
        claude_usage: analysisResult.usage || { input_tokens: 0, output_tokens: 0 },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Agent API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
