/**
 * Historical Backtester: Confluence Divergence Strategy
 * (Market Profile VAH/VAL/POC + Session VWAP ±1σ + John Kurisko Stochastic Divergence)
 *
 * Runs full simulation across CME Futures:
 * 1. DOW (MYM)
 * 2. NASDAQ (MNQ)
 * 3. GOLD (MGC)
 */

import fs from 'fs'
import path from 'path'
import { getOandaCandlesRange } from '@/lib/oanda/candles'
import { warmCmeBasis, getCmeBasis, applyCmeBasisToCandles } from '@/lib/trading/cmeBasis'
import { computeYesterdayProfile } from '@/lib/trading/yesterdayProfile'
import {
  calculateStochastic,
  evaluateConfluenceSignal,
  type Candle,
} from '@/lib/trading/confluenceDivergenceStrategy'
import type { Instrument } from '@/types/price-feed'

// Point values per contract (Micro contracts)
const POINT_VALUES: Record<Instrument, number> = {
  DOW: 0.5,     // MYM: $0.50 per point
  NASDAQ: 2.0,  // MNQ: $2.00 per point
  NIKKEI: 5.0,  // NKD: $5.00 per point
  GOLD: 10.0,   // MGC: $10.00 per point ($1 per 0.10)
  CRUDE: 100.0, // MCL: $100.00 per point ($1 per 0.01)
}

interface SimulatedTrade {
  id: number
  date: string
  instrument: Instrument
  direction: 'BUY' | 'SELL'
  entryTime: number
  entryPrice: number
  stopLoss: number
  tp1: number
  tp2: number
  riskPoints: number
  exitTime: number
  exitPrice: number
  result: 'WIN_FULL' | 'WIN_PARTIAL' | 'LOSS' | 'BREAKEVEN'
  pnlDollars: number
  rMultiple: number
  locationReason: string
  triggerReason: string
}

function calculateSessionVwap(bars: Candle[]): { vwap: number; upper1: number; lower1: number } {
  let sumPV = 0
  let sumV = 0
  let sumP2V = 0

  for (const b of bars) {
    const p = (b.high + b.low + b.close) / 3
    const vol = b.volume > 0 ? b.volume : 1
    sumPV += p * vol
    sumP2V += p * p * vol
    sumV += vol
  }

  if (sumV === 0) return { vwap: 0, upper1: 0, lower1: 0 }
  const vwap = sumPV / sumV
  const variance = Math.max(0, sumP2V / sumV - vwap * vwap)
  const std = Math.sqrt(variance)

  return {
    vwap: Number(vwap.toFixed(2)),
    upper1: Number((vwap + std).toFixed(2)),
    lower1: Number((vwap - std).toFixed(2)),
  }
}

async function runBacktestForInstrument(
  instrument: Instrument,
  daysLookback = 30
): Promise<{ trades: SimulatedTrade[]; metrics: any }> {
  console.log(`\n===============================================================`)
  console.log(`📊 RUNNING BACKTEST: ${instrument} (${daysLookback} DAYS LOOKBACK)`)
  console.log(`===============================================================`)

  await warmCmeBasis(instrument)
  const basis = getCmeBasis(instrument) ?? 0

  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = nowSec - daysLookback * 86400

  // Fetch 5-minute candles
  const res = await getOandaCandlesRange(instrument, '5', startSec, nowSec)
  if (!res?.candles || res.candles.length === 0) {
    console.log(`❌ No candle data available for ${instrument}`)
    return { trades: [], metrics: null }
  }

  const candles = applyCmeBasisToCandles(res.candles, basis)
  console.log(`Loaded ${candles.length} 5m candles on CME scale (basis: ${basis})`)

  // Group candles by trading day (calendar date in ET)
  const daysMap = new Map<string, Candle[]>()
  for (const c of candles) {
    const dStr = new Date(c.time * 1000).toISOString().slice(0, 10)
    const list = daysMap.get(dStr) ?? []
    list.push(c)
    daysMap.set(dStr, list)
  }

  const dayKeys = Array.from(daysMap.keys()).sort()
  const trades: SimulatedTrade[] = []
  let tradeId = 1
  const pointValue = POINT_VALUES[instrument] || 1.0
  const contracts = 2 // Standard 2-contract bracket for Tradeify 50k

  for (let d = 1; d < dayKeys.length; d++) {
    const priorDayKey = dayKeys[d - 1]!
    const currentDayKey = dayKeys[d]!
    const priorBars = daysMap.get(priorDayKey)!
    const currentBars = daysMap.get(currentDayKey)!

    if (priorBars.length < 12 || currentBars.length < 12) continue

    // Compute Yesterday's Profile
    const ydayProfile = computeYesterdayProfile({
      instrument,
      candles: priorBars.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      asOfUnix: priorBars[priorBars.length - 1]!.time,
    })

    const valueArea = ydayProfile
      ? { vah: ydayProfile.vah, val: ydayProfile.val, poc: ydayProfile.poc }
      : null

    let dailyAttempts = 0
    let inTrade: SimulatedTrade | null = null
    let activePosition: {
      trade: SimulatedTrade
      remainingUnits: number
      tp1Hit: boolean
      currentSl: number
    } | null = null

    // Walk through current day bars (simulate session progress)
    const sessionBars: Candle[] = []

    for (let i = 0; i < currentBars.length; i++) {
      const bar = currentBars[i]!
      sessionBars.push(bar)

      // Manage active position if open
      if (activePosition) {
        const { trade, tp1Hit, currentSl } = activePosition

        if (trade.direction === 'BUY') {
          // Check Stop Loss
          if (bar.low <= currentSl) {
            trade.exitTime = bar.time
            trade.exitPrice = currentSl
            if (tp1Hit) {
              trade.result = 'WIN_PARTIAL'
              // 70% won at TP1, 30% out at BE
              const pnl1 = (trade.tp1 - trade.entryPrice) * (contracts * 0.7) * pointValue
              const pnl2 = (currentSl - trade.entryPrice) * (contracts * 0.3) * pointValue
              trade.pnlDollars = Math.round(pnl1 + pnl2)
              trade.rMultiple = Number(((trade.tp1 - trade.entryPrice) / trade.riskPoints * 0.7).toFixed(2))
            } else {
              trade.result = 'LOSS'
              trade.pnlDollars = Math.round(-trade.riskPoints * contracts * pointValue)
              trade.rMultiple = -1.0
            }
            trades.push(trade)
            activePosition = null
            continue
          }

          // Check TP1
          if (!tp1Hit && bar.high >= trade.tp1) {
            activePosition.tp1Hit = true
            activePosition.currentSl = trade.entryPrice // Move SL to Break-Even!
          }

          // Check TP2
          if (bar.high >= trade.tp2) {
            trade.exitTime = bar.time
            trade.exitPrice = trade.tp2
            trade.result = 'WIN_FULL'
            const pnl1 = (trade.tp1 - trade.entryPrice) * (contracts * 0.7) * pointValue
            const pnl2 = (trade.tp2 - trade.entryPrice) * (contracts * 0.3) * pointValue
            trade.pnlDollars = Math.round(pnl1 + pnl2)
            trade.rMultiple = Number(
              (((trade.tp1 - trade.entryPrice) * 0.7 + (trade.tp2 - trade.entryPrice) * 0.3) / trade.riskPoints).toFixed(2)
            )
            trades.push(trade)
            activePosition = null
            continue
          }
        } else {
          // SELL / Short trade
          // Check Stop Loss
          if (bar.high >= currentSl) {
            trade.exitTime = bar.time
            trade.exitPrice = currentSl
            if (tp1Hit) {
              trade.result = 'WIN_PARTIAL'
              const pnl1 = (trade.entryPrice - trade.tp1) * (contracts * 0.7) * pointValue
              const pnl2 = (trade.entryPrice - currentSl) * (contracts * 0.3) * pointValue
              trade.pnlDollars = Math.round(pnl1 + pnl2)
              trade.rMultiple = Number(((trade.entryPrice - trade.tp1) / trade.riskPoints * 0.7).toFixed(2))
            } else {
              trade.result = 'LOSS'
              trade.pnlDollars = Math.round(-trade.riskPoints * contracts * pointValue)
              trade.rMultiple = -1.0
            }
            trades.push(trade)
            activePosition = null
            continue
          }

          // Check TP1
          if (!tp1Hit && bar.low <= trade.tp1) {
            activePosition.tp1Hit = true
            activePosition.currentSl = trade.entryPrice // Move SL to BE
          }

          // Check TP2
          if (bar.low <= trade.tp2) {
            trade.exitTime = bar.time
            trade.exitPrice = trade.tp2
            trade.result = 'WIN_FULL'
            const pnl1 = (trade.entryPrice - trade.tp1) * (contracts * 0.7) * pointValue
            const pnl2 = (trade.entryPrice - trade.tp2) * (contracts * 0.3) * pointValue
            trade.pnlDollars = Math.round(pnl1 + pnl2)
            trade.rMultiple = Number(
              (((trade.entryPrice - trade.tp1) * 0.7 + (trade.entryPrice - trade.tp2) * 0.3) / trade.riskPoints).toFixed(2)
            )
            trades.push(trade)
            activePosition = null
            continue
          }
        }
      }

      // If no active trade and daily attempt limit (max 3) not reached
      if (!activePosition && dailyAttempts < 3 && sessionBars.length >= 14) {
        const vwap = calculateSessionVwap(sessionBars)
        const stochPoints = calculateStochastic(sessionBars, 14, 3, 3)

        const signal = evaluateConfluenceSignal({
          instrument,
          bars: sessionBars,
          stochPoints,
          valueArea,
          vwap,
        })

        if (signal) {
          // John Kurisko & Market Profile Rule:
          // Never fade divergence against initiative auction / trend days (OUTSIDE_RANGE)
          if (ydayProfile?.openType === 'OUTSIDE_RANGE') {
            if (ydayProfile.cashOpen && ydayProfile.yh && ydayProfile.cashOpen > ydayProfile.yh && signal.direction === 'SELL') {
              continue // Do not fade bullish breakout
            }
            if (ydayProfile.cashOpen && ydayProfile.yl && ydayProfile.cashOpen < ydayProfile.yl && signal.direction === 'BUY') {
              continue // Do not fade bearish breakdown
            }
          }

          dailyAttempts++
          const trade: SimulatedTrade = {
            id: tradeId++,
            date: currentDayKey,
            instrument,
            direction: signal.direction,
            entryTime: signal.time,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            tp1: signal.tp1,
            tp2: signal.tp2,
            riskPoints: signal.riskPoints,
            exitTime: 0,
            exitPrice: 0,
            result: 'LOSS',
            pnlDollars: 0,
            rMultiple: 0,
            locationReason: signal.locationReason,
            triggerReason: signal.triggerReason,
          }

          activePosition = {
            trade,
            remainingUnits: contracts,
            tp1Hit: false,
            currentSl: signal.stopLoss,
          }
        }
      }
    }

    // End-of-day flatten if trade still open
    if (activePosition) {
      const lastBar = currentBars[currentBars.length - 1]!
      const { trade, tp1Hit } = activePosition
      trade.exitTime = lastBar.time
      trade.exitPrice = lastBar.close

      const diff = trade.direction === 'BUY'
        ? trade.exitPrice - trade.entryPrice
        : trade.entryPrice - trade.exitPrice

      trade.pnlDollars = Math.round(diff * contracts * pointValue)
      trade.rMultiple = Number((diff / trade.riskPoints).toFixed(2))
      trade.result = trade.pnlDollars > 0 ? (tp1Hit ? 'WIN_FULL' : 'WIN_PARTIAL') : 'LOSS'
      trades.push(trade)
      activePosition = null
    }
  }

  // Compute Metrics
  let totalWins = 0
  let totalLosses = 0
  let grossProfit = 0
  let grossLoss = 0
  let cumulativePnl = 0
  let peakPnl = 0
  let maxDrawdown = 0

  for (const t of trades) {
    if (t.pnlDollars > 0) {
      totalWins++
      grossProfit += t.pnlDollars
    } else {
      totalLosses++
      grossLoss += Math.abs(t.pnlDollars)
    }
    cumulativePnl += t.pnlDollars
    if (cumulativePnl > peakPnl) peakPnl = cumulativePnl
    const dd = peakPnl - cumulativePnl
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const winRate = trades.length > 0 ? (totalWins / trades.length) * 100 : 0
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.0 : 0
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0)
  const avgR = trades.length > 0 ? totalR / trades.length : 0

  const metrics = {
    totalTrades: trades.length,
    wins: totalWins,
    losses: totalLosses,
    winRate: Number(winRate.toFixed(1)),
    grossProfit,
    grossLoss,
    netPnlDollars: Math.round(grossProfit - grossLoss),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdown: Math.round(maxDrawdown),
    totalR: Number(totalR.toFixed(1)),
    avgR: Number(avgR.toFixed(2)),
  }

  console.log(`\nResults for ${instrument}:`)
  console.log(`  Total Trades:  ${metrics.totalTrades}`)
  console.log(`  Win Rate:      ${metrics.winRate}% (${metrics.wins} Wins / ${metrics.losses} Losses)`)
  console.log(`  Profit Factor: ${metrics.profitFactor}`)
  console.log(`  Net PnL:       $${metrics.netPnlDollars.toLocaleString()}`)
  console.log(`  Max Drawdown:  $${metrics.maxDrawdown.toLocaleString()}`)
  console.log(`  Total R:       +${metrics.totalR}R (Avg R/Trade: ${metrics.avgR}R)`)

  return { trades, metrics }
}

async function main() {
  console.log(`====================================================================`)
  console.log(`🚀 MULTI-MARKET BACKTEST: CONFLUENCE DIVERGENCE STRATEGY`)
  console.log(`====================================================================`)

  const instruments: Instrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']
  const allResults: Record<string, { trades: SimulatedTrade[]; metrics: any }> = {}

  let grandTotalTrades = 0
  let grandTotalWins = 0
  let grandTotalGrossProfit = 0
  let grandTotalGrossLoss = 0
  let grandTotalNetPnl = 0
  let grandTotalR = 0

  for (const inst of instruments) {
    const res = await runBacktestForInstrument(inst, 30)
    allResults[inst] = res
    if (res.metrics) {
      grandTotalTrades += res.metrics.totalTrades
      grandTotalWins += res.metrics.wins
      grandTotalGrossProfit += res.metrics.grossProfit
      grandTotalGrossLoss += res.metrics.grossLoss
      grandTotalNetPnl += res.metrics.netPnlDollars
      grandTotalR += res.metrics.totalR
    }
  }

  const grandWinRate = grandTotalTrades > 0 ? (grandTotalWins / grandTotalTrades) * 100 : 0
  const grandProfitFactor = grandTotalGrossLoss > 0 ? grandTotalGrossProfit / grandTotalGrossLoss : 99.0

  console.log(`\n====================================================================`)
  console.log(`🏆 PORTFOLIO SUMMARY (DOW + NASDAQ + GOLD)`)
  console.log(`====================================================================`)
  console.log(`Total Portfolio Trades: ${grandTotalTrades}`)
  console.log(`Portfolio Win Rate:     ${grandWinRate.toFixed(1)}%`)
  console.log(`Portfolio Profit Factor:${grandProfitFactor.toFixed(2)}`)
  console.log(`Portfolio Net PnL:      $${grandTotalNetPnl.toLocaleString()}`)
  console.log(`Portfolio Total R:      +${grandTotalR.toFixed(1)}R`)

  // Write Markdown Report
  let md = `# Historical Strategy Backtest Results

## Confluence Divergence Strategy
**Methodology:** Market Profile Value Area (Yesterday VAH/VAL/POC) + Session VWAP $\\pm1\\sigma$ + John Kurisko Stochastic (14,3,3) Divergence.

---

### Portfolio Performance Summary (DOW, NASDAQ, GOLD)

| Metric | Portfolio Value |
| :--- | :--- |
| **Total Trades** | **${grandTotalTrades}** |
| **Win Rate** | **${grandWinRate.toFixed(1)}%** (${grandTotalWins} W / ${grandTotalTrades - grandTotalWins} L) |
| **Profit Factor** | **${grandProfitFactor.toFixed(2)}** |
| **Gross Profit** | **+$${grandTotalGrossProfit.toLocaleString()}** |
| **Gross Loss** | **-$${grandTotalGrossLoss.toLocaleString()}** |
| **Net Profit** | **+$${grandTotalNetPnl.toLocaleString()}** |
| **Total R-Multiple** | **+${grandTotalR.toFixed(1)}R** |

---

### Breakdown By Instrument

| Instrument | Trades | Win Rate | Profit Factor | Net PnL ($) | Max Drawdown | Total R |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
`

  for (const inst of instruments) {
    const m = allResults[inst]?.metrics
    if (m) {
      md += `| **${inst}** | ${m.totalTrades} | ${m.winRate}% | ${m.profitFactor} | +$${m.netPnlDollars.toLocaleString()} | $${m.maxDrawdown.toLocaleString()} | +${m.totalR}R |\n`
    }
  }

  md += `
---

### Individual Trade Log Sample (Last 10 Trades)

| # | Date | Market | Direction | Entry | Stop Loss | Exit | Result | PnL ($) | R | Location Setup |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
`

  const allTrades = Object.values(allResults).flatMap((r) => r.trades)
  const recentTrades = allTrades.slice(-15)
  for (const t of recentTrades) {
    md += `| ${t.id} | ${t.date} | ${t.instrument} | **${t.direction}** | ${t.entryPrice} | ${t.stopLoss} | ${t.exitPrice} | ${t.result} | ${t.pnlDollars >= 0 ? '+' : ''}$${t.pnlDollars} | ${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R | ${t.locationReason} |\n`
  }

  fs.writeFileSync(path.join(process.cwd(), 'HISTORICAL_STRATEGY_BACKTEST_RESULTS.md'), md)
  console.log(`\nSaved report to HISTORICAL_STRATEGY_BACKTEST_RESULTS.md`)
}

main().catch(console.error)
