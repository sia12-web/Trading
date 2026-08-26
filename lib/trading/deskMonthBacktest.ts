/**
 * Deterministic last-month desk replay on closed 5-minute CME bars.
 *
 * Uses the live ticket rules — not the Gemini OR15-breakout / 2R / daily-open
 * story:
 *   CALL LONG hunts range low ±10; SHORT hunts range high ±10.
 *   SL beyond the active range edge (strategyStopDetail). TP = 1.5R.
 *   Tradeify $400 → $250 → $150, max 3 fills, green lock +$700, 2 stop-outs.
 *   Dow Asia: 20:00–02:00 ET, range < 80 pts, buy/sell stop ±20, SL mid, 1.5R.
 *
 * CALL is computed from bars that closed *before* the current bar (no
 * lookahead). If stop and target both print in the same 5m bar, the replay
 * books a stop (conservative).
 */

import {
  cashOpenUnixForYmd,
  isWeekdayYmd,
  NY_DESK_CLOCK,
  zonedCivilToUnix,
} from '@/lib/chart/sessionVwap'
import { computeDeskCall, type DeskCallBar } from '@/lib/trading/deskCall'
import { resolveDeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
import {
  computeDowAsiaRangeEdge,
  selectDowAsiaSessionBars,
} from '@/lib/trading/dowAsiaRangeEdge'
import {
  snapDeskPrice,
  snapStopToTick,
  snapTargetToTick,
} from '@/lib/trading/instrumentTicks'
import { calculateFuturesContractSize } from '@/lib/trading/positionSizing'
import { RANGE_EDGE_BAND_POINTS } from '@/lib/trading/rangeEdgeEntryGate'
import { strategyEntryRisk } from '@/lib/trading/strategyRiskGeometry'
import {
  resolveTradeifyPlace,
  TRADEIFY_GREEN_DAY_LOCK_DOLLARS,
  TRADEIFY_MAX_STOP_OUTS,
  TRADEIFY_STARTING_BALANCE,
  tradeifyMustFlatten,
  tradeifyRiskStepDollars,
  tradeifySessionKey,
} from '@/lib/trading/tradeifyGrowth50k'
import { attemptLadderFromCounts } from '@/lib/trading/attemptLadder'

export type BtBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type BtInstrument = 'DOW' | 'NASDAQ'

export type BtSetup = 'ASIA' | 'OR15' | 'OR30' | 'IB'

export type BtExitReason = 'target' | 'stop' | 'flatten' | 'both_hit_stop'

export type BtTrade = {
  id: number
  sessionKey: string
  cashYmd: string
  instrument: BtInstrument
  setup: BtSetup
  side: 'LONG' | 'SHORT'
  entryUnix: number
  entry: number
  stop: number
  target: number
  exitUnix: number
  exit: number
  exitReason: BtExitReason
  contracts: number
  riskDollars: number
  pnl: number
  orHigh: number | null
  orLow: number | null
  note: string
}

export type BtSkip = {
  cashYmd: string
  reason: string
}

export type BtSessionSnap = {
  key: string
  fills: number
  stopOuts: number
  pnl: number
  locked: string | null
}

export type BtResult = {
  fromYmd: string
  toYmd: string
  startingEquity: number
  endingEquity: number
  trades: BtTrade[]
  skips: BtSkip[]
  sessions: BtSessionSnap[]
  conservativeBothHits: number
}

const ET = 'America/New_York'
const BAND = RANGE_EDGE_BAND_POINTS

function addYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

function listWeekdays(fromYmd: string, toYmd: string): string[] {
  const out: string[] = []
  let cur = fromYmd
  while (cur <= toYmd) {
    if (isWeekdayYmd(cur, ET)) out.push(cur)
    cur = addYmd(cur, 1)
  }
  return out
}

function validBar(b: BtBar): boolean {
  return (
    Number.isFinite(b.time) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  )
}

function sliceClosed(bars: BtBar[], asOfUnix: number, lookbackUnix: number): DeskCallBar[] {
  const out: DeskCallBar[] = []
  for (const b of bars) {
    if (b.time < lookbackUnix) continue
    if (b.time >= asOfUnix) break
    if (!validBar(b)) continue
    out.push({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 1,
    })
  }
  return out
}

function overnightRangePct(bars: BtBar[], fromUnix: number, toUnix: number): number {
  let hi = -Infinity
  let lo = Infinity
  for (const b of bars) {
    if (b.time < fromUnix || b.time >= toUnix || !validBar(b)) continue
    if (b.high > hi) hi = b.high
    if (b.low < lo) lo = b.low
  }
  if (!(hi > lo) || !Number.isFinite(hi)) return 0
  const mid = (hi + lo) / 2
  return mid > 0 ? (hi - lo) / mid : 0
}

function lockInstrument(args: {
  dow: BtBar[]
  nasdaq: BtBar[]
  cashYmd: string
}): BtInstrument {
  const prev = addYmd(args.cashYmd, -1)
  const from = zonedCivilToUnix(prev, 18, ET)
  const to = zonedCivilToUnix(args.cashYmd, 9.25, ET)
  const dowPct = overnightRangePct(args.dow, from, to)
  const nqPct = overnightRangePct(args.nasdaq, from, to)
  return nqPct >= dowPct ? 'NASDAQ' : 'DOW'
}

function setupFromMode(mode: string): BtSetup {
  if (mode === 'or30') return 'OR30'
  if (mode === 'ib') return 'IB'
  return 'OR15'
}

function bandFor(side: 'LONG' | 'SHORT', center: number): { min: number; max: number } {
  return { min: center - BAND, max: center + BAND }
}

function barTouches(bar: BtBar, min: number, max: number): boolean {
  return bar.low <= max && bar.high >= min
}

function fillAt(entry: number, bar: BtBar): number | null {
  if (bar.low <= entry && bar.high >= entry) return entry
  return null
}

function stopFillPrice(side: 'LONG' | 'SHORT', stop: number, bar: BtBar): number {
  if (side === 'LONG') return Math.min(stop, bar.open)
  return Math.max(stop, bar.open)
}

function targetFillPrice(side: 'LONG' | 'SHORT', target: number, bar: BtBar): number {
  if (side === 'LONG') return Math.max(target, Math.min(bar.high, target))
  return Math.min(target, Math.max(bar.low, target))
}

function resolveBarExit(args: {
  side: 'LONG' | 'SHORT'
  stop: number
  target: number
  bar: BtBar
}): { reason: BtExitReason; price: number } | null {
  const hitStop = args.side === 'LONG' ? args.bar.low <= args.stop : args.bar.high >= args.stop
  const hitTp = args.side === 'LONG' ? args.bar.high >= args.target : args.bar.low <= args.target
  if (hitStop && hitTp) {
    return { reason: 'both_hit_stop', price: stopFillPrice(args.side, args.stop, args.bar) }
  }
  if (hitStop) return { reason: 'stop', price: stopFillPrice(args.side, args.stop, args.bar) }
  if (hitTp) return { reason: 'target', price: targetFillPrice(args.side, args.target, args.bar) }
  return null
}

function signedPnl(
  instrument: BtInstrument,
  side: 'LONG' | 'SHORT',
  entry: number,
  exit: number,
  contracts: number
): number {
  const pts = side === 'LONG' ? exit - entry : entry - exit
  const pv = instrument === 'DOW' ? 0.5 : 2
  return Math.round(pts * pv * contracts * 100) / 100
}

type OpenBook = {
  id: number
  sessionKey: string
  cashYmd: string
  instrument: BtInstrument
  setup: BtSetup
  side: 'LONG' | 'SHORT'
  entryUnix: number
  entry: number
  stop: number
  target: number
  contracts: number
  riskDollars: number
  orHigh: number | null
  orLow: number | null
  note: string
}

type Working = {
  instrument: BtInstrument
  setup: BtSetup
  side: 'LONG' | 'SHORT'
  entry: number
  bandMin: number
  bandMax: number
  orHigh: number
  orLow: number
  windowEnd: number
  note: string
}

function windowEndUnix(cashYmd: string, mode: string): number {
  if (mode === 'morning') return zonedCivilToUnix(cashYmd, 10, ET)
  if (mode === 'or30') return zonedCivilToUnix(cashYmd, 10.5, ET)
  return zonedCivilToUnix(cashYmd, 15.25, ET)
}

export function replayDeskMonth(args: {
  dow: BtBar[]
  nasdaq: BtBar[]
  fromYmd: string
  toYmd: string
}): BtResult {
  const dow = args.dow.filter(validBar).sort((a, b) => a.time - b.time)
  const nasdaq = args.nasdaq.filter(validBar).sort((a, b) => a.time - b.time)
  const days = listWeekdays(args.fromYmd, args.toYmd)
  const trades: BtTrade[] = []
  const skips: BtSkip[] = []
  const sessionMap = new Map<string, BtSessionSnap>()
  let equity = TRADEIFY_STARTING_BALANCE
  let nextId = 1
  let conservativeBothHits = 0

  const sessionOf = (now: Date): BtSessionSnap => {
    const key = tradeifySessionKey(now)
    let s = sessionMap.get(key)
    if (!s) {
      s = { key, fills: 0, stopOuts: 0, pnl: 0, locked: null }
      sessionMap.set(key, s)
    }
    return s
  }

  const closeBook = (book: OpenBook, exitUnix: number, exit: number, reason: BtExitReason) => {
    const px = snapDeskPrice(book.instrument, exit)
    const pnl = signedPnl(book.instrument, book.side, book.entry, px, book.contracts)
    equity = Math.round((equity + pnl) * 100) / 100
    const sess = sessionMap.get(book.sessionKey)
    if (sess) {
      sess.pnl = Math.round((sess.pnl + pnl) * 100) / 100
      if (reason === 'stop' || reason === 'both_hit_stop') sess.stopOuts += 1
    }
    if (reason === 'both_hit_stop') conservativeBothHits += 1
    trades.push({
      id: book.id,
      sessionKey: book.sessionKey,
      cashYmd: book.cashYmd,
      instrument: book.instrument,
      setup: book.setup,
      side: book.side,
      entryUnix: book.entryUnix,
      entry: book.entry,
      stop: book.stop,
      target: book.target,
      exitUnix,
      exit: px,
      exitReason: reason,
      contracts: book.contracts,
      riskDollars: book.riskDollars,
      pnl,
      orHigh: book.orHigh,
      orLow: book.orLow,
      note: book.note,
    })
  }

  for (const cashYmd of days) {
    const openU = cashOpenUnixForYmd(cashYmd, NY_DESK_CLOCK)
    const flattenU = zonedCivilToUnix(cashYmd, 16 + 59 / 60, ET)
    const nyEnd = zonedCivilToUnix(cashYmd, 16, ET)
    const locked = lockInstrument({ dow, nasdaq, cashYmd })
    const series = locked === 'DOW' ? dow : nasdaq
    const nyNow = new Date(openU * 1000)
    const sess = sessionOf(nyNow)
    sess.locked = locked

    let book: OpenBook | null = null
    let working: Working | null = null
    let morningFills = 0
    let or30Fills = 0
    let ibFills = 0
    let morningStops = 0

    const asiaBars = selectDowAsiaSessionBars(dow, cashYmd)
    const asia = computeDowAsiaRangeEdge(asiaBars)
    if (!asia) {
      skips.push({ cashYmd, reason: `ASIA: not enough 20:00–02:00 ET MYM bars (${asiaBars.length})` })
    } else if (!asia.activeEdge) {
      skips.push({
        cashYmd,
        reason: `ASIA stand aside — range ${asia.asiaRange} pts ≥ 80 (H ${asia.asiaHigh} / L ${asia.asiaLow})`,
      })
    } else {
      const manageStart = zonedCivilToUnix(cashYmd, 2, ET)
      const manageBars = dow.filter((b) => b.time >= manageStart && b.time < openU)
      let asiaSide: 'LONG' | 'SHORT' | null = null
      let asiaFillBar: BtBar | null = null
      for (const bar of manageBars) {
        const hitLong = bar.high >= asia.buyStopPrice
        const hitShort = bar.low <= asia.sellStopPrice
        if (hitLong && hitShort) {
          skips.push({ cashYmd, reason: 'ASIA: both stops tagged in the same 5m bar — skipped' })
          asiaSide = null
          break
        }
        if (hitLong) {
          asiaSide = 'LONG'
          asiaFillBar = bar
          break
        }
        if (hitShort) {
          asiaSide = 'SHORT'
          asiaFillBar = bar
          break
        }
      }
      if (asiaSide && asiaFillBar) {
        const place = resolveTradeifyPlace({
          now: new Date(asiaFillBar.time * 1000),
          fillsUsed: sess.fills,
          dailyPnl: sess.pnl,
          equity,
          stopOutsToday: sess.stopOuts,
        })
        if (!place.allowed) {
          skips.push({ cashYmd, reason: `ASIA ${asiaSide} refused: ${place.refuseMessage}` })
        } else {
          const entry =
            asiaSide === 'LONG' ? asia.buyStopPrice : asia.sellStopPrice
          const stop = asia.asiaMid
          const target =
            asiaSide === 'LONG' ? asia.takeProfitPriceLong : asia.takeProfitPriceShort
          const sized = calculateFuturesContractSize('DOW', entry, stop, place.riskDollars)
          book = {
            id: nextId++,
            sessionKey: sess.key,
            cashYmd,
            instrument: 'DOW',
            setup: 'ASIA',
            side: asiaSide,
            entryUnix: asiaFillBar.time,
            entry: snapDeskPrice('DOW', entry),
            stop: snapStopToTick('DOW', entry, stop, asiaSide),
            target: snapTargetToTick('DOW', entry, target, asiaSide),
            contracts: sized.contracts,
            riskDollars: place.riskDollars,
            orHigh: asia.asiaHigh,
            orLow: asia.asiaLow,
            note: `Asia ${asia.asiaRange} pts < 80. Buy ${asia.buyStopPrice} / sell ${asia.sellStopPrice}.`,
          }
          sess.fills += 1
          const sameBar = resolveBarExit({
            side: book.side,
            stop: book.stop,
            target: book.target,
            bar: asiaFillBar,
          })
          if (sameBar && sameBar.reason !== 'target') {
            closeBook(book, asiaFillBar.time, sameBar.price, sameBar.reason)
            book = null
          } else {
            for (const later of dow) {
              if (later.time <= asiaFillBar.time) continue
              if (later.time >= openU) break
              const hit = resolveBarExit({
                side: book.side,
                stop: book.stop,
                target: book.target,
                bar: later,
              })
              if (hit) {
                closeBook(book, later.time, hit.price, hit.reason)
                book = null
                break
              }
            }
          }
        }
      } else if (asia && asia.activeEdge && !asiaFillBar) {
        skips.push({
          cashYmd,
          reason: `ASIA active (${asia.asiaRange} pts) but neither stop tagged before 09:30`,
        })
      }
    }

    const rth = series.filter((b) => b.time >= openU && b.time <= nyEnd)
    if (rth.length < 6) {
      skips.push({ cashYmd, reason: `${locked} RTH: only ${rth.length} 5m bars` })
      if (book) {
        const last = rth[rth.length - 1] ?? series[series.length - 1]
        if (last) closeBook(book, last.time, last.close, 'flatten')
        book = null
      }
      continue
    }

    for (const bar of rth) {
      const now = new Date(bar.time * 1000)
      if (book) {
        const hit = resolveBarExit({
          side: book.side,
          stop: book.stop,
          target: book.target,
          bar,
        })
        if (hit) {
          closeBook(book, bar.time, hit.price, hit.reason)
          if (book.setup === 'OR15' && (hit.reason === 'stop' || hit.reason === 'both_hit_stop')) {
            morningStops += 1
          }
          book = null
          working = null
        } else if (tradeifyMustFlatten(now) || bar.time >= flattenU) {
          closeBook(book, bar.time, bar.close, 'flatten')
          book = null
          working = null
          break
        }
        continue
      }

      if (tradeifyMustFlatten(now) || bar.time >= flattenU) break

      if (working && bar.time >= working.windowEnd) working = null

      const ladder = attemptLadderFromCounts({
        morningAttempts: morningFills,
        ibAttempts: or30Fills,
        lunchAttempts: ibFills,
        morningStopHits: morningStops,
        now,
        instrument: locked,
      })
      const mode = resolveDeskPlaybookMode({
        instrument: locked,
        now,
        ladder,
      })
      if (mode === 'done' || mode === 'lunch_break') {
        working = null
        continue
      }

      const lookbackU = openU - 36 * 3600
      const closed = sliceClosed(series, bar.time, lookbackU)
      const call = computeDeskCall({
        instrument: locked,
        candles: closed,
        asOfUnix: bar.time - 1,
        playbookMode: mode,
      })

      if (call.side === 'WAIT' || call.entryPrice == null || !call.rangeHigh || !call.rangeLow) {
        if (working && working.setup !== setupFromMode(mode)) working = null
        continue
      }

      const setup = setupFromMode(mode)
      const winEnd = windowEndUnix(cashYmd, mode)
      if (bar.time >= winEnd) {
        working = null
        continue
      }

      if (!working || working.side !== call.side || working.setup !== setup) {
        const center = call.entryPrice
        const band = bandFor(call.side, center)
        working = {
          instrument: locked,
          setup,
          side: call.side,
          entry: center,
          bandMin: band.min,
          bandMax: band.max,
          orHigh: call.rangeHigh,
          orLow: call.rangeLow,
          windowEnd: winEnd,
          note: `CALL ${call.rangeKey} ${call.side} · ${call.openingType} · ${call.controlLabel}`,
        }
      }

      if (!working || !barTouches(bar, working.bandMin, working.bandMax)) continue
      const fillPx = fillAt(working.entry, bar)
      if (fillPx == null) continue

      const place = resolveTradeifyPlace({
        now,
        fillsUsed: sess.fills,
        dailyPnl: sess.pnl,
        equity,
        stopOutsToday: sess.stopOuts,
      })
      if (!place.allowed) {
        skips.push({ cashYmd, reason: `${locked} ${working.setup} refused: ${place.refuseMessage}` })
        working = null
        continue
      }

      const risk = strategyEntryRisk({
        entry: fillPx,
        direction: working.side,
        activeRange: {
          label: working.setup,
          high: working.orHigh,
          low: working.orLow,
        },
      })
      const stop = snapStopToTick(locked, fillPx, risk.stop, working.side)
      const target = snapTargetToTick(locked, fillPx, risk.target, working.side)
      const sized = calculateFuturesContractSize(locked, fillPx, stop, place.riskDollars)

      book = {
        id: nextId++,
        sessionKey: sess.key,
        cashYmd,
        instrument: locked,
        setup: working.setup,
        side: working.side,
        entryUnix: bar.time,
        entry: snapDeskPrice(locked, fillPx),
        stop,
        target,
        contracts: sized.contracts,
        riskDollars: place.riskDollars,
        orHigh: working.orHigh,
        orLow: working.orLow,
        note: working.note,
      }
      sess.fills += 1
      if (working.setup === 'OR15') morningFills += 1
      else if (working.setup === 'OR30') or30Fills += 1
      else ibFills += 1
      working = null

      const same = resolveBarExit({
        side: book.side,
        stop: book.stop,
        target: book.target,
        bar,
      })
      if (same) {
        closeBook(book, bar.time, same.price, same.reason)
        if (book.setup === 'OR15' && (same.reason === 'stop' || same.reason === 'both_hit_stop')) {
          morningStops += 1
        }
        book = null
      }
    }

    if (book) {
      const last = rth[rth.length - 1]!
      closeBook(book, last.time, last.close, 'flatten')
    }
  }

  return {
    fromYmd: args.fromYmd,
    toYmd: args.toYmd,
    startingEquity: TRADEIFY_STARTING_BALANCE,
    endingEquity: equity,
    trades,
    skips,
    sessions: [...sessionMap.values()],
    conservativeBothHits,
  }
}

export function formatEt(unix: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(unix * 1000))
}

export function renderDeskBacktestMarkdown(
  result: BtResult,
  meta: { dowSymbol: string; nasdaqSymbol: string; barCountDow: number; barCountNasdaq: number }
): string {
  const wins = result.trades.filter((t) => t.pnl > 0)
  const losses = result.trades.filter((t) => t.pnl < 0)
  const flats = result.trades.filter((t) => t.pnl === 0)
  const net = Math.round((result.endingEquity - result.startingEquity) * 100) / 100
  const lines: string[] = []
  lines.push('# Last-month desk backtest (real 5-minute CME bars)')
  lines.push('')
  lines.push(
    `Replay of the **live TradePulse desk**, not the Gemini daily-open audit. Data: Yahoo Finance \`${meta.dowSymbol}\` (DOW / MYM) and \`${meta.nasdaqSymbol}\` (NASDAQ / MNQ), 5-minute Globex bars. Window **${result.fromYmd} → ${result.toYmd}** America/New_York.`
  )
  lines.push('')
  lines.push('## Rules actually used')
  lines.push('')
  lines.push('- One NY instrument per cash day: larger overnight range **percent** (18:00–09:15 ET) of MYM vs MNQ.')
  lines.push('- CALL from **closed bars only**. LONG limit = range **low**; SHORT limit = range **high**; fill only if that price trades inside ±10.')
  lines.push('- Stop beyond the range edge (`strategyEntryRisk`). Target **1.5R**. Risk **$400 → $250 → $150**. Session cap 3 fills. Green lock +$700. Two stop-outs lock the day.')
  lines.push('- Dow Asia: **20:00–02:00 ET**, range < 80 pts, buy stop high+20 / sell stop low−20, stop at midpoint, 1.5R. First tagged stop after 02:00; both-in-same-bar skipped.')
  lines.push('- If stop and target print in the same 5-minute bar, the replay books a **stop** (conservative).')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`| | |`)
  lines.push(`|---|---|`)
  lines.push(`| Starting equity | $${result.startingEquity.toLocaleString('en-US')}`)
  lines.push(`| Ending equity | $${result.endingEquity.toLocaleString('en-US')}`)
  lines.push(`| Net | ${net >= 0 ? '+' : ''}$${net.toLocaleString('en-US')}`)
  lines.push(`| Trades | ${result.trades.length} (${wins.length} wins / ${losses.length} losses / ${flats.length} flat)`)
  lines.push(`| Conservative same-bar stop+target | ${result.conservativeBothHits}`)
  lines.push(`| 5m bars | MYM ${meta.barCountDow} · MNQ ${meta.barCountNasdaq}`)
  lines.push('')
  lines.push('## Trades')
  lines.push('')
  lines.push(
    '| # | Cash day | ET time | Inst | Setup | Side | Entry | Stop | TP | Exit | Reason | Qty | Risk | P&L | OR H/L |'
  )
  lines.push('|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|')
  for (const t of result.trades) {
    const hl =
      t.orHigh != null && t.orLow != null
        ? `${t.orHigh} / ${t.orLow}`
        : '—'
    const pnl = `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`
    lines.push(
      `| ${t.id} | ${t.cashYmd} | ${formatEt(t.entryUnix)} | ${t.instrument} | ${t.setup} | ${t.side} | ${t.entry} | ${t.stop} | ${t.target} | ${t.exit} | ${t.exitReason} | ${t.contracts} | $${t.riskDollars} | ${pnl} | ${hl} |`
    )
  }
  if (result.trades.length === 0) {
    lines.push('| — | — | — | — | — | — | — | — | — | — | no fills | — | — | — | — |')
  }
  lines.push('')
  lines.push('## Skips / stand-asides')
  lines.push('')
  for (const s of result.skips) {
    lines.push(`- **${s.cashYmd}** — ${s.reason}`)
  }
  if (result.skips.length === 0) lines.push('- None.')
  lines.push('')
  lines.push('## How to re-run')
  lines.push('')
  lines.push('```bash')
  lines.push('npx tsx scripts/backtest-desk-last-month.ts')
  lines.push('```')
  lines.push('')
  lines.push(
    `Green-day lock threshold in code: +$${TRADEIFY_GREEN_DAY_LOCK_DOLLARS}. Max stop-outs: ${TRADEIFY_MAX_STOP_OUTS}. First-fill planned risk: $${tradeifyRiskStepDollars(0)}.`
  )
  lines.push('')
  return lines.join('\n')
}
