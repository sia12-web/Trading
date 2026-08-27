/**
 * Auction volume-bar break: a high-RVOL bar tags the locked range
 * (green must touch range high, red must touch range low). For the next
 * N bars, a close through that bar's high is long; a close through its
 * low is the opposite. Setup dies after N bars (price accepted).
 */

import { instrumentTick } from '@/lib/trading/instrumentTicks'
import { FUTURES_POINT_VALUES } from '@/lib/trading/positionSizing'
import {
  AUCTION_INSTRUMENTS,
  nyCivil,
  summarizeAuctionTrades,
  type AuctionBar,
  type AuctionInstrument,
  type AuctionRangeFocus,
  type AuctionSummary,
} from '@/lib/trading/auctionStrategy'

export { AUCTION_INSTRUMENTS, summarizeAuctionTrades }
export type { AuctionBar, AuctionInstrument, AuctionRangeFocus, AuctionSummary }

export type VolumeBreakKind = 'CONTINUE' | 'FAIL'
export type VolumeBreakTrade = {
  instrument: AuctionInstrument
  date: string
  kind: VolumeBreakKind
  rangeFocus: AuctionRangeFocus
  side: 'LONG' | 'SHORT'
  setupColor: 'GREEN' | 'RED'
  waitUsed: number
  entry: number
  stop: number
  target: number
  riskDollars: number
  contracts: number
  pointValue: number
  exit: number
  exitReason: 'take_profit' | 'stop_hit' | 'eod'
  pnl: number
  rMultiple: number
  fillUnix: number
  exitUnix: number
}

export type VolumeBreakParams = {
  waitBars: number
  rr: number
  slBufferTicks: number
  rvolMult: number
  minRangeMult: number
  maxDaily: number
  /** Live Dow: FAIL only (CONTINUE is not the book). */
  onlyKind?: VolumeBreakKind
  /** Live Dow: 15-minute range only. */
  onlyRange?: AuctionRangeFocus
  /** Live last-bar scan — do not suppress a new trigger because an earlier sim fill is "open". */
  ignoreOccupancy?: boolean
}

export const DEFAULT_VOLUME_BREAK: VolumeBreakParams = {
  waitBars: 5,
  rr: 1.25,
  slBufferTicks: 5,
  rvolMult: 1.2,
  minRangeMult: 1.0,
  maxDaily: 3,
}

const ACCOUNT_SIZE = 50_000
const RISK_PCT = 1
const POINT_VALUE: Record<AuctionInstrument, number> = {
  DOW: FUTURES_POINT_VALUES.DOW,
  NASDAQ: FUTURES_POINT_VALUES.NASDAQ,
  GOLD: FUTURES_POINT_VALUES.GOLD,
  CRUDE: FUTURES_POINT_VALUES.CRUDE,
}

function sma(values: number[], len: number): number | null {
  if (values.length < len) return null
  let s = 0
  for (let i = values.length - len; i < values.length; i++) s += values[i]!
  return s / len
}

function closeTrade(args: {
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  contracts: number
  pointValue: number
  later: AuctionBar[]
  eodClose: number
  eodUnix: number
  rr: number
}): Pick<VolumeBreakTrade, 'exit' | 'exitReason' | 'pnl' | 'rMultiple' | 'exitUnix'> {
  const riskPts = Math.abs(args.entry - args.stop)
  const stopPnl = -riskPts * args.pointValue * args.contracts
  const tpPts = Math.abs(args.target - args.entry)
  const tpPnl = tpPts * args.pointValue * args.contracts
  const tpR = riskPts > 0 ? tpPts / riskPts : args.rr

  for (const bar of args.later) {
    const hitStop = args.side === 'LONG' ? bar.low <= args.stop : bar.high >= args.stop
    const hitTp = args.side === 'LONG' ? bar.high >= args.target : bar.low <= args.target
    if (hitStop) {
      return { exit: args.stop, exitReason: 'stop_hit', pnl: stopPnl, rMultiple: -1, exitUnix: bar.time }
    }
    if (hitTp) {
      return { exit: args.target, exitReason: 'take_profit', pnl: tpPnl, rMultiple: tpR, exitUnix: bar.time }
    }
  }
  const signed = args.side === 'LONG' ? 1 : -1
  const pts = (args.eodClose - args.entry) * signed
  return {
    exit: args.eodClose,
    exitReason: 'eod',
    pnl: pts * args.pointValue * args.contracts,
    rMultiple: riskPts > 0 ? pts / riskPts : 0,
    exitUnix: args.eodUnix,
  }
}

type Setup = {
  barIndex: number
  high: number
  low: number
  color: 'GREEN' | 'RED'
  rangeFocus: AuctionRangeFocus
  ymd: string
}

export function runVolumeBreakBacktest(args: {
  instrument: AuctionInstrument
  candles: AuctionBar[]
  params?: Partial<VolumeBreakParams>
}): {
  instrument: AuctionInstrument
  params: VolumeBreakParams
  trades: VolumeBreakTrade[]
  summary: AuctionSummary
  byKind: Record<VolumeBreakKind, AuctionSummary>
  bySide: Record<'LONG' | 'SHORT', AuctionSummary>
  byRange: Record<AuctionRangeFocus, AuctionSummary>
  expiredSetups: number
} {
  const params: VolumeBreakParams = { ...DEFAULT_VOLUME_BREAK, ...args.params }
  const instrument = args.instrument
  const tick = instrumentTick(instrument)
  const pointValue = POINT_VALUE[instrument]
  const riskDollars = ACCOUNT_SIZE * (RISK_PCT / 100)
  const buffer = tick * params.slBufferTicks

  const candles = (args.candles || [])
    .filter(
      (c) =>
        c &&
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.high >= c.low
    )
    .slice()
    .sort((a, b) => a.time - b.time)

  const tagged = candles.map((c) => ({ ...c, ...nyCivil(c.time) }))
  const volumes: number[] = []
  const ranges: number[] = []
  const trades: VolumeBreakTrade[] = []
  let expiredSetups = 0

  let curDay = ''
  let r15h: number | null = null
  let r15l: number | null = null
  let r30h: number | null = null
  let r30l: number | null = null
  let r60h: number | null = null
  let r60l: number | null = null
  let dailySignals = 0
  let inTradeUntil = 0
  let setup: Setup | null = null

  for (let i = 0; i < tagged.length; i++) {
    const bar = tagged[i]!
    const isNewDay = bar.ymd !== curDay
    if (isNewDay) {
      curDay = bar.ymd
      r15h = r15l = r30h = r30l = r60h = r60l = null
      dailySignals = 0
      setup = null
    }

    const nyMins = bar.mins
    const isRth = nyMins >= 570 && nyMins < 960
    if (nyMins >= 570 && nyMins < 585) {
      r15h = r15h == null ? bar.high : Math.max(r15h, bar.high)
      r15l = r15l == null ? bar.low : Math.min(r15l, bar.low)
    }
    if (nyMins >= 570 && nyMins < 600) {
      r30h = r30h == null ? bar.high : Math.max(r30h, bar.high)
      r30l = r30l == null ? bar.low : Math.min(r30l, bar.low)
    }
    if (nyMins >= 570 && nyMins < 630) {
      r60h = r60h == null ? bar.high : Math.max(r60h, bar.high)
      r60l = r60l == null ? bar.low : Math.min(r60l, bar.low)
    }

    const in15Exec = nyMins >= 585 && nyMins < 600
    const in30Exec = nyMins >= 600 && nyMins < 630
    const in1hExec = nyMins >= 630 && nyMins < 690

    let activeH: number | null = null
    let activeL: number | null = null
    let rangeFocus: AuctionRangeFocus | null = null
    if (in15Exec && r15h != null) {
      activeH = r15h
      activeL = r15l
      rangeFocus = '15M'
    } else if (in30Exec && r30h != null) {
      activeH = r30h
      activeL = r30l
      rangeFocus = '30M'
    } else if (in1hExec && r60h != null) {
      activeH = r60h
      activeL = r60l
      rangeFocus = 'IB'
    }

    volumes.push(bar.volume || 0)
    ranges.push(bar.high - bar.low)
    const volSma = sma(volumes, 20)
    const rngSma = sma(ranges, 20)
    const rvol = volSma != null && volSma > 0 ? (bar.volume || 0) / volSma : 1
    const isBig =
      rngSma != null && rngSma > 0 ? bar.high - bar.low >= rngSma * params.minRangeMult : false
    const isHighVol = rvol >= params.rvolMult
    const isGreen = bar.close > bar.open
    const isRed = bar.close < bar.open
    const touchesHigh = activeH != null && bar.low <= activeH && bar.high >= activeH
    const touchesLow = activeL != null && bar.low <= activeL && bar.high >= activeL

    if (setup && bar.ymd !== setup.ymd) {
      expiredSetups += 1
      setup = null
    }

    // Resolve an open setup on bars after the volume bar.
    if (
      setup &&
      isRth &&
      (params.ignoreOccupancy ||
        (bar.time > inTradeUntil && dailySignals < params.maxDaily)) &&
      i > setup.barIndex &&
      i - setup.barIndex <= params.waitBars
    ) {
      const brokeHigh = bar.close > setup.high
      const brokeLow = bar.close < setup.low
      let side: 'LONG' | 'SHORT' | null = null
      let kind: VolumeBreakKind | null = null
      if (brokeHigh && !brokeLow) {
        side = 'LONG'
        kind = setup.color === 'GREEN' ? 'CONTINUE' : 'FAIL'
      } else if (brokeLow && !brokeHigh) {
        side = 'SHORT'
        kind = setup.color === 'RED' ? 'CONTINUE' : 'FAIL'
      } else if (brokeHigh && brokeLow) {
        // Both sides tagged: use close vs midpoint of the volume bar.
        const mid = (setup.high + setup.low) / 2
        side = bar.close >= mid ? 'LONG' : 'SHORT'
        kind =
          (side === 'LONG' && setup.color === 'GREEN') ||
          (side === 'SHORT' && setup.color === 'RED')
            ? 'CONTINUE'
            : 'FAIL'
      }

      if (side && kind && (!params.onlyKind || kind === params.onlyKind)) {
        const entry = bar.close
        const sl = side === 'LONG' ? setup.low - buffer : setup.high + buffer
        const riskPts = Math.abs(entry - sl)
        const slValid = side === 'LONG' ? sl < entry : sl > entry
        if (slValid && riskPts > 0) {
          const tp = side === 'LONG' ? entry + riskPts * params.rr : entry - riskPts * params.rr
          const contracts = Math.max(1, Math.floor(riskDollars / (riskPts * pointValue)))
          const later: AuctionBar[] = []
          let eod = bar
          for (let j = i + 1; j < tagged.length; j++) {
            const nxt = tagged[j]!
            if (nxt.ymd !== bar.ymd) break
            if (nxt.mins >= 960) break
            if (nxt.mins >= 570) {
              later.push(nxt)
              eod = nxt
            }
          }
          const closed = closeTrade({
            side,
            entry,
            stop: sl,
            target: tp,
            contracts,
            pointValue,
            later,
            eodClose: eod.close,
            eodUnix: eod.time,
            rr: params.rr,
          })
          dailySignals += 1
          inTradeUntil = closed.exitUnix
          trades.push({
            instrument,
            date: bar.ymd,
            kind,
            rangeFocus: setup.rangeFocus,
            side,
            setupColor: setup.color,
            waitUsed: i - setup.barIndex,
            entry,
            stop: sl,
            target: tp,
            riskDollars,
            contracts,
            pointValue,
            exit: closed.exit,
            exitReason: closed.exitReason,
            pnl: closed.pnl,
            rMultiple: closed.rMultiple,
            fillUnix: bar.time,
            exitUnix: closed.exitUnix,
          })
          setup = null
        }
      }
    }

    if (setup && i - setup.barIndex >= params.waitBars) {
      expiredSetups += 1
      setup = null
    }

    // Arm a new volume-bar setup (not on the same bar as a fill).
    if (
      !setup &&
      isRth &&
      rangeFocus &&
      (!params.onlyRange || rangeFocus === params.onlyRange) &&
      activeH != null &&
      activeL != null &&
      isHighVol &&
      isBig &&
      (params.ignoreOccupancy || bar.time > inTradeUntil)
    ) {
      if (isGreen && touchesHigh) {
        setup = {
          barIndex: i,
          high: bar.high,
          low: bar.low,
          color: 'GREEN',
          rangeFocus,
          ymd: bar.ymd,
        }
      } else if (isRed && touchesLow) {
        setup = {
          barIndex: i,
          high: bar.high,
          low: bar.low,
          color: 'RED',
          rangeFocus,
          ymd: bar.ymd,
        }
      }
    }
  }

  const asAuction = trades.map((t) => ({
    ...t,
    pattern: 'ABSORB_BREAKOUT' as const,
    openType: 'Analyzing...' as const,
  }))

  return {
    instrument,
    params,
    trades,
    summary: summarizeAuctionTrades(asAuction, instrument),
    byKind: {
      CONTINUE: summarizeAuctionTrades(
        asAuction.filter((t) => t.kind === 'CONTINUE'),
        'CONTINUE'
      ),
      FAIL: summarizeAuctionTrades(
        asAuction.filter((t) => t.kind === 'FAIL'),
        'FAIL'
      ),
    },
    bySide: {
      LONG: summarizeAuctionTrades(
        asAuction.filter((t) => t.side === 'LONG'),
        'LONG'
      ),
      SHORT: summarizeAuctionTrades(
        asAuction.filter((t) => t.side === 'SHORT'),
        'SHORT'
      ),
    },
    byRange: {
      '15M': summarizeAuctionTrades(
        asAuction.filter((t) => t.rangeFocus === '15M'),
        '15M'
      ),
      '30M': summarizeAuctionTrades(
        asAuction.filter((t) => t.rangeFocus === '30M'),
        '30M'
      ),
      IB: summarizeAuctionTrades(
        asAuction.filter((t) => t.rangeFocus === 'IB'),
        'IB'
      ),
    },
    expiredSetups,
  }
}
