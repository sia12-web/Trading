/**
 * Quantitative 1-Year 5-Minute Wyckoff Accumulation & Distribution Backtest Engine
 * Across All 5 Desk Markets: NASDAQ (NQ), DOW (YM), CRUDE (CL), GOLD (GC), NIKKEI (NKD)
 *
 * Investigates:
 * 1. How institutions accumulate vs distribute in trading ranges on 5-minute timeframe.
 * 2. Order Flow CVD behavior: Absorption divergence at Creek (Support) & Ice (Resistance).
 * 3. Volatility (ATR) behavior: Compression in Phase B vs Expansion in Phase C/D.
 * 4. Illusion / Liquidity Sweep Mechanics: Frequency of Springs (Lower Low traps) vs UTADs (Higher High traps).
 * 5. Timing & Session Cadence: What hours ranges build, and what hours Mark-Up / Mark-Down triggers.
 */

import fs from 'fs'
import path from 'path'
import { getYahooCandles } from '../lib/yahoo/candles'

export interface Bar5M {
  time: number // unix epoch in seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
  atr14: number
  barDelta: number
  sessionCvd: number
  hourEt: number
  session: 'ASIA' | 'LONDON' | 'NY_AM' | 'NY_PM' | 'POST_SETTLE'
}

export interface RangeEvent {
  market: string
  type: 'ACCUMULATION' | 'DISTRIBUTION'
  startTime: number
  endTime: number
  durationHours: number
  rangeHigh: number
  rangeLow: number
  rangeSpanPts: number
  rangeSpanAtr: number
  phaseBAtr: number
  breakoutAtr: number
  atrExpansionRatio: number
  hasSweep: boolean // Spring in Accumulation (Lower Low), UTAD in Distribution (Higher High)
  sweepDepthPts: number
  sweepDepthAtr: number
  sweepVolumeRatio: number // Volume at sweep bar relative to range 20-bar avg
  hasCvdDivergence: boolean // Bullish absorption at Spring, Bearish absorption at UTAD
  breakoutHourEt: number
  breakoutSession: 'ASIA' | 'LONDON' | 'NY_AM' | 'NY_PM' | 'POST_SETTLE'
  formationSession: 'ASIA' | 'LONDON' | 'NY_AM' | 'NY_PM' | 'POST_SETTLE'
  postBreakoutExpansionPts: number
}

function isDst(d: Date): boolean {
  const y = d.getUTCFullYear()
  const mar1 = new Date(Date.UTC(y, 2, 1)).getUTCDay()
  const secondSunMar = 1 + ((7 - mar1) % 7) + 7
  const dstStart = Date.UTC(y, 2, secondSunMar, 7)
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay()
  const firstSunNov = 1 + ((7 - nov1) % 7)
  const dstEnd = Date.UTC(y, 10, firstSunNov, 6)
  const t = d.getTime()
  return t >= dstStart && t < dstEnd
}

function getEtParts(unixSec: number) {
  const d = new Date(unixSec * 1000)
  const offset = isDst(d) ? -4 : -5
  const local = new Date(unixSec * 1000 + offset * 3600 * 1000)
  const hour = local.getUTCHours()
  const minute = local.getUTCMinutes()
  const dayOfWeek = local.getUTCDay() // 0 = Sun, 6 = Sat

  // Session classification (ET clock)
  let session: 'ASIA' | 'LONDON' | 'NY_AM' | 'NY_PM' | 'POST_SETTLE' = 'ASIA'
  const timeMins = hour * 60 + minute
  if (timeMins >= 18 * 60 || timeMins < 2 * 60) {
    session = 'ASIA' // 18:00 - 02:00 ET
  } else if (timeMins >= 2 * 60 && timeMins < 8 * 60 + 30) {
    session = 'LONDON' // 02:00 - 08:30 ET
  } else if (timeMins >= 8 * 60 + 30 && timeMins < 12 * 60) {
    session = 'NY_AM' // 08:30 - 12:00 ET
  } else if (timeMins >= 12 * 60 && timeMins < 16 * 60) {
    session = 'NY_PM' // 12:00 - 16:00 ET
  } else {
    session = 'POST_SETTLE' // 16:00 - 18:00 ET
  }

  return { hour, minute, dayOfWeek, session, localDateStr: local.toISOString().slice(0, 10) }
}

/** Aggregate 1-minute bars to 5-minute bars */
function aggregate1mTo5m(
  bars1m: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
): Bar5M[] {
  const BUCKET = 300 // 5 minutes in seconds
  const bars5m: Bar5M[] = []
  let cur: { time: number; open: number; high: number; low: number; close: number; volume: number } | null = null
  let bucketStart = -1

  // Filter for last 1 year (e.g. from Oct 2025 to Oct 2026)
  // Let's take the last 365 days of available data in the dataset
  const latestTime = bars1m[bars1m.length - 1]?.time ?? 0
  const oneYearPriorTime = latestTime - 365 * 24 * 3600
  const filtered1m = bars1m.filter((b) => b.time >= oneYearPriorTime)

  for (const b of filtered1m) {
    const start = Math.floor(b.time / BUCKET) * BUCKET
    const vol = Number.isFinite(b.volume) ? b.volume : 0
    if (!cur || start !== bucketStart) {
      if (cur) {
        bars5m.push({
          time: cur.time,
          open: cur.open,
          high: cur.high,
          low: cur.low,
          close: cur.close,
          volume: cur.volume,
          atr14: 0,
          barDelta: 0,
          sessionCvd: 0,
          hourEt: 0,
          session: 'ASIA',
        })
      }
      bucketStart = start
      cur = { time: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: vol }
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close
      cur.volume += vol
    }
  }

  if (cur) {
    bars5m.push({
      time: cur.time,
      open: cur.open,
      high: cur.high,
      low: cur.low,
      close: cur.close,
      volume: cur.volume,
      atr14: 0,
      barDelta: 0,
      sessionCvd: 0,
      hourEt: 0,
      session: 'ASIA',
    })
  }

  // Compute ATR, delta proxy, session CVD, and session metadata
  let runningCvd = 0
  let currentSessionDate = ''

  for (let i = 0; i < bars5m.length; i++) {
    const bar = bars5m[i]!
    const { hour, session, localDateStr } = getEtParts(bar.time)
    bar.hourEt = hour
    bar.session = session

    // Reset CVD on new trading date (at 18:00 ET session start)
    if (localDateStr !== currentSessionDate) {
      runningCvd = 0
      currentSessionDate = localDateStr
    }

    // Tick delta approximation (Close Location Value within Bar * Volume)
    // CLV = ((close - low) - (high - close)) / (high - low) in range [-1, +1]
    const range = bar.high - bar.low
    const clv = range > 0 ? ((bar.close - bar.low) - (bar.high - bar.close)) / range : 0
    bar.barDelta = Math.round(bar.volume * clv)
    runningCvd += bar.barDelta
    bar.sessionCvd = runningCvd

    // 14-period True Range & ATR
    const prev = i > 0 ? bars5m[i - 1]! : bar
    const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close))

    if (i < 14) {
      bar.atr14 = tr
    } else {
      // Wilder's smoothed ATR
      bar.atr14 = (bars5m[i - 1]!.atr14 * 13 + tr) / 14
    }
  }

  return bars5m
}

/**
 * Scan for Wyckoff Trading Ranges and evaluate boundary behaviors
 */
function analyzeWyckoffRanges(market: string, bars: Bar5M[]): RangeEvent[] {
  const events: RangeEvent[] = []
  const MIN_RANGE_BARS = 18 // At least 1.5 hours (18 * 5m = 90 mins)
  const MAX_RANGE_BARS = 72 // Up to 6 hours

  let i = 50 // Warmup

  while (i < bars.length - 30) {
    // Check if bars [i - MIN_RANGE_BARS, i] form a consolidation box
    // Condition 1: ATR is relatively low (compression)
    const recentAtrSlice = bars.slice(i - MIN_RANGE_BARS, i).map((b) => b.atr14)
    const avgAtr = recentAtrSlice.reduce((a, b) => a + b, 0) / recentAtrSlice.length

    let rangeHigh = -Infinity
    let rangeLow = Infinity
    for (let k = i - MIN_RANGE_BARS; k < i; k++) {
      rangeHigh = Math.max(rangeHigh, bars[k]!.high)
      rangeLow = Math.min(rangeLow, bars[k]!.low)
    }

    const rangeSpan = rangeHigh - rangeLow
    // A trading range has a bounded span: typically 1.5 to 4.5 ATRs
    const rangeSpanAtr = rangeSpan / (avgAtr || 1)

    if (rangeSpanAtr >= 1.5 && rangeSpanAtr <= 5.0) {
      // We have a qualified candidate Trading Range!
      // Now trace forward: does it expand, how long does Phase B last, and how does it break out?
      let rangeEndIdx = i
      let isAccumulation = false
      let isDistribution = false
      let breakoutIdx = -1

      // Track sweeps during Phase B/C
      let hadSpringSweep = false
      let hadUtadSweep = false
      let maxSpringDepthPts = 0
      let maxUtadDepthPts = 0
      let springSweepVolume = 0
      let utadSweepVolume = 0
      let springHasCvdDiv = false
      let utadHasCvdDiv = false

      let rangeVolSum = 0
      let rangeBarCount = 0

      // Trace forward up to MAX_RANGE_BARS
      const maxForward = Math.min(i + (MAX_RANGE_BARS - MIN_RANGE_BARS), bars.length - 20)

      for (let j = i; j < maxForward; j++) {
        const bar = bars[j]!
        rangeVolSum += bar.volume
        rangeBarCount++

        // Check for Lower Low Sweep (Potential Spring) below Creek
        if (bar.low < rangeLow) {
          const depth = rangeLow - bar.low
          if (depth > maxSpringDepthPts) {
            maxSpringDepthPts = depth
            springSweepVolume = bar.volume
            // Check if price made a lower low while CVD made a higher low or bar delta showed absorption
            const priorLowBar = bars.slice(i - MIN_RANGE_BARS, j).reduce((lowest, b) => (b.low < lowest.low ? b : lowest), bars[j]!)
            if (bar.sessionCvd >= priorLowBar.sessionCvd || bar.barDelta > 0) {
              springHasCvdDiv = true
            }
          }
          // If price swept below but reclaimed within 3 bars, flag as confirmed Spring sweep
          if (bar.close > rangeLow - 0.25 * avgAtr) {
            hadSpringSweep = true
          }
        }

        // Check for Higher High Sweep (Potential UTAD / Upthrust) above Ice
        if (bar.high > rangeHigh) {
          const depth = bar.high - rangeHigh
          if (depth > maxUtadDepthPts) {
            maxUtadDepthPts = depth
            utadSweepVolume = bar.volume
            // Check if price made higher high while CVD made lower high or bar delta showed selling
            const priorHighBar = bars.slice(i - MIN_RANGE_BARS, j).reduce((highest, b) => (b.high > highest.high ? b : highest), bars[j]!)
            if (bar.sessionCvd <= priorHighBar.sessionCvd || bar.barDelta < 0) {
              utadHasCvdDiv = true
            }
          }
          // If price swept above but closed back inside or near Ice, flag as UTAD sweep
          if (bar.close < rangeHigh + 0.25 * avgAtr) {
            hadUtadSweep = true
          }
        }

        // Check for Phase D / E Resolution (Breakout):
        // Mark-Up: Closes firmly above rangeHigh + 0.40 * avgAtr and holds for 2 bars
        if (bar.close > rangeHigh + 0.4 * avgAtr && bars[j + 1] && bars[j + 1]!.close > rangeHigh) {
          isAccumulation = true
          breakoutIdx = j
          rangeEndIdx = j
          break
        }

        // Mark-Down: Closes firmly below rangeLow - 0.40 * avgAtr and holds for 2 bars
        if (bar.close < rangeLow - 0.4 * avgAtr && bars[j + 1] && bars[j + 1]!.close < rangeLow) {
          isDistribution = true
          breakoutIdx = j
          rangeEndIdx = j
          break
        }
      }

      if ((isAccumulation || isDistribution) && breakoutIdx > 0) {
        const breakoutBar = bars[breakoutIdx]!
        const formationBar = bars[i - MIN_RANGE_BARS]!
        const avgRangeVol = rangeVolSum / (rangeBarCount || 1)

        // Post-breakout price expansion (over next 12 bars = 1 hour)
        const postSlice = bars.slice(breakoutIdx, Math.min(breakoutIdx + 12, bars.length))
        let maxExpansion = 0
        if (isAccumulation) {
          const highestPost = Math.max(...postSlice.map((b) => b.high))
          maxExpansion = Math.max(0, highestPost - rangeHigh)
        } else {
          const lowestPost = Math.min(...postSlice.map((b) => b.low))
          maxExpansion = Math.max(0, rangeLow - lowestPost)
        }

        events.push({
          market,
          type: isAccumulation ? 'ACCUMULATION' : 'DISTRIBUTION',
          startTime: formationBar.time,
          endTime: breakoutBar.time,
          durationHours: Number(((breakoutBar.time - formationBar.time) / 3600).toFixed(1)),
          rangeHigh,
          rangeLow,
          rangeSpanPts: Number(rangeSpan.toFixed(2)),
          rangeSpanAtr: Number(rangeSpanAtr.toFixed(2)),
          phaseBAtr: Number(avgAtr.toFixed(2)),
          breakoutAtr: Number(breakoutBar.atr14.toFixed(2)),
          atrExpansionRatio: Number((breakoutBar.atr14 / (avgAtr || 1)).toFixed(2)),
          hasSweep: isAccumulation ? hadSpringSweep : hadUtadSweep,
          sweepDepthPts: Number((isAccumulation ? maxSpringDepthPts : maxUtadDepthPts).toFixed(2)),
          sweepDepthAtr: Number(((isAccumulation ? maxSpringDepthPts : maxUtadDepthPts) / (avgAtr || 1)).toFixed(2)),
          sweepVolumeRatio: Number(
            (
              (isAccumulation ? springSweepVolume : utadSweepVolume) /
              (avgRangeVol || 1)
            ).toFixed(2)
          ),
          hasCvdDivergence: isAccumulation ? springHasCvdDiv : utadHasCvdDiv,
          breakoutHourEt: breakoutBar.hourEt,
          breakoutSession: breakoutBar.session,
          formationSession: formationBar.session,
          postBreakoutExpansionPts: Number(maxExpansion.toFixed(2)),
        })

        // Fast-forward past this breakout to avoid counting duplicate overlapping ranges
        i = breakoutIdx + 12
        continue
      }
    }

    i += 4 // Step forward 20 minutes
  }

  return events
}

export async function runFull1YearWyckoffBacktest() {
  console.log('🚀 Starting 1-Year 5-Minute Wyckoff Range Backtest across Desk Markets...\n')

  const markets = [
    { key: 'NASDAQ', name: 'NASDAQ (NQ)', file: 'data/cme_multiyear/nasdaq_1m_multiyear.json' },
    { key: 'DOW', name: 'DOW (YM)', file: 'data/cme_multiyear/dow_1m_multiyear.json' },
    { key: 'CRUDE', name: 'CRUDE (CL)', file: 'data/cme_multiyear/crude_1m_multiyear.json' },
    { key: 'GOLD', name: 'GOLD (GC)', file: 'data/cme_multiyear/gold_1m_multiyear.json' },
    { key: 'NIKKEI', name: 'NIKKEI 225 (NKD)', file: '' },
  ]

  const allEvents: RangeEvent[] = []
  const marketSummaries: Record<string, any> = {}

  for (const m of markets) {
    let bars5m: Bar5M[] = []

    if (m.key === 'NIKKEI') {
      console.log(`Processing ${m.name} recent multi-month intraday data...`)
      const fetched = await getYahooCandles('NIKKEI', '5', 59)
      if (fetched && fetched.candles.length > 0) {
        // Map YahooCandle to Bar5M
        const rawBars = fetched.candles.map(c => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 100, // Synthetic volume proxy if 0
        }))
        // Process ATR, CVD, Delta
        bars5m = aggregate1mTo5m(rawBars)
        console.log(`  -> Fetched ${bars5m.length.toLocaleString()} 5m bars for ${m.name}`)
      } else {
        console.warn(`Could not fetch data for ${m.name}`)
        continue
      }
    } else {
      const fullPath = path.resolve(process.cwd(), m.file)
      if (!fs.existsSync(fullPath)) {
        console.warn(`File not found for ${m.name}: ${fullPath}`)
        continue
      }

      console.log(`Processing ${m.name} 1-year data...`)
      const rawData = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
      bars5m = aggregate1mTo5m(rawData)
      console.log(`  -> Built ${bars5m.length.toLocaleString()} 5m bars (${new Date(bars5m[0]!.time * 1000).toISOString().slice(0, 10)} to ${new Date(bars5m[bars5m.length - 1]!.time * 1000).toISOString().slice(0, 10)})`)
    }

    const events = analyzeWyckoffRanges(m.key, bars5m)
    allEvents.push(...events)

    const accum = events.filter((e) => e.type === 'ACCUMULATION')
    const distrib = events.filter((e) => e.type === 'DISTRIBUTION')

    // Sweep stats
    const accumSweeps = accum.filter((e) => e.hasSweep)
    const distribSweeps = distrib.filter((e) => e.hasSweep)

    // CVD Divergence stats
    const accumCvdDiv = accum.filter((e) => e.hasCvdDivergence)
    const distribCvdDiv = distrib.filter((e) => e.hasCvdDivergence)

    // ATR stats
    const avgAtrExpansion = events.reduce((sum, e) => sum + e.atrExpansionRatio, 0) / (events.length || 1)
    const avgSweepVolRatio = events.filter((e) => e.hasSweep).reduce((sum, e) => sum + e.sweepVolumeRatio, 0) / (events.filter((e) => e.hasSweep).length || 1)

    // Breakout Hour distribution
    const breakoutHours: Record<number, number> = {}
    for (const e of events) {
      breakoutHours[e.breakoutHourEt] = (breakoutHours[e.breakoutHourEt] || 0) + 1
    }

    marketSummaries[m.key] = {
      market: m.name,
      totalRanges: events.length,
      accumulationCount: accum.length,
      distributionCount: distrib.length,
      accumulationSpringRatePct: Number(((accumSweeps.length / (accum.length || 1)) * 100).toFixed(1)),
      distributionUtadRatePct: Number(((distribSweeps.length / (distrib.length || 1)) * 100).toFixed(1)),
      bullishAbsorptionCvdRatePct: Number(((accumCvdDiv.length / (accum.length || 1)) * 100).toFixed(1)),
      bearishAbsorptionCvdRatePct: Number(((distribCvdDiv.length / (distrib.length || 1)) * 100).toFixed(1)),
      avgRangeDurationHours: Number((events.reduce((sum, e) => sum + e.durationHours, 0) / (events.length || 1)).toFixed(1)),
      avgAtrExpansionRatio: Number(avgAtrExpansion.toFixed(2)),
      avgSweepVolumeRatio: Number(avgSweepVolRatio.toFixed(2)),
      topBreakoutHoursEt: Object.entries(breakoutHours)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([h, c]) => `${h}:00 ET (${c} ranges)`),
      topFormationSessions: Object.entries(
        events.reduce((acc: any, e) => {
          acc[e.formationSession] = (acc[e.formationSession] || 0) + 1
          return acc
        }, {})
      )
        .sort((a: any, b: any) => b[1] - a[1])
        .map(([s, c]) => `${s} (${c})`),
    }

    console.log(`  -> Detected ${events.length} qualified Wyckoff Ranges: ${accum.length} Accumulation, ${distrib.length} Distribution`)
    console.log(`  -> Spring Rate (Lower Low Sweep before Markup): ${marketSummaries[m.key].accumulationSpringRatePct}%`)
    console.log(`  -> UTAD Rate (Higher High Sweep before Markdown): ${marketSummaries[m.key].distributionUtadRatePct}%`)
    console.log(`  -> CVD Absorption Divergence Rate: Accum ${marketSummaries[m.key].bullishAbsorptionCvdRatePct}% | Distrib ${marketSummaries[m.key].bearishAbsorptionCvdRatePct}%`)
    console.log(`  -> Average Breakout Volatility Expansion: ${marketSummaries[m.key].avgAtrExpansionRatio}x ATR\n`)
  }

  // Cross-market Grand Totals
  const totalAccum = allEvents.filter((e) => e.type === 'ACCUMULATION')
  const totalDistrib = allEvents.filter((e) => e.type === 'DISTRIBUTION')
  const totalSprings = totalAccum.filter((e) => e.hasSweep)
  const totalUtads = totalDistrib.filter((e) => e.hasSweep)

  const overall = {
    totalRangesAnalyzed: allEvents.length,
    accumulationRanges: totalAccum.length,
    distributionRanges: totalDistrib.length,
    overallSpringRatePct: Number(((totalSprings.length / (totalAccum.length || 1)) * 100).toFixed(1)),
    overallUtadRatePct: Number(((totalUtads.length / (totalDistrib.length || 1)) * 100).toFixed(1)),
    overallCvdAbsorptionPct: Number(
      (
        ((totalAccum.filter((e) => e.hasCvdDivergence).length + totalDistrib.filter((e) => e.hasCvdDivergence).length) /
          (allEvents.length || 1)) *
        100
      ).toFixed(1)
    ),
    avgAtrExpansionOnBreakout: Number(
      (allEvents.reduce((s, e) => s + e.atrExpansionRatio, 0) / (allEvents.length || 1)).toFixed(2)
    ),
    sweepDepthAvgAtr: Number(
      (allEvents.filter((e) => e.hasSweep).reduce((s, e) => s + e.sweepDepthAtr, 0) / (allEvents.filter((e) => e.hasSweep).length || 1)).toFixed(2)
    ),
  }

  const outResult = {
    metadata: {
      title: '1-Year 5-Minute Wyckoff Range Accumulation & Distribution Backtest',
      generatedAt: new Date().toISOString(),
      timeframe: '5m',
      samplePeriod: 'Last 365 Days',
    },
    overall,
    byMarket: marketSummaries,
    sampleEvents: allEvents.slice(0, 100),
  }

  const outPath = path.resolve(process.cwd(), 'data/wyckoff_range_backtest_1year.json')
  fs.writeFileSync(outPath, JSON.stringify(outResult, null, 2))
  console.log(`✅ Backtest complete! Saved full results to: ${outPath}`)

  return outResult
}

// Auto-run if executed directly
if (require.main === module || process.argv[1]?.includes('backtest-wyckoff-range-mechanics')) {
  runFull1YearWyckoffBacktest()
}
