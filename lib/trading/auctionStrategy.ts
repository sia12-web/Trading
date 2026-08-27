/**
 * Bar-by-bar port of the TradingView "auction" indicator (absorb-breakout).
 * Sequential non-overlapping windows: 15M 09:45–10:00, 30M 10:00–10:30,
 * IB 10:30–11:30. Fake rejection tail at the active range edge, then close
 * crosses the tail in the VWAP+EMA20 trend. Signals on 5m close. One
 * position at a time. Flatten at 16:00 ET.
 */

import { instrumentTick } from '@/lib/trading/instrumentTicks'
import { FUTURES_POINT_VALUES } from '@/lib/trading/positionSizing'

export const AUCTION_INSTRUMENTS = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const
export type AuctionInstrument = (typeof AUCTION_INSTRUMENTS)[number]

export function isAuctionInstrument(value: string): value is AuctionInstrument {
  return (AUCTION_INSTRUMENTS as readonly string[]).includes(value)
}

export type AuctionRangeFocus = '15M' | '30M' | 'IB'
export type AuctionOpenType =
  | 'GAP UP (Imbalance)'
  | 'GAP DOWN (Imbalance)'
  | 'INSIDE VALUE (Balance)'
  | 'IN RANGE / OUT VALUE'
  | 'Analyzing...'

export type AuctionBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type AuctionTrade = {
  instrument: AuctionInstrument
  date: string
  pattern: 'ABSORB_BREAKOUT'
  rangeFocus: AuctionRangeFocus
  openType: AuctionOpenType
  side: 'LONG' | 'SHORT'
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

export type AuctionSummary = {
  key: string
  trades: number
  wins: number
  losses: number
  eod: number
  winRate: number | null
  netPnl: number
  sumR: number
  expectR: number | null
  avgR: number | null
  profitFactor: number | null
  maxDrawdown: number
}

export type AuctionBacktestResult = {
  instrument: AuctionInstrument
  days: number
  bars: number
  fromUnix: number
  toUnix: number
  trades: AuctionTrade[]
  summary: AuctionSummary
  bySide: Record<'LONG' | 'SHORT', AuctionSummary>
  byRange: Record<AuctionRangeFocus, AuctionSummary>
}

const NY = 'America/New_York'
const ACCOUNT_SIZE = 50_000
const RISK_PCT = 1
const MAX_DAILY_SIGNALS = 3
const PROXIMITY_PCT = 0.2
const MIN_FAKE_TAIL_PCT = 30
const RR_RATIO = 1.5
const SAME_SIDE_COOLDOWN = 6
const EMA_LEN = 20
const FAKE_AGE_MAX = 4

const POINT_VALUE: Record<AuctionInstrument, number> = {
  DOW: FUTURES_POINT_VALUES.DOW,
  NASDAQ: FUTURES_POINT_VALUES.NASDAQ,
  GOLD: FUTURES_POINT_VALUES.GOLD,
  CRUDE: FUTURES_POINT_VALUES.CRUDE,
}

const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function nyCivil(unix: number): { ymd: string; mins: number } {
  const parts = nyFmt.formatToParts(new Date(unix * 1000))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '0'
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  const minute = parseInt(get('minute'), 10)
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    mins: hour * 60 + minute,
  }
}

function nearLevel(price: number, ref: number | null, pct: number): boolean {
  if (ref == null || !Number.isFinite(ref)) return false
  return Math.abs(price - ref) <= ref * (pct / 100)
}

function classifyOpen(
  openPx: number,
  yHigh: number,
  yLow: number,
  yClose: number
): { openType: AuctionOpenType; focus: AuctionRangeFocus } {
  const yRange = Math.max(yHigh - yLow, 1e-9)
  const yPoc = (yHigh + yLow + yClose) / 3
  const yVah = yPoc + yRange * 0.35
  const yVal = yPoc - yRange * 0.35
  if (openPx > yHigh) return { openType: 'GAP UP (Imbalance)', focus: '15M' }
  if (openPx < yLow) return { openType: 'GAP DOWN (Imbalance)', focus: '15M' }
  if (openPx <= yVah && openPx >= yVal) {
    return { openType: 'INSIDE VALUE (Balance)', focus: 'IB' }
  }
  return { openType: 'IN RANGE / OUT VALUE', focus: '30M' }
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
}): Pick<AuctionTrade, 'exit' | 'exitReason' | 'pnl' | 'rMultiple' | 'exitUnix'> {
  const riskPts = Math.abs(args.entry - args.stop)
  const stopPnl = -riskPts * args.pointValue * args.contracts
  const tpPts = Math.abs(args.target - args.entry)
  const tpPnl = tpPts * args.pointValue * args.contracts
  const tpR = riskPts > 0 ? tpPts / riskPts : RR_RATIO

  for (const bar of args.later) {
    const hitStop = args.side === 'LONG' ? bar.low <= args.stop : bar.high >= args.stop
    const hitTp = args.side === 'LONG' ? bar.high >= args.target : bar.low <= args.target
    if (hitStop) {
      return {
        exit: args.stop,
        exitReason: 'stop_hit',
        pnl: stopPnl,
        rMultiple: -1,
        exitUnix: bar.time,
      }
    }
    if (hitTp) {
      return {
        exit: args.target,
        exitReason: 'take_profit',
        pnl: tpPnl,
        rMultiple: tpR,
        exitUnix: bar.time,
      }
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

export function summarizeAuctionTrades(
  trades: AuctionTrade[],
  key = 'ALL'
): AuctionSummary {
  const wins = trades.filter((t) => t.exitReason === 'take_profit').length
  const losses = trades.filter((t) => t.exitReason === 'stop_hit').length
  const eod = trades.filter((t) => t.exitReason === 'eod').length
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const sumR = trades.reduce((s, t) => s + t.rMultiple, 0)
  const grossWin = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
  let peak = 0
  let eq = 0
  let maxDd = 0
  for (const t of trades) {
    eq += t.pnl
    if (eq > peak) peak = eq
    maxDd = Math.max(maxDd, peak - eq)
  }
  const n = trades.length
  return {
    key,
    trades: n,
    wins,
    losses,
    eod,
    winRate: n > 0 ? wins / n : null,
    netPnl,
    sumR,
    expectR: n > 0 ? sumR / n : null,
    avgR: n > 0 ? sumR / n : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdown: maxDd,
  }
}

export type AuctionBacktestParams = {
  /** `ib` = 10:30–11:30 only (gold / crude live). Default sequential 15M→30M→IB. */
  rangeMode?: 'sequential' | 'ib'
  allowShort?: boolean
  maxDaily?: number
  rr?: number
  /** Live last-bar scan — do not suppress a new trigger because an earlier sim fill is "open". */
  ignoreOccupancy?: boolean
}

export function runAuctionBacktest(args: {
  instrument: AuctionInstrument
  candles: AuctionBar[]
  params?: AuctionBacktestParams
}): AuctionBacktestResult {
  const instrument = args.instrument
  const params = args.params ?? {}
  const tick = instrumentTick(instrument)
  const pointValue = POINT_VALUE[instrument]
  const riskDollars = ACCOUNT_SIZE * (RISK_PCT / 100)
  const rrRatio = params.rr ?? RR_RATIO
  const maxDaily = params.maxDaily ?? MAX_DAILY_SIGNALS
  const allowShort = params.allowShort !== false
  const rangeMode = params.rangeMode ?? 'sequential'
  const emaAlpha = 2 / (EMA_LEN + 1)
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
  const daySet = new Set<string>()
  for (const b of tagged) daySet.add(b.ymd)

  const trades: AuctionTrade[] = []

  let yHigh: number | null = null
  let yLow: number | null = null
  let yClose: number | null = null
  let curDay = ''
  let dayHigh = NaN
  let dayLow = NaN
  let dayClose = NaN
  let wasRth = false

  let openType: AuctionOpenType = 'Analyzing...'
  let prevRangeTag: AuctionRangeFocus | 'WAIT' | 'EXPIRED' = 'WAIT'

  let r15h: number | null = null
  let r15l: number | null = null
  let r30h: number | null = null
  let r30l: number | null = null
  let r60h: number | null = null
  let r60l: number | null = null

  let ema: number | null = null
  let vwapNum = 0
  let vwapDen = 0

  let fakeTopTailH: number | null = null
  let fakeTopBodyL: number | null = null
  let fakeTopAge = 0
  let fakeBotTailL: number | null = null
  let fakeBotBodyH: number | null = null
  let fakeBotAge = 0

  let dailySignals = 0
  let lastSignalSide = 0
  let lastSignalBar = -999
  let inTradeUntil = 0
  let prevClose: number | null = null
  let prevFakeTop: number | null = null
  let prevFakeBot: number | null = null

  for (let i = 0; i < tagged.length; i++) {
    const bar = tagged[i]!
    const isNewDay = bar.ymd !== curDay
    if (isNewDay) {
      if (curDay) {
        yHigh = dayHigh
        yLow = dayLow
        yClose = dayClose
      }
      curDay = bar.ymd
      dayHigh = bar.high
      dayLow = bar.low
      dayClose = bar.close
      r15h = r15l = r30h = r30l = r60h = r60l = null
      dailySignals = 0
      wasRth = false
      vwapNum = 0
      vwapDen = 0
    } else {
      dayHigh = Math.max(dayHigh, bar.high)
      dayLow = Math.min(dayLow, bar.low)
      dayClose = bar.close
    }

    const nyMins = bar.mins
    const isRth = nyMins >= 570 && nyMins < 960
    const in15Build = nyMins >= 570 && nyMins < 585
    const in30Build = nyMins >= 570 && nyMins < 600
    const in1hBuild = nyMins >= 570 && nyMins < 630
    const in15Exec = nyMins >= 585 && nyMins < 600
    const in30Exec = nyMins >= 600 && nyMins < 630
    const in1hExec = nyMins >= 630 && nyMins < 690

    if (isRth && !wasRth && yHigh != null && yLow != null && yClose != null) {
      openType = classifyOpen(bar.open, yHigh, yLow, yClose).openType
    }
    wasRth = isRth

    if (in15Build) {
      r15h = r15h == null ? bar.high : Math.max(r15h, bar.high)
      r15l = r15l == null ? bar.low : Math.min(r15l, bar.low)
    }
    if (in30Build) {
      r30h = r30h == null ? bar.high : Math.max(r30h, bar.high)
      r30l = r30l == null ? bar.low : Math.min(r30l, bar.low)
    }
    if (in1hBuild) {
      r60h = r60h == null ? bar.high : Math.max(r60h, bar.high)
      r60l = r60l == null ? bar.low : Math.min(r60l, bar.low)
    }

    let activeH: number | null = null
    let activeL: number | null = null
    let canTradeWindow = false
    let rangeTag: AuctionRangeFocus | 'WAIT' | 'EXPIRED' = nyMins >= 690 ? 'EXPIRED' : 'WAIT'
    if (rangeMode === 'ib') {
      if (in1hExec) {
        activeH = r60h
        activeL = r60l
        canTradeWindow = r60h != null
        rangeTag = 'IB'
      }
    } else if (in15Exec) {
      activeH = r15h
      activeL = r15l
      canTradeWindow = r15h != null
      rangeTag = '15M'
    } else if (in30Exec) {
      activeH = r30h
      activeL = r30l
      canTradeWindow = r30h != null
      rangeTag = '30M'
    } else if (in1hExec) {
      activeH = r60h
      activeL = r60l
      canTradeWindow = r60h != null
      rangeTag = 'IB'
    }
    const windowChanged = rangeTag !== prevRangeTag
    prevRangeTag = rangeTag

    const typical = (bar.high + bar.low + bar.close) / 3
    const vol = Math.max(bar.volume || 0, 1e-9)
    vwapNum += typical * vol
    vwapDen += vol
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : bar.close
    ema = ema == null ? bar.close : emaAlpha * bar.close + (1 - emaAlpha) * ema

    const isUptrend = bar.close > vwap && bar.close > ema
    const isDowntrend = bar.close < vwap && bar.close < ema

    const nearH =
      nearLevel(bar.high, activeH, PROXIMITY_PCT) ||
      (activeH != null ? bar.high >= activeH : false)
    const nearL =
      nearLevel(bar.low, activeL, PROXIMITY_PCT) ||
      (activeL != null ? bar.low <= activeL : false)

    const candleRange = bar.high - bar.low
    const upperTail = bar.high - Math.max(bar.open, bar.close)
    const lowerTail = Math.min(bar.open, bar.close) - bar.low
    const upperTailPct = candleRange > 0 ? (upperTail / candleRange) * 100 : 0
    const lowerTailPct = candleRange > 0 ? (lowerTail / candleRange) * 100 : 0

    if (isNewDay || !canTradeWindow || windowChanged) {
      fakeTopTailH = null
      fakeTopBodyL = null
      fakeTopAge = 0
      fakeBotTailL = null
      fakeBotBodyH = null
      fakeBotAge = 0
    }

    if (upperTailPct >= MIN_FAKE_TAIL_PCT && nearH && isUptrend && canTradeWindow) {
      fakeTopTailH = bar.high
      fakeTopBodyL = Math.min(bar.open, bar.close)
      fakeTopAge = 0
    }
    if (lowerTailPct >= MIN_FAKE_TAIL_PCT && nearL && isDowntrend && canTradeWindow) {
      fakeBotTailL = bar.low
      fakeBotBodyH = Math.max(bar.open, bar.close)
      fakeBotAge = 0
    }

    if (fakeTopTailH != null) {
      fakeTopAge += 1
      if (fakeTopAge > FAKE_AGE_MAX) fakeTopTailH = null
    }
    if (fakeBotTailL != null) {
      fakeBotAge += 1
      if (fakeBotAge > FAKE_AGE_MAX) fakeBotTailL = null
    }

    const buyRaw =
      fakeTopTailH != null &&
      prevClose != null &&
      prevFakeTop != null &&
      prevClose <= prevFakeTop &&
      bar.close > fakeTopTailH &&
      isUptrend &&
      canTradeWindow
    const sellRaw =
      fakeBotTailL != null &&
      prevClose != null &&
      prevFakeBot != null &&
      prevClose >= prevFakeBot &&
      bar.close < fakeBotTailL &&
      isDowntrend &&
      canTradeWindow

    const canTrigger =
      isRth &&
      canTradeWindow &&
      (params.ignoreOccupancy ||
        (dailySignals < maxDaily && bar.time > inTradeUntil))
    let buySignal =
      buyRaw && canTrigger && (lastSignalSide !== 1 || i - lastSignalBar > SAME_SIDE_COOLDOWN)
    let sellSignal =
      allowShort &&
      sellRaw &&
      canTrigger &&
      (lastSignalSide !== -1 || i - lastSignalBar > SAME_SIDE_COOLDOWN)
    if (buySignal) sellSignal = false

    if (buySignal || sellSignal) {
      const side: 'LONG' | 'SHORT' = buySignal ? 'LONG' : 'SHORT'
      const entry = bar.close
      const sl =
        side === 'LONG'
          ? (fakeTopBodyL ?? bar.low) - tick
          : (fakeBotBodyH ?? bar.high) + tick
      const sizeRiskPts = Math.max(Math.abs(entry - sl), tick * 10)
      const tp = side === 'LONG' ? entry + sizeRiskPts * rrRatio : entry - sizeRiskPts * rrRatio
      const slValid = side === 'LONG' ? sl < entry : sl > entry
      const tpValid = side === 'LONG' ? tp > entry : tp < entry
      if (slValid && tpValid) {
        lastSignalSide = side === 'LONG' ? 1 : -1
        lastSignalBar = i
        dailySignals += 1
        if (side === 'LONG') fakeTopTailH = null
        else fakeBotTailL = null

        const contracts = Math.max(1, Math.floor(riskDollars / (sizeRiskPts * pointValue)))
        const laterRth: AuctionBar[] = []
        let eod = bar
        for (let j = i + 1; j < tagged.length; j++) {
          const nxt = tagged[j]!
          if (nxt.ymd !== bar.ymd) break
          if (nxt.mins >= 960) break
          if (nxt.mins >= 570) {
            laterRth.push(nxt)
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
          later: laterRth,
          eodClose: eod.close,
          eodUnix: eod.time,
        })
        inTradeUntil = closed.exitUnix
        trades.push({
          instrument,
          date: bar.ymd,
          pattern: 'ABSORB_BREAKOUT',
          rangeFocus: rangeTag === '15M' || rangeTag === '30M' || rangeTag === 'IB' ? rangeTag : 'IB',
          openType,
          side,
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
      }
    }

    prevClose = bar.close
    prevFakeTop = fakeTopTailH
    prevFakeBot = fakeBotTailL
  }

  return {
    instrument,
    days: daySet.size,
    bars: tagged.length,
    fromUnix: tagged[0]?.time ?? 0,
    toUnix: tagged[tagged.length - 1]?.time ?? 0,
    trades,
    summary: summarizeAuctionTrades(trades, instrument),
    bySide: {
      LONG: summarizeAuctionTrades(
        trades.filter((t) => t.side === 'LONG'),
        'LONG'
      ),
      SHORT: summarizeAuctionTrades(
        trades.filter((t) => t.side === 'SHORT'),
        'SHORT'
      ),
    },
    byRange: {
      '15M': summarizeAuctionTrades(
        trades.filter((t) => t.rangeFocus === '15M'),
        '15M'
      ),
      '30M': summarizeAuctionTrades(
        trades.filter((t) => t.rangeFocus === '30M'),
        '30M'
      ),
      IB: summarizeAuctionTrades(
        trades.filter((t) => t.rangeFocus === 'IB'),
        'IB'
      ),
    },
  }
}

/** Pine overlay colors — range orange, half-back gray, absorb buy/sell. */
export const AUCTION_COLORS = {
  range: '#f97316',
  mid: '#9ca3af',
  buy: '#22c55e',
  sell: '#b91c1c',
  entry: '#9ca3af',
  tp: '#22c55e',
  sl: '#ef4444',
} as const

export type AuctionRangeTag = AuctionRangeFocus | 'WAIT' | 'EXPIRED' | 'FORMING'

export type AuctionHud = {
  openType: AuctionOpenType
  rangeTag: AuctionRangeTag
  windowLabel: string
  canTradeWindow: boolean
  isLunch: boolean
  bias: 'Bullish (VWAP/EMA)' | 'Bearish (VWAP/EMA)' | 'Neutral/Chop'
  dailySignals: number
  maxDaily: number
  riskDollars: number
  engine: string
}

export type AuctionOverlaySignal = {
  time: number
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  rangeFocus: AuctionRangeFocus
  contracts: number
}

export type AuctionOverlay = {
  instrument: AuctionInstrument
  hud: AuctionHud
  rangeHigh: number | null
  rangeLow: number | null
  rangeMid: number | null
  showRange: boolean
  showMidpoint: boolean
  signals: AuctionOverlaySignal[]
  lastSignal: AuctionOverlaySignal | null
}

export type AuctionLineSpec = {
  price: number
  title: string
  color: string
  dashed?: boolean
  width: 1 | 2
}

function auctionWindowLabel(
  tag: AuctionRangeTag,
  nyMins: number,
  isLunch: boolean
): string {
  if (isLunch) return 'HIBERNATING (LUNCH)'
  if (tag === '15M') return '09:45 - 10:00 EST (15M Execution)'
  if (tag === '30M') return '10:00 - 10:30 EST (30M Execution)'
  if (tag === 'IB') return '10:30 - 11:30 EST (IB Execution)'
  if (nyMins >= 690) return 'Expired (Passed Morning Windows)'
  return 'Forming...'
}

function biasLabel(isUp: boolean, isDown: boolean): AuctionHud['bias'] {
  if (isUp) return 'Bullish (VWAP/EMA)'
  if (isDown) return 'Bearish (VWAP/EMA)'
  return 'Neutral/Chop'
}

/**
 * Live/sim as-of: during the walk, include bars through wall/last tip so the
 * HUD matches the Pine `barstate.islast` dashboard.
 */
export function resolveAuctionAsOfUnix(
  lastBarUnix: number | null | undefined,
  wallUnix: number
): number {
  const last =
    lastBarUnix != null && Number.isFinite(lastBarUnix) && lastBarUnix > 0
      ? lastBarUnix
      : wallUnix
  return Math.max(last, wallUnix)
}

/**
 * Chart overlay for the TradingView "auction" indicator: sequential range
 * H/L + half-back, absorb BUY/SELL markers, last-signal SL/TP, HUD.
 */
export function computeAuctionOverlay(args: {
  instrument: string
  candles: AuctionBar[]
  asOfUnix?: number
}): AuctionOverlay | null {
  if (!isAuctionInstrument(args.instrument)) return null
  const instrument = args.instrument
  const asOf = args.asOfUnix ?? Number.POSITIVE_INFINITY
  const sliced = (args.candles || []).filter(
    (c) =>
      c &&
      Number.isFinite(c.time) &&
      c.time <= asOf &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
  )
  const ran = runAuctionBacktest({
    instrument,
    candles: sliced,
    params: { rangeMode: 'sequential', allowShort: true, maxDaily: MAX_DAILY_SIGNALS },
  })

  const tagged = sliced
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((c) => ({ ...c, ...nyCivil(c.time) }))

  const emaAlpha = 2 / (EMA_LEN + 1)
  let yHigh: number | null = null
  let yLow: number | null = null
  let yClose: number | null = null
  let curDay = ''
  let dayHigh = NaN
  let dayLow = NaN
  let dayClose = NaN
  let wasRth = false
  let openType: AuctionOpenType = 'Analyzing...'
  let r15h: number | null = null
  let r15l: number | null = null
  let r30h: number | null = null
  let r30l: number | null = null
  let r60h: number | null = null
  let r60l: number | null = null
  let ema: number | null = null
  let vwapNum = 0
  let vwapDen = 0

  let activeH: number | null = null
  let activeL: number | null = null
  let canTradeWindow = false
  let rangeTag: AuctionRangeTag = 'WAIT'
  let nyMins = 0
  let isLunch = false
  let isUp = false
  let isDown = false

  for (let i = 0; i < tagged.length; i++) {
    const bar = tagged[i]!
    const isNewDay = bar.ymd !== curDay
    if (isNewDay) {
      if (curDay) {
        yHigh = dayHigh
        yLow = dayLow
        yClose = dayClose
      }
      curDay = bar.ymd
      dayHigh = bar.high
      dayLow = bar.low
      dayClose = bar.close
      r15h = r15l = r30h = r30l = r60h = r60l = null
      wasRth = false
      vwapNum = 0
      vwapDen = 0
    } else {
      dayHigh = Math.max(dayHigh, bar.high)
      dayLow = Math.min(dayLow, bar.low)
      dayClose = bar.close
    }

    nyMins = bar.mins
    const isRth = nyMins >= 570 && nyMins < 960
    isLunch = isRth && nyMins >= 720 && nyMins < 810
    const in15Build = nyMins >= 570 && nyMins < 585
    const in30Build = nyMins >= 570 && nyMins < 600
    const in1hBuild = nyMins >= 570 && nyMins < 630
    const in15Exec = nyMins >= 585 && nyMins < 600
    const in30Exec = nyMins >= 600 && nyMins < 630
    const in1hExec = nyMins >= 630 && nyMins < 690

    if (isRth && !wasRth && yHigh != null && yLow != null && yClose != null) {
      openType = classifyOpen(bar.open, yHigh, yLow, yClose).openType
    }
    wasRth = isRth

    if (in15Build) {
      r15h = r15h == null ? bar.high : Math.max(r15h, bar.high)
      r15l = r15l == null ? bar.low : Math.min(r15l, bar.low)
    }
    if (in30Build) {
      r30h = r30h == null ? bar.high : Math.max(r30h, bar.high)
      r30l = r30l == null ? bar.low : Math.min(r30l, bar.low)
    }
    if (in1hBuild) {
      r60h = r60h == null ? bar.high : Math.max(r60h, bar.high)
      r60l = r60l == null ? bar.low : Math.min(r60l, bar.low)
    }

    activeH = null
    activeL = null
    canTradeWindow = false
    rangeTag = nyMins >= 690 ? 'EXPIRED' : nyMins >= 570 ? 'FORMING' : 'WAIT'
    if (in15Exec) {
      activeH = r15h
      activeL = r15l
      canTradeWindow = r15h != null
      rangeTag = '15M'
    } else if (in30Exec) {
      activeH = r30h
      activeL = r30l
      canTradeWindow = r30h != null
      rangeTag = '30M'
    } else if (in1hExec) {
      activeH = r60h
      activeL = r60l
      canTradeWindow = r60h != null
      rangeTag = 'IB'
    } else if (nyMins >= 690 && r60h != null && r60l != null) {
      // Afternoon review — Pine hides the plot; keep IB so the button still shows structure.
      activeH = r60h
      activeL = r60l
    }

    const typical = (bar.high + bar.low + bar.close) / 3
    const vol = Math.max(bar.volume || 0, 1e-9)
    vwapNum += typical * vol
    vwapDen += vol
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : bar.close
    ema = ema == null ? bar.close : emaAlpha * bar.close + (1 - emaAlpha) * ema
    isUp = bar.close > vwap && bar.close > ema
    isDown = bar.close < vwap && bar.close < ema
  }

  const lastYmd = tagged.length ? tagged[tagged.length - 1]!.ymd : ''
  const signals: AuctionOverlaySignal[] = ran.trades
    .filter((t) => t.date === lastYmd)
    .map((t) => ({
      time: t.fillUnix,
      side: t.side,
      entry: t.entry,
      stop: t.stop,
      target: t.target,
      rangeFocus: t.rangeFocus,
      contracts: t.contracts,
    }))
  const lastSignal = signals.length ? signals[signals.length - 1]! : null
  const showRange = activeH != null && activeL != null
  const mid =
    showRange && activeH != null && activeL != null ? (activeH + activeL) / 2 : null

  return {
    instrument,
    hud: {
      openType,
      rangeTag,
      windowLabel: auctionWindowLabel(rangeTag, nyMins, isLunch),
      canTradeWindow,
      isLunch,
      bias: biasLabel(isUp, isDown),
      dailySignals: signals.length,
      maxDaily: MAX_DAILY_SIGNALS,
      riskDollars: ACCOUNT_SIZE * (RISK_PCT / 100),
      engine: 'Sequential Absorption Breakouts',
    },
    rangeHigh: showRange ? activeH : null,
    rangeLow: showRange ? activeL : null,
    rangeMid: mid,
    showRange,
    showMidpoint: showRange && mid != null,
    signals,
    lastSignal,
  }
}

export function auctionOverlayBadgeText(
  overlay: AuctionOverlay | null,
  visible: boolean
): string {
  if (!visible) return 'off'
  if (!overlay) return '—'
  if (overlay.hud.isLunch) return 'LUNCH'
  return overlay.hud.rangeTag
}

export function auctionOverlayPaintKey(
  visible: boolean,
  overlay: AuctionOverlay | null
): string {
  if (!visible) return 'off'
  if (!overlay) return 'empty'
  const sig = overlay.lastSignal
  return [
    overlay.instrument,
    overlay.hud.rangeTag,
    overlay.hud.canTradeWindow ? '1' : '0',
    overlay.showRange ? overlay.rangeHigh : '',
    overlay.showRange ? overlay.rangeLow : '',
    overlay.showMidpoint ? overlay.rangeMid : '',
    sig ? `${sig.side}|${sig.time}|${sig.entry}|${sig.stop}|${sig.target}` : '',
    overlay.signals.length,
  ].join('|')
}

export function auctionOverlayLineSpecs(overlay: AuctionOverlay): AuctionLineSpec[] {
  const specs: AuctionLineSpec[] = []
  const tag =
    overlay.hud.rangeTag === '15M' ||
    overlay.hud.rangeTag === '30M' ||
    overlay.hud.rangeTag === 'IB'
      ? overlay.hud.rangeTag
      : overlay.hud.rangeTag === 'EXPIRED'
        ? 'IB'
        : overlay.hud.rangeTag
  if (overlay.showRange && overlay.rangeHigh != null) {
    specs.push({
      price: overlay.rangeHigh,
      title: `${tag} H`,
      color: AUCTION_COLORS.range,
      width: 2,
    })
  }
  if (overlay.showRange && overlay.rangeLow != null) {
    specs.push({
      price: overlay.rangeLow,
      title: `${tag} L`,
      color: AUCTION_COLORS.range,
      width: 2,
    })
  }
  if (overlay.showMidpoint && overlay.rangeMid != null) {
    specs.push({
      price: overlay.rangeMid,
      title: 'Half-Back',
      color: AUCTION_COLORS.mid,
      dashed: true,
      width: 1,
    })
  }
  const sig = overlay.lastSignal
  if (sig) {
    const side = sig.side === 'LONG' ? 'BUY' : 'SELL'
    specs.push({
      price: sig.entry,
      title: `[${sig.rangeFocus}] ABSORB ${side}`,
      color: AUCTION_COLORS.entry,
      dashed: true,
      width: 1,
    })
    specs.push({
      price: sig.target,
      title: '1.5R TP',
      color: AUCTION_COLORS.tp,
      width: 2,
    })
    specs.push({
      price: sig.stop,
      title: `SL · Qty ${sig.contracts}`,
      color: AUCTION_COLORS.sl,
      width: 2,
    })
  }
  return specs
}
