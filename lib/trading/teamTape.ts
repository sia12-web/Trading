/**
 * NYC team tape (Questrade) — see-only signals + leftover-fill advice.
 * A team stock fill never burns a Tradeify attempt. Your copy does.
 */

import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import {
  resolveTradeifyPlace,
  tradeifyMustFlatten,
  tradeifyRiskStepDollars,
  type TradeifyPlaceDecision,
  type TradeifyPlaceInput,
} from '@/lib/trading/tradeifyGrowth50k'

export const TEAM_TAPE_MAX_FILLS = 3

export type TeamTapeSide = 'BUY' | 'SELL'
export type TeamTapeStatus = 'working' | 'filled' | 'closed' | 'cancelled'

export type TeamTapeSignal = {
  sourceId: string
  symbol: string
  side: TeamTapeSide
  quantity: number
  entry: number
  stop: number | null
  target: number | null
  status: TeamTapeStatus
  filledAt?: string | null
}

export type TeamCopyAdvice = {
  canCopy: boolean
  fillsUsed: number
  fillsLeft: number
  nextFillNumber: number
  riskDollars: number
  clockedIn: boolean
  mustFlatten: boolean
  headline: string
  detail: string
  target1_5R: number | null
}

export function isTeamTapeSymbol(raw?: string | null): boolean {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
  if (!s || /\s/.test(s)) return false
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(s)
}

export function parseTeamTapeSide(raw?: string | null): TeamTapeSide | null {
  const s = String(raw || '').trim().toUpperCase()
  if (s === 'BUY' || s === 'LONG') return 'BUY'
  if (s === 'SELL' || s === 'SHORT') return 'SELL'
  return null
}

export function teamTapeTarget1_5R(args: {
  side: TeamTapeSide
  entry: number
  stop: number | null
}): number | null {
  const entry = Number(args.entry)
  const stop = Number(args.stop)
  if (!(entry > 0) || !(stop > 0)) return null
  const direction = args.side === 'SELL' ? 'SHORT' : 'LONG'
  const tp = takeProfitFromStopR({ entry, stop, direction })
  return tp > 0 && tp !== entry ? Math.round(tp * 100) / 100 : null
}

export function buildTeamCopyAdvice(args: {
  place: TradeifyPlaceDecision
  clockedIn: boolean
  now?: Date
}): TeamCopyAdvice {
  const now = args.now ?? new Date()
  const fillsUsed = Math.max(0, args.place.fillsUsed)
  const fillsLeft = Math.max(0, TEAM_TAPE_MAX_FILLS - fillsUsed)
  const mustFlatten = tradeifyMustFlatten(now) || args.place.refuseReason === 'must_flatten'
  const nextFillNumber = Math.min(fillsUsed + 1, TEAM_TAPE_MAX_FILLS)
  const riskDollars = args.place.allowed
    ? args.place.riskDollars
    : tradeifyRiskStepDollars(fillsUsed)

  if (mustFlatten) {
    return {
      canCopy: false,
      fillsUsed,
      fillsLeft,
      nextFillNumber,
      riskDollars,
      clockedIn: args.clockedIn,
      mustFlatten: true,
      headline: 'Do not copy. Flatten now.',
      detail:
        'Growth cannot hold overnight. Close Tradovate and cancel working orders (16:59 ET / 12:59 holiday).',
      target1_5R: null,
    }
  }
  if (!args.place.allowed || fillsLeft <= 0) {
    const why = args.place.refuseMessage || 'Session 3/3 or day locked.'
    return {
      canCopy: false,
      fillsUsed,
      fillsLeft,
      nextFillNumber,
      riskDollars,
      clockedIn: args.clockedIn,
      mustFlatten: false,
      headline: 'Do not copy — no Tradeify fill left.',
      detail: `${why} Team stock fills do not count until you place.`,
      target1_5R: null,
    }
  }
  if (!args.clockedIn) {
    return {
      canCopy: false,
      fillsUsed,
      fillsLeft,
      nextFillNumber,
      riskDollars,
      clockedIn: false,
      mustFlatten: false,
      headline: `Clock in first — ${fillsLeft} fill${fillsLeft === 1 ? '' : 's'} left.`,
      detail: `If you copy after clock-in this would be fill ${nextFillNumber}/3 at $${riskDollars}. One NYC index only (DOW or NASDAQ), same side. Do not copy their share count.`,
      target1_5R: null,
    }
  }
  return {
    canCopy: true,
    fillsUsed,
    fillsLeft,
    nextFillNumber,
    riskDollars,
    clockedIn: true,
    mustFlatten: false,
    headline: `You may copy — this would be fill ${nextFillNumber}/3.`,
    detail: `Then ${fillsLeft - 1} left. Size $${riskDollars} on DOW or NASDAQ (one only, same side). Close at 1.5R or flatten 16:59 ET. Their share count is not your size.`,
    target1_5R: null,
  }
}

export function teamCopyAdviceFromInput(
  input: TradeifyPlaceInput & { clockedIn: boolean }
): TeamCopyAdvice {
  const now = input.now ?? new Date()
  return buildTeamCopyAdvice({
    place: resolveTradeifyPlace(input),
    clockedIn: input.clockedIn,
    now,
  })
}

export function withSignalTarget(
  advice: TeamCopyAdvice,
  signal: TeamTapeSignal
): TeamCopyAdvice {
  return {
    ...advice,
    target1_5R:
      signal.target ??
      teamTapeTarget1_5R({
        side: signal.side,
        entry: signal.entry,
        stop: signal.stop,
      }),
  }
}

export function parseTeamTapeIngest(
  body: unknown
): { ok: true; signal: TeamTapeSignal } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON' }
  }
  const b = body as Record<string, unknown>
  const sourceId = String(b.sourceId || b.orderId || b.source_id || '').trim()
  if (!sourceId) return { ok: false, error: 'sourceId required' }
  const symbol = String(b.symbol || '').trim().toUpperCase()
  if (!isTeamTapeSymbol(symbol)) {
    return { ok: false, error: 'US stock symbol only (not options)' }
  }
  const side = parseTeamTapeSide(String(b.side || ''))
  if (!side) return { ok: false, error: 'side must be BUY or SELL' }
  const quantity = Number(b.quantity ?? b.qty)
  const entry = Number(b.entry ?? b.price ?? b.avgExecPrice)
  if (!(quantity > 0) || !(entry > 0)) {
    return { ok: false, error: 'quantity and entry required' }
  }
  const stopRaw = b.stop ?? b.stopPrice
  const targetRaw = b.target ?? b.takeProfit
  const stop =
    stopRaw == null || stopRaw === '' ? null : Number(stopRaw)
  const targetIn =
    targetRaw == null || targetRaw === '' ? null : Number(targetRaw)
  const statusRaw = String(b.status || 'filled').toLowerCase()
  const status: TeamTapeStatus =
    statusRaw === 'working' || statusRaw === 'closed' || statusRaw === 'cancelled'
      ? statusRaw
      : 'filled'
  const filledAt = b.filledAt || b.filled_at
    ? String(b.filledAt || b.filled_at)
    : null
  const stopOk = stop != null && Number.isFinite(stop) && stop > 0 ? stop : null
  const targetOk =
    targetIn != null && Number.isFinite(targetIn) && targetIn > 0
      ? Math.round(targetIn * 100) / 100
      : teamTapeTarget1_5R({ side, entry, stop: stopOk })
  return {
    ok: true,
    signal: {
      sourceId,
      symbol,
      side,
      quantity,
      entry,
      stop: stopOk,
      target: targetOk,
      status,
      filledAt,
    },
  }
}

export function formatTeamTelegram(args: {
  signal: TeamTapeSignal
  advice: TeamCopyAdvice
}): string {
  const s = args.signal
  const a = withSignalTarget(args.advice, s)
  const sl = s.stop != null ? String(s.stop) : '—'
  const tp = a.target1_5R != null ? String(a.target1_5R) : '—'
  return [
    `[TEAM] ${s.side} ${s.symbol} × ${s.quantity} @ ${s.entry}`,
    `SL ${sl} · 1.5R ${tp}`,
    a.headline,
    a.detail,
  ].join('\n')
}
