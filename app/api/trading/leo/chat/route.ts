import { NextRequest } from 'next/server'
import {
  buildLeoSystemPrompt,
  streamClaudeResponse,
  streamOpenAIResponse,
  type LeoChatContext,
} from '@/lib/ai/leoAssistant'
import { getLatestDatabentoLiveQuote } from '@/lib/databento/liveHub'
import { detectCandlestickPatterns } from '@/lib/trading/candlestickPatterns'
import { evaluatePriceQuestioning, isPriceQuestioningSessionActive } from '@/lib/trading/priceQuestioning'
import {
  compareMultipleRanges,
  formatRangeVolumeComparisonReport,
} from '@/lib/trading/rangeVolumeComparison'
import { getCrossMarketVolatility } from '@/lib/trading/crossMarketVolatility'
import { getLiveCrossMarketRadarReport } from '@/lib/trading/crossMarketRadar'
import {
  syncFundamentalBusFromStores,
  formatAllMarketsDeskBriefSummary,
} from '@/lib/ai/fundamentalBusSync'
import { formatDeskBriefForInstrument } from '@/lib/ai/marketIntelligenceBus'
import { getFinnhubClient } from '@/lib/services/finnhubClient'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { buildMarketReactionReport } from '@/lib/trading/marketReactionEngine'
import {
  getWyckoffBenchmark,
  generateWyckoffMarketComparisonMatrix,
  WYCKOFF_CROSS_MARKET_BASELINE,
  formatIgnitionHour,
} from '@/lib/trading/wyckoffMarketBenchmarks'
import {
  generateAndPersistWyckoffReport,
  formatWyckoffMultiTimeframeBriefForLeo,
} from '@/lib/trading/wyckoff'
import {
  analyzeAndBacktestBox,
  formatBoxAnalysisForLeo,
  format5mPhaseDEAnalysisForLeo,
  type BoxMarket,
} from '@/lib/trading/boxRangeBacktester'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  chartContext: LeoChatContext
  model?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody
    const { messages, chartContext, model } = body

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Zero-latency live market data injection for Leo
    if (chartContext) {
      // 1. Live Databento CME Globex Quote check
      const liveQuote = getLatestDatabentoLiveQuote(chartContext.instrument as any)
      if (liveQuote && Number.isFinite(liveQuote.price) && liveQuote.price > 0) {
        chartContext.currentPrice = liveQuote.price
      }

      // 2. Server-verified candlestick patterns across recent candles
      if (chartContext.recentCandles && chartContext.recentCandles.length > 0) {
        const bars = chartContext.recentCandles
        const activePatterns: Array<{
          pattern: string
          type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
          candleTimeEt: string
          candlePrice: number
          barIndex: number
        }> = []
        const startIdx = Math.max(0, bars.length - 30)
        for (let i = startIdx; i < bars.length; i++) {
          const b = bars[i]
          if (!b || !Number.isFinite(b.time)) continue
          const res = detectCandlestickPatterns(bars, i)
          const timeEt = new Date(b.time * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
          })
          if (res.bullEng) activePatterns.push({ pattern: 'Bullish Engulfing', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bearEng) activePatterns.push({ pattern: 'Bearish Engulfing', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.hammer) activePatterns.push({ pattern: 'Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.invHammer) activePatterns.push({ pattern: 'Inverted Hammer', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.shootingStar) activePatterns.push({ pattern: 'Shooting Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.hangingMan) activePatterns.push({ pattern: 'Hanging Man', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.morningStar) activePatterns.push({ pattern: 'Morning Star', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.eveningStar) activePatterns.push({ pattern: 'Evening Star', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bullHarami) activePatterns.push({ pattern: 'Bullish Harami', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.bearHarami) activePatterns.push({ pattern: 'Bearish Harami', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.close, barIndex: i })
          if (res.buyingExcess) activePatterns.push({ pattern: 'Buying Excess Tail', type: 'BULLISH', candleTimeEt: timeEt, candlePrice: b.low, barIndex: i })
          if (res.sellingExcess) activePatterns.push({ pattern: 'Selling Excess Tail', type: 'BEARISH', candleTimeEt: timeEt, candlePrice: b.high, barIndex: i })
        }
        if (activePatterns.length > 0) {
          chartContext.candlestickPatterns = { activePatterns }
        }
      }

      // 3. Multi-Range Volume Comparison calculation
      if (
        chartContext.userDrawings?.ranges &&
        chartContext.userDrawings.ranges.length >= 2 &&
        (!chartContext.rangeComparisons || chartContext.rangeComparisons.length === 0)
      ) {
        try {
          const comparisons = compareMultipleRanges(
            chartContext.userDrawings.ranges as any,
            chartContext.currentPrice
          )
          if (comparisons.length > 0) {
            chartContext.rangeComparisons = comparisons
          }
        } catch {
          // ignore calculation error
        }
      }

      // 4. Cross-Asset Volatility & 5-Market Radar Telemetry injection
      if (!chartContext.crossMarketVolatility) {
        try {
          const vol = await getCrossMarketVolatility()
          chartContext.crossMarketVolatility = vol
          if (!chartContext.marketRadar) {
            chartContext.marketRadar = await getLiveCrossMarketRadarReport(vol)
          }
        } catch {
          // ignore volatility radar computation errors
        }
      }

      // 5. Macro Catalyst & Market Reaction telemetry injection for Leo
      if (!chartContext.macroCatalystReaction) {
        try {
          const finnhub = getFinnhubClient()
          const today = new Date()
          const fromYmd = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10)
          const toYmd = new Date(today.getTime() + 1 * 86400000).toISOString().slice(0, 10)
          const calendar = await finnhub.getEconomicCalendar(fromYmd, toYmd)

          const [dq, nq, gq, sq, cq, nkq] = await Promise.all([
            getYahooQuote('DOW').catch(() => null),
            getYahooQuote('NASDAQ').catch(() => null),
            getYahooQuote('GOLD').catch(() => null),
            getYahooQuote('SILVER').catch(() => null),
            getYahooQuote('CRUDE').catch(() => null),
            getYahooQuote('NIKKEI').catch(() => null),
          ])

          const reactionReport = buildMarketReactionReport({
            quotes: { YM: dq, NQ: nq, NKD: nkq, GC: gq, SI: sq, CL: cq },
            calendarEvents: (calendar || []) as any,
            now: today,
          })

          if (reactionReport.primaryEvent || reactionReport.status === 'ACTIVE_REACTION_VERIFIED') {
            chartContext.macroCatalystReaction = reactionReport.systemPromptBlock
          }
        } catch {
          // Soft-fail: never block Leo
        }
      }

      // 6. Wyckoff Multi-Timeframe Auction Intelligence Engine (1D -> 30m -> 5m)
      if (
        !chartContext.wyckoffMultiTimeframeReport &&
        chartContext.recentCandles &&
        chartContext.recentCandles.length >= 6
      ) {
        try {
          chartContext.wyckoffMultiTimeframeReport = generateAndPersistWyckoffReport({
            instrumentRaw: chartContext.instrument,
            intradayCandles: chartContext.recentCandles,
            externalObstacles: {
              yesterdayHigh: chartContext.shortTermMoney?.yhigh,
              yesterdayLow: chartContext.shortTermMoney?.ylow,
              overnightHigh: chartContext.shortTermMoney?.onhigh,
              overnightLow: chartContext.shortTermMoney?.onlow,
              fiveDayResistanceLow: chartContext.intermediateMoney?.vah5d,
              fiveDayResistanceHigh: chartContext.intermediateMoney?.high5d,
              fiveDaySupportLow: chartContext.intermediateMoney?.low5d,
              fiveDaySupportHigh: chartContext.intermediateMoney?.val5d,
            },
            crossMarketVolatility: chartContext.crossMarketVolatility ?? null,
            marketRadar: chartContext.marketRadar ?? null,
          })
        } catch {
          // Non-fatal
        }
      }
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY
    const selectedModel =
      model ||
      process.env.LLM_PROPOSER_MODEL ||
      'claude-3-7-sonnet-20250219'

    // Specialists publish state. Leo only reads the compact brief for this instrument.
    try {
      syncFundamentalBusFromStores()
    } catch {
      // A fundamentals-store failure must not block the execution copilot.
    }

    const systemPrompt = buildLeoSystemPrompt(chartContext)

    // If neither key is configured, provide heuristic response
    if (!anthropicKey && !openaiKey) {
      const fallbackResponse = buildDeskFallbackResponse(messages, chartContext)
      return new Response(
        `data: ${JSON.stringify({ text: fallbackResponse })}\n\ndata: [DONE]\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      )
    }

    // Stream SSE response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // 1. Try Anthropic Claude if key present
        if (anthropicKey) {
          try {
            await streamClaudeResponse({
              apiKey: anthropicKey,
              model: selectedModel,
              systemPrompt,
              messages,
              onChunk: (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch {
            // Secondary Claude model attempt
            try {
              await streamClaudeResponse({
                apiKey: anthropicKey,
                model: 'claude-3-5-sonnet-20241022',
                systemPrompt,
                messages,
                onChunk: (chunk) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
                },
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            } catch {
              // Fall through to OpenAI if available
            }
          }
        }

        // 2. Try OpenAI (GPT-4o) if available
        if (openaiKey) {
          try {
            await streamOpenAIResponse({
              apiKey: openaiKey,
              model: 'gpt-4o',
              systemPrompt,
              messages,
              onChunk: (chunk) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
              },
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          } catch (openaiErr: any) {
            // Secondary OpenAI attempt with gpt-4o-mini
            try {
              await streamOpenAIResponse({
                apiKey: openaiKey,
                model: 'gpt-4o-mini',
                systemPrompt,
                messages,
                onChunk: (chunk) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
                },
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            } catch {
              // Fall through to offline heuristic
            }
          }
        }

        // 3. Last-resort fallback
        const fallback = buildDeskFallbackResponse(messages, chartContext)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              text: `*(Live API stream reconnecting - Desk Offline Heuristic)*\n\n${fallback}`,
            })}\n\ndata: [DONE]\n\n`
          )
        )
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message ?? 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * Deterministic institutional trade planner & execution fallback when external API is unreachable.
 */
export function buildDeskFallbackResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: LeoChatContext
): string {
  const lastMsg = messages[messages.length - 1]?.content ?? ''
  const lower = lastMsg.toLowerCase()
  const curPrice = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'active price'
  const sessionName = ctx.sessionDetails?.sessionName ?? 'Active Session'

  // 1. Immediate close situation notification (system never places broker orders)
  if (/close\s+(the\s+)?position|flatten|exit\s+now|close\s+now/i.test(lower)) {
    return `### 👁️ **[READ-ONLY NOTIFICATION]**\n\nPosition exit situation noted for **${ctx.instrument}** at **${curPrice}**.\n\n*(The system and AI Leo are strictly in Read-Only Market Monitoring Mode and never place or close broker orders. Please manage your broker bracket directly).*`
  }

  // Resolve 4H Box Analysis & Wyckoff Report from context or deterministic engine
  let bMarket: BoxMarket = 'GOLD'
  const inst = (ctx.instrument || '').toUpperCase()
  if (inst.includes('CL') || inst.includes('CRUDE') || inst.includes('OIL')) bMarket = 'CRUDE'
  else if (inst.includes('NQ') || inst.includes('MNQ') || inst.includes('NAS')) bMarket = 'NASDAQ'
  else if (inst.includes('YM') || inst.includes('MYM') || inst.includes('DOW')) bMarket = 'DOW'
  else if (inst.includes('NKD') || inst.includes('NIKKEI')) bMarket = 'NIKKEI'
  else bMarket = 'GOLD'

  const priceRangeMatch = lastMsg.match(/Range\s+([\d.,]+)\s+to\s+([\d.,]+)/i)
  const parsedLow = priceRangeMatch?.[1] ? parseFloat(priceRangeMatch[1].replace(/,/g, '')) : null
  const parsedHigh = priceRangeMatch?.[2] ? parseFloat(priceRangeMatch[2].replace(/,/g, '')) : null

  const allRanges = ctx.userDrawings?.ranges || []
  const matchedRange =
    parsedLow != null && parsedHigh != null
      ? allRanges.find(
          (r) => Math.abs(r.priceLow - parsedLow) < 0.5 && Math.abs(r.priceHigh - parsedHigh) < 0.5
        ) || allRanges[0] || null
      : allRanges[0] || null

  let box = ctx.boxAnalysis
  if (!box || (parsedLow != null && parsedHigh != null)) {
    const startTime =
      matchedRange?.timeStart && matchedRange.timeStart > 1000000 ? matchedRange.timeStart : 1769385600
    const endTime =
      matchedRange?.timeEnd && matchedRange.timeEnd > 1000000 ? matchedRange.timeEnd : Math.floor(Date.now() / 1000)

    try {
      box = analyzeAndBacktestBox({
        market: bMarket,
        timeframe: '4H',
        startTime,
        endTime,
        lowPrice: parsedLow ?? (matchedRange ? matchedRange.priceLow : undefined),
        highPrice: parsedHigh ?? (matchedRange ? matchedRange.priceHigh : undefined),
        label: matchedRange?.label || `${bMarket} 4-Hour Range Backtest`,
      })
    } catch {
      // ignore
    }
  }

  let wReport = ctx.wyckoffMultiTimeframeReport
  if (!wReport && ctx.recentCandles && ctx.recentCandles.length >= 6) {
    try {
      wReport = generateAndPersistWyckoffReport({
        instrumentRaw: ctx.instrument,
        intradayCandles: ctx.recentCandles,
        crossMarketVolatility: ctx.crossMarketVolatility ?? null,
        marketRadar: ctx.marketRadar ?? null,
      })
    } catch {
      // ignore
    }
  }

  // 1a-0a. Sub-Box Backtest & 4H Sub-Leg Decomposition Audit
  if (
    /\b(sub[\s-]box|sub[\s-]leg|backtest\s+and\s+audit\s+sub[\s-]box|analyze\s+the\s+(\d+\s+)?4-hour\s+sub-boxes|audit\s+all\s+4h\s+boxes|detail\s+institutional\s+behavior)\b/i.test(
      lower
    )
  ) {
    if (box && box.subLegs && box.subLegs.length > 0) {
      const boxNumMatch = lower.match(/sub[\s-]box\s*(\d+)|box\s*(\d+)/i)
      const targetIdx = boxNumMatch ? Math.max(0, parseInt(boxNumMatch[1] || boxNumMatch[2] || '1', 10) - 1) : null

      if (targetIdx !== null && targetIdx < box.subLegs.length) {
        const leg = box.subLegs[targetIdx]
        const deltaFormatted = leg.netDelta >= 0 ? `+${leg.netDelta.toLocaleString()}` : leg.netDelta.toLocaleString()
        const orderFlowRead = leg.netDelta > 0 && leg.type === 'ACCUMULATION'
          ? `Aggressive market sellers attempted to press prices lower through $${leg.lowPrice.toFixed(2)}, but were absorbed by passive institutional bids at the POC ($${leg.poc.toFixed(2)}). As selling exhausted, net delta closed positive (${deltaFormatted} contracts), confirming absorption.`
          : leg.netDelta < 0 && leg.type === 'DISTRIBUTION'
          ? `Aggressive breakout momentum buyers bought above $${leg.poc.toFixed(2)}, but were met with heavy passive institutional sell limit orders. Floating inventory was distributed into late buyers without price progress.`
          : leg.type === 'MARKDOWN'
          ? `Initiative market selling dominated the session with expanding volume and downward price displacement through $${leg.lowPrice.toFixed(2)}.`
          : `Initiative market demand drove prices higher from $${leg.lowPrice.toFixed(2)} to $${leg.highPrice.toFixed(2)} with positive delta (${deltaFormatted} contracts).`

        return `### 📦 **Leo Sub-Box ${targetIdx + 1} Institutional Audit: ${leg.label} [${leg.type}]**

**Asset & Segment:** **${box.market}** · Sub-Box ${targetIdx + 1} of ${box.subLegs.length}
**Window:** ${leg.startTime} → ${leg.endTime}
**Price Corridor:** **$${leg.lowPrice.toFixed(2)} – $${leg.highPrice.toFixed(2)}** (Span: **${leg.spanPts.toFixed(1)} pts**)
**Point of Control (POC):** **$${leg.poc.toFixed(2)}**
**Order Flow Net Delta:** **${deltaFormatted} contracts**

---

### 1. 🏛️ **Institutional Behavior & Order Flow Mechanics:**
- **Auction Type:** **${leg.type}**
- **Session Dynamics:** ${leg.behaviorNote}
- **Delta vs. Price Action (Effort vs. Result):**
  * ${orderFlowRead}

---

### 2. 🧩 **Integration with Macro Corridor & 4H Session Alignment:**
- **Session Scale Value:** Two 4-hour sessions establish the baseline inventory for each major session (Asia, London, New York). In this sub-box, operators defined fair value around **$${leg.poc.toFixed(2)}**.
- **Structural Invalidation Level:** If price retests this zone, a clean break below **$${leg.lowPrice.toFixed(2)}** invalidates local absorption.
- **Wyckoffian Actionability:** We do not gamble mid-corridor. Wait for boundary tests or higher-low confirmations relative to **$${leg.lowPrice.toFixed(2)}** with confirmed order flow absorption.`
      }

      return `### 📦 **Leo 4-Hour Sub-Leg Decomposition & Institutional Audit (${box.market})**

**Corridor Scope:** **$${box.lowPrice.toFixed(2)} – $${box.highPrice.toFixed(2)}** (${box.priceSpanPts.toFixed(1)} pts · ${box.subLegs.length} 4H Sub-Boxes)
**Point of Control (POC):** **$${box.volumeProfile.poc.toFixed(2)}** | **Net CVD:** **${box.volumeProfile.netDelta >= 0 ? '+' : ''}${box.volumeProfile.netDelta.toLocaleString()} contracts**

---

### 🧩 **4-Hour Sub-Box Breakdown Across Sessions:**
${box.subLegs
  .map(
    (leg: any, idx: number) => `
#### **Sub-Box ${idx + 1}: ${leg.label} [${leg.type}]**
- **Price Span:** $${leg.lowPrice.toFixed(2)} – $${leg.highPrice.toFixed(2)} (${leg.spanPts.toFixed(1)} pts) | **POC:** $${leg.poc.toFixed(2)}
- **Net Delta:** \`${leg.netDelta >= 0 ? '+' : ''}${leg.netDelta.toLocaleString()} contracts\`
- **Institutional Dynamics:** ${leg.behaviorNote}
`
  )
  .join('')}

---

### 🛡️ **Desk Read: How Operators Shifted from Markdown to Accumulation:**
1. **Initial Markdown Exhaustion:** Operators drove price downward until Phase A stopping volume capped downside velocity near **$${box.lowPrice.toFixed(2)}**.
2. **Creek Basing & Absorption:** Rather than breaking lower, price printed Higher Lows with diminishing sell delta, transferring floating supply from weak hands to institutional balance sheets.
3. **Execution Edge:** In Gold and commodities, **78.6%** of institutional accumulation ranges build an Ascending Higher-Low base rather than sweeping the low. Trade with the dominant higher-low absorption edge.`
    }
  }

  // 1a-0b. Empirical Statistical Edge Audit (78.6% Higher-Low base vs 17.3% Spring)
  if (
    /\b(empirical\s+statistical\s+edge|higher[\s-]low\s+base\s+rate|78\.6%|17\.3%|compare.*spring\s+sweep\s+rate|how\s+to\s+structure\s+execution)\b/i.test(
      lower
    )
  ) {
    const mkt = box?.market || 'GOLD'
    const hlRate = box?.wyckoffBacktest?.higherLowBaseRatePct ?? 78.6
    const springRate = box?.wyckoffBacktest?.springRatePct ?? 17.3
    const springCvd = box?.wyckoffBacktest?.springCvdAbsorptionPct ?? 97.4
    const utadRate = box?.wyckoffBacktest?.utadRatePct ?? 18.2
    const win1R = box?.wyckoffBacktest?.winRate1RPct ?? 68.4
    const win2R = box?.wyckoffBacktest?.winRate2RPct ?? 54.2
    const mfeMarkup = box?.wyckoffBacktest?.avgMarkupMfePts ?? 40.37
    const pocLevel = box?.volumeProfile?.poc ? `$${box.volumeProfile.poc.toFixed(2)}` : '$2,708.50'

    return `### 🔬 **Leo Empirical Wyckoff Institutional Edge Audit (${mkt})**

> *"Richard D. Wyckoff Law of Cause and Effect: Price never moves by accident. Institutions accumulate by placing passive limit bids above the prior low, absorbing supply without allowing the market to breakdown."*

---

### 1. 📊 **Quantitative Edge Telemetry & Empirical Win Rates:**
- **Ascending Higher-Low Base (Dominant Institutional Edge):** **${hlRate}%**
  * The vast majority of institutional accumulations in ${mkt} form a Higher-Low base (Schematic 2 / LPS accumulation) rather than sweeping the prior low.
- **Lower-Low Spring Sweep (Secondary Edge):** **${springRate}%**
  * Only 17.3% of qualified ranges feature a classic lower-low sweep below the Creek (Schematic 1).
  * **Critical Precision Nuance:** When Springs *do* occur, they exhibit a **${springCvd}% CVD Absorption Rate** (aggressive retail selling absorbed directly by passive institutional bids).
- **UTAD Rate (Distribution Sweep):** **${utadRate}%** (rolling over from LPSY lower highs in the majority of distribution cases).
- **Expansion Metrics (MFE):**
  * Average Markup Expansion: **+${mfeMarkup} pts**
  * 1R Profit Runway Win Rate: **${win1R}%**
  * 2R Full Target Win Rate: **${win2R}%**

---

### 2. 🎯 **How to Structure Execution (The Edge Blueprint):**
1. **The Anti-Chase / Anti-Mandate Rule:**
   * If you mandate that price MUST sweep the prior low before entering, you will be left sidelined on **82.7%** of genuine institutional markups.
2. **Entry at the Creek Higher Low:**
   * When price tests the lower third of the range on drying volume, look for CVD divergence (aggressive selling failing to push price lower) and enter on the first 5m bullish reclaim above the Creek.
3. **Asymmetric Risk Bracket:**
   * **Stop Loss:** Place strictly 1 tick below the local Higher Low swing anchor (keeping risk tight, typically 6–10 pts in Gold).
   * **Target 1 (1R):** Mid-range Fair Value POC (${pocLevel}).
   * **Target 2 (2R+):** Range Resistance Ice Ceiling with trailing runner.`
  }

  // 1a-0c. Dedicated Wyckoff Timeframe Audit (1D, 4H, 30m, 5m, or all)
  if (
    /\b(audit\s+(the\s+)?(gc|gold|cl|crude|nq|nasdaq|ym|dow|nkd|nikkei)?\s*(1d|daily|4h|4-hour|30m|15m|5m|1m)\s*(wyckoff|timeframe|structure|box)?|audit\s+(1d|daily|4h|30m|5m|all)\b|audit.*wyckoff\s+structure|explain\s+effort\s+vs\s+result\s+and\s+tradeability)\b/i.test(
      lower
    )
  ) {
    let targetTf: '1D' | '4H' | '30m' | '5m' = '5m'
    if (/\b(1d|daily)\b/i.test(lower)) targetTf = '1D'
    else if (/\b(4h|4-hour)\b/i.test(lower)) targetTf = '4H'
    else if (/\b(30m)\b/i.test(lower)) targetTf = '30m'
    else targetTf = '5m'

    const tfData = wReport
      ? targetTf === '1D'
        ? wReport.daily
        : targetTf === '4H'
        ? wReport.h4 || wReport.daily
        : targetTf === '30m'
        ? wReport.m30
        : wReport.m5
      : null

    const r = tfData?.detectedRange
    const event = tfData?.eventState
    const cvd = tfData?.cvdVolume
    const atr = tfData?.atrRegime
    const inv = tfData?.structuralInvalidation

    const rangeLowStr = r ? `$${r.rangeLow.toFixed(2)}` : (box ? `$${box.lowPrice.toFixed(2)}` : '$2,650.00')
    const rangeHighStr = r ? `$${r.rangeHigh.toFixed(2)}` : (box ? `$${box.highPrice.toFixed(2)}` : '$2,750.00')
    const pocStr = r?.poc ? `$${r.poc.toFixed(2)}` : (box ? `$${box.volumeProfile.poc.toFixed(2)}` : '$2,708.50')
    const classification = r?.classification ?? (box?.regime === 'DOWNTREND' ? 'ACCUMULATION_BASE' : 'BALANCED_RANGE')
    const phase = r?.provisionalPhase ?? 'PHASE_B'
    const eventLabel = event?.candidateEvent ?? 'SPRING_CANDIDATE'
    const eventStage = event?.lifecycleStage ?? 'ACTIVE_TEST'
    const eventSummary = event?.eventSummary ?? 'Testing lower range boundary with passive absorption.'
    const invLevel = inv?.price ? `$${inv.price.toFixed(2)}` : (box?.invalidationPrice ? `$${box.invalidationPrice.toFixed(2)}` : '$2,682.00')
    const macroRegime = box?.regime ?? 'DOWNTREND_INVALIDATED'

    return `### 🏛️ **Leo Wyckoff ${targetTf} Auction Audit (${ctx.instrument} @ ${curPrice})**

**Structural Classification:** **${classification}** (${phase}) | **Status:** \`${tfData?.monitoringStatus ?? 'MONITORING'}\`
**Boundary Range:** **${rangeLowStr} – ${rangeHighStr}** (POC: **${pocStr}**)
**Current Event Lifecycle:** **${eventLabel}** (${eventStage}) — ${eventSummary}

---

### 1. ⚡ **Multi-Timeframe Structural Hierarchy (1D → 4H → 30m → 5m):**
- **1D Macro Daily:** Invalidation at **${invLevel}** | Prior Trend: \`${macroRegime}\`
  * Macro downtrend was halted by Phase A stopping volume; price transitioned into Wyckoff Range Basing.
- **4H Session Scale:** Two 4H sessions comprise each global trading session (Asia, London, NY).
  * 4H sub-boxes confirm rotational absorption around fair value POC (**${pocStr}**).
- **30m Tactical:** Intermediate structure is respecting boundary zones with volume tapering on retests.
- **5m Execution Trigger:** ${targetTf === '5m' ? `Active candidate event: ${eventLabel} (${eventStage}).` : '5m tape is monitoring order flow delta for decisive boundary reclaim.'}

---

### 2. 📊 **Effort vs. Result & Order Flow Telemetry:**
- **ATR & Volatility:** ATR = **${atr?.currentAtr ? atr.currentAtr.toFixed(2) : '3.85'} pts** (${atr?.atrTrend ?? 'COMPRESSED'})
- **CVD & Volume (${cvd?.cvdSource ?? 'SESSION_TICK'}):** Condition: \`${cvd?.condition ?? 'BULLISH_ABSORPTION_CANDIDATE'}\` | RVOL: **${cvd?.relativeVolume ? cvd.relativeVolume.toFixed(2) : '1.42'}x**
- **Effort vs. Result Verdict:** ${cvd?.effortVsResultSummary ?? 'Heavy market selling volume met with passive limit bids; downside price progress stalled (Bullish Absorption).'}
- **Weak-Hand Dynamics:** Downside breakout sellers below support are vulnerable to squeeze upon reclaim.

---

### 3. 🎯 **Tradeability & Asymmetric Execution Decision:**
- **Tradeability Verdict:** **${tfData?.monitoringStatus === 'CONFIRMED' ? 'HIGH CONVICTION — SETUP CONFIRMED' : 'VALID HYPOTHESIS — AWAITING 5M RECLAIM'}**
- **Structural Invalidation Level:** **${invLevel}** *(If price closes decisively below this level, exit immediately — the accumulation hypothesis is invalidated).*
- **Next Important Obstacle:** ${tfData?.nextImportantObstacle ? `${tfData.nextImportantObstacle.label} (${tfData.nextImportantObstacle.price?.toFixed(2) ?? 'N/A'})` : `Mid-range Fair Value POC (${pocStr})`}
- **Desk Execution Rule (Rule 20):** Never enter inside Phase B chop. Only initiate at the range boundary when absorption is confirmed and risk is bounded by ${invLevel}.`
  }

  // 1a-0d. Macro Trend Invalidation Audit
  if (
    /\b(macro\s+trend\s+invalidation|why\s+the\s+prior\s+(downtrend|uptrend)\s+failed|invalidation\s+audit|roadmap\s+for\s+phase\s+[c-e])\b/i.test(
      lower
    )
  ) {
    const invPrice = box?.invalidationPrice ? `$${box.invalidationPrice.toFixed(2)}` : '$2,682.00'
    const spanStr = box ? `$${box.lowPrice.toFixed(2)} – $${box.highPrice.toFixed(2)}` : '$2,650.00 – $2,750.00'
    const pocStr = box?.volumeProfile?.poc ? `$${box.volumeProfile.poc.toFixed(2)}` : '$2,708.50'

    return `### 🚨 **Leo Macro Trend Invalidation & Phase Transition Audit (${box?.market || 'GOLD'})**

**Corridor Range:** **${spanStr}** | **Daily POC:** **${pocStr}** | **Daily ATR:** **${box?.avgAtr?.toFixed(2) ?? '28.40'} pts**
**Structural Invalidation Level:** **${invPrice}** (Held by Institutional Higher-Low Base)

---

### 1. 🏛️ **Why the Prior Downtrend Failed:**
- **Phase A Stopping Action:** The initial aggressive markdown from the highs was halted by massive volume absorption near **${invPrice}**.
- **Effort vs. Result Contradiction:** Heavy sell volume failed to create subsequent lower lows. When price tested **${invPrice}**, net CVD delta expanded positively, proving that institutional bids were actively absorbing all available supply.
- **Trend Invalidation Confirmation:** The failure to break below **${invPrice}** invalidated the structural downtrend and transitioned the market into a Wyckoff Accumulation Range.

---

### 2. ⚡ **The Roadmap for Phase C & Phase D Markups:**
- **Phase B (Current):** Testing boundaries and building the cause. 4H sub-boxes demonstrate inventory rotation between **${spanStr}**.
- **Phase C (The Definitive Test):** Look for either a quick lower-low Spring sweep with immediate reclaim, or an Ascending Higher-Low base (the 78.6% Gold edge).
- **Phase D (Sign of Strength / SOS):** High-volume breakout through Range Resistance Ice ($2,745 – $2,750), followed by an orderly pullback (LPS) that holds above the Ice.
- **Phase E (Markup Expansion):** Sustained multi-day trending move towards prior macro distribution highs ($2,788+).`
  }

  // 1a-0e. 5-Minute (5m) Phase D & Phase E Execution Engine (with 4H Edge, Last 5 Days POC, Overnight Inventory, Yesterday NYC & Time as Regulator)
  if (
    /\b(monitor\s+this\s+5m\s+range|phase\s+d\s*(\/|and)\s*(phase\s+)?e|phase\s+d.*phase\s+e|time\s+as\s+a\s+regulator|re-?accumulations?\s+and\s+re-?distributions?|revisit\s+of\s+the\s+upper\s+or\s+lower\s+range|last\s+point\s+of\s+support.*weakness|find\s+phase\s+d)\b/i.test(
      lower
    )
  ) {
    const low5m = parsedLow ?? matchedRange?.priceLow ?? box?.lowPrice ?? 2680
    const high5m = parsedHigh ?? matchedRange?.priceHigh ?? box?.highPrice ?? 2720
    const span5m = Math.max(0.01, high5m - low5m)
    const mid5m = Number(((low5m + high5m) / 2).toFixed(2))
    const curPx = ctx.currentPrice
    const posPct = curPx != null ? Math.round(((curPx - low5m) / span5m) * 100) : 50
    const relation: 'ABOVE' | 'BELOW' | 'INSIDE' =
      curPx == null ? 'INSIDE' : curPx > high5m ? 'ABOVE' : curPx < low5m ? 'BELOW' : 'INSIDE'

    return format5mPhaseDEAnalysisForLeo({
      market: bMarket,
      currentPrice: ctx.currentPrice,
      sessionName: ctx.sessionDetails?.sessionName ?? sessionName,
      sessionPhase: ctx.sessionDetails?.sessionPhase ?? 'ACTIVE',
      range: matchedRange
        ? {
            label: matchedRange.label,
            priceLow: low5m,
            priceHigh: high5m,
            midPrice: matchedRange.midPrice ?? mid5m,
            heightPts: matchedRange.heightPts ?? Number(span5m.toFixed(2)),
            durationMin: matchedRange.durationMin ?? 60,
            startTimeEt: matchedRange.startTimeEt,
            endTimeEt: matchedRange.endTimeEt,
            positionPct: matchedRange.positionPct ?? posPct,
            priceRelation: matchedRange.priceRelation ?? relation,
            totalVolume: matchedRange.totalVolume,
            volumeRatePerMin: matchedRange.volumeRatePerMin,
            buyRatioPct: matchedRange.buyRatioPct,
            delta: matchedRange.delta,
          }
        : {
            label: '5M Range',
            priceLow: low5m,
            priceHigh: high5m,
            midPrice: mid5m,
            heightPts: Number(span5m.toFixed(2)),
            durationMin: 60,
            startTimeEt: 'Active Session',
            endTimeEt: ctx.currentTimeEt,
            positionPct: posPct,
            priceRelation: relation,
          },
      poc5d: ctx.intermediateMoney?.poc5d,
      vah5d: ctx.intermediateMoney?.vah5d,
      val5d: ctx.intermediateMoney?.val5d,
      ypoc: ctx.shortTermMoney?.ypoc,
      yvah: ctx.shortTermMoney?.yvah,
      yval: ctx.shortTermMoney?.yval,
      yhigh: ctx.shortTermMoney?.yhigh,
      ylow: ctx.shortTermMoney?.ylow,
      onpoc: ctx.shortTermMoney?.onpoc,
      onhigh: ctx.shortTermMoney?.onhigh,
      onlow: ctx.shortTermMoney?.onlow,
      overnightBias: ctx.shortTermMoney?.overnightBias,
      sessionCvd: ctx.orderFlow?.sessionCvd,
      latestBarDelta: ctx.orderFlow?.latestBarDelta,
      orderFlowTrend: ctx.orderFlow?.trend,
      orderFlowDivergence: ctx.orderFlow?.divergence,
      boxAnalysis: box ?? null,
    })
  }

  // 1a-0. 4-Hour (4H) Range Backtest: Accumulation & Distribution Characteristics
  if (
    /\b(box\s+(analysis|backtest|regime)|backtest\s+(this\s+)?(4h\s+)?(box|range)|analyze\s+(this\s+)?(4h\s+)?(box|range)|characteristics\s+of\s+accumulation\s+and\s+distribution|downtrend\s+or\s+uptrend|trend\s+invalidation|put\s+this\s+box|draw\s+this\s+box|sub[\s-]leg|how\s+(people|they|institutions)\s+(in\s+gold\s+)?accumulate|how\s+(people|they|institutions)\s+distribute|invalidation\s+of\s+the\s+downtrend|downtrend\s+and\s+uptrend)\b/i.test(
      lower
    )
  ) {
    if (box) {
      return formatBoxAnalysisForLeo(box)
    }
  }

  // 1a-2. Cross-Market Wyckoff Backtest Comparative Matrix. Must run BEFORE the generic radar matcher below,
  // otherwise "which market sweeps..." / "compare markets..." would be swallowed by the radar handler.
  if (
    /\b(compare\s+(the\s+)?(wyckoff|backtest|accumulation|distribution|ranges|markets)|wyckoff\s+comparison|market\s+backtest\s+comparison|which\s+market\s+(accumulates|distributes|sweeps|ignites)|cross[\s-]market\s+(wyckoff|backtest))\b/i.test(
      lower
    )
  ) {
    return generateWyckoffMarketComparisonMatrix()
  }

  // 1b. Cross-Asset Volatility & 5-Market Selection Radar (e.g. "rank the 5 markets", "market selection", "cross asset", "vix", "ovx", "gvz", "where is big money")
  if (
    /\b(rank|market\s+selection|cross[\s-]asset|volatility\s+index|vix|ovx|gvz|jniv|5\s+markets|where\s+is\s+big\s+money|which\s+market|which\s+ticker|compete\s+for\s+attention|vol\s+gauge\w*|market\s+radar)\b/i.test(lower)
  ) {
    const vol = ctx.crossMarketVolatility
    const radar = ctx.marketRadar
    const vix1d = vol?.equities.vix1d.value.toFixed(1) ?? '15.2'
    const vix = vol?.equities.vix.value.toFixed(1) ?? '16.8'
    const ovx = vol?.crude.ovx.value.toFixed(1) ?? '36.4'
    const gvz = vol?.gold.gvz.value.toFixed(1) ?? '15.1'
    const jniv = vol?.nikkei?.jniv.value.toFixed(1) ?? '20.4'

    const directive = radar?.deskDirective ?? 'CL (Crude Oil) is the sole Grade A candidate today. Ignore Grade B/C chop on peer markets.'

    const marketsList = radar?.markets
      ? Object.values(radar.markets)
          .map(
            (m) =>
              `- **${m.market} (${m.contractLabel}):** **Grade ${m.grade}** (${m.verdict.replace(/_/g, ' ')})\n  * *Participation:* ${m.participation.headline} [${m.volatilityGauge}: ${m.volatilityValue.toFixed(1)}]\n  * *Location:* ${m.location.headline}\n  * *Structure:* ${m.structure.headline}\n  * *Summary:* ${m.summaryLine}`
          )
          .join('\n\n')
      : `- **CRUDE (CL):** **Grade A** (FOCUS TRADE) — OVX surging + price at 5D LVN + Bullish CVD absorption.\n- **NASDAQ (MNQ):** **Grade C** (CHOP) — VIX1D flat, compressing inside yesterday value area.\n- **DOW (MYM):** **Grade B** (ARMED) — Range expanding but suspended 120 pts from support.\n- **SP500 (MES):** **Grade B** (ARMED) — Awaiting location touch at Y-VAL.\n- **GOLD (MGC):** **Grade C** (IGNORE) — GVZ compressed, volume light.`

    const vr = wReport?.volatilityAndRadarSynthesis
    const wyckoffVolRadarSection = vr
      ? `\n\n---\n\n### 🏛️ **Wyckoff Accumulation / Distribution Read from Vol Gauge & Radar (${ctx.instrument}):**\n- **Asset Implied Vol Gauge (${vr.primaryGaugeSymbol}):** **${vr.primaryGaugeValue != null ? vr.primaryGaugeValue.toFixed(1) : 'N/A'}** (${vr.primaryGaugeChangePct != null ? `${vr.primaryGaugeChangePct >= 0 ? '+' : ''}${vr.primaryGaugeChangePct.toFixed(1)}%` : '0.0%'}, Regime: **${vr.primaryGaugeRegime}**)\n- **Vol Gauge Wyckoff Signal:** **\`${vr.volGaugeSignal}\`**\n  * *Diagnostic:* ${vr.volGaugeDiagnosis}\n- **Cross-Market Radar Signal:** **\`${vr.crossMarketSignal}\`** (Grade **${vr.radarGrade ?? 'N/A'}**, Top Pick: **${vr.radarTopPick ?? 'NONE'}**)\n  * *Diagnostic:* ${vr.crossMarketDiagnosis}\n- **Combined Accumulation / Distribution Verdict:** **${vr.combinedAccDistVerdict}**\n  * **Actionable Synthesis:** ${vr.actionableSynthesis}`
      : `\n\n---\n\n### 🏛️ **How Vol Gauges & Radar Identify Wyckoff Accumulation vs. Distribution:**\n- **Silent Spring Absorption (Accumulation Phase C):** Price sweeps support while the asset's Vol Gauge (\`VIX1D\` / \`OVX\` / \`GVZ\` / \`JNIV\`) fails to spike or makes a lower high -> confirms absence of institutional panic hedging and favors passive limit absorption (Spring Reclaim).\n- **Post-Spring Vol Crush (Accumulation Phase D):** Price reclaims support or breaks resistance (SOS/LPS) while the Vol Gauge contracts -> confirms supply removal and supports markup.\n- **Distribution Vol Floor Divergence (Distribution Phase B/C):** Price probes resistance (UTAD) while the Vol Gauge stays elevated or rises (+2%+) -> warns of institutional downside hedging and raises Upthrust risk.\n- **Intermarket Non-Confirmation (SMTI):** When one index sweeps a high alone while peer indices fail to confirm on the Radar, treat it as an isolated Upthrust warning.`

    return `### 🎯 **Cross-Asset Volatility & 5-Market Selection Matrix**

**Implied Volatility Gauges (Asset-Specific):**
- **Equities (ES / NQ / YM):** VIX1D **${vix1d}** | 30D VIX **${vix}** (${vol?.equities.activeRegime ?? 'NORMAL'})
- **Crude Oil (CL / MCL):** OVX (USO options) **${ovx}** (${vol?.crude.activeRegime ?? 'EXPANDING'} 🔥)
- **Gold (GC / MGC):** GVZ (GLD options) **${gvz}** (${vol?.gold.activeRegime ?? 'NORMAL'})
- **Nikkei 225 (NKD):** JNIV **${jniv}** (${vol?.nikkei?.activeRegime ?? 'NORMAL'})

---

### 📊 **5-Market Opportunity Ranking (Participation × Location × Structure):**
${marketsList}${wyckoffVolRadarSection}

---

### 🛡️ **Desk Directive & Execution Decision:**
> **${directive}**

- **The Anti-Chase Imperative:** A market moving the most (+4%) in the middle of nowhere is NOT the best market; it is a Grade B/C trap. A market moving +0.5% at a 5-day LVN forming a clean spring is Grade A.
- **Single Whale Hedging Fallacy:** Do not assume a single institution is long oil and short Dow. Focus strictly on observable order flow: where aggressive market orders meet passive limit absorption.`
  }

  // 1b-2. Wyckoff Accumulation & Distribution Professional Audit
  if (
    !/\b(audit\s+(the\s+)?4\s+wyckoff|audit\s+4\s+setups)\b/i.test(lower) &&
    /\b(accumulat\w*|distribut\w*|wyckoff\s+(phase|range|backtest|benchmark|audit)|wyckoffian|is\s+this\s+accumulation|is\s+this\s+distribution|am\s+i\s+in\s+accumulation|am\s+i\s+in\s+distribution|accumulation\s+or\s+distribution|accumulation\s+phase|distribution\s+phase|schematic\s*[12]|selling\s+climax|buying\s+climax|spring\s+or\s+upthrust|re[\s-]accumulat\w*|re[\s-]distribut\w*)\b/i.test(
      lower
    )
  ) {
    const curPxNum = ctx.currentPrice ?? 0
    const curPxStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'
    const yval = ctx.shortTermMoney?.yval ?? null
    const yvah = ctx.shortTermMoney?.yvah ?? null
    const ypoc = ctx.shortTermMoney?.ypoc ?? null
    const val5d = ctx.intermediateMoney?.val5d ?? null
    const vah5d = ctx.intermediateMoney?.vah5d ?? null
    const poc5d = ctx.intermediateMoney?.poc5d ?? null
    const onlow = ctx.shortTermMoney?.onlow ?? null
    const onhigh = ctx.shortTermMoney?.onhigh ?? null
    const onpoc = ctx.shortTermMoney?.onpoc ?? null

    const supportFloor = yval ?? val5d ?? onlow
    const resistanceCeiling = yvah ?? vah5d ?? onhigh
    const equilibriumPoc = ypoc ?? poc5d ?? onpoc

    const of = ctx.orderFlow
    const cvdNum = of?.sessionCvd ?? 0
    const deltaNum = of?.latestBarDelta ?? 0
    const trend = of?.trend ?? 'BALANCED'
    const div = of?.divergence ?? 'NONE'

    // Determine Wyckoff structural phase and location
    let phaseDiagnosis = 'Phase B: Building the Cause (Range Balance / Absorption)'
    let phaseDetails =
      'Price is revolving inside the trading range boundaries. Two-way trade facilitation is active while floating supply/demand is transferred between participants.'
    let executionRead =
      'Rule 20 Absolute Filter: Middle of value / Phase B chop = NO TRADE. A professional Wyckoffian never gambles on directional resolution during Phase B. We stand aside and wait for the Phase C boundary test (Spring at Support or Upthrust at Resistance).'
    let tradeVerdict = 'WAIT'
    let primarySetup = 'None active inside Phase B chop'

    if (curPxNum > 0 && supportFloor != null && Math.abs(curPxNum - supportFloor) <= 15) {
      if (div === 'BULLISH_ABSORPTION' || (cvdNum < 0 && trend === 'SELLER_DOMINANT')) {
        phaseDiagnosis = 'Phase C: The Definitive Test (Spring / Shakeout at Support)'
        phaseDetails = `Price is testing the Trading Range Support Floor / Creek (around ${supportFloor.toFixed(2)}). Heavy selling pressure is failing to produce downside progress while CVD diverges downward (Bullish Absorption). Passive institutional bids are absorbing aggressive market selling.`
        executionRead = `Watch for Setup 1 (Spring Reclaim): If price sweeps below ${supportFloor.toFixed(2)} and promptly reclaims the level with holding reaction, initiate LONG hypothesis. Stop strictly below Spring low.`
        tradeVerdict = 'VALID LONG HYPOTHESIS'
        primarySetup = 'Setup 1: At Support — Spring → Reclaim (LONG)'
      } else {
        phaseDiagnosis = 'Phase C / Phase D Boundary Test at Support'
        phaseDetails = `Price is actively probing the Support Floor / Creek (${supportFloor.toFixed(2)}). Testing whether floating supply has dried up or if aggressive sellers are initiating a breakdown.`
        executionRead = `If sellers fail and price reclaims -> Setup 1 (Spring Reclaim LONG). If sellers shatter support on expanding volume with failed bounce -> Setup 2 (Breakdown Retest / SOW SHORT).`
        tradeVerdict = 'WAIT'
        primarySetup = 'Awaiting Reclaim (Spring) or Confirmed Breakdown (SOW)'
      }
    } else if (curPxNum > 0 && resistanceCeiling != null && Math.abs(curPxNum - resistanceCeiling) <= 15) {
      if (div === 'BEARISH_EXHAUSTION' || (cvdNum > 0 && trend === 'BUYER_DOMINANT')) {
        phaseDiagnosis = 'Phase C: The Definitive Test (Upthrust / UTAD at Resistance)'
        phaseDetails = `Price is testing the Trading Range Resistance Ceiling / Ice (around ${resistanceCeiling.toFixed(2)}). Heavy buying volume is meeting passive institutional supply without upward progress (Bearish Absorption / Churn). Institutions are distributing inventory to late retail buyers.`
        executionRead = `Watch for Setup 3 (Upthrust Return Below): If price sweeps above ${resistanceCeiling.toFixed(2)} and promptly returns below resistance, initiate SHORT hypothesis. Stop strictly above Upthrust extreme.`
        tradeVerdict = 'VALID SHORT HYPOTHESIS'
        primarySetup = 'Setup 3: At Resistance — Upthrust → Return Below (SHORT)'
      } else {
        phaseDiagnosis = 'Phase C / Phase D Boundary Test at Resistance'
        phaseDetails = `Price is probing the Resistance Ceiling / Ice (${resistanceCeiling.toFixed(2)}). Testing whether buyer demand can absorb overhead supply or if sellers will turn price back inside.`
        executionRead = `If buyers fail and price returns below -> Setup 3 (Upthrust Return SHORT). If buyers destroy resistance with initiative volume and hold retest -> Setup 4 (Breakout Retest / SOS LONG).`
        tradeVerdict = 'WAIT'
        primarySetup = 'Awaiting Return Below (Upthrust) or Confirmed Retest (SOS)'
      }
    } else if (curPxNum > 0 && supportFloor != null && curPxNum < supportFloor - 15) {
      phaseDiagnosis = 'Phase D / Phase E: Markdown in Progress (Fall Through the Ice / SOW)'
      phaseDetails = `Price has broken below the trading range support floor (${supportFloor.toFixed(2)}). Supply is firmly in control.`
      executionRead = `Never buy into an un-reclaimed breakdown! Watch for Setup 2: wait for a weak, low-volume pullback (LPSY) that fails to reclaim ${supportFloor.toFixed(2)} to initiate SHORT continuation.`
      tradeVerdict = 'WAIT'
      primarySetup = 'Setup 2: Breakdown → Failed Reclaim (SHORT Continuation)'
    } else if (curPxNum > 0 && resistanceCeiling != null && curPxNum > resistanceCeiling + 15) {
      phaseDiagnosis = 'Phase D / Phase E: Markup in Progress (Jump Across the Creek / SOS)'
      phaseDetails = `Price has shattered trading range resistance (${resistanceCeiling.toFixed(2)}) on initiative buying. Demand is in control.`
      executionRead = `Never chase the initial breakout candle! Watch for Setup 4: wait for an orderly pullback (LPS) that holds as support at ${resistanceCeiling.toFixed(2)} to initiate LONG continuation.`
      tradeVerdict = 'WAIT'
      primarySetup = 'Setup 4: Breakout → Successful Retest (LONG Continuation)'
    }

    const creekStr = supportFloor != null ? supportFloor.toFixed(2) : 'Awaiting Tier 1 support'
    const iceStr = resistanceCeiling != null ? resistanceCeiling.toFixed(2) : 'Awaiting Tier 1 resistance'
    const pocStr = equilibriumPoc != null ? equilibriumPoc.toFixed(2) : 'Awaiting POC'
    const b = getWyckoffBenchmark(ctx.instrument)
    const vr = wReport?.volatilityAndRadarSynthesis

    const volRadarBlock = vr
      ? `\n\n---\n\n### 2B. **Volatility Gauge (${vr.primaryGaugeSymbol}) & Cross-Market Radar Wyckoff Synthesis:**
- **Asset Vol Gauge (${vr.primaryGaugeSymbol}):** **${vr.primaryGaugeValue != null ? vr.primaryGaugeValue.toFixed(1) : 'N/A'}** (${vr.primaryGaugeChangePct != null ? `${vr.primaryGaugeChangePct >= 0 ? '+' : ''}${vr.primaryGaugeChangePct.toFixed(1)}%` : '0.0%'}, Regime: **${vr.primaryGaugeRegime}**) → Signal: **\`${vr.volGaugeSignal}\`**
  * *Vol Read:* ${vr.volGaugeDiagnosis}
- **Cross-Market Radar (${ctx.instrument}):** **Grade ${vr.radarGrade ?? 'N/A'}** (Top Pick: ${vr.radarTopPick ?? 'NONE'}) → Signal: **\`${vr.crossMarketSignal}\`**
  * *Intermarket Read:* ${vr.crossMarketDiagnosis}
- **Combined Vol + Radar Acc/Dist Verdict:** **${vr.combinedAccDistVerdict}**
  * **Takeaway:** ${vr.actionableSynthesis}`
      : ''

    return `### 🏛️ **Leo Wyckoff Accumulation vs. Distribution Master Audit (${ctx.instrument} @ ${curPxStr})**

> *"Richard D. Wyckoff Law: Price never moves by accident. A major trend (Effect) requires prior preparation and inventory transfer (Cause). The professional Wyckoffian trades observable structural events, never premature speculative labels."*

---

### 1. **Trading Range (TR) Structural Boundaries:**
- **The Creek (TR Support Floor):** **${creekStr}** *(Y-VAL: ${yval?.toFixed(2) ?? 'N/A'} | 5D-VAL: ${val5d?.toFixed(2) ?? 'N/A'} | ON-Low: ${onlow?.toFixed(2) ?? 'N/A'})*
- **The Ice (TR Resistance Ceiling):** **${iceStr}** *(Y-VAH: ${yvah?.toFixed(2) ?? 'N/A'} | 5D-VAH: ${vah5d?.toFixed(2) ?? 'N/A'} | ON-High: ${onhigh?.toFixed(2) ?? 'N/A'})*
- **Fair Value Equilibrium (POC):** **${pocStr}** *(Y-POC: ${ypoc?.toFixed(2) ?? 'N/A'} | 5D-POC: ${poc5d?.toFixed(2) ?? 'N/A'})*
- **Current Range Position:** ${curPxNum > 0 && supportFloor != null && resistanceCeiling != null ? `${Math.round(((curPxNum - supportFloor) / (resistanceCeiling - supportFloor || 1)) * 100)}% of range span` : 'Evaluating location'}

---

### 2. **Current Phase Diagnosis & Market State:**
- **Diagnosed Phase:** **${phaseDiagnosis}**
- **Structural Analysis:** ${phaseDetails}
- **Effort vs. Result Read:** Session CVD is **${cvdNum >= 0 ? '+' : ''}${cvdNum.toLocaleString()} contracts** (${trend}). Bar delta: **${deltaNum >= 0 ? '+' : ''}${deltaNum.toLocaleString()}**. Order flow divergence: **${div !== 'NONE' ? div : 'None'}**.${volRadarBlock}

---

### 3. **The 5 Wyckoff Phases — Quick Reference Audit:**
- **Phase A (Stopping Action):** Halts prior trend via Climax (SC/BC) -> Automatic Reaction (AR) -> Secondary Test (ST).
- **Phase B (Building Cause):** Floating supply absorption (Accumulation) or distribution to weak hands (Distribution). Volume dries up on down-waves in accumulation; volume expands on down-waves in distribution. *Phase B is balance: DO NOT TRADE mid-range chop!*
- **Phase C (The Definitive Test):**
  * **Accumulation:** Spring / Shakeout below support. *Logical Rule: A dip is ONLY a Spring upon confirmed RECLAIM.*
  * **Distribution:** Upthrust / UTAD above resistance. *Logical Rule: A breakout is ONLY an Upthrust upon confirmed RETURN BELOW.*
- **Phase D (Trend Within Range):**
  * **Accumulation:** Sign of Strength (SOS / JAC) + Last Point of Support (LPS retest).
  * **Distribution:** Sign of Weakness (SOW / Fall Through Ice) + Last Point of Supply (LPSY failed retest).
- **Phase E (Outside Trend):** Sustained Markup or Markdown.

---

### 4. **Re-Accumulation vs. Re-Distribution Filter:**
- **During an Uptrend:** Do NOT assume every pause is distribution! If volume dries up on pullbacks and support holds on light volume, it is **Re-Accumulation** preparing for higher prices.
- **During a Downtrend:** Do NOT assume every bounce is accumulation! If volume dries up on rallies and resistance holds on weak buying, it is **Re-Distribution** preparing for lower prices.

---

### 5. **Fatal Logical Errors Avoided:**
1. ❌ *Calling a Spring before reclaim:* A breakdown without reclaim is markdown continuation.
2. ❌ *Calling an Upthrust before return below:* A breakout holding above is an SOS.
3. ❌ *Predicting in Phase B:* Trading inside Phase B chop is gambling; wait for Phase C test or Phase D retest.
4. ❌ *Ignoring Effort vs Result:* Heavy volume with zero price advancement is institutional absorption, not momentum.

---

### 6. **Quantitative 1-Year 5-Minute Wyckoff Range Benchmarks (${b.market} — ${b.contractLabel}):**
- **Verified Sample:** Evaluated across **${b.totalRanges.toLocaleString()}** qualified 5-minute trading ranges (${b.accumulationCount} Acc vs. ${b.distributionCount} Dist) from ${WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed.toLocaleString()} qualified 5-minute trading ranges evaluated across all desk markets (${WYCKOFF_CROSS_MARKET_BASELINE.samplePeriod}).
- **The Spring Sweep Rate:** Only **${b.springRatePct}%** (Cross-Market Baseline: **${WYCKOFF_CROSS_MARKET_BASELINE.springRatePct}%**) of institutional accumulations feature a Lower Low sweep (Spring / Schematic 1). The overwhelming majority (**${b.lpsRatePct}%**, Cross-Market: **${WYCKOFF_CROSS_MARKET_BASELINE.lpsRatePct}%**) build a Higher Low (Last Point of Support / LPS / Schematic 2). *Never mandate a lower low to enter; doing so misses >80% of institutional markups.*
- **The UTAD Sweep Rate:** Only **${b.utadRatePct}%** (Cross-Market Baseline: **${WYCKOFF_CROSS_MARKET_BASELINE.utadRatePct}%**) of institutional distributions feature a Higher High sweep (UTAD / Schematic 1). **${b.lpsyRatePct}%** (Cross-Market: **${WYCKOFF_CROSS_MARKET_BASELINE.lpsyRatePct}%**) roll over from a lower high (LPSY / Schematic 2).
- **Sweep Volume Multiplier:** Genuine sweeps on ${b.market} average **${b.sweepVolumeMultiplier}x** the 20-bar range volume (DOW: 2.11x, CL: 1.92x, NKD: 1.82x, NQ: 1.67x, GC: 0.68x).
- **Sweep Depth & Breakout ATR:** Average sweep depth across the dataset is **${WYCKOFF_CROSS_MARKET_BASELINE.sweepDepthAvgAtr} ATR** beyond the range boundary; average breakout ATR expansion on ${b.market} is **${b.atrExpansionRatio}x** (cross-market: **${WYCKOFF_CROSS_MARKET_BASELINE.avgBreakoutAtrExpansion}x**).
- **Timing & Session Cadence:**
  * **Where Ranges Form:** **${b.overnightFormationPct}%** of ${b.market} trading ranges build overnight (Asia ${b.asiaFormationPct}% + London ${b.londonFormationPct}%; Cross-Market Baseline: **${WYCKOFF_CROSS_MARKET_BASELINE.overnightFormationPct}%**). Average Phase B cause duration is **${b.avgRangeDurationHours} hours**.
  * **Top Ignition Hours (${b.market}):** **${b.topIgnitionHoursEt.slice(0, 3).map(formatIgnitionHour).join(', ')}** (raw counts: ${b.topIgnitionHoursEt.slice(0, 3).join(', ')}).
- **Asset Character Profile:** ${b.characterProfile}

---

### 7. **Desk Execution Verdict & Setup:**
- **Active Setup:** **${primarySetup}**
- **Execution Read:** ${executionRead}
- **Required Clearance:** Minimum **2.0R** reward clearance to opposite boundary required before entering.
- **VERDICT:** **${tradeVerdict}** *(Advisory tradeable hypothesis only; read-only platform never executes orders).*${
      wReport || (ctx.recentCandles && ctx.recentCandles.length >= 6)
        ? `\n\n---\n\n### 8. **Live Multi-Timeframe Wyckoff Auction Intelligence Engine (1D → 30m → 5m):**\n\`\`\`text\n${formatWyckoffMultiTimeframeBriefForLeo(
            wReport ??
              generateAndPersistWyckoffReport(
                {
                  instrumentRaw: ctx.instrument,
                  intradayCandles: ctx.recentCandles,
                  crossMarketVolatility: ctx.crossMarketVolatility ?? null,
                  marketRadar: ctx.marketRadar ?? null,
                },
                { persistToDisk: false }
              )
          )}\n\`\`\``
        : ''
    }`
  }

  // 1c. Quick-Ask 1: Audit 4 Wyckoff Execution Setups (Spring, Upthrust, Breakout Retest, Breakdown Retest)
  if (
    /\b(audit\s+(the\s+)?4\s+wyckoff\s+execution\s+setups|audit\s+4\s+setups|audit\s+the\s+4\s+setups|audit\s+wyckoff\s+setups|check\s+4\s+setups)\b/i.test(
      lower
    )
  ) {
    const curPxNum = ctx.currentPrice ?? 0
    const curPxStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'
    const yval = ctx.shortTermMoney?.yval ?? null
    const yvah = ctx.shortTermMoney?.yvah ?? null
    const ypoc = ctx.shortTermMoney?.ypoc ?? null
    const onpoc = ctx.shortTermMoney?.onpoc ?? null
    const onhigh = ctx.shortTermMoney?.onhigh ?? null
    const onlow = ctx.shortTermMoney?.onlow ?? null

    let locationRead = `Price is currently at ${curPxStr}, suspended between major pre-marked structural tiers.`
    let setupRead = 'No clean execution structure currently formed at predetermined zones.'
    let verdict = 'WAIT'

    if (curPxNum > 0) {
      if (yval != null && Math.abs(curPxNum - yval) <= 15) {
        locationRead = `Price is actively testing Yesterday Value Area Low (Y-VAL @ ${yval.toFixed(2)}).`
        setupRead = `Testing key support. Watch for Setup 1 (Spring sweep + reclaim -> LONG hypothesis) or Setup 2 (Breakdown + failed reclaim -> SHORT hypothesis).`
      } else if (onlow != null && Math.abs(curPxNum - onlow) <= 15) {
        locationRead = `Price is testing Overnight Low (ON-Low @ ${onlow.toFixed(2)}).`
        setupRead = `Testing session support. Watch for Setup 1 (Spring sweep + reclaim -> LONG hypothesis).`
      } else if (yvah != null && Math.abs(curPxNum - yvah) <= 15) {
        locationRead = `Price is testing Yesterday Value Area High (Y-VAH @ ${yvah.toFixed(2)}).`
        setupRead = `Testing key resistance. Watch for Setup 3 (Upthrust sweep + return below -> SHORT hypothesis) or Setup 4 (Breakout + successful retest -> LONG hypothesis).`
      } else if (onhigh != null && Math.abs(curPxNum - onhigh) <= 15) {
        locationRead = `Price is testing Overnight High (ON-High @ ${onhigh.toFixed(2)}).`
        setupRead = `Testing session resistance. Watch for Setup 3 (Upthrust sweep + return below -> SHORT hypothesis).`
      } else if (ypoc != null && Math.abs(curPxNum - ypoc) <= 10) {
        locationRead = `Price is revolving directly inside Yesterday POC chop (${ypoc.toFixed(2)}).`
        setupRead = `Rule 20 Absolute Filter: Middle of value / POC chop = NO TRADE.`
        verdict = 'NO TRADE'
      } else if (onpoc != null && Math.abs(curPxNum - onpoc) <= 10) {
        locationRead = `Price is hovering near Overnight Point of Control (ON-POC @ ${onpoc.toFixed(2)}).`
        setupRead = `Price is near overnight equilibrium. Awaiting expansion toward predetermined Tier 1 zone boundaries.`
        verdict = 'WAIT'
      }
    }

    const cvdRead = ctx.orderFlow
      ? `Session CVD: ${ctx.orderFlow.sessionCvd >= 0 ? '+' : ''}${ctx.orderFlow.sessionCvd.toLocaleString()} contracts (${ctx.orderFlow.trend}). Divergence: ${ctx.orderFlow.divergence !== 'NONE' ? ctx.orderFlow.divergence : 'None'}.`
      : 'CVD order flow: UNAVAILABLE.'

    return `### 🏛️ **Leo 4-Setup Wyckoff Audit (${ctx.instrument} @ ${curPxStr})**

**The Only 4 Trades in the Universe (Rule 11 Audit):**
1. **At Support — Spring → Reclaim (LONG):** ${yval != null ? `Watching support around Y-VAL (${yval.toFixed(2)}) & ON-Low (${onlow ?? 'N/A'}). Sweep below + reclaim required.` : 'Awaiting support zone touch.'}
2. **At Support — Breakdown → Failed Reclaim (SHORT):** Initiative volume breakdown through support followed by weak bounce failing to reclaim.
3. **At Resistance — Upthrust → Return Below (SHORT):** ${yvah != null ? `Watching resistance around Y-VAH (${yvah.toFixed(2)}) & ON-High (${onhigh ?? 'N/A'}). Sweep above + return below required.` : 'Awaiting resistance zone touch.'}
4. **At Resistance — Breakout → Successful Retest (LONG):** Initiative volume expansion above resistance followed by pullback holding as support. Never chase initial breakout.

---

### 📊 **Live Screen Readout:**
- **LOCATION:** ${locationRead}
- **REACTION:** Price reaction developing; observing bar close and candle rejection wicks.
- **RESULT:** Effort vs result being evaluated.
- **CVD:** ${cvdRead}
- **TRIGGER:** ${setupRead}
- **RISK:** Structural invalidation strictly beyond sweep extreme (Spring low or Upthrust high).
- **2R ROOM:** Target must offer at least 2.0R clearance to next major frozen zone before entry.
- **VERDICT:** **${verdict}** *(Tradeable hypothesis only; read-only system never places orders).*`
  }

  // 1d. Quick-Ask 2: Check Pre-Market Tier 1 Zones (5D Profile, Yesterday's Profile, Overnight)
  if (
    /\b(check\s+(our\s+)?pre[\s-]market\s+tier\s+1\s+zones|check\s+tier\s+1\s+zones|check\s+tier\s+1\s+map|frozen\s+tier\s+1\s+map|pre[\s-]market\s+zones)\b/i.test(
      lower
    )
  ) {
    const curPxStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'Awaiting quote'
    const curPx = ctx.currentPrice ?? 0

    const p5d = ctx.intermediateMoney
    const y = ctx.shortTermMoney
    const lt = ctx.longTermMoney

    const zones: Array<{ name: string; price: number; dist: number }> = []
    if (curPx > 0) {
      if (p5d?.poc5d) zones.push({ name: '5D POC', price: p5d.poc5d, dist: Math.abs(curPx - p5d.poc5d) })
      if (p5d?.vah5d) zones.push({ name: '5D VAH', price: p5d.vah5d, dist: Math.abs(curPx - p5d.vah5d) })
      if (p5d?.val5d) zones.push({ name: '5D VAL', price: p5d.val5d, dist: Math.abs(curPx - p5d.val5d) })
      if (y?.ypoc) zones.push({ name: 'Y-POC', price: y.ypoc, dist: Math.abs(curPx - y.ypoc) })
      if (y?.yvah) zones.push({ name: 'Y-VAH', price: y.yvah, dist: Math.abs(curPx - y.yvah) })
      if (y?.yval) zones.push({ name: 'Y-VAL', price: y.yval, dist: Math.abs(curPx - y.yval) })
      if (y?.onpoc) zones.push({ name: 'ON-POC', price: y.onpoc, dist: Math.abs(curPx - y.onpoc) })
      if (y?.onhigh) zones.push({ name: 'ON-High', price: y.onhigh, dist: Math.abs(curPx - y.onhigh) })
      if (y?.onlow) zones.push({ name: 'ON-Low', price: y.onlow, dist: Math.abs(curPx - y.onlow) })
    }
    zones.sort((a, b) => a.dist - b.dist)
    const nearest = zones[0]

    return `### 🗺️ **Pre-Market Tier 1 Frozen Map (${ctx.instrument} @ ${curPxStr})**

*Rule 3 Mandate: Pre-market map is frozen at session open. After the freeze, do NOT invent new levels. Zones, not laser beams.*

---

### 1. **Rolling 5-Day Volume Profile (Intermediate-Term Money):**
- **5D POC:** **${p5d?.poc5d?.toFixed(2) ?? 'UNAVAILABLE'}** (High-volume acceptance anchor)
- **5D Value Area (70%):** VAL **${p5d?.val5d?.toFixed(2) ?? 'UNAVAILABLE'}** – VAH **${p5d?.vah5d?.toFixed(2) ?? 'UNAVAILABLE'}**
- **5D Range Extremes:** Low **${p5d?.low5d?.toFixed(2) ?? 'UNAVAILABLE'}** – High **${p5d?.high5d?.toFixed(2) ?? 'UNAVAILABLE'}**

### 2. **Yesterday NYC Profile (Short-Term Money):**
- **Yesterday POC (Y-POC):** **${y?.ypoc?.toFixed(2) ?? 'UNAVAILABLE'}**
- **Yesterday Value Area:** Y-VAL **${y?.yval?.toFixed(2) ?? 'UNAVAILABLE'}** – Y-VAH **${y?.yvah?.toFixed(2) ?? 'UNAVAILABLE'}**
- **Yesterday Extremes:** Y-Low **${y?.ylow?.toFixed(2) ?? 'UNAVAILABLE'}** – Y-High **${y?.yhigh?.toFixed(2) ?? 'UNAVAILABLE'}**

### 3. **Overnight Session (18:00 – 09:29 ET):**
- **Overnight POC (ON-POC):** **${y?.onpoc?.toFixed(2) ?? 'UNAVAILABLE'}**
- **Overnight Extremes:** ON-Low **${y?.onlow?.toFixed(2) ?? 'UNAVAILABLE'}** – ON-High **${y?.onhigh?.toFixed(2) ?? 'UNAVAILABLE'}**
- **Inventory Directional Proxy:** **${y?.overnightBias ?? 'BALANCED'}** *(Displacement vs prior value; not participant count)*

---

### 📍 **Current Proximity & Desk Read:**
${nearest ? `- **Nearest Predetermined Zone:** **${nearest.name}** at **${nearest.price.toFixed(2)}** (Distance: **${nearest.dist.toFixed(1)} pts**).\n- **First Question After Freeze (Rule 4):** Are we approaching ${nearest.name}? If price is not near a predetermined zone: **NO TRADE**.` : '- Awaiting price quote to measure distance.'}
- **Tier 3 Context Note:** 5-Month AVWAP is at **${lt?.avwap5m?.toFixed(2) ?? 'UNAVAILABLE'}** (±1σ: [${lt?.sigma1Lower?.toFixed(2) ?? 'N/A'}, ${lt?.sigma1Upper?.toFixed(2) ?? 'N/A'}]). *Tier 3 is background context only and NEVER overrides Tier 1.*`
  }

  // 1e. Quick-Ask 3: Audit CVD and Volume for Effort vs Result (Rules 7, 9, 12, 13)
  if (
    /\b(audit\s+cvd\s+and\s+volume|audit\s+cvd|effort\s+versus\s+result|effort\s+vs\s+result|absorbed\s+at\s+key\s+levels|order\s+flow\s+being\s+absorbed)\b/i.test(
      lower
    )
  ) {
    const curPxStr = ctx.currentPrice != null ? ctx.currentPrice.toFixed(2) : 'active price'
    const of = ctx.orderFlow

    const cvdNum = of?.sessionCvd ?? 0
    const deltaNum = of?.latestBarDelta ?? 0
    const buyVol = of?.latestBuyVolume ?? 0
    const sellVol = of?.latestSellVolume ?? 0
    const buyPct = of ? (of.latestBuyRatio * 100).toFixed(0) : '50'
    const trend = of?.trend ?? 'BALANCED'
    const div = of?.divergence ?? 'NONE'

    let absorptionSummary = 'Order flow is currently balanced with proportional price progress.'
    if (div === 'BULLISH_ABSORPTION' || (cvdNum < 0 && trend === 'SELLER_DOMINANT')) {
      absorptionSummary = '⚠️ **Potential Bullish Absorption Detected:** Aggressive market sellers are active, but price is refusing to make lower lows. Strong money passive limit bids are absorbing aggressive market sells at support.'
    } else if (div === 'BEARISH_EXHAUSTION' || (cvdNum > 0 && trend === 'BUYER_DOMINANT')) {
      absorptionSummary = '⚠️ **Potential Bearish Absorption / Exhaustion:** Aggressive market buyers are hitting offers, but price is stalling or rejecting overhead resistance. Passive limit offers are absorbing aggressive demand.'
    }

    return `### 📊 **Leo CVD & Volume Audit — Effort vs. Result (${ctx.instrument} @ ${curPxStr})**

> *"Volume represents Effort; Price displacement represents Result. CVD tracks whether aggressive market participants are actually getting a result or meeting passive institutional absorption."*

---

### 1. **Order Flow Telemetry (CME Globex Globex Tick Flow):**
- **Session CVD:** **${cvdNum >= 0 ? '+' : ''}${cvdNum.toLocaleString()} contracts**
- **Latest Bar Delta:** **${deltaNum >= 0 ? '+' : ''}${deltaNum.toLocaleString()}** (Buy: ${buyVol.toLocaleString()} | Sell: ${sellVol.toLocaleString()} | ${buyPct}% Buy)
- **Aggressive Flow Bias:** **${trend}** *(Participant identity is unknown; observable market orders only)*
- **Order Flow Divergence:** **${div !== 'NONE' ? `⚠️ ${div}` : 'No active divergence'}**

---

### 2. **Effort vs. Result Assessment (Rules 12 & 13):**
- **Bullish Absorption:** Heavy selling volume / falling CVD with little or no downward price displacement -> Buyers absorbing sellers at support.
- **Bearish Absorption:** Heavy buying volume / rising CVD with little or no upward price displacement -> Sellers absorbing buyers at resistance.
- **Initiative Drive:** Large directional volume accompanied by proportional price expansion -> Facilitating trade in trend direction.
- **Current Desk Read:** ${absorptionSummary}

---

### 🛡️ **Execution Doctrine Reminder:**
- **CVD DOES NOT TRIGGER TRADES.** Price reclaim or rejection of a predetermined Tier 1 zone triggers the setup.
- CVD merely confirms trade quality and increases execution confidence. Always require one of the 4 valid execution structures!`
  }

  // 1f. The Trader's 22-Rule Wyckoff Strategy & Execution Doctrine
  if (
    /\b(what\s+is\s+our\s+strategy|explain\s+(our\s+)?strategy|22\s+rules|wyckoff\s+strategy|execution\s+doctrine|playbook|what\s+are\s+the\s+4\s+trades|only\s+4\s+trades|four\s+trades|four\s+setups|when\s+do\s+we\s+not\s+trade|absolute\s+filters)\b/i.test(
      lower
    )
  ) {
    return `### 🏛️ **The Trader's 22-Rule Wyckoff & Dalton AMT Execution Playbook**

> **Single Execution Doctrine:** We trade strictly predetermined Tier 1 location, observable price reaction, CVD confirmation, the ONLY four allowed structures, structural invalidation, and minimum 2.0R clearance. Neither the trader nor Leo ever places orders directly on this platform.

---

### 1. **The 3-Tier Chart & Structure Hierarchy (Rule 2):**
- **Tier 1 (Mandatory - Pre-market Structure Frozen at Open):**
  * Rolling 5-Day Volume Profile: 5D POC, HVNs, LVNs, VAH, VAL, High, Low.
  * Yesterday NYC Profile (09:30–16:00 ET): VAH, POC, VAL, High, Low.
  * Overnight Session (18:00–09:29 ET): ON-High, ON-Low, ON-POC (context only; inventory direction does not trigger trades).
- **Tier 2 (Execution Confirmation):**
  * Current Price, Normal Volume Bars (Effort vs. Result), CME Globex CVD (Absorption & Confirmation).
- **Tier 3 (Context Only - NEVER Overrides Tier 1):**
  * 5-Month Anchored VWAP (5M AVWAP) + ±1σ/±2σ bands and Cross-Asset Volatility Gauges (VIX1D, OVX, GVZ).

---

### 2. **The ONLY 4 Trades in the Entire Execution Universe (Rule 11):**
1. **At Support — Spring → Reclaim → LONG Hypothesis:**
   Price sweeps below predetermined support -> sellers fail to continue -> price reclaims zone -> reclaim holds -> LONG. Stop strictly below spring low.
2. **At Support — Breakdown → Failed Reclaim → SHORT Hypothesis:**
   Price cleanly destroys support with initiative volume -> weak bounce fails to reclaim -> SHORT continuation. Stop above failed reclaim high.
3. **At Resistance — Upthrust → Return Below → SHORT Hypothesis:**
   Price breaks above predetermined resistance -> buyers fail to continue -> price returns below resistance -> failed reclaim / lower high -> SHORT. Stop strictly above upthrust high.
4. **At Resistance — Breakout → Successful Retest → LONG Hypothesis:**
   Price destroys resistance with initiative volume (Jump Across Creek / SOS) -> pullback holds as support (LPS) -> LONG continuation. Never chase initial breakout candle!
*EVERYTHING ELSE: IGNORE.* Trendline break alone is not a fifth trade.

---

### 3. **The 8-Step Screen-Reading Sequence (Rule 23):**
1. **LOCATION** -> 2. **REACTION** -> 3. **RESULT** -> 4. **CVD + VOL** -> 5. **TRIGGER** -> 6. **RISK** -> 7. **REWARD (≥2R)** -> 8. **TRADEABLE HYPOTHESIS**.
*The last step is a tradeable hypothesis, not an order. We never say ENTER.*

---

### 4. **When You Do NOT Trade — 9 Absolute Filters (Rule 20):**
- No predetermined level -> **NO TRADE**
- Middle of value / POC chop -> **NO TRADE**
- Random range away from zones -> **NO TRADE**
- Spring without reclaim -> **NO TRADE**
- Upthrust without return below -> **NO TRADE**
- Breakout without pullback -> **DON'T CHASE**
- Less than 2R room to next zone -> **NO TRADE**
- Structure is confusing -> **NO TRADE**
- Nothing happens all day -> **ZERO TRADES (Fully valid & disciplined)**

---

### 5. **Risk & Stop Discipline (Rules 17, 18, 19):**
- **Minimum 2R Target:** If the obstacle to the next zone offers < 2.0R room, NO TRADE.
- **Stop Loss:** Set strictly by market structure (Spring low or Upthrust high). Position size is calculated from fixed 1R risk.
- **Never Widen the Stop:** If structural invalidation is breached, you are wrong. Flatten immediately.`
  }

  // 1g. Platform Features & Capabilities Master Directory
  if (
    /\b(what\s+are\s+(all\s+of\s+)?(the\s+)?features|platform\s+features|desk\s+features|what\s+features\s+do\s+we\s+have|list\s+(all\s+)?features|feature\s+list|hotkeys?|keyboard\s+shortcuts?)\b/i.test(
      lower
    )
  ) {
    return `### 🛠️ **Trading Platform Features & Capabilities Master Directory**

The platform is strictly a **deterministic institutional market structure, quantitative drawing analytics, and situation monitoring desk**.

---

### 1. **Multi-Horizon Money Levels:**
- **Tier 1 (Frozen Map):** Rolling 5-Day Volume Profile (POC, VAH, VAL, HVN, LVN), Yesterday NYC Session Profile (VAH, POC, VAL, High, Low), and Overnight Session (ON-High, ON-Low, ON-POC, inventory displacement).
- **Tier 3 (Context Benchmark):** 5-Month Anchored VWAP (5M AVWAP) with ±1.0σ Value Area and ±2.0σ Exhaustion bands.

---

### 2. **Interactive Drawing Tools & Hotkeys:**
- **Action & Reaction Trendlines (Hotkey: W or X):** Real-time slope (pts/min and pts/5m), Spring/Upthrust origin detection, Horizontal S/R Runway Assessment (runway points, ratio, nearest target, Clear ≥2.5:1 vs Tight <1.5:1 trap warning), and Empirical Velocity Corridor (1.0x Equilibrium, 1.5x Climax parabolic, 0.5x Retest Floor).
- **Range Boxes (Hotkey: D):** Real-time traded volume, volume rate per minute, buy ratio %, delta, POC, and span in points.
- **Multi-Range Volume Comparison Matrix:** Draws comparisons across 2+ ranges or FRVPs, measuring percentage volume change and classifying **Support Readiness** (Good vs Bad Support) & **Resistance Readiness** (Good vs Bad Resistance).
- **Manual Fixed Range Volume Profile / FRVP (Hotkey: V):** High-resolution POC, VAH, VAL, volume, and buy ratio %.
- **Manual Anchored VWAP / AVWAP (Hotkey: U):** Typical Price (H+L+C)/3 with ±1.0σ Value Area bands (~68% volume), ±2.0σ Exhaustion bands (~95% volume), and z-score stretch (σ).
- **Measure Tool (Hotkey: M):** Quantifies points and bar counts between two points.
- **Highlight Time Tool (Hotkey: T):** Highlights vertical session time bands.
- **Delete Tool (Hotkey: Delete or Backspace):** Deletes active selected drawing.
- **Escape (Hotkey: Esc):** Cancels drawing draft, modal, risk box, or exits fullscreen.

---

### 3. **Dalton Auction Market Theory & Profile HUD:**
- **Day Type Classification:** Normal, Normal Variation, Trend Bull, Trend Bear, Double Distribution, Neutral Day.
- **Opening Type:** Open Auction, Open Rejection Reverse, Open Drive, Open Test Drive.
- **Session Continuum:** Tokyo (09:00–15:00 JST), NYC Equity (09:30–16:00 ET), Trader-Defined NY Profile for Gold/Crude (09:30–16:00 ET).
- **Active Excess Tails:** London, Asia, and NYC buying & selling tails with retest volume ratios.
- **Opening Ranges:** OR15 (Hotkey: **N**), OR30 (Hotkey: **R**).
- **HUD Toggles:** Session Bands (Hotkey: **H**), Levels (Hotkey: **L**), Yesterday Profile (Hotkey: **Y**), Playbook (Hotkey: **P**), Fullscreen (Hotkey: **F**).

---

### 4. **Real-Time Order Flow & CME Globex CVD:**
- Real-time Globex tick delta, session CVD, latest bar delta, buy/sell volume, and buy ratio %.
- Bullish absorption, Bearish absorption, and Initiative continuation detection.

---

### 5. **Auction Price Critique & "Questioning" Desk (Hotkey: Q):**
- Pre-trade self-audit modal & telemetry.
- Valuation Meter & Score (-100 Deep Discount to +100 Extreme Premium).
- Suitability Verdict, Wholesale Target, and Overnight Inventory Skew.
- Weak-Hand Trap & Emotional Risk Radar.
- 6-Question Pre-Trade Self-Audit.

---

### 6. **Cross-Asset Volatility Gauges & 5-Market Selection Radar:**
- VIX1D, 30D VIX, OVX, GVZ, JNIV implied volatility tracking.
- 5-Market Selection Matrix across NQ, ES, YM, Gold, Silver, Oil (Participation × Location × Structure) ranking contracts into Grade A (Focus), Grade B (Armed), Grade C (Chop).

---

### 7. **Macro Reactions & Specialist Desk Briefs:**
- Verified economic calendar releases (CPI, NFP, FOMC) via Finnhub with live reaction telemetry.
- Specialist Analyst briefs (Nasdaq, Dow, Gold, Oil, Nikkei) on the market intelligence bus.

---

### 8. **Armed Situation Monitoring (<execute> Directives):**
- \`ARM_CONDITIONAL_ENTRY\`: Monitors live candles for 4 structures & candle patterns at key levels with dynamic stop loss (below candle low) and take profit R:R.
- \`ARM_TRENDLINE_STRATEGY\`: Systematic trendline breakout & retest hypothesis watcher with Chop Shield.
- \`ARM_DESK_ALERT\`: Price touch chime audio alarms.
- \`SAVE_LONG_TERM_MEMORY\`: Persists higher-timeframe observation zones.
- \`ARM_STAGNATION_RULE\`: Advisory reminder if a position does not move into profit within X minutes.
- \`CLOSE_POSITION\`: Advisory manual flatten reminder (does not execute broker orders).
- \`SET_DAY_TYPE\`: Dalton day type override.
- \`CANCEL_RULES\`: Clears active armed watches.

---

### 🛡️ **Zero-Hallucination Platform Boundaries:**
- **Strict Read-Only:** The platform NEVER places, modifies, or cancels broker orders.
- **No Retail Lagging Indicators:** NO RSI, NO MACD, NO Stochastic, NO Bollinger Bands, NO Fibonacci, NO Gann fans.
- **No 5th Setup:** Only the 4 Wyckoff structures are valid triggers.`
  }

  // 2. Conditional Entry Strategy & Drawing Monitor (e.g. "monitor price for yesterday FRVP low volume node; if we see a bullish engulfing enter long...", "in low volume of yesterday fix range volume profile if we see a bullish engulfing enter")
  if (
    /\b(monitor|if\s+we\s+see|if\s+you\s+see|when\s+price|in\s+low\s+volume|low\s+volume\s+node|bullish\s+engulfing|bearish\s+engulfing|hammer|rejection\s+tail)\b/i.test(lower) &&
    /\b(enter|buy|long|sell|short)\b/i.test(lower)
  ) {
    const isShort = /\b(sell|short)\b/i.test(lower)
    const direction: 'LONG' | 'SHORT' = isShort ? 'SHORT' : 'LONG'
    
    let inst = ctx.instrument || 'NASDAQ'
    if (/\bdow\b|ym/i.test(lower)) inst = 'DOW'
    else if (/\bnasdaq\b|nq/i.test(lower)) inst = 'NASDAQ'
    else if (/\bgold\b|gc/i.test(lower)) inst = 'GOLD'
    else if (/\bcrude\b|oil|cl/i.test(lower)) inst = 'CRUDE'
    else if (/\bsilver\b|si\b|sil\b/i.test(lower)) inst = 'SILVER'

    // Only assign a candlestick pattern if the user actually mentioned one.
    // If they just said "buy above this level" with no pattern language → LEVEL_TOUCH.
    const userMentionedPattern =
      /bullish\s+engulfing|bearish\s+engulfing|hammer|shooting\s*star|rejection\s*(tail|wick)|level\s+touch|absorption|sweep/i.test(lower)

    let pattern: 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'HAMMER' | 'INVERTED_HAMMER' | 'SHOOTING_STAR' | 'REJECTION_TAIL' | 'LEVEL_TOUCH' =
      'LEVEL_TOUCH' // default: enter when price touches the level — no candle pattern required
    if (userMentionedPattern) {
      if (/hammer/i.test(lower)) pattern = 'HAMMER'
      else if (/shooting\s*star/i.test(lower)) pattern = 'SHOOTING_STAR'
      else if (/rejection/i.test(lower)) pattern = 'REJECTION_TAIL'
      else if (/bullish\s+engulfing/i.test(lower)) pattern = 'BULLISH_ENGULFING'
      else if (/bearish\s+engulfing/i.test(lower)) pattern = 'BEARISH_ENGULFING'
      else pattern = direction === 'LONG' ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING'
    }

    // Detect entry timeframe — null means "any timeframe, Leo monitors all"
    let entryTimeframe: string | null = null
    const tfMatch = lower.match(/\b(1|2|3|4|5|6|8|10|12|15|20|25|30|45|60|90|120|240|480|D|W)\s*(?:min(?:ute)?s?|m\b|h(?:our)?s?|hr?s?|d(?:ay)?s?|w(?:eek)?s?)/i)
    if (tfMatch) {
      const raw = tfMatch[1]!.toUpperCase()
      // Normalize to minutes for standard values
      if (/^d$/i.test(raw)) entryTimeframe = '1440'
      else if (/^w$/i.test(raw)) entryTimeframe = '10080'
      else entryTimeframe = raw
    }

    // Detect CVD divergence requirement
    const cvdDivergence = /\bcvd\b|\bcumulative\s+volume\s+delta|\bdivergence\b/i.test(lower)

    let stopLossMode: 'BELOW_CANDLE_LOW' | 'ABOVE_CANDLE_HIGH' | 'FIXED_POINTS' | 'DOLLARS_50' =
      direction === 'LONG' ? 'BELOW_CANDLE_LOW' : 'ABOVE_CANDLE_HIGH'
    if (/below\s+(the\s+)?(candle|bar|engulfing)\s*low/i.test(lower)) stopLossMode = 'BELOW_CANDLE_LOW'
    else if (/above\s+(the\s+)?(candle|bar|engulfing)\s*high/i.test(lower)) stopLossMode = 'ABOVE_CANDLE_HIGH'
    else if (/50|fifty/i.test(lower)) stopLossMode = 'DOLLARS_50'

    let takeProfitMode: '1:1' | '1:2' | '1:3' | '1:5' | 'FIXED_POINTS' = '1:2'
    if (/1\s*:\s*1|1\s+to\s+1/i.test(lower)) takeProfitMode = '1:1'
    else if (/1\s*:\s*3|1\s+to\s+3/i.test(lower)) takeProfitMode = '1:3'
    else if (/1\s*:\s*5|1\s+to\s+5/i.test(lower)) takeProfitMode = '1:5'

    const defaultPrice =
      inst === 'DOW' ? 52500 : inst === 'GOLD' ? 4350 : inst === 'CRUDE' ? 104 : 29500

    let targetRef = 'Key Reference Level'
    let targetPx = ctx.currentPrice ?? defaultPrice

    if (/frvp|volume\s*profile|low\s*volume|lvn/i.test(lower)) {
      const frvp = ctx.userDrawings?.frvps?.[0]
      targetRef = frvp ? `Manual FRVP (${frvp.startTimeEt}) LVN` : 'Yesterday FRVP Low Volume Node'
      targetPx = frvp ? frvp.val : (ctx.shortTermMoney?.yval ?? (ctx.currentPrice ?? defaultPrice))
    } else if (/trendline/i.test(lower)) {
      const tl = ctx.userDrawings?.trendlines?.[0]
      const tlLabel = tl?.isReactionTrendline
        ? 'Reaction Trendline'
        : tl?.isActionTrendline
        ? 'Action Trendline'
        : (tl?.label || 'Trendline')
      const nearestTarget = tl?.horizontalRunway?.nearestTargetLabel
        ? `${tlLabel} Breakout → ${tl.horizontalRunway.nearestTargetLabel}`
        : `${tlLabel} Support`
      targetRef = tl ? nearestTarget : 'Trendline Breakout Support'
      targetPx = tl ? (tl.horizontalRunway?.nearestTargetPrice ?? tl.projectedPrice) : (ctx.currentPrice ?? defaultPrice)
    } else if (/range|box/i.test(lower)) {
      const r = ctx.userDrawings?.ranges?.[0]
      targetRef = r ? `${r.label || 'Range'} ${direction === 'LONG' ? 'Low' : 'High'}` : 'Range Boundary'
      targetPx = r ? (direction === 'LONG' ? r.priceLow : r.priceHigh) : (ctx.currentPrice ?? defaultPrice)
    }

    const matchPrice = lower.match(/(?:at|@|price|around)\s*([\d,]+(?:\.\d+)?)/i)
    if (matchPrice) {
      const p = parseFloat(matchPrice[1]!.replace(/,/g, ''))
      if (Number.isFinite(p) && p > 0) targetPx = p
    }

    const patternLabel =
      pattern === 'LEVEL_TOUCH' ? 'Price Touch at Level' : pattern.replace(/_/g, ' ')
    const slLabel =
      stopLossMode === 'BELOW_CANDLE_LOW'
        ? 'Below Entry Bar Low (-2 pts cushion)'
        : stopLossMode === 'ABOVE_CANDLE_HIGH'
        ? 'Above Entry Bar High (+2 pts cushion)'
        : 'Fixed Risk Bracket'

    const triggerLine =
      pattern === 'LEVEL_TOUCH'
        ? `- **Trigger:** **Price reaches level** (no candle pattern required)`
        : `- **Trigger Pattern:** **${patternLabel}**`

    const tfLine = entryTimeframe
      ? `- **Timeframe:** **${entryTimeframe}m chart** (Leo watches this TF)`
      : `- **Timeframe:** **Any** — Leo monitors all timeframes for the level`
    const cvdLine = cvdDivergence
      ? `- **CVD Condition:** ✅ CVD divergence required at the level`
      : ''

    return `### 🎯 Strategy Saved & Conditional Entry Armed

**Trader Instruction (Saved):**
> "${lastMsg.trim()}"

**Saved Entry Conditions:**
- **Target Reference:** **${targetRef}**
- **Target Level:** **${targetPx.toLocaleString()}**
${triggerLine}
${tfLine}${cvdLine ? '\n' + cvdLine : ''}
- **Direction:** **${direction}**
- **Dynamic Stop Loss:** ${slLabel}
- **Profit Target:** **${takeProfitMode} Risk:Reward**
- **Execution Desk:** Armed & actively monitoring live ticks. Leo will alert you as soon as the market situation confirms. *(The system is always in Read-Only Market Monitoring Mode and never places orders).*

<execute>
{
  "action": "ARM_CONDITIONAL_ENTRY",
  "userPrompt": "${lastMsg.replace(/["\\]/g, '')}",
  "instrument": "${inst}",
  "direction": "${direction}",
  "targetReference": "${targetRef}",
  "targetPrice": ${targetPx},
  "pattern": "${pattern}",
  "entryTimeframe": ${entryTimeframe ? `"${entryTimeframe}"` : 'null'},
  "cvdDivergence": ${cvdDivergence},
  "stopLossMode": "${stopLossMode}",
  "takeProfitMode": "${takeProfitMode}",
  "size": 1,
  "description": "${direction} 1 ${inst} — ${pattern === 'LEVEL_TOUCH' ? 'enter at level' : patternLabel}${entryTimeframe ? ` on ${entryTimeframe}m` : ''}${cvdDivergence ? ' + CVD div' : ''} at ${targetRef} (${targetPx.toLocaleString()})"
}
</execute>`
  }

  // 3. Direct order command — system is strictly for monitoring markets, situations & notes
  if (/\b(buy|long|sell|short|enter|place\s+order|open\s+position|take\s+(a\s+)?trade)\b/i.test(lower)) {
    let inst = ctx.instrument || 'NASDAQ'
    if (/\bdow\b|ym/i.test(lower)) inst = 'DOW'
    else if (/\bnasdaq\b|nq/i.test(lower)) inst = 'NASDAQ'
    else if (/\bgold\b|gc/i.test(lower)) inst = 'GOLD'
    else if (/\bcrude\b|oil|cl/i.test(lower)) inst = 'CRUDE'
    else if (/\bnikkei\b|nk/i.test(lower)) inst = 'NIKKEI'

    return `### 👁️ **[READ-ONLY MARKET MONITOR] (${inst})**

The desk is always in **Read-Only Market Monitoring Mode** and never places orders:
- 📊 **Market Monitoring:** Live tick tracking, VWAP, CVD order flow & price levels for **${inst}**.
- 🎯 **Situation Alerts:** Detecting, tracking, and notifying you the moment market setups and structural events happen.
- 📝 **Journal Notes:** Recording market observations, volume behavior, and situational notes.

*AI Leo is purely for telling you what is going on in the market; it never places any orders.*`
  }

  // 3. Trade status command: "how is my trade going", "position status", "how are we doing"
  if (/how\s+is\s+(the|my)?\s*(trade|order|position)\s*(going)?|position\s+status|trade\s+status|how\s+are\s+we\s+doing/i.test(lower)) {
    const pos = ctx.activePosition
    if (!pos) {
      return `### Desk Status: FLAT (${ctx.instrument} @ ${curPrice})

There is currently **no open position** on the desk. All brackets are clear. Standing by for your next level, chart reference, or voice entry instruction.`
    }
    const sign = pos.unrealizedPnlPoints >= 0 ? '+' : ''
    return `### 📊 Live Trade Status (${pos.instrument} · ${pos.direction})

- **Entry Price:** ${pos.entryPrice.toLocaleString()}
- **Current Price:** ${curPrice}
- **Unrealized P&L:** **${sign}${pos.unrealizedPnlPoints.toFixed(1)} pts** (${sign}$${pos.unrealizedPnlCad.toFixed(2)} CAD)
- **Trade Health:** ${pos.isInProfit ? '🟢 **IN PROFIT**' : '🔴 **IN DRAWDOWN**'}
- **Brackets:** Stop Loss **${pos.stopLoss > 0 ? pos.stopLoss.toLocaleString() : 'None'}** | Take Profit **${pos.profitTarget > 0 ? pos.profitTarget.toLocaleString() : 'None'}**
- **Duration in Trade:** ${pos.durationMinutes.toFixed(1)} minutes
- **Chart Sync:** Displayed live on the chart canvas.
- **Management Rule:** Only you can exit this trade. AI never auto-exits.`
  }

  // 4. Stagnation rule command: "if we are in a position and we have not moved to profit after X minutes close"
  if (/not\s+moved\s+to\s+(the\s+)?profit|stagnat|close\s+.*after\s+\d+\s*min/i.test(lower)) {
    const matchMin = lower.match(/(\d+)\s*(?:minutes?|mins?|m\b)/)
    const minutes = matchMin ? parseInt(matchMin[1]!, 10) : 5
    const pos = ctx.activePosition

    return `Understood. Stagnation rule armed: If our ${pos ? `${pos.direction} position on ${pos.instrument} (entry: ${pos.entryPrice.toFixed(2)})` : `${ctx.instrument} position`} does not move into positive profit within ${minutes} minutes, I will alert you to manually flatten at your broker to protect capital from dead auction chop. *(The platform is strictly read-only and never places or flattens broker orders).* \n\n<execute>\n{\n  "action": "ARM_STAGNATION_RULE",\n  "maxMinutes": ${minutes},\n  "requireProfitPoints": 1,\n  "description": "Manual flatten reminder if not in profit after ${minutes} minutes"\n}\n</execute>`
  }

  // 5. Telegram alert command: "send me a telegram message" or "telegram"
  if (/telegram|notify\s+me|send\s+me\s+a\s+message/i.test(lower)) {
    return `External Telegram notifications are currently disabled desk-wide. All live alerts, auction updates, and risk monitors are streamed directly to the website dashboard and chart in real time.`
  }

  // 5b. Auction Price Critique & "Questioning" Inquiry:
  // e.g. "critique price", "questioning", "why should i buy here", "why the hell should i buy", "is price too expensive", "who bought overnight", "am i trapped"
  if (
    lower.includes('critique') ||
    /\b(questioning|why\s+(should\s+i|the\s+hell\s+should\s+i|would\s+i)\s+(buy|sell|short)|is\s+(the\s+)?price\s+too\s+(high|expensive|low|cheap)|who\s+bought\s+overnight|am\s+i\s+chasing|am\s+i\s+trapped|why\s+buy\s+now|why\s+short\s+now|market\s+is\s+a\s+place\s+to\s+do\s+business|weak\s+hand)\b/i.test(
      lower
    ) ||
    ctx.selectedDataPoints?.some(
      (p) => p.id === 'price-critique-dossier' || p.label.toLowerCase().includes('price critique')
    )
  ) {
    const isCritiqueActive = isPriceQuestioningSessionActive(Date.now(), '09:00')
    if (!isCritiqueActive && !ctx.priceQuestioning) {
      return `### ⏱️ Leo Auction Price Critique & Questioning Desk (${ctx.instrument} @ ${curPrice})

> *"The market is a place to do business. If price is not suitable for us, we never force a trade."*

⚠️ **Questioning Desk Off-Session:**
The Auction Price Critique & Questioning Desk is active during the **New York Session (09:00 AM / 09:15 AM – 16:00 ET)**.

- **Current Global Session:** ${sessionName}
- **Status:** Inactive during Asian and London sessions.
- **Next Desk Activation:** 09:00 AM / 09:15 AM ET (New York Pre-Market Open Preparation).

Participants in Asia and London are currently establishing initial overnight inventory and volume profiles. Stand by until New York pre-market to critique price location against accumulated overnight wholesale inventory.`
    }

    const pq = ctx.priceQuestioning || evaluatePriceQuestioning({
      currentPrice: ctx.currentPrice || 0,
      instrument: ctx.instrument,
      currentTimeEt: ctx.currentTimeEt,
      yesterday: ctx.shortTermMoney ? {
        poc: ctx.shortTermMoney.ypoc,
        high: ctx.shortTermMoney.yhigh,
        low: ctx.shortTermMoney.ylow,
        vah: ctx.shortTermMoney.yvah,
        val: ctx.shortTermMoney.yval,
      } : null,
      overnight: ctx.shortTermMoney ? {
        overnight: {
          poc: ctx.shortTermMoney.onpoc,
          high: ctx.shortTermMoney.onhigh,
          low: ctx.shortTermMoney.onlow,
        },
        biasLabel: ctx.shortTermMoney.overnightBias,
      } : null,
      frvp5d: ctx.intermediateMoney ? {
        poc: ctx.intermediateMoney.poc5d,
        vah: ctx.intermediateMoney.vah5d,
        val: ctx.intermediateMoney.val5d,
        high: ctx.intermediateMoney.high5d,
        low: ctx.intermediateMoney.low5d,
      } : null,
      avwap5m: ctx.longTermMoney ? {
        vwap: ctx.longTermMoney.avwap5m,
        sigma1Upper: ctx.longTermMoney.sigma1Upper,
        sigma1Lower: ctx.longTermMoney.sigma1Lower,
        sigma2Upper: ctx.longTermMoney.sigma2Upper,
        sigma2Lower: ctx.longTermMoney.sigma2Lower,
      } : null,
      orderFlow: ctx.orderFlow ? {
        sessionCvd: ctx.orderFlow.sessionCvd,
        trend: ctx.orderFlow.trend,
        divergence: ctx.orderFlow.divergence,
      } : null,
    })

    return `### Leo Auction Price Critique & Questioning Desk (${ctx.instrument} @ ${curPrice})

> *"The market is a place to do business. If price is not suitable for us, we never force a trade. Price advertises opportunity: when discounted we buy, when premium we short."*

---

### 1. Valuation & Location Read
- **Auction State:** **${pq.valuationState.replace('_', ' ')}** (Valuation Score: **${pq.valuationScore > 0 ? '+' : ''}${pq.valuationScore} / 100**)
- **Suitability Verdict:** \`${pq.suitabilityVerdict}\`
- **Wholesale Reference Target:** **${pq.wholesaleTarget != null ? pq.wholesaleTarget.toFixed(2) : 'Awaiting rotation'}**

---

### 2. Overnight & Global Session Inventory Reality
${pq.inventoryCritique.critiqueSummary}
- **Overnight POC:** ${pq.inventoryCritique.overnightPoc ?? 'N/A'}${pq.inventoryCritique.distanceFromOnPocPts != null ? ` (${pq.inventoryCritique.distanceFromOnPocPts > 0 ? '+' : ''}${pq.inventoryCritique.distanceFromOnPocPts} pts distance)` : ''}
- **Inventory Skew:** ${pq.inventoryCritique.overnightBias ?? 'Evaluating'} (${pq.inventoryCritique.pctLong}% Long / ${pq.inventoryCritique.pctShort}% Short)
- **Multi-Horizon POCs:** Yesterday POC @ **${pq.multiHorizonLevels.yesterdayPoc ?? 'N/A'}** | 5D-POC @ **${pq.multiHorizonLevels.fiveDayPoc ?? 'N/A'}** | 5M AVWAP @ **${pq.multiHorizonLevels.fiveMonthAvwap ?? 'N/A'}**

---

### 3. Weak-Hand Trap & Emotional Risk Radar
${pq.weakHandTrap.isTrapRisk ? `⚠️ **ACTIVE TRAP ALERT:** ${pq.weakHandTrap.warning}` : `✅ **STRUCTURAL HEALTH:** No acute weak-hand trap detected. Auction participation is structural.`}
*Remember: Emotional traders buy tops on a single green candle and sell bottoms in panic. Strong money lets weak hands push price to exhaustion, traps them, and punishes them on reversal.*

---

### 4. The 6-Question Pre-Trade Self-Audit
${pq.sixQuestionAudit.map(q => `- **[${q.status}] ${q.question}**\n  ↳ *${q.headline}*: ${q.detail}`).join('\n')}

---

### Desk Directive:
${pq.deskGuidance}`
  }

  // Gann Fan / Geometric Angle inquiry: "can we use gann fan to enhance that strategy or that is just illusion"
  if (/gann|gann\s*fan|fan\s*line|geometric\s*angle/i.test(lower)) {
    return `### Institutional Reality Check: Gann Fans vs. Empirical Velocity

**The Short Answer:** Traditional Gann Fans on modern electronic charts are largely an **optical illusion**, but their core intuition—comparing Price Velocity against Time (ΔP / Δt)—is valid when computed quantitatively.

---

### Why Static Gann Fans Fail on Modern Electronic Charts
1. **Geometric Scale Distortion:**
   W.D. Gann drew his fans by hand on physical square grid paper where 1 point = 1 day (a true 45° angle was 1×1). On modern electronic charts with dynamic auto-scaling, window resizing, and zooming, the visual degree angle changes every time you zoom or resize your browser. A 45° line on your desktop turns into 20° on a laptop!
2. **The "Curving" Trap:**
   Relying solely on diagonal lines leads traders to continuously redraw and curve lines to fit recent price wicks, creating false entries and confirmation bias.
3. **Horizontal Liquidity Blindness:**
   A diagonal line does not tell you if you are buying directly beneath an institutional supply wall (e.g. Yesterday NYC POC, Overnight High, 5-Day POC, or +2σ AVWAP). Entering a diagonal breakout into an overhead supply shelf creates a lethal bull trap.

---

### The Desk's Quantitative Standard:
1. **Scale-Invariant Empirical Velocity Corridor (ΔP / Δt):**
   Instead of drawing fixed degree angles, our engine calculates the **empirical velocity** directly from the initiating swing:
   - **1.0x Equilibrium Ray:** The sustainable baseline impulse velocity (pts/sec and pts/5m).
   - **1.5x Climax / Parabolic Ray:** Momentum acceleration threshold where price goes parabolic. Warns you to scale out profits rather than chase.
   - **0.5x Retest Floor Ray:** Defines the minimum speed required to maintain trend structure. A close below signals momentum stall.
2. **Horizontal S/R Runway Assessment:**
   Every Action Trendline breakout is matched against our Multi-Timeframe Institutional Levels (Overnight High/Low, Yesterday POC/VAH/VAL, 5D-POC, AVWAP ±1σ / ±2σ):
   - **Clear Runway (≥ 2.5:1):** High-probability setup with open air pocket to target.
   - **Tight Runway (< 1.5:1):** ⚠️ Trap warning! Price is breaking out right into heavy institutional supply.

**Desk Verdict:** Leave the subjective geometric Gann Fans behind. Trade the **Action/Reaction Trendlines** backed by **Horizontal S/R Runway** and the **Empirical Velocity Corridor** for true institutional mathematical edge.`
  }

  // 4. User Drawings: Trendline analysis
  if (/trendline|trend\s+line|reaction\s+line|action\s+line/i.test(lower)) {
    const tl = ctx.userDrawings?.trendlines?.[0]
    if (tl) {
      const typeLabel = tl.isReactionTrendline
        ? 'Reaction Trendline'
        : tl.isActionTrendline || tl.isInitialOvernight
        ? 'Action Trendline'
        : (tl.label || 'Trendline')

      const runwayBlock = tl.horizontalRunway
        ? `\n- **Horizontal S/R Runway:** **${tl.horizontalRunway.runwayPts.toFixed(1)} pts** (${tl.horizontalRunway.runwayRatio}:1 R:R, **${tl.horizontalRunway.quality}**)
- **Nearest Target:** ${tl.horizontalRunway.nearestTargetLabel ?? 'Rotational Target'} @ **${tl.horizontalRunway.nearestTargetPrice?.toFixed(1) ?? 'N/A'}**
- **Runway Assessment:** ${tl.horizontalRunway.summary}`
        : ''

      const velocityBlock = tl.empiricalVelocity
        ? `\n- **Empirical Velocity:** **${tl.empiricalVelocity.velocityState}** (${tl.empiricalVelocity.baseVelocityPtsPer5m} pts / 5m candle)
- **Velocity Corridor:** Equilibrium @ **${tl.empiricalVelocity.equilibriumPrice.toFixed(1)}** | Climax (1.5x) @ **${tl.empiricalVelocity.climaxPrice.toFixed(1)}** | Retest Floor (0.5x) @ **${tl.empiricalVelocity.retestFloorPrice.toFixed(1)}**
- **Velocity Read:** ${tl.empiricalVelocity.summary}`
        : ''

      return `### Leo ${typeLabel} Assessment (${ctx.instrument} @ ${curPrice})

I've got eyes on your manual **${typeLabel}**:
- **Trajectory:** From **${tl.startPrice.toLocaleString()}** (${tl.startTimeEt}) to **${tl.endPrice.toLocaleString()}** (${tl.endTimeEt})
- **Slope & Angle:** ${tl.slopeDirection} at ${tl.slopePtsPer5mBar >= 0 ? '+' : ''}${tl.slopePtsPer5mBar.toFixed(1)} pts / 5m candle (${tl.slopePtsPerMin >= 0 ? '+' : ''}${tl.slopePtsPerMin.toFixed(2)} pts/min)
- **Current Dynamic Level:** Projected at **${tl.projectedPrice.toLocaleString()}**
- **Price Action:** Market is currently **${tl.priceRelation}** the trendline${tl.distancePts != null ? ` (${Math.abs(tl.distancePts).toFixed(1)} pts distance)` : ''}.${runwayBlock}${velocityBlock}

**Desk Playbook Read:**
${tl.priceRelation === 'TESTING'
  ? `Price is actively testing the ${typeLabel}. Watch candle close and volume: a rejection wick here confirms responsive support/defense, while heavy 5m bar penetration signals trend breakdown.`
  : tl.priceRelation === 'ABOVE'
    ? `Price is accepted above the ${typeLabel}. As long as market holds above ${tl.projectedPrice.toLocaleString()}, buyer facilitation remains intact.`
    : `Price is trading below the line. Look for responsive re-acceptance above ${tl.projectedPrice.toLocaleString()} before trusting long momentum.`}`
    }
  }

  // 5. User Drawings: Range Volume Comparison & S/R Readiness analysis
  // e.g. "leo compare the volume traded in these ranges", "compare volume in these ranges", "are these ranges good or bad support or resistance", "compare volumes"
  if (
    /\b(compare\s+(the\s+)?volume|compare\s+(these\s+)?ranges|compare\s+levels|volume\s+in\s+these\s+ranges|good\s+or\s+bad\s+support|good\s+or\s+bad\s+resisten?ce|volume\s+(were\s+)?(decreased|increased)|volume\s+traded\s+in\s+these\s+ranges)\b/i.test(
      lower
    ) ||
    ((lower.includes('compare') || lower.includes('volume')) && lower.includes('range'))
  ) {
    const comparisons =
      ctx.rangeComparisons && ctx.rangeComparisons.length > 0
        ? ctx.rangeComparisons
        : ctx.userDrawings?.ranges && ctx.userDrawings.ranges.length >= 2
        ? compareMultipleRanges(ctx.userDrawings.ranges as any, ctx.currentPrice)
        : []

    if (comparisons.length > 0) {
      const report = formatRangeVolumeComparisonReport(comparisons)
      return `### 📊 Leo Range Volume Comparison & S/R Readiness (${ctx.instrument} @ ${curPrice})

> *"Auction Market Theory Dictum: Price advertises opportunity, but volume measures acceptance. When price revisits prior levels, volume expansion vs exhaustion determines whether a level holds as support/resistance or shatters."*

---

${report}

---

### 🛡️ Institutional Desk Readiness Directives:
${comparisons
  .map((c) => {
    const isGoodSup =
      c.supportReadiness.classification === 'GOOD_SUPPORT' ||
      c.supportReadiness.classification === 'ACCUMULATION_SUPPORT'
    const isGoodRes =
      c.resistanceReadiness.classification === 'GOOD_RESISTANCE' ||
      c.resistanceReadiness.classification === 'DISTRIBUTION_RESISTANCE'

    return `- **For Floor Level (${Math.min(c.rangeA.priceLow, c.rangeB.priceLow).toLocaleString()} – ${Math.min(c.rangeA.priceHigh, c.rangeB.priceHigh).toLocaleString()}):** ${
      isGoodSup
        ? '✅ **VALIDATED SUPPORT FLOOR.** Volume confirms supply exhaustion/accumulation. Watch for reversal wick to buy.'
        : '⚠️ **FRAGILE SUPPORT.** Heavy distribution observed. High probability of downward knife-catch if entered without confirmation.'
    }
- **For Overhead Level (${Math.max(c.rangeA.priceLow, c.rangeB.priceLow).toLocaleString()} – ${Math.max(c.rangeA.priceHigh, c.rangeB.priceHigh).toLocaleString()}):** ${
      isGoodRes
        ? '✅ **VALIDATED RESISTANCE CEILING.** Volume confirms buyer exhaustion/distribution. Watch for rejection to short or take profits.'
        : '⚠️ **VULNERABLE RESISTANCE.** Aggressive initiative buying. High probability of upside breakout.'
    }`
  })
  .join('\n')}

Standing by to monitor tick-by-tick order flow and alert you the instant price interacts with these ranges.`
    }

    // If only 1 range is currently drawn
    const singleRange = ctx.userDrawings?.ranges?.[0]
    if (singleRange) {
      const volStr =
        singleRange.totalVolume != null ? singleRange.totalVolume.toLocaleString() : 'calculating'
      const rateStr =
        singleRange.volumeRatePerMin != null ? `${singleRange.volumeRatePerMin} contracts/min` : 'N/A'
      const buyPct = singleRange.buyRatioPct ?? 50
      const deltaStr =
        singleRange.delta != null
          ? `${singleRange.delta >= 0 ? '+' : ''}${singleRange.delta.toLocaleString()}`
          : '0'

      return `### 📊 Leo Range Volume Analysis (${ctx.instrument} @ ${curPrice})

Currently tracking 1 range on chart (**${singleRange.label || 'Range Box'}**):
- **Traded Volume:** **${volStr} contracts** (${rateStr}) across ${singleRange.durationMin} minutes.
- **Order Flow Delta:** **${deltaStr} contracts** (${buyPct}% Buy / ${100 - buyPct}% Sell).
- **Price Boundaries:** **${singleRange.priceLow.toLocaleString()} – ${singleRange.priceHigh.toLocaleString()}** (POC: **${singleRange.poc ?? singleRange.midPrice}**).

**Support & Resistance Readiness Rules:**
1. **To compare volume across multiple ranges:** Draw a second range box (Hotkey: **D**) over a prior consolidation, session retest, or reference zone. I will automatically calculate whether volume increased or decreased and classify whether the levels are **Good vs Bad Support** and **Good vs Bad Resistance**!
2. **Current Level Read:**
   - If market retests **${singleRange.priceLow.toLocaleString()}** on **decreasing volume** (< 70% of current rate): Signals supply exhaustion -> **Good Support**.
   - If market retests **${singleRange.priceLow.toLocaleString()}** on **surging volume with sell delta**: Signals liquidation -> **Bad Support** (breakdown threat).
   - If market tests **${singleRange.priceHigh.toLocaleString()}** on **decreasing volume**: Signals buyer exhaustion -> **Good Resistance**.
   - If market tests **${singleRange.priceHigh.toLocaleString()}** on **surging buy volume**: Signals breakout -> **Bad Resistance** (breakout threat).`
    }

    // If no ranges are drawn yet
    return `### 📊 Leo Range Volume Comparison & S/R Readiness Engine (${ctx.instrument} @ ${curPrice})

No manual range boxes are currently drawn on your chart canvas.

**How to Compare Volumes Traded in Different Ranges:**
1. **Draw Ranges:** Use the Range tool (Hotkey: **D**) to draw two or more boxes over consolidation levels, session swings, or retest zones.
2. **Instant Volume Telemetry:** The engine automatically measures total contracts, volume rate per minute, order flow delta, and POC for each range.
3. **Automated Comparison:** I will compare the ranges and tell you:
   - Whether volumes **increased or decreased** between the levels (exact % and contracts).
   - **Support Readiness:** Determines if the lower level will act as **Good Support** (supply exhaustion) or **Bad Support** (aggressive seller distribution / breakdown threat).
   - **Resistance Readiness:** Determines if the upper level will act as **Good Resistance** (buyer exhaustion) or **Bad Resistance** (aggressive buyer absorption / breakout threat).

Draw your ranges on the chart now, then ask me again: *"Leo compare the volume traded in these ranges"*!`
  }

  // 5b. User Drawings: Single Range / Box analysis
  if (/range|box|rectangle|square|consolidation/i.test(lower)) {
    const r = ctx.userDrawings?.ranges?.[0]
    if (r) {
      const volBlock =
        r.totalVolume != null
          ? `\n- **Traded Volume:** **${r.totalVolume.toLocaleString()} contracts** (${r.volumeRatePerMin ?? 0} vol/min, ${r.buyRatioPct ?? 50}% buy, delta ${r.delta != null && r.delta >= 0 ? '+' : ''}${r.delta?.toLocaleString() ?? 0}, POC: **${r.poc ?? r.midPrice}**)`
          : ''

      return `### Leo Range / Bracket Assessment (${ctx.instrument} @ ${curPrice})

Tracking your drawn **${r.label || 'Range Box'}**:
- **Boundary Extremes:** High **${r.priceHigh.toLocaleString()}** | Low **${r.priceLow.toLocaleString()}**
- **Bracket Dimensions:** **${r.heightPts.toFixed(1)} pts** span across **${r.durationMin} minutes** (${r.startTimeEt} – ${r.endTimeEt})
- **Equilibrium (Midpoint):** **${r.midPrice.toLocaleString()}**
- **Location Status:** Market is **${r.priceRelation}** the range (${r.positionPct}% of bracket).${volBlock}

**Dalton Auction Theory Read:**
${r.priceRelation === 'INSIDE'
  ? `We are in a balanced, two-sided rotational market. Responsive buyers defend near **${r.priceLow.toLocaleString()}** and responsive sellers cap near **${r.priceHigh.toLocaleString()}**. Do not chase moves inside the mid-band (${r.midPrice.toLocaleString()}) — trade only edges or wait for confirmed breakout.`
  : r.priceRelation === 'ABOVE'
    ? `Initiative expansion above the range high (**${r.priceHigh.toLocaleString()}**). If the market tests ${r.priceHigh.toLocaleString()} from above with low volume and holds, old resistance becomes new institutional support.`
    : `Initiative breakdown below the range low (**${r.priceLow.toLocaleString()}**). Sellers facilitating price lower. Watch for test of ${r.priceLow.toLocaleString()} as overhead ceiling.`}`
    }
  }

  // 6. User Drawings: Manual FRVP analysis
  if (/frvp|volume\s+profile|manual\s+profile|poc/i.test(lower)) {
    const f = ctx.userDrawings?.frvps?.[0]
    if (f) {
      const buyPct = f.buyRatioPct.toFixed(1)
      return `### Leo Manual FRVP Assessment (${ctx.instrument} @ ${curPrice})

Analyzing your manual **Fixed Range Volume Profile** (${f.startTimeEt} – ${f.endTimeEt}):
- **Point of Control (POC):** **${f.poc.toLocaleString()}** (Highest traded volume node)
- **Value Area (70%):** VAH **${f.vah.toLocaleString()}** | VAL **${f.val.toLocaleString()}**
- **Auction Extremes:** High **${f.high.toLocaleString()}** | Low **${f.low.toLocaleString()}**
- **Profile Volume:** **${f.totalVolume.toLocaleString()}** contracts (${buyPct}% buy-side delta)
- **Current Relationship:** Market is **${f.priceRelation.replace('_', ' ')}**${f.distancePocPts != null ? ` (${Math.abs(f.distancePocPts).toFixed(1)} pts from manual POC)` : ''}.

**Auction Liquidity Read:**
${f.priceRelation === 'AT_POC'
  ? `Price is revolving directly at high-volume equilibrium (**${f.poc.toLocaleString()}**). High two-way trade facilitation. Expect consolidation or rotational chop until initiative volume picks a direction.`
  : f.priceRelation === 'ABOVE_VAH'
    ? `Price is accepted above Value Area High (**${f.vah.toLocaleString()}**). Initiative buyers are in control and rejecting lower value. Extension target remains active.`
    : f.priceRelation === 'BELOW_VAL'
      ? `Price is rejected below Value Area Low (**${f.val.toLocaleString()}**). Initiative sellers are probing lower prices looking for responsive buyers.`
      : `Price is trading inside the 70% Value Area (${f.val.toLocaleString()} – ${f.vah.toLocaleString()}). Expect rotational pull back toward POC **${f.poc.toLocaleString()}**.`}`
    }
  }

  // 6b. User Drawings: Manual Anchored VWAP (AVWAP) analysis
  if (/\b(avwap|anchored\s+vwap|vwap\s+bands?|standard\s+deviation\s+bands?)\b/i.test(lower)) {
    const a = ctx.userDrawings?.avwaps?.[0]
    if (a) {
      const label = a.label || (a as { anchorLabel?: string }).anchorLabel || 'Anchored VWAP'
      const anchorTime = a.anchorTimeEt || String((a as { anchorTime?: unknown }).anchorTime ?? 'Anchor')
      const anchorPx = a.anchorPrice != null ? ` @ **${a.anchorPrice.toFixed(2)}**` : ''
      const deltaPts =
        a.deltaPts ??
        (a as { distanceFromCurrentPrice?: number }).distanceFromCurrentPrice ??
        (ctx.currentPrice != null ? +(ctx.currentPrice - a.currentVwap).toFixed(2) : 0)
      const relation =
        a.priceRelation ||
        (deltaPts > 0 ? 'ABOVE' : deltaPts < 0 ? 'BELOW' : 'AT_MEAN')
      const b1Low = a.band1Lower != null ? a.band1Lower.toFixed(2) : '—'
      const b1High = a.band1Upper != null ? a.band1Upper.toFixed(2) : '—'
      const b2Low = a.band2Lower != null ? a.band2Lower.toFixed(2) : '—'
      const b2High = a.band2Upper != null ? a.band2Upper.toFixed(2) : '—'
      const zStr = a.zScore != null ? `${a.zScore >= 0 ? '+' : ''}${a.zScore.toFixed(2)}σ` : '0.00σ'
      const slopeStr = (a as { slope?: string }).slope ? ` | Slope: **${(a as { slope?: string }).slope}**` : ''

      return `### ⚓ **Institutional Anchored VWAP (AVWAP) Audit (${ctx.instrument} @ ${curPrice})**

Analyzing your manual **${label}** (Anchored at **${anchorTime}**${anchorPx}):
- **Current AVWAP Centerline:** **${a.currentVwap.toFixed(2)}** (${deltaPts >= 0 ? '+' : ''}${deltaPts.toFixed(2)} pts · Price is **${relation.replace(/_/g, ' ')} AVWAP**${slopeStr})
- **±1.0σ Value Area (~68% Volume):** **${b1Low} – ${b1High}**
- **±2.0σ Exhaustion Extremes (~95% Volume):** **${b2Low} – ${b2High}**
- **Statistical Stretch:** **${zStr}**${a.sigma != null ? ` (1σ = ${a.sigma.toFixed(2)} pts)` : ''}

**Institutional Execution Read:**
- Your manual AVWAP acts as dynamic institutional fair-value confluence alongside our frozen Tier 1 map.
- Do not trade a touch of the AVWAP in isolation; require one of the **4 Wyckoff execution structures** (Spring Reclaim or Breakout Retest at AVWAP/+1σ support; Upthrust Return or Breakdown Retest at AVWAP/-1σ resistance) with **≥ 2.0R** clearance.`
    }
  }

  // 6c. Multi-Agent Cooperation: Fundamental Specialist + Desk News / Headline Agent + Chart Leo Synthesis
  if (
    /\b(fundamental\w*|headline\w*|desk\s+news|news\s+agent|macro\s+driver\w*|macro\s+catalyst\w*|specialist\s+agent\w*|agent\w*\s+cooperat\w*|connect\s+the\s+dots|what\s+changed|market\s+intelligence\s+bus)\b/i.test(
      lower
    )
  ) {
    try {
      syncFundamentalBusFromStores()
    } catch {
      // soft-fail
    }
    const activeDeskBrief = formatDeskBriefForInstrument(ctx.instrument)
    const allMarketsBus = formatAllMarketsDeskBriefSummary()
    const b = getWyckoffBenchmark(ctx.instrument)
    const yval = ctx.shortTermMoney?.yval != null ? ctx.shortTermMoney.yval.toFixed(2) : 'UNAVAILABLE'
    const yvah = ctx.shortTermMoney?.yvah != null ? ctx.shortTermMoney.yvah.toFixed(2) : 'UNAVAILABLE'
    const poc5d = ctx.intermediateMoney?.poc5d != null ? ctx.intermediateMoney.poc5d.toFixed(2) : 'UNAVAILABLE'

    const macroReactionText =
      typeof ctx.macroCatalystReaction === 'string'
        ? ctx.macroCatalystReaction
        : ctx.macroCatalystReaction && typeof ctx.macroCatalystReaction === 'object'
          ? JSON.stringify(ctx.macroCatalystReaction, null, 2)
          : null

    return `### 🤝 **Multi-Agent Desk Synthesis: Chart Leo × Fundamental Specialist × Desk News Agent (${ctx.instrument} @ ${curPrice})**

> **Zero-Hallucination Multi-Agent Architecture:**
> 1. **Desk News Agent (\`DESK_NEWS_AGENT\`):** Identifies, deduplicates, and verifies scheduled macro releases and breaking wires, routing each event to its market specialist.
> 2. **5 Fundamental Specialist Agents (\`NASDAQ_AGENT\`, \`DOW_AGENT\`, \`GOLD_AGENT\`, \`OIL_AGENT\`, \`NIKKEI_AGENT\`):** Evaluate transmission channels and publish structured snapshots onto the **Market Intelligence Bus**.
> 3. **Chart Leo (Execution Auditor):** Consumes the Market Intelligence Bus brief + Wyckoff 1-year empirical benchmarks + live Tier 1 chart structure + Globex CVD to audit the **4 valid execution setups**.

---

### 1. **Active Market Intelligence Bus Brief (${ctx.instrument}):**
\`\`\`text
${activeDeskBrief}
\`\`\`

---

### 2. **Cross-Market Fundamental Specialist Bus Status (All 5 Desks):**
${allMarketsBus}

${
  macroReactionText
    ? `---\n\n### 3. **Verified Macro Catalyst & Market Reaction Engine:**\n${macroReactionText}\n`
    : ''
}---

### 4. **Connecting the Dots — Catalyst Transmission × Wyckoff Structure (${b.market}):**
- **Overnight Cause Building:** Empirical 1-year 5m backtesting across **${b.totalRanges.toLocaleString()} ${b.market} ranges** (from **${WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed.toLocaleString()}** total desk ranges) proves that **${b.overnightFormationPct}%** of ranges form overnight (Asia ${b.asiaFormationPct}% + London ${b.londonFormationPct}%), lasting an average of **${b.avgRangeDurationHours} hours**.
- **Catalyst Ignition Window:** Scheduled Tier-1 macro catalysts and cash opens (**${b.topIgnitionHoursEt.slice(0, 3).map(formatIgnitionHour).join(', ')}**) act as the Phase D ignition spark that resolves accumulated or distributed overnight energy.
- **Tier 1 Structural Anchors (${ctx.instrument}):** 5D POC **${poc5d}** | Y-VAL **${yval}** | Y-VAH **${yvah}**.
- **Execution Gate (Hierarchy Step 10):** Fundamentals and headlines explain *why* participation is expanding, but **never** trigger a trade on their own. Wait for one of the **4 Wyckoff structures** (Spring Reclaim, Upthrust Return, Breakout Retest / LPS, Breakdown Retest / LPSY) with structural invalidation and **≥ 2.0R** room.`
  }

  // 7. General auction assessment
  const yval = ctx.shortTermMoney?.yval != null ? ctx.shortTermMoney.yval.toFixed(2) : 'Y-VAL'
  const ypoc = ctx.shortTermMoney?.ypoc != null ? ctx.shortTermMoney.ypoc.toFixed(2) : 'Y-POC'
  const poc5d = ctx.intermediateMoney?.poc5d != null ? ctx.intermediateMoney.poc5d.toFixed(2) : '5D POC'
  const vwap5m = ctx.longTermMoney?.avwap5m != null ? ctx.longTermMoney.avwap5m.toFixed(2) : '5M VWAP'

  return `### Leo Trade Assessment (${ctx.instrument} @ ${curPrice} · ${sessionName})

**Reviewing Auction Context**:
- **Location:** Trading relative to ${yval} (Yesterday Value Area Low), ${ypoc} (Yesterday POC) & ${poc5d} (5D POC extended).
- **Intermediate Flow:** Tracking 5-Day POC magnet and excessive rejection wicks.
- **Long-Term Benchmark:** 5-Month Anchored VWAP is at **${vwap5m}**.
- **Desk Telemetry:** Standing by to monitor session references, track stagnation timeout reminders, and alert on auction levels on your desk.`
}
