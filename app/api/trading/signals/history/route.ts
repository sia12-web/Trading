import { NextRequest, NextResponse } from 'next/server'
import { getOandaCandlesRange } from '@/lib/oanda/candles'
import { warmCmeBasis, getCmeBasis, applyCmeBasisToCandles } from '@/lib/trading/cmeBasis'
import { computeYesterdayProfile } from '@/lib/trading/yesterdayProfile'
import {
  calculateStochastic,
  evaluateConfluenceSignal,
  type Candle,
} from '@/lib/trading/confluenceDivergenceStrategy'
import type { Instrument } from '@/types/price-feed'

const POINT_VALUES: Record<Instrument, number> = {
  DOW: 0.5,
  NASDAQ: 2.0,
  NIKKEI: 5.0,
  GOLD: 10.0,
  CRUDE: 100.0,
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const instrument = (searchParams.get('instrument')?.toUpperCase() || 'GOLD') as Instrument
  const daysLookback = Math.min(Math.max(parseInt(searchParams.get('days') || '14', 10), 1), 30)

  try {
    await warmCmeBasis(instrument)
    const basis = getCmeBasis(instrument) ?? 0

    const nowSec = Math.floor(Date.now() / 1000)
    const startSec = nowSec - daysLookback * 86400

    const res = await getOandaCandlesRange(instrument, '5', startSec, nowSec)
    if (!res?.candles || res.candles.length === 0) {
      return NextResponse.json({ success: true, instrument, trades: [] })
    }

    const candles = applyCmeBasisToCandles(res.candles, basis)

    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const fmtTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })

    interface NycCandle extends Candle {
      etDate: string
      etMins: number
    }

    const nyCandles: NycCandle[] = candles.map((c) => {
      const d = new Date(c.time * 1000)
      const etDate = fmtDate.format(d)
      const timeStr = fmtTime.format(d)
      const [h, m] = timeStr.split(':').map(Number)
      const etMins = (h || 0) * 60 + (m || 0)
      return { ...c, etDate, etMins }
    })

    const daysMap = new Map<string, NycCandle[]>()
    for (const c of nyCandles) {
      const list = daysMap.get(c.etDate) ?? []
      list.push(c)
      daysMap.set(c.etDate, list)
    }

    const dayKeys = Array.from(daysMap.keys()).sort()
    const trades: any[] = []
    let tradeId = 1
    const pointValue = POINT_VALUES[instrument] || 1.0
    const contracts = 2

    for (let d = 1; d < dayKeys.length; d++) {
      const priorDayKey = dayKeys[d - 1]!
      const currentDayKey = dayKeys[d]!
      const priorBars = daysMap.get(priorDayKey)!
      const currentBars = daysMap.get(currentDayKey)!

      const rthBars = currentBars.filter((b) => b.etMins >= 570 && b.etMins <= 960)
      if (priorBars.length < 12 || rthBars.length < 6) continue

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
      let activePosition: {
        trade: any
        remainingUnits: number
        tp1Hit: boolean
        currentSl: number
      } | null = null

      const sessionBars: Candle[] = []

      for (let i = 0; i < rthBars.length; i++) {
        const bar = rthBars[i]!
        sessionBars.push(bar)

        if (activePosition) {
          const { trade, tp1Hit, currentSl } = activePosition

          if (trade.direction === 'BUY') {
            if (bar.low <= currentSl) {
              trade.exitTime = bar.time
              trade.exitPrice = currentSl
              if (tp1Hit) {
                trade.result = 'WIN_PARTIAL'
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

            if (!tp1Hit && bar.high >= trade.tp1) {
              activePosition.tp1Hit = true
              activePosition.currentSl = trade.entryPrice
            }

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

            if (!tp1Hit && bar.low <= trade.tp1) {
              activePosition.tp1Hit = true
              activePosition.currentSl = trade.entryPrice
            }

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

        if (!activePosition && dailyAttempts < 3 && sessionBars.length >= 14 && bar.etMins <= 945) {
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
            if (ydayProfile?.openType === 'OUTSIDE_RANGE') {
              if (ydayProfile.cashOpen && ydayProfile.yh && ydayProfile.cashOpen > ydayProfile.yh && signal.direction === 'SELL') {
                continue
              }
              if (ydayProfile.cashOpen && ydayProfile.yl && ydayProfile.cashOpen < ydayProfile.yl && signal.direction === 'BUY') {
                continue
              }
            }

            dailyAttempts++
            const timeEt = new Date(signal.time * 1000).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })

            const trade = {
              id: tradeId++,
              date: currentDayKey,
              time: signal.time,
              timeEt,
              instrument,
              direction: signal.direction,
              entryPrice: signal.entryPrice,
              stopLoss: signal.stopLoss,
              tp1: signal.tp1,
              tp2: signal.tp2,
              riskPoints: signal.riskPoints,
              exitTime: 0,
              exitPrice: 0,
              result: 'OPEN',
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

      // Flatten at 16:00 ET
      if (activePosition) {
        const lastBar = rthBars[rthBars.length - 1]!
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

    // Sort descending by time (newest first)
    trades.sort((a, b) => b.time - a.time)

    return NextResponse.json({
      success: true,
      instrument,
      totalSignals: trades.length,
      trades,
    })
  } catch (error) {
    console.error('Error fetching signals history:', error)
    return NextResponse.json({ success: false, error: 'Failed to compute signals history' }, { status: 500 })
  }
}
