/**
 * Backtester for Position Management Rules across DOW (US30_USD), NASDAQ (NAS100_USD), and NIKKEI (JP225_USD)
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

import { getYahooCandles } from '../lib/yahoo/candles.ts'

const INSTRUMENTS = ['DOW', 'NASDAQ', 'NIKKEI']

async function fetchHistoricalData(instrument) {
  const res = await getYahooCandles(instrument, '5', 5)
  if (!res || !res.candles || res.candles.length < 50) {
    console.error(`Failed to fetch candles for ${instrument}`)
    return []
  }
  return res.candles
}

/**
 * Simulate trade entry on breakout/reversal setups across candles
 */
function runBacktest(candles, instrument, config) {
  let trades = 0
  let wins = 0
  let losses = 0
  let breakevens = 0
  let totalReturnR = 0

  const { beThresholdR, trailStartR, trailDistancePct } = config

  for (let i = 20; i < candles.length - 30; i += 3) {
    const lookback = candles.slice(i - 20, i)
    const high20 = Math.max(...lookback.map(c => c.high))
    const low20 = Math.min(...lookback.map(c => c.low))
    const current = candles[i]

    let direction = null
    let entry = 0
    let sl = 0
    let tp = 0

    if (current.close > high20) {
      direction = 'LONG'
      entry = current.close
      const atr = Math.abs(current.high - current.low) * 1.5
      sl = entry - Math.max(entry * 0.0025, atr)
      tp = entry + (entry - sl) * 2.0 // 2:1 R:R target
    } else if (current.close < low20) {
      direction = 'SHORT'
      entry = current.close
      const atr = Math.abs(current.high - current.low) * 1.5
      sl = entry + Math.max(entry * 0.0025, atr)
      tp = entry - (sl - entry) * 2.0 // 2:1 R:R target
    }

    if (!direction) continue

    const rRisk = Math.abs(entry - sl)
    if (rRisk === 0) continue

    trades++
    let currentSl = sl
    let peakPrice = entry
    let exited = false
    let exitPrice = 0

    for (let j = i + 1; j < Math.min(i + 40, candles.length); j++) {
      const c = candles[j]

      if (direction === 'LONG') {
        if (c.high > peakPrice) peakPrice = c.high
        const maxR = (peakPrice - entry) / rRisk

        // Check if Stop Loss hit
        if (c.low <= currentSl) {
          exited = true
          exitPrice = currentSl
          break
        }

        // Check if Take Profit hit
        if (c.high >= tp) {
          exited = true
          exitPrice = tp
          break
        }

        // Management Rule: Breakeven
        if (maxR >= beThresholdR && currentSl < entry) {
          currentSl = entry
        }

        // Management Rule: Trailing Stop
        if (maxR >= trailStartR) {
          const trailedSl = peakPrice - (rRisk * trailDistancePct)
          if (trailedSl > currentSl) {
            currentSl = trailedSl
          }
        }
      } else {
        // SHORT
        if (c.low < peakPrice || peakPrice === entry) peakPrice = c.low
        const maxR = (entry - peakPrice) / rRisk

        // Check if Stop Loss hit
        if (c.high >= currentSl) {
          exited = true
          exitPrice = currentSl
          break
        }

        // Check if Take Profit hit
        if (c.low <= tp) {
          exited = true
          exitPrice = tp
          break
        }

        // Management Rule: Breakeven
        if (maxR >= beThresholdR && currentSl > entry) {
          currentSl = entry
        }

        // Management Rule: Trailing Stop
        if (maxR >= trailStartR) {
          const trailedSl = peakPrice + (rRisk * trailDistancePct)
          if (trailedSl < currentSl) {
            currentSl = trailedSl
          }
        }
      }
    }

    if (!exited) {
      const finalC = candles[Math.min(i + 39, candles.length - 1)]
      exitPrice = finalC.close
    }

    const tradePnlR = direction === 'LONG'
      ? (exitPrice - entry) / rRisk
      : (entry - exitPrice) / rRisk

    totalReturnR += tradePnlR

    if (tradePnlR > 0.1) wins++
    else if (tradePnlR < -0.1) losses++
    else breakevens++
  }

  const winRate = trades > 0 ? ((wins / trades) * 100).toFixed(1) : '0'
  const expectancyR = trades > 0 ? (totalReturnR / trades).toFixed(2) : '0'

  return {
    instrument,
    trades,
    wins,
    losses,
    breakevens,
    winRate: `${winRate}%`,
    totalReturnR: totalReturnR.toFixed(2),
    expectancyR: `${expectancyR}R`,
  }
}

async function run() {
  console.log('=== QUANTITATIVE BACKTEST OF POSITION MANAGEMENT RULES ===\n')

  for (const inst of INSTRUMENTS) {
    console.log(`\n--------------------------------------------------`)
    console.log(`  INSTRUMENT: ${inst}`)
    console.log(`--------------------------------------------------`)
    const candles = await fetchHistoricalData(inst)
    if (!candles.length) continue

    const configs = [
      { name: '1. Fixed TP/SL (No Management)', beThresholdR: 99, trailStartR: 99, trailDistancePct: 1.0 },
      { name: '2. Ultra-Tight (BE @ +0.5R, Trail @ 0.3R)', beThresholdR: 0.5, trailStartR: 0.7, trailDistancePct: 0.3 },
      { name: '3. Generic (BE @ +1.0R, Trail @ 0.5R)', beThresholdR: 1.0, trailStartR: 1.2, trailDistancePct: 0.5 },
      {
        name: '4. Tailored Instrument Profile',
        beThresholdR: inst === 'NASDAQ' ? 1.2 : inst === 'NIKKEI' ? 0.75 : 1.0,
        trailStartR: inst === 'NASDAQ' ? 1.4 : inst === 'NIKKEI' ? 0.9 : 1.2,
        trailDistancePct: inst === 'NASDAQ' ? 0.55 : inst === 'NIKKEI' ? 0.35 : 0.45,
      },
    ]

    for (const cfg of configs) {
      const res = runBacktest(candles, inst, cfg)
      console.log(`\n  Strategy: ${cfg.name}`)
      console.log(`    Trades: ${res.trades} | Wins: ${res.wins} | Losses: ${res.losses} | Breakevens: ${res.breakevens}`)
      console.log(`    Win Rate: ${res.winRate} | Expectancy: ${res.expectancyR} per trade | Total: +${res.totalReturnR}R`)
    }
  }
}

run()
