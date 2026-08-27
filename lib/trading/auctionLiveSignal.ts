/**
 * Live entrance notes for the auction book:
 *   DOW  — 15M volume-bar FAIL (wait 5, 1.5R)
 *   GOLD — IB absorb-breakout, both sides
 *   CRUDE — IB absorb-breakout, longs only
 *
 * Telegram + chart auto-place consume this. Session 3-fill and Tradeify
 * sizing stay on the existing working/open routes.
 */

import {
  nyCivil,
  runAuctionBacktest,
  type AuctionBar,
} from '@/lib/trading/auctionStrategy'
import { runVolumeBreakBacktest } from '@/lib/trading/auctionVolumeBreak'
import { NY_RISK_LADDER_DOLLARS, NY_TICKET_R } from '@/lib/trading/nyDeskStrategy'

export const AUCTION_TELEGRAM_KIND = 'auction_setup' as const

export const AUCTION_LIVE_INSTRUMENTS = ['DOW', 'GOLD', 'CRUDE'] as const
export type AuctionLiveInstrument = (typeof AUCTION_LIVE_INSTRUMENTS)[number]

const FIVE_MIN = 300
const LAST_BAR_GRACE_SEC = 15 * 60

export type AuctionLiveSignal = {
  instrument: AuctionLiveInstrument
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  fillUnix: number
  rangeLabel: 'Open range' | 'OR30' | 'IB'
  note: string
  telegram: string
}

export function isAuctionLiveInstrument(value: string): value is AuctionLiveInstrument {
  return (AUCTION_LIVE_INSTRUMENTS as readonly string[]).includes(value)
}

export function isAuctionTicketReason(reason?: string | null): boolean {
  return typeof reason === 'string' && /^AUCTION\b/i.test(reason.trim())
}

export function isAuctionTicketPayload(body: {
  auction_ticket?: unknown
  entry_reason?: unknown
  levelType?: unknown
}): boolean {
  if (body.auction_ticket === true) return true
  if (String(body.levelType || '') === 'auction') return true
  return isAuctionTicketReason(
    typeof body.entry_reason === 'string' ? body.entry_reason : null
  )
}

function playbookLabelForMins(mins: number): AuctionLiveSignal['rangeLabel'] {
  if (mins >= 630) return 'IB'
  if (mins >= 600) return 'OR30'
  return 'Open range'
}

function asBars(
  candles: Array<{
    time: number
    open: number
    high: number
    low: number
    close: number
    volume?: number
  }>
): AuctionBar[] {
  return candles
    .filter(
      (c) =>
        c &&
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    )
    .map((c) => ({
      time: Number(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Number.isFinite(c.volume) ? Number(c.volume) : 0,
    }))
}

function lastClosedBar(bars: AuctionBar[], nowUnix: number): AuctionBar | null {
  let last: AuctionBar | null = null
  for (const b of bars) {
    if (b.time + FIVE_MIN <= nowUnix) last = b
  }
  return last
}

function formatNote(args: {
  instrument: AuctionLiveInstrument
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  engineLine: string
}): string {
  return [
    `AUCTION ${args.instrument} ${args.side} · ${args.engineLine}`,
    `Entry ${args.entry.toLocaleString()} SL ${args.stop.toLocaleString()} TP ${args.target.toLocaleString()}.`,
  ].join(' ')
}

export function formatAuctionSetupTelegram(args: {
  instrument: AuctionLiveInstrument
  side: 'LONG' | 'SHORT'
  engineLine: string
  entry: number
  stop: number
  target: number
}): string {
  return [
    `SETUP ${args.instrument} · AUCTION ${args.side}`,
    args.engineLine,
    `Entry ${args.entry.toLocaleString()}  SL ${args.stop.toLocaleString()}  TP ${args.target.toLocaleString()}`,
    `Ticket: ${NY_TICKET_R}R · $${NY_RISK_LADDER_DOLLARS[0]}→$${NY_RISK_LADDER_DOLLARS[1]}→$${NY_RISK_LADDER_DOLLARS[2]} · session 3 fills`,
  ].join('\n')
}

function toSignal(args: {
  instrument: AuctionLiveInstrument
  side: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  fillUnix: number
  engineLine: string
}): AuctionLiveSignal | null {
  const slValid = args.side === 'LONG' ? args.stop < args.entry : args.stop > args.entry
  const tpValid = args.side === 'LONG' ? args.target > args.entry : args.target < args.entry
  if (!slValid || !tpValid) return null
  const rangeLabel = playbookLabelForMins(nyCivil(args.fillUnix).mins)
  return {
    instrument: args.instrument,
    side: args.side,
    entry: args.entry,
    stop: args.stop,
    target: args.target,
    fillUnix: args.fillUnix,
    rangeLabel,
    note: formatNote(args),
    telegram: formatAuctionSetupTelegram(args),
  }
}

/**
 * True when the latest closed 5m bar just printed an auction entrance.
 * NASDAQ is not in this book.
 */
export function evaluateAuctionLiveSignal(args: {
  instrument: string
  candles: Array<{
    time: number
    open: number
    high: number
    low: number
    close: number
    volume?: number
  }>
  nowUnix: number
}): AuctionLiveSignal | null {
  if (!isAuctionLiveInstrument(args.instrument)) return null
  const bars = asBars(args.candles)
  const last = lastClosedBar(bars, args.nowUnix)
  if (!last) return null
  const lastCiv = nyCivil(last.time)
  const nowCiv = nyCivil(args.nowUnix)
  if (lastCiv.ymd !== nowCiv.ymd) return null
  if (args.nowUnix - last.time > LAST_BAR_GRACE_SEC) return null

  const closed = bars.filter((b) => b.time <= last.time)
  if (closed.length < 20) return null

  if (args.instrument === 'DOW') {
    const ran = runVolumeBreakBacktest({
      instrument: 'DOW',
      candles: closed,
      params: {
        waitBars: 5,
        rr: 1.5,
        slBufferTicks: 5,
        rvolMult: 1.2,
        minRangeMult: 1.0,
        maxDaily: 3,
        onlyKind: 'FAIL',
        onlyRange: '15M',
        ignoreOccupancy: true,
      },
    })
    const t = ran.trades[ran.trades.length - 1]
    if (!t || t.fillUnix !== last.time) return null
    return toSignal({
      instrument: 'DOW',
      side: t.side,
      entry: t.entry,
      stop: t.stop,
      target: t.target,
      fillUnix: t.fillUnix,
      engineLine: '15M volume-bar FAIL — opposite-side break',
    })
  }

  const ran = runAuctionBacktest({
    instrument: args.instrument,
    candles: closed,
    params: {
      rangeMode: 'ib',
      allowShort: args.instrument !== 'CRUDE',
      rr: 1.5,
      maxDaily: 3,
      ignoreOccupancy: true,
    },
  })
  const t = ran.trades[ran.trades.length - 1]
  if (!t || t.fillUnix !== last.time) return null
  const crudeNote = args.instrument === 'CRUDE' ? ', longs only' : ', both sides'
  return toSignal({
    instrument: args.instrument,
    side: t.side,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    fillUnix: t.fillUnix,
    engineLine: `IB absorb-breakout${crudeNote}`,
  })
}
