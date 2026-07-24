/**
 * 2-Year Multi-Year Quantitative Position Management Optimization & Backtester
 * Runs exhaustive grid search across 2 years of historical market data for:
 * 1. DOW (US30_USD / ^DJI)
 * 2. NASDAQ (NAS100_USD / ^IXIC / QQQ)
 * 3. NIKKEI (JP225_USD / ^N225)
 */

import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
      envVars[key] = val
    }
  }
})
Object.assign(process.env, envVars)

const INSTRUMENTS = [
  { name: 'DOW', symbol: '^DJI', proxy: 'DIA', pipSize: 1.0 },
  { name: 'NASDAQ', symbol: '^IXIC', proxy: 'QQQ', pipSize: 1.0 },
  { name: 'NIKKEI', symbol: '^N225', proxy: 'EWJ', pipSize: 5.0 },
]

/** Fetch 2 Years of 1-Hour & 5-Minute Historical Bars from Yahoo Chart API */
async function fetch2YearHistoricalData(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1h&range=2y`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    const timestamps = result?.timestamp || []
    const quote = result?.indicators?.quote?.[0] || {}

    const candles = []
    for (let i = 0; i < timestamps.length; i++) {
      const o = Number(quote.open?.[i])
      const h = Number(quote.high?.[i])
      const l = Number(quote.low?.[i])
      const c = Number(quote.close?.[i])
      if (Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
        candles.push({ timestamp: timestamps[i], open: o, high: h, low: l, close: c })
      }
    }
    return candles
  } catch (err) {
    console.error(`Error fetching 2y data for ${symbol}:`, err.message)
    return []
  }
}

/** Simulate trading strategies on 2-year candle dataset */
function simulateStrategy(candles, instrumentName, config) {
  const { beThresholdR, trailStartR, trailDistancePct, scaleOutAtR } = config
  let totalTrades = 0
  let wins = 0
  let losses = 0
  let breakevens = 0
  let scaledOutCount = 0
  let totalNetR = 0

  // Walk through candles looking for market structure level breakouts
  for (let i = 50; i < candles.length - 20; i += 4) {
    const lookback = candles.slice(i - 50, i)
    const high50 = Math.max(...lookback.map((c) => c.high))
    const low50 = Math.min(...lookback.map((c) => c.low))
    const current = candles[i]

    let direction = null
    let entry = 0
    let sl = 0
    let tp = 0

    if (current.close > high50) {
      direction = 'LONG'
      entry = current.close
      const range = current.high - current.low
      sl = entry - Math.max(entry * 0.004, range * 1.5)
      tp = entry + (entry - sl) * 2.0 // 2:1 R:R target
    } else if (current.close < low50) {
      direction = 'SHORT'
      entry = current.close
      const range = current.high - current.low
      sl = entry + Math.max(entry * 0.004, range * 1.5)
      tp = entry - (sl - entry) * 2.0 // 2:1 R:R target
    }

    if (!direction) continue

    const rRisk = Math.abs(entry - sl)
    if (rRisk <= 0) continue

    totalTrades++
    let currentSl = sl
    let peakPrice = entry
    let isScaledOut = false
    let currentPositionWeight = 1.0 // 100% initial size
    let realizedPnlR = 0

    // Forward walk through execution window (up to 30 bars)
    for (let j = i + 1; j < Math.min(i + 30, candles.length); j++) {
      const c = candles[j]

      if (direction === 'LONG') {
        if (c.high > peakPrice) peakPrice = c.high
        const maxR = (peakPrice - entry) / rRisk

        // 1. Check Stop Loss Hit
        if (c.low <= currentSl) {
          const exitPnlR = (currentSl - entry) / rRisk
          realizedPnlR += exitPnlR * currentPositionWeight
          break
        }

        // 2. Check Take Profit Hit
        if (c.high >= tp) {
          const exitPnlR = (tp - entry) / rRisk
          realizedPnlR += exitPnlR * currentPositionWeight
          break
        }

        // 3. Scale-Out Rule
        if (maxR >= scaleOutAtR && !isScaledOut && scaleOutAtR < 90) {
          isScaledOut = true
          scaledOutCount++
          const partialPnlR = (entry + rRisk * scaleOutAtR - entry) / rRisk
          realizedPnlR += partialPnlR * 0.5 // Lock 50% profit
          currentPositionWeight = 0.5 // Hold remaining 50%
        }

        // 4. Breakeven Rule
        if (maxR >= beThresholdR && currentSl < entry) {
          currentSl = entry
        }

        // 5. Trailing Stop Rule
        if (maxR >= trailStartR) {
          const trailPrice = peakPrice - rRisk * trailDistancePct
          if (trailPrice > currentSl) {
            currentSl = trailPrice
          }
        }
      } else {
        // SHORT
        if (c.low < peakPrice || peakPrice === entry) peakPrice = c.low
        const maxR = (entry - peakPrice) / rRisk

        // 1. Check Stop Loss Hit
        if (c.high >= currentSl) {
          const exitPnlR = (entry - currentSl) / rRisk
          realizedPnlR += exitPnlR * currentPositionWeight
          break
        }

        // 2. Check Take Profit Hit
        if (c.low <= tp) {
          const exitPnlR = (entry - tp) / rRisk
          realizedPnlR += exitPnlR * currentPositionWeight
          break
        }

        // 3. Scale-Out Rule
        if (maxR >= scaleOutAtR && !isScaledOut && scaleOutAtR < 90) {
          isScaledOut = true
          scaledOutCount++
          const partialPnlR = (entry - (entry - rRisk * scaleOutAtR)) / rRisk
          realizedPnlR += partialPnlR * 0.5
          currentPositionWeight = 0.5
        }

        // 4. Breakeven Rule
        if (maxR >= beThresholdR && currentSl > entry) {
          currentSl = entry
        }

        // 5. Trailing Stop Rule
        if (maxR >= trailStartR) {
          const trailPrice = peakPrice + rRisk * trailDistancePct
          if (trailPrice < currentSl) {
            currentSl = trailPrice
          }
        }
      }
    }

    totalNetR += realizedPnlR
    if (realizedPnlR > 0.05) wins++
    else if (realizedPnlR < -0.05) losses++
    else breakevens++
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const expectancy = totalTrades > 0 ? totalNetR / totalTrades : 0

  return {
    configName: config.name,
    trades: totalTrades,
    wins,
    losses,
    breakevens,
    winRate: winRate.toFixed(1),
    totalNetR: totalNetR.toFixed(2),
    expectancy: expectancy.toFixed(3),
    beThresholdR,
    trailStartR,
    trailDistancePct,
    scaleOutAtR,
  }
}

async function run() {
  console.log('========================================================================')
  console.log('  2-YEAR MULTI-YEAR QUANTITATIVE POSITION MANAGEMENT OPTIMIZATION')
  console.log('========================================================================\n')

  const optimalProfiles = {}

  for (const item of INSTRUMENTS) {
    console.log(`\n------------------------------------------------------------------------`)
    console.log(`  ANALYZING 2-YEAR HISTORICAL DATA: ${item.name} (${item.symbol})`)
    console.log(`------------------------------------------------------------------------`)

    const candles = await fetch2YearHistoricalData(item.symbol)
    console.log(`  Loaded ${candles.length} historical bars (2-Year dataset)\n`)
    if (!candles.length) continue

    // Grid search configurations
    const grid = [
      { name: 'Fixed TP/SL (No Management)', beThresholdR: 99, trailStartR: 99, trailDistancePct: 1.0, scaleOutAtR: 99 },
      { name: 'Ultra-Tight Management', beThresholdR: 0.5, trailStartR: 0.6, trailDistancePct: 0.3, scaleOutAtR: 0.5 },
      { name: 'Standard 1:1 Breakeven', beThresholdR: 1.0, trailStartR: 1.2, trailDistancePct: 0.5, scaleOutAtR: 1.0 },
      { name: 'Tech Volatility Profile (Wide Room)', beThresholdR: 1.3, trailStartR: 1.5, trailDistancePct: 0.6, scaleOutAtR: 1.2 },
      { name: 'Asian Session Fast-Lock Profile', beThresholdR: 0.7, trailStartR: 0.9, trailDistancePct: 0.4, scaleOutAtR: 0.7 },
      { name: 'Blue-Chip Institutional Profile', beThresholdR: 0.9, trailStartR: 1.1, trailDistancePct: 0.45, scaleOutAtR: 0.9 },
    ]

    let bestConfig = null
    let maxExpectancy = -999

    for (const cfg of grid) {
      const res = simulateStrategy(candles, item.name, cfg)
      console.log(`  Strategy: ${res.configName.padEnd(35)} | Win Rate: ${res.winRate.padStart(5)}% | Net Return: ${res.totalNetR.padStart(7)}R | Expectancy: ${res.expectancy}R/trade`)
      if (Number(res.expectancy) > maxExpectancy) {
        maxExpectancy = Number(res.expectancy)
        bestConfig = res
      }
    }

    console.log(`\n  🏆 OPTIMAL 2-YEAR PROFILE FOR ${item.name}:`)
    console.log(`     - Strategy: ${bestConfig.configName}`)
    console.log(`     - Breakeven Trigger: +${bestConfig.beThresholdR} R (${(bestConfig.beThresholdR * 50).toFixed(1)}% TP distance)`)
    console.log(`     - Trailing Stop Trigger: +${bestConfig.trailStartR} R`)
    console.log(`     - Trailing Distance: ${bestConfig.trailDistancePct * 100}% of Risk`)
    console.log(`     - Partial Scale-Out: +${bestConfig.scaleOutAtR} R`)
    console.log(`     - 2-Year Total Net Return: +${bestConfig.totalNetR} R (${bestConfig.winRate}% Win Rate)\n`)

    optimalProfiles[item.name] = bestConfig
  }

  console.log('\n========================================================================')
  console.log('  OPTIMAL 2-YEAR INSTRUMENT PARAMETERS FOR PRODUCTION IMPLEMENTATION')
  console.log('========================================================================')
  console.log(JSON.stringify(optimalProfiles, null, 2))
}

run()
