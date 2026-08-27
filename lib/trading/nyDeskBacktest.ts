/**
 * Bar-by-bar replay of the live NY desk strategy.
 * Uses computeDeskCall + strategyEntryRisk + the ticket ladder.
 * Does not invent fills, win rates, or prices.
 */

import {
  cashOpenUnixForYmd,
  deskClockFor,
  isWeekdayYmd,
} from '@/lib/chart/sessionVwap'
import { computeDeskCall, type DeskCallBar } from '@/lib/trading/deskCall'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
import { isNyCallSetup, NY_MAX_FILLS, NY_MAX_STOP_OUTS } from '@/lib/trading/nyDeskStrategy'
import { calculateFuturesContractSize } from '@/lib/trading/positionSizing'
import { RANGE_EDGE_BAND_POINTS } from '@/lib/trading/rangeEdgeEntryGate'
import { strategyEntryRisk } from '@/lib/trading/strategyRiskGeometry'
import {
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
  TRADEIFY_RISK_FIRST_DOLLARS,
  TRADEIFY_RISK_SECOND_DOLLARS,
  TRADEIFY_RISK_THIRD_DOLLARS,
} from '@/lib/trading/tradeifyGrowth50k'

export const NY_BACKTEST_INSTRUMENTS = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const
export type NyBacktestInstrument = (typeof NY_BACKTEST_INSTRUMENTS)[number]

export type NyBacktestBar = DeskCallBar

export type NyBacktestTrade = {
  instrument: NyBacktestInstrument
  date: string
  window: DeskPlaybookMode
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  riskDollars: number
  contracts: number
  exit: number
  exitReason: 'take_profit' | 'stop_hit' | 'eod'
  pnl: number
  rMultiple: number
  fillUnix: number
  exitUnix: number
}

export type NyBacktestSummary = {
  instrument: string
  days: number
  warmupDays: number
  trades: number
  wins: number
  losses: number
  eod: number
  winRate: number | null
  netPnl: number
  sumR: number
  expectR: number | null
  stopOutDays: number
}

const BAND = RANGE_EDGE_BAND_POINTS
const IB_ENTRY_END_SEC = 5 * 3600 + 45 * 60
/** Region uses 5 completed cash days; stay-out uses 10 day ranges. */
const CALL_LOOKBACK_DAYS = 10
const RISK = [
  TRADEIFY_RISK_FIRST_DOLLARS,
  TRADEIFY_RISK_SECOND_DOLLARS,
  TRADEIFY_RISK_THIRD_DOLLARS,
] as const

/** Civil YYYY-MM-DD in America/New_York for this Jun–Aug 2026 EDT tape. */
function edtYmd(unix: number): string {
  const d = new Date((unix - 4 * 3600) * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function groupCashDays(
  cashBars: NyBacktestBar[],
  timeZone: string
): { days: string[]; byDay: Map<string, NyBacktestBar[]> } {
  const byDay = new Map<string, NyBacktestBar[]>()
  for (const c of cashBars) {
    const ymd = edtYmd(c.time)
    const arr = byDay.get(ymd)
    if (arr) arr.push(c)
    else byDay.set(ymd, [c])
  }
  const days = Array.from(byDay.keys())
    .filter((ymd) => isWeekdayYmd(ymd, timeZone))
    .sort()
  return { days, byDay }
}

function histForDay(
  days: string[],
  d: number,
  byDay: Map<string, NyBacktestBar[]>
): NyBacktestBar[] {
  const from = Math.max(0, d - CALL_LOOKBACK_DAYS)
  const out: NyBacktestBar[] = []
  for (let i = from; i <= d; i++) {
    const bars = byDay.get(days[i]!)
    if (bars) out.push(...bars)
  }
  return out
}

function histEndingOn(
  ymd: string,
  instDays: string[],
  byDay: Map<string, NyBacktestBar[]>
): NyBacktestBar[] {
  const idx = instDays.indexOf(ymd)
  if (idx < 0) return byDay.get(ymd) || []
  return histForDay(instDays, idx, byDay)
}

/** NY cash 09:30–16:00. Dataset is Jun–Aug 2026 (EDT = UTC−4). */
function isNyCashBar(unix: number): boolean {
  const daySec = (((unix - 4 * 3600) % 86400) + 86400) % 86400
  return daySec >= 9 * 3600 + 30 * 60 && daySec < 16 * 3600
}

function playbookAtElapsed(elapsed: number): DeskPlaybookMode | null {
  if (elapsed < 15 * 60) return null
  if (elapsed < 30 * 60) return 'morning'
  if (elapsed < 60 * 60) return 'or30'
  if (elapsed < IB_ENTRY_END_SEC) return 'ib'
  return 'done'
}

function barTagsBand(
  bar: NyBacktestBar,
  center: number,
  band: number = BAND
): boolean {
  return bar.low <= center + band && bar.high >= center - band
}

function riskForFill(fillIndex: number): number {
  return RISK[Math.min(Math.max(fillIndex, 0), RISK.length - 1)]!
}

function closeOpenTrade(args: {
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  pointValue: number
  contracts: number
  fillBar: NyBacktestBar
  later: NyBacktestBar[]
  eodClose: number
  eodUnix: number
}): Pick<NyBacktestTrade, 'exit' | 'exitReason' | 'pnl' | 'rMultiple' | 'exitUnix'> {
  const { side, entry, stop, target, contracts, pointValue } = args
  const walk = [args.fillBar, ...args.later]
  const stopPnl = -Math.abs(entry - stop) * pointValue * contracts
  const tpPnl = Math.abs(target - entry) * pointValue * contracts
  const tpR =
    Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : 1.5
  for (const bar of walk) {
    const hitStop = side === 'LONG' ? bar.low <= stop : bar.high >= stop
    const hitTp = side === 'LONG' ? bar.high >= target : bar.low <= target
    if (hitStop) {
      return {
        exit: stop,
        exitReason: 'stop_hit',
        pnl: stopPnl,
        rMultiple: -1,
        exitUnix: bar.time,
      }
    }
    if (hitTp) {
      return {
        exit: target,
        exitReason: 'take_profit',
        pnl: tpPnl,
        rMultiple: tpR,
        exitUnix: bar.time,
      }
    }
  }
  const signed = args.side === 'LONG' ? 1 : -1
  const pts = (args.eodClose - entry) * signed
  const pnl = pts * pointValue * contracts
  const r =
    Math.abs(entry - stop) > 0 ? pts / Math.abs(entry - stop) : 0
  return {
    exit: args.eodClose,
    exitReason: 'eod',
    pnl,
    rMultiple: r,
    exitUnix: args.eodUnix,
  }
}

export function summarizeNyBacktestTrades(
  trades: NyBacktestTrade[],
  extra?: { instrument?: string; days?: number; warmupDays?: number }
): NyBacktestSummary {
  const wins = trades.filter((t) => t.exitReason === 'take_profit').length
  const losses = trades.filter((t) => t.exitReason === 'stop_hit').length
  const eod = trades.filter((t) => t.exitReason === 'eod').length
  const netPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const sumR = trades.reduce((s, t) => s + t.rMultiple, 0)
  const stopOutDays = new Set(
    trades.filter((t) => t.exitReason === 'stop_hit').map((t) => t.date)
  )
  const n = trades.length
  return {
    instrument: extra?.instrument ?? 'ALL',
    days: extra?.days ?? 0,
    warmupDays: extra?.warmupDays ?? 0,
    trades: n,
    wins,
    losses,
    eod,
    winRate: n > 0 ? wins / n : null,
    netPnl,
    sumR,
    expectR: n > 0 ? sumR / n : null,
    stopOutDays: stopOutDays.size,
  }
}

/**
 * Independent book: this name gets its own 3 fills / 2 stops per NY cash day.
 */
export function runNyDeskInstrumentBacktest(args: {
  instrument: NyBacktestInstrument
  candles: NyBacktestBar[]
  minWarmupDays?: number
  /** Last N traded days after warmup. Default: all. */
  lastSessions?: number
  stayOutEnabled?: boolean
}): {
  trades: NyBacktestTrade[]
  days: number
  warmupDays: number
  summary: NyBacktestSummary
} {
  const instrument = args.instrument
  const minWarmup = args.minWarmupDays ?? 5
  const stayOutEnabled = args.stayOutEnabled === true
  const clock = deskClockFor(instrument)
  const candles = (args.candles || [])
    .filter((c) => c && Number.isFinite(c.time) && Number.isFinite(c.high))
    .slice()
    .sort((a, b) => a.time - b.time)

  const cashBars = candles.filter((c) => isNyCashBar(c.time))
  const { days, byDay } = groupCashDays(cashBars, clock.timeZone)
  console.error(
    `  [${instrument}] bars ${candles.length} cash ${cashBars.length} days ${days.length}`
  )

  const trades: NyBacktestTrade[] = []
  let tradedDays = 0
  const firstTrade =
    args.lastSessions != null
      ? Math.max(minWarmup, days.length - args.lastSessions)
      : minWarmup

  for (let d = 0; d < days.length; d++) {
    const ymd = days[d]!
    if (d < firstTrade) continue
    tradedDays += 1
    const t0 = Date.now()
    const openU = cashOpenUnixForYmd(ymd, clock)
    const session = byDay.get(ymd) || []
    if (session.length < 8) continue

    let fills = 0
    let stops = 0
    let dayPnl = 0
    let i = 0
    let cachedMode: DeskPlaybookMode | null = null
    let cachedFills = -1
    let call: ReturnType<typeof computeDeskCall> | null = null
    const histBase = histForDay(days, d, byDay)
    while (i < session.length) {
      if (fills >= NY_MAX_FILLS || stops >= NY_MAX_STOP_OUTS) break
      if (dayPnl >= TRADEIFY_GREEN_DAY_LOCK_DOLLARS) break
      if (dayPnl <= -TRADEIFY_DLL_DOLLARS) break

      const bar = session[i]!
      const elapsed = bar.time - openU
      const mode = playbookAtElapsed(elapsed)
      if (!mode || mode === 'done') {
        i += 1
        continue
      }

      if (mode !== cachedMode || fills !== cachedFills) {
        const hist = histBase.filter((c) => c.time <= bar.time)
        call = computeDeskCall({
          instrument,
          candles: hist,
          asOfUnix: bar.time,
          playbookMode: mode,
          attemptsUsed: fills,
          stayOutEnabled,
        })
        cachedMode = mode
        cachedFills = fills
      }
      const center = call?.entryPrice
      const edge = call?.entryEdge
      if (
        !call ||
        !center ||
        !edge ||
        !isNyCallSetup({ side: call.side, edge, bookLocked: false }) ||
        !barTagsBand(bar, center)
      ) {
        i += 1
        continue
      }

      const range =
        call.rangeHigh != null && call.rangeLow != null
          ? {
              label: call.rangeKey || mode,
              high: call.rangeHigh,
              low: call.rangeLow,
            }
          : null
      const side = call.side as 'LONG' | 'SHORT'
      const riskDollars = riskForFill(fills)
      const strat = strategyEntryRisk({
        entry: center,
        direction: side,
        activeRange: range,
      })
      const sized = calculateFuturesContractSize(
        instrument,
        center,
        strat.stop,
        riskDollars
      )
      const later = session.slice(i + 1)
      const closed = closeOpenTrade({
        side,
        entry: center,
        stop: strat.stop,
        target: strat.target,
        pointValue: sized.pointValue,
        contracts: sized.contracts,
        fillBar: bar,
        later,
        eodClose: session[session.length - 1]!.close,
        eodUnix: session[session.length - 1]!.time,
      })
      trades.push({
        instrument,
        date: ymd,
        window: mode,
        side,
        entry: center,
        stop: strat.stop,
        target: strat.target,
        riskDollars,
        contracts: sized.contracts,
        exit: closed.exit,
        exitReason: closed.exitReason,
        pnl: closed.pnl,
        rMultiple: closed.rMultiple,
        fillUnix: bar.time,
        exitUnix: closed.exitUnix,
      })
      fills += 1
      dayPnl += closed.pnl
      if (closed.exitReason === 'stop_hit') stops += 1
      const exitIdx = session.findIndex((c) => c.time >= closed.exitUnix)
      i = exitIdx >= 0 ? exitIdx + 1 : session.length
    }
    console.error(
      `  [${instrument}] ${ymd}  ${tradedDays}/${days.length - minWarmup}  fills ${fills}  ${Date.now() - t0}ms`
    )
  }

  return {
    trades,
    days: tradedDays,
    warmupDays: Math.min(minWarmup, days.length),
    summary: summarizeNyBacktestTrades(trades, {
      instrument,
      days: tradedDays,
      warmupDays: Math.min(minWarmup, days.length),
    }),
  }
}

export function runNyDeskBoardBacktest(args: {
  candles: Record<NyBacktestInstrument, NyBacktestBar[]>
  minWarmupDays?: number
  lastSessions?: number
  stayOutEnabled?: boolean
}): {
  trades: NyBacktestTrade[]
  days: number
  warmupDays: number
  summary: NyBacktestSummary
} {
  const minWarmup = args.minWarmupDays ?? 5
  const stayOutEnabled = args.stayOutEnabled === true
  const clock = deskClockFor('DOW')
  const grouped = {
    DOW: groupCashDays(
      (args.candles.DOW || []).filter((c) => isNyCashBar(c.time)),
      clock.timeZone
    ),
    NASDAQ: groupCashDays(
      (args.candles.NASDAQ || []).filter((c) => isNyCashBar(c.time)),
      clock.timeZone
    ),
    GOLD: groupCashDays(
      (args.candles.GOLD || []).filter((c) => isNyCashBar(c.time)),
      clock.timeZone
    ),
    CRUDE: groupCashDays(
      (args.candles.CRUDE || []).filter((c) => isNyCashBar(c.time)),
      clock.timeZone
    ),
  }
  const daySet = new Set<string>()
  for (const inst of NY_BACKTEST_INSTRUMENTS) {
    for (const ymd of grouped[inst].days) daySet.add(ymd)
  }
  const days = Array.from(daySet).sort()
  const trades: NyBacktestTrade[] = []
  let tradedDays = 0
  const firstTrade =
    args.lastSessions != null
      ? Math.max(minWarmup, days.length - args.lastSessions)
      : minWarmup

  for (let d = 0; d < days.length; d++) {
    const ymd = days[d]!
    if (d < firstTrade) continue
    tradedDays += 1
    const t0 = Date.now()
    const openU = cashOpenUnixForYmd(ymd, clock)
    const sessions: Record<NyBacktestInstrument, NyBacktestBar[]> = {
      DOW: grouped.DOW.byDay.get(ymd) || [],
      NASDAQ: grouped.NASDAQ.byDay.get(ymd) || [],
      GOLD: grouped.GOLD.byDay.get(ymd) || [],
      CRUDE: grouped.CRUDE.byDay.get(ymd) || [],
    }
    const times = new Set<number>()
    for (const inst of NY_BACKTEST_INSTRUMENTS) {
      for (const b of sessions[inst]) times.add(b.time)
    }
    const timeline = Array.from(times).sort((a, b) => a - b)
    if (timeline.length < 8) continue

    const barAt = {
      DOW: new Map(sessions.DOW.map((b) => [b.time, b])),
      NASDAQ: new Map(sessions.NASDAQ.map((b) => [b.time, b])),
      GOLD: new Map(sessions.GOLD.map((b) => [b.time, b])),
      CRUDE: new Map(sessions.CRUDE.map((b) => [b.time, b])),
    }
    const histBase = {
      DOW: histEndingOn(ymd, grouped.DOW.days, grouped.DOW.byDay),
      NASDAQ: histEndingOn(ymd, grouped.NASDAQ.days, grouped.NASDAQ.byDay),
      GOLD: histEndingOn(ymd, grouped.GOLD.days, grouped.GOLD.byDay),
      CRUDE: histEndingOn(ymd, grouped.CRUDE.days, grouped.CRUDE.byDay),
    }
    let fills = 0
    let stops = 0
    let dayPnl = 0
    let cachedMode: DeskPlaybookMode | null = null
    let cachedFills = -1
    const callCache: Partial<
      Record<NyBacktestInstrument, ReturnType<typeof computeDeskCall>>
    > = {}
    let tPtr = 0
    while (tPtr < timeline.length) {
      if (fills >= NY_MAX_FILLS || stops >= NY_MAX_STOP_OUTS) break
      if (dayPnl >= TRADEIFY_GREEN_DAY_LOCK_DOLLARS) break
      if (dayPnl <= -TRADEIFY_DLL_DOLLARS) break

      const t = timeline[tPtr]!
      const elapsed = t - openU
      const mode = playbookAtElapsed(elapsed)
      if (!mode || mode === 'done') {
        tPtr += 1
        continue
      }

      if (mode !== cachedMode || fills !== cachedFills) {
        cachedMode = mode
        cachedFills = fills
        for (const inst of NY_BACKTEST_INSTRUMENTS) {
          if (sessions[inst].length === 0) {
            callCache[inst] = undefined
            continue
          }
          const hist = histBase[inst].filter((c) => c.time <= t)
          callCache[inst] = computeDeskCall({
            instrument: inst,
            candles: hist,
            asOfUnix: t,
            playbookMode: mode,
            attemptsUsed: fills,
            stayOutEnabled,
          })
        }
      }

      let taken: NyBacktestTrade | null = null
      for (const inst of NY_BACKTEST_INSTRUMENTS) {
        const bar = barAt[inst].get(t)
        if (!bar) continue
        const call = callCache[inst]
        const center = call?.entryPrice
        const edge = call?.entryEdge
        if (
          !call ||
          !center ||
          !edge ||
          !isNyCallSetup({ side: call.side, edge, bookLocked: false }) ||
          !barTagsBand(bar, center)
        ) {
          continue
        }
        const sess = sessions[inst]
        const range =
          call.rangeHigh != null && call.rangeLow != null
            ? {
                label: call.rangeKey || mode,
                high: call.rangeHigh,
                low: call.rangeLow,
              }
            : null
        const side = call.side as 'LONG' | 'SHORT'
        const riskDollars = riskForFill(fills)
        const strat = strategyEntryRisk({
          entry: center,
          direction: side,
          activeRange: range,
        })
        const sized = calculateFuturesContractSize(
          inst,
          center,
          strat.stop,
          riskDollars
        )
        const later = sess.filter((c) => c.time > t)
        const closed = closeOpenTrade({
          side,
          entry: center,
          stop: strat.stop,
          target: strat.target,
          pointValue: sized.pointValue,
          contracts: sized.contracts,
          fillBar: bar,
          later,
          eodClose: sess[sess.length - 1]?.close ?? bar.close,
          eodUnix: sess[sess.length - 1]?.time ?? bar.time,
        })
        taken = {
          instrument: inst,
          date: ymd,
          window: mode,
          side,
          entry: center,
          stop: strat.stop,
          target: strat.target,
          riskDollars,
          contracts: sized.contracts,
          exit: closed.exit,
          exitReason: closed.exitReason,
          pnl: closed.pnl,
          rMultiple: closed.rMultiple,
          fillUnix: t,
          exitUnix: closed.exitUnix,
        }
        break
      }

      if (!taken) {
        tPtr += 1
        continue
      }
      trades.push(taken)
      fills += 1
      dayPnl += taken.pnl
      if (taken.exitReason === 'stop_hit') stops += 1
      while (tPtr < timeline.length && timeline[tPtr]! <= taken.exitUnix) {
        tPtr += 1
      }
    }
    console.error(
      `  [BOARD] ${ymd}  ${tradedDays}/${days.length - minWarmup}  fills ${fills}  ${Date.now() - t0}ms`
    )
  }

  return {
    trades,
    days: tradedDays,
    warmupDays: Math.min(minWarmup, days.length),
    summary: summarizeNyBacktestTrades(trades, {
      instrument: 'BOARD',
      days: tradedDays,
      warmupDays: Math.min(minWarmup, days.length),
    }),
  }
}
