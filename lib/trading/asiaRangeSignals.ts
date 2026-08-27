/**
 * Bar-by-bar port of the TradingView "Asia Range Signals (Dow / Gold)" indicator.
 * Montreal clock. Asia box 20:00–02:00 (lock bar excluded). Both stop orders
 * from 02:00 until 03:30. SL = Asia mid. TP = 1.5R. Flatten 10:25.
 */

export const ASIA_TZ = 'America/Toronto'
export const ASIA_OPEN_MINS = 20 * 60
export const ASIA_LOCK_MINS = 2 * 60
export const ASIA_FILL_CUTOFF_MINS = 3 * 60 + 30
export const ASIA_FLAT_MINS = 10 * 60 + 25
export const ASIA_LOCK_WINDOW_END_MINS = 8 * 60
export const ASIA_ACCOUNT = 50_000
export const ASIA_RISK_PCT = 1
export const ASIA_TP_R = 1.5

export type AsiaBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type AsiaInstrument = 'DOW' | 'GOLD'
export type AsiaSide = 'LONG' | 'SHORT'
export type AsiaExitReason = 'take_profit' | 'stop_hit' | 'flatten_1130' | 'two_way'
export type AsiaSkipReason = 'ok' | 'range_too_wide' | 'zero_range' | 'qty_zero' | 'no_fill' | 'two_way'

export type AsiaLevels = {
  asiaHigh: number
  asiaLow: number
  asiaRange: number
  asiaMid: number
  buyStop: number
  sellStop: number
  riskPts: number
  longRiskPts: number
  shortRiskPts: number
  longTp: number
  shortTp: number
}

export type AsiaTrade = {
  instrument: AsiaInstrument
  date: string
  side: AsiaSide
  asiaHigh: number
  asiaLow: number
  asiaRange: number
  asiaMid: number
  entry: number
  stop: number
  target: number
  riskPts: number
  contracts: number
  pointValue: number
  exit: number
  exitReason: AsiaExitReason
  pnl: number
  rMultiple: number
  fillUnix: number
  exitUnix: number
}

export type AsiaSession = {
  lockDate: string
  lockUnix: number
  asiaHigh: number
  asiaLow: number
  asiaRange: number
  asiaMid: number
  buyStop: number
  sellStop: number
  longTp: number
  shortTp: number
  riskPts: number
  contracts: number
  qualified: boolean
  skipReason: AsiaSkipReason
  trade: AsiaTrade | null
}

export type AsiaSummary = {
  key: string
  sessions: number
  qualified: number
  trades: number
  wins: number
  losses: number
  flatten: number
  winRate: number | null
  netPnl: number
  sumR: number
  expectR: number | null
  profitFactor: number | null
  maxDrawdown: number
}

export type AsiaBacktestResult = {
  instrument: AsiaInstrument
  bars: number
  fromUnix: number
  toUnix: number
  buffer: number
  bufferHigh: number
  bufferLow: number
  maxRange: number
  sessions: AsiaSession[]
  trades: AsiaTrade[]
  summary: AsiaSummary
  bySide: Record<AsiaSide, AsiaSummary>
  rangePercentiles: {
    p25: number
    p50: number
    p75: number
    p90: number
    min: number
    max: number
  } | null
}

const montrealFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ASIA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function montrealCivil(unix: number): { ymd: string; mins: number } {
  const parts = montrealFmt.formatToParts(new Date(unix * 1000))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '0'
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  const minute = parseInt(get('minute'), 10)
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    mins: hour * 60 + minute,
  }
}

export function asiaPreset(instrument: AsiaInstrument): {
  buffer: number
  pointValue: number
  label: string
} {
  if (instrument === 'DOW') {
    return { buffer: 20, pointValue: 0.5, label: 'MYM' }
  }
  return { buffer: 10, pointValue: 10, label: 'MGC' }
}

export function asiaSignalLevels(args: {
  asiaHigh: number
  asiaLow: number
  buffer?: number
  bufferHigh?: number
  bufferLow?: number
  tpR?: number
}): AsiaLevels {
  const tpR = args.tpR ?? ASIA_TP_R
  const bufferHigh = args.bufferHigh ?? args.buffer
  const bufferLow = args.bufferLow ?? args.buffer
  if (bufferHigh == null || bufferLow == null) {
    throw new Error('asiaSignalLevels requires buffer or bufferHigh/bufferLow')
  }
  const asiaRange = args.asiaHigh - args.asiaLow
  const asiaMid = (args.asiaHigh + args.asiaLow) / 2
  const buyStop = args.asiaHigh + bufferHigh
  const sellStop = args.asiaLow - bufferLow
  const longRiskPts = Math.abs(buyStop - asiaMid)
  const shortRiskPts = Math.abs(asiaMid - sellStop)
  const riskPts = Math.max(longRiskPts, shortRiskPts)
  return {
    asiaHigh: args.asiaHigh,
    asiaLow: args.asiaLow,
    asiaRange,
    asiaMid,
    buyStop,
    sellStop,
    riskPts,
    longRiskPts,
    shortRiskPts,
    longTp: buyStop + tpR * longRiskPts,
    shortTp: sellStop - tpR * shortRiskPts,
  }
}

export function asiaQty(
  riskPts: number,
  pointValue: number,
  account = ASIA_ACCOUNT,
  riskPct = ASIA_RISK_PCT
): number {
  const riskCash = account * (riskPct / 100)
  const unit = riskPts * pointValue
  if (!(unit > 0)) return 0
  return Math.floor(riskCash / unit)
}

export function summarizeAsiaTrades(
  trades: AsiaTrade[],
  key: string,
  sessionCount = 0,
  qualifiedCount = 0
): AsiaSummary {
  const wins = trades.filter((t) => t.exitReason === 'take_profit').length
  const losses = trades.filter((t) => t.exitReason === 'stop_hit' || t.exitReason === 'two_way').length
  const flatten = trades.filter((t) => t.exitReason === 'flatten_1130').length
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
    sessions: sessionCount,
    qualified: qualifiedCount,
    trades: n,
    wins,
    losses,
    flatten,
    winRate: n > 0 ? wins / n : null,
    netPnl,
    sumR,
    expectR: n > 0 ? sumR / n : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdown: maxDd,
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

function signedPnl(
  side: AsiaSide,
  entry: number,
  exit: number,
  contracts: number,
  pointValue: number
): number {
  const pts = side === 'LONG' ? exit - entry : entry - exit
  return pts * pointValue * contracts
}

function rOf(side: AsiaSide, entry: number, exit: number, riskPts: number): number {
  if (!(riskPts > 0)) return 0
  const pts = side === 'LONG' ? exit - entry : entry - exit
  return pts / riskPts
}

function makeTrade(args: {
  instrument: AsiaInstrument
  date: string
  side: AsiaSide
  levels: AsiaLevels
  entry: number
  exit: number
  exitReason: AsiaExitReason
  contracts: number
  pointValue: number
  fillUnix: number
  exitUnix: number
}): AsiaTrade {
  const sideRisk =
    args.side === 'LONG' ? args.levels.longRiskPts : args.levels.shortRiskPts
  const rMultiple =
    args.exitReason === 'stop_hit' || args.exitReason === 'two_way'
      ? -1
      : rOf(args.side, args.entry, args.exit, sideRisk)
  return {
    instrument: args.instrument,
    date: args.date,
    side: args.side,
    asiaHigh: args.levels.asiaHigh,
    asiaLow: args.levels.asiaLow,
    asiaRange: args.levels.asiaRange,
    asiaMid: args.levels.asiaMid,
    entry: args.entry,
    stop: args.levels.asiaMid,
    target: args.side === 'LONG' ? args.levels.longTp : args.levels.shortTp,
    riskPts: sideRisk,
    contracts: args.contracts,
    pointValue: args.pointValue,
    exit: args.exit,
    exitReason: args.exitReason,
    pnl: signedPnl(args.side, args.entry, args.exit, args.contracts, args.pointValue),
    rMultiple,
    fillUnix: args.fillUnix,
    exitUnix: args.exitUnix,
  }
}

function makeSession(args: {
  lockDate: string
  lockUnix: number
  levels: AsiaLevels
  contracts: number
  qualified: boolean
  skipReason: AsiaSkipReason
  trade: AsiaTrade | null
}): AsiaSession {
  return {
    lockDate: args.lockDate,
    lockUnix: args.lockUnix,
    asiaHigh: args.levels.asiaHigh,
    asiaLow: args.levels.asiaLow,
    asiaRange: args.levels.asiaRange,
    asiaMid: args.levels.asiaMid,
    buyStop: args.levels.buyStop,
    sellStop: args.levels.sellStop,
    longTp: args.levels.longTp,
    shortTp: args.levels.shortTp,
    riskPts: args.levels.riskPts,
    contracts: args.contracts,
    qualified: args.qualified,
    skipReason: args.skipReason,
    trade: args.trade,
  }
}

function closeOpenTrade(args: {
  instrument: AsiaInstrument
  date: string
  side: AsiaSide
  levels: AsiaLevels
  contracts: number
  pointValue: number
  entry: number
  fillUnix: number
  bars: AsiaBar[]
  startIndex: number
}): AsiaTrade {
  const stop = args.levels.asiaMid
  const target = args.side === 'LONG' ? args.levels.longTp : args.levels.shortTp

  for (let i = args.startIndex; i < args.bars.length; i++) {
    const bar = args.bars[i]!
    const { mins } = montrealCivil(bar.time)
    const prevMins = i > 0 ? montrealCivil(args.bars[i - 1]!.time).mins : NaN
    const flatTime =
      mins >= ASIA_FLAT_MINS &&
      mins < ASIA_OPEN_MINS &&
      (Number.isNaN(prevMins) || prevMins < ASIA_FLAT_MINS)

    const hitStop = args.side === 'LONG' ? bar.low <= stop : bar.high >= stop
    const hitTp = args.side === 'LONG' ? bar.high >= target : bar.low <= target

    if (hitStop) {
      return makeTrade({
        ...args,
        exit: stop,
        exitReason: 'stop_hit',
        exitUnix: bar.time,
      })
    }
    if (hitTp) {
      return makeTrade({
        ...args,
        exit: target,
        exitReason: 'take_profit',
        exitUnix: bar.time,
      })
    }
    if (flatTime) {
      return makeTrade({
        ...args,
        exit: bar.open,
        exitReason: 'flatten_1130',
        exitUnix: bar.time,
      })
    }
  }

  const last = args.bars[args.bars.length - 1]!
  return makeTrade({
    ...args,
    exit: last.close,
    exitReason: 'flatten_1130',
    exitUnix: last.time,
  })
}

export function runAsiaRangeBacktest(args: {
  instrument: AsiaInstrument
  candles: AsiaBar[]
  maxRange: number
  buffer?: number
  bufferHigh?: number
  bufferLow?: number
  pointValue?: number
  tpR?: number
  account?: number
  riskPct?: number
  requireQty?: boolean
}): AsiaBacktestResult {
  const preset = asiaPreset(args.instrument)
  const bufferHigh = args.bufferHigh ?? args.buffer ?? preset.buffer
  const bufferLow = args.bufferLow ?? args.buffer ?? preset.buffer
  const buffer = Math.max(bufferHigh, bufferLow)
  const pointValue = args.pointValue ?? preset.pointValue
  const tpR = args.tpR ?? ASIA_TP_R
  const account = args.account ?? ASIA_ACCOUNT
  const riskPct = args.riskPct ?? ASIA_RISK_PCT
  const requireQty = args.requireQty !== false
  const maxRange = args.maxRange

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

  const sessions: AsiaSession[] = []
  const trades: AsiaTrade[] = []

  let asiaHigh = NaN
  let asiaLow = NaN
  let live = false
  let pending: AsiaLevels | null = null
  let pendingContracts = 0
  let lockDate = ''
  let lockUnix = 0
  let lockIndex = -1

  const finishUnfilled = (reason: AsiaSkipReason) => {
    if (!pending || !live) {
      pending = null
      live = false
      return
    }
    sessions.push(
      makeSession({
        lockDate,
        lockUnix,
        levels: pending,
        contracts: pendingContracts,
        qualified: true,
        skipReason: reason,
        trade: null,
      })
    )
    pending = null
    live = false
  }

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!
    const { ymd, mins } = montrealCivil(bar.time)
    const prevMins = i > 0 ? montrealCivil(candles[i - 1]!.time).mins : Number.NaN
    const asiaOpen = mins >= ASIA_OPEN_MINS && (Number.isNaN(prevMins) || prevMins < ASIA_OPEN_MINS)
    const inAsia = mins >= ASIA_OPEN_MINS || mins < ASIA_LOCK_MINS
    const crossedLock =
      mins >= ASIA_LOCK_MINS &&
      mins < ASIA_LOCK_WINDOW_END_MINS &&
      (Number.isNaN(prevMins) || prevMins < ASIA_LOCK_MINS || prevMins >= ASIA_OPEN_MINS)
    const fillCutoff =
      mins >= ASIA_FILL_CUTOFF_MINS &&
      mins < ASIA_FLAT_MINS &&
      (Number.isNaN(prevMins) || prevMins < ASIA_FILL_CUTOFF_MINS)

    if (asiaOpen) {
      finishUnfilled('no_fill')
      asiaHigh = bar.high
      asiaLow = bar.low
      live = false
      pending = null
    } else if (inAsia && Number.isFinite(asiaHigh)) {
      asiaHigh = Math.max(asiaHigh, bar.high)
      asiaLow = Math.min(asiaLow, bar.low)
    }

    if (crossedLock) {
      finishUnfilled('no_fill')
      const levels = asiaSignalLevels({ asiaHigh, asiaLow, bufferHigh, bufferLow, tpR })
      const qty = asiaQty(levels.riskPts, pointValue, account, riskPct)
      lockDate = ymd
      lockUnix = bar.time
      lockIndex = i
      if (!(levels.asiaRange > 0) || !Number.isFinite(levels.asiaRange)) {
        sessions.push(
          makeSession({
            lockDate,
            lockUnix,
            levels,
            contracts: qty,
            qualified: false,
            skipReason: 'zero_range',
            trade: null,
          })
        )
        pending = null
        live = false
      } else if (!(levels.asiaRange < maxRange)) {
        sessions.push(
          makeSession({
            lockDate,
            lockUnix,
            levels,
            contracts: qty,
            qualified: false,
            skipReason: 'range_too_wide',
            trade: null,
          })
        )
        pending = null
        live = false
      } else if (requireQty && qty < 1) {
        sessions.push(
          makeSession({
            lockDate,
            lockUnix,
            levels,
            contracts: qty,
            qualified: false,
            skipReason: 'qty_zero',
            trade: null,
          })
        )
        pending = null
        live = false
      } else {
        pending = levels
        pendingContracts = Math.max(1, qty)
        live = true
      }
    }

    if (live && fillCutoff) {
      finishUnfilled('no_fill')
    }

    if (live && pending && i > lockIndex && mins < ASIA_FILL_CUTOFF_MINS) {
      const hitBuy = bar.high >= pending.buyStop
      const hitSell = bar.low <= pending.sellStop
      if (hitBuy && hitSell) {
        const trade = makeTrade({
          instrument: args.instrument,
          date: lockDate,
          side: 'LONG',
          levels: pending,
          entry: pending.buyStop,
          exit: pending.asiaMid,
          exitReason: 'two_way',
          contracts: pendingContracts,
          pointValue,
          fillUnix: bar.time,
          exitUnix: bar.time,
        })
        sessions.push(
          makeSession({
            lockDate,
            lockUnix,
            levels: pending,
            contracts: pendingContracts,
            qualified: true,
            skipReason: 'two_way',
            trade,
          })
        )
        trades.push(trade)
        pending = null
        live = false
      } else if (hitBuy || hitSell) {
        const side: AsiaSide = hitBuy ? 'LONG' : 'SHORT'
        const rawEntry = side === 'LONG' ? pending.buyStop : pending.sellStop
        const gapped = side === 'LONG' ? bar.open > rawEntry : bar.open < rawEntry
        const entry = gapped ? bar.open : rawEntry
        const trade = closeOpenTrade({
          instrument: args.instrument,
          date: lockDate,
          side,
          levels: pending,
          contracts: pendingContracts,
          pointValue,
          entry,
          fillUnix: bar.time,
          bars: candles,
          startIndex: i,
        })
        sessions.push(
          makeSession({
            lockDate,
            lockUnix,
            levels: pending,
            contracts: pendingContracts,
            qualified: true,
            skipReason: 'ok',
            trade,
          })
        )
        trades.push(trade)
        pending = null
        live = false
        const exitAt = candles.findIndex((b) => b.time === trade.exitUnix)
        i = exitAt >= 0 ? exitAt : candles.length - 1
      }
    }
  }
  finishUnfilled('no_fill')

  const ranges = sessions
    .map((s) => s.asiaRange)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
  const qualified = sessions.filter((s) => s.qualified).length
  const summary = summarizeAsiaTrades(trades, args.instrument, sessions.length, qualified)
  return {
    instrument: args.instrument,
    bars: candles.length,
    fromUnix: candles[0]?.time || 0,
    toUnix: candles[candles.length - 1]?.time || 0,
    buffer,
    bufferHigh,
    bufferLow,
    maxRange,
    sessions,
    trades,
    summary,
    bySide: {
      LONG: summarizeAsiaTrades(
        trades.filter((t) => t.side === 'LONG'),
        'LONG',
        sessions.length,
        qualified
      ),
      SHORT: summarizeAsiaTrades(
        trades.filter((t) => t.side === 'SHORT'),
        'SHORT',
        sessions.length,
        qualified
      ),
    },
    rangePercentiles: ranges.length
      ? {
          min: ranges[0]!,
          p25: percentile(ranges, 0.25),
          p50: percentile(ranges, 0.5),
          p75: percentile(ranges, 0.75),
          p90: percentile(ranges, 0.9),
          max: ranges[ranges.length - 1]!,
        }
      : null,
  }
}

export function sweepMaxRange(
  collected: AsiaBacktestResult,
  maxRanges: number[]
): Array<AsiaSummary & { maxRange: number; fills: number; noFill: number }> {
  return maxRanges.map((cap) => {
    const sessions = collected.sessions.filter((s) => s.asiaRange > 0 && s.asiaRange < cap)
    const qualified = sessions.filter((s) => s.skipReason !== 'zero_range')
    const fills = qualified.map((s) => s.trade).filter((t): t is AsiaTrade => t != null)
    const noFill = qualified.filter((s) => s.skipReason === 'no_fill').length
    const summary = summarizeAsiaTrades(fills, `max<${cap}`, sessions.length, qualified.length)
    return { ...summary, maxRange: cap, fills: fills.length, noFill }
  })
}

/**
 * Latest Asia lock from M5 bars (no fill simulation). Used live for Telegram + chart OCO.
 */
export function lockLatestAsiaSession(args: {
  instrument: AsiaInstrument
  candles: AsiaBar[]
  maxRange: number
  buffer?: number
  bufferHigh?: number
  bufferLow?: number
  tpR?: number
  account?: number
  riskPct?: number
  requireQty?: boolean
  nowUnix?: number
}): AsiaSession | null {
  const preset = asiaPreset(args.instrument)
  const bufferHigh = args.bufferHigh ?? args.buffer ?? preset.buffer
  const bufferLow = args.bufferLow ?? args.buffer ?? preset.buffer
  const tpR = args.tpR ?? ASIA_TP_R
  const account = args.account ?? ASIA_ACCOUNT
  const riskPct = args.riskPct ?? ASIA_RISK_PCT
  const requireQty = args.requireQty !== false
  const maxRange = args.maxRange
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1000)

  const candles = (args.candles || [])
    .filter(
      (c) =>
        c &&
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.high >= c.low &&
        c.time <= nowUnix
    )
    .slice()
    .sort((a, b) => a.time - b.time)

  let asiaHigh = NaN
  let asiaLow = NaN
  let last: AsiaSession | null = null

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!
    const { ymd, mins } = montrealCivil(bar.time)
    const prevMins = i > 0 ? montrealCivil(candles[i - 1]!.time).mins : Number.NaN
    const asiaOpen = mins >= ASIA_OPEN_MINS && (Number.isNaN(prevMins) || prevMins < ASIA_OPEN_MINS)
    const inAsia = mins >= ASIA_OPEN_MINS || mins < ASIA_LOCK_MINS
    const crossedLock =
      mins >= ASIA_LOCK_MINS &&
      mins < ASIA_LOCK_WINDOW_END_MINS &&
      (Number.isNaN(prevMins) || prevMins < ASIA_LOCK_MINS || prevMins >= ASIA_OPEN_MINS)

    if (asiaOpen) {
      asiaHigh = bar.high
      asiaLow = bar.low
    } else if (inAsia && Number.isFinite(asiaHigh)) {
      asiaHigh = Math.max(asiaHigh, bar.high)
      asiaLow = Math.min(asiaLow, bar.low)
    }

    if (!crossedLock) continue

    const levels = asiaSignalLevels({ asiaHigh, asiaLow, bufferHigh, bufferLow, tpR })
    const qty = asiaQty(levels.riskPts, preset.pointValue, account, riskPct)
    let qualified = true
    let skipReason: AsiaSkipReason = 'ok'
    if (!(levels.asiaRange > 0) || !Number.isFinite(levels.asiaRange)) {
      qualified = false
      skipReason = 'zero_range'
    } else if (!(levels.asiaRange < maxRange)) {
      qualified = false
      skipReason = 'range_too_wide'
    } else if (requireQty && qty < 1) {
      qualified = false
      skipReason = 'qty_zero'
    }
    last = makeSession({
      lockDate: ymd,
      lockUnix: bar.time,
      levels,
      contracts: Math.max(qualified ? 1 : 0, qty),
      qualified,
      skipReason,
      trade: null,
    })
  }

  return last
}

export function bucketByRange(
  collected: AsiaBacktestResult,
  edges: number[]
): Array<AsiaSummary & { lo: number; hi: number; label: string }> {
  const rows: Array<AsiaSummary & { lo: number; hi: number; label: string }> = []
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!
    const hi = edges[i + 1]!
    const fills = collected.sessions
      .filter((s) => s.asiaRange >= lo && s.asiaRange < hi && s.trade)
      .map((s) => s.trade!)
    const label = `${lo}–${hi}`
    rows.push({
      ...summarizeAsiaTrades(fills, label, fills.length, fills.length),
      lo,
      hi,
      label,
    })
  }
  return rows
}
