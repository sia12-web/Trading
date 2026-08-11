/**
 * Desk rule: at most one working (unfilled) limit at a time per trade day / desk.
 */

export const WORKING_LIMIT_ALREADY_MESSAGE =
  'A working limit is already open — cancel it before placing another.'

export type WorkingLimitSummary = {
  instrument: string
  direction: string
  level: number
}

/**
 * Chart gate effect — whether to cancel / clear a working limit.
 *
 * Refresh/remount must NOT cancel: clockedOut alone on first observation is a
 * keep (hydrate the ghost). Only cancel on FLAT window gap, or a true clock-out
 * transition (was clocked in → now out). DONE/CLOSED clear local UI and let
 * cleanup-session expire.
 */
export function shouldCancelWorkingForGate(args: {
  phase: string
  clockedIn: boolean
  /** null = gate never observed yet this mount (refresh/hydrate). */
  hadClockedIn: boolean | null
  hasPending: boolean
}): 'keep' | 'cancel' | 'expire-via-cleanup' {
  if (!args.hasPending) return 'keep'

  const phaseBlocks =
    args.phase === 'FLAT' || args.phase === 'DONE' || args.phase === 'CLOSED'
  const clockedOutTransition =
    args.hadClockedIn === true && !args.clockedIn

  if (!phaseBlocks && !clockedOutTransition) return 'keep'
  if (args.phase === 'FLAT' || clockedOutTransition) return 'cancel'
  // DONE / CLOSED — clear local overlay; durable expire via cleanup-session
  return 'expire-via-cleanup'
}

/** User-facing block message — includes instrument + price when known. */
export function formatWorkingLimitAlreadyMessage(
  w?: WorkingLimitSummary | null
): string {
  if (!w?.instrument || !Number.isFinite(Number(w.level))) {
    return WORKING_LIMIT_ALREADY_MESSAGE
  }
  const dir = String(w.direction || '').toUpperCase()
  const lvl = Number(w.level).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })
  return `A ${dir} working limit on ${w.instrument} @ ${lvl} is already open — cancel it on the chart before placing another.`
}

/** API / DB row shape returned by GET /positions/working and 409 POST. */
export type WorkingLimitRow = {
  id?: string
  instrument: string
  entry_price: number
  entry_direction: string
  stop_loss_price?: number | null
  profit_target_price?: number | null
  position_size?: number | null
  risk_amount?: number | null
  account_size?: number | null
  entry_window?: number | null
  regime?: string | null
  regime_confidence?: number | null
  entry_timestamp?: string | null
  entry_reason?: string | null
  entry_source?: string | null
}

export const WORKING_SL_LOCKED_HINT = 'SL locked — sized at place'

/** Map durable working row → chart pending overlay (client). */
export function workingRowToPending(row: WorkingLimitRow): {
  instrument: 'DOW' | 'NASDAQ' | 'NIKKEI'
  level: number
  direction: 'LONG' | 'SHORT'
  stopLoss: number
  profitTarget: number
  positionSize: number
  riskAmount: number
  riskPercent: number
  accountSize: number
  entryWindow: 1 | 2 | 3
  regime: 'bullish' | 'bearish' | 'choppy'
  regimeConfidence: number
  placedAt: number
  entryReason?: string
  entrySource: 'ai' | 'structure' | 'manual'
  workingId?: string
} {
  const instrument = row.instrument as 'DOW' | 'NASDAQ' | 'NIKKEI'
  const level = Number(row.entry_price)
  const direction =
    String(row.entry_direction || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const stopLoss = Number(row.stop_loss_price)
  const profitTarget = Number(row.profit_target_price)
  const accountSize = Number(row.account_size) || 100_000
  const riskAmount = Number(row.risk_amount) || 0
  const ew = Number(row.entry_window)
  const entryWindow = (ew === 2 ? 2 : ew === 3 ? 3 : 1) as 1 | 2 | 3
  const regimeRaw = String(row.regime || 'bullish').toLowerCase()
  const regime =
    regimeRaw === 'bearish' || regimeRaw === 'choppy'
      ? (regimeRaw as 'bearish' | 'choppy')
      : 'bullish'
  const src = String(row.entry_source || 'ai').toLowerCase()
  const entrySource =
    src === 'manual' || src === 'structure' ? (src as 'manual' | 'structure') : 'ai'

  return {
    instrument,
    level,
    direction,
    stopLoss: Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : level * 0.99,
    profitTarget:
      Number.isFinite(profitTarget) && profitTarget > 0
        ? profitTarget
        : direction === 'LONG'
          ? level * 1.01
          : level * 0.99,
    positionSize: Number(row.position_size) || 1,
    riskAmount,
    riskPercent: accountSize > 0 ? (riskAmount / accountSize) * 100 : 1,
    accountSize,
    entryWindow,
    regime,
    regimeConfidence: Number(row.regime_confidence) || 70,
    placedAt: row.entry_timestamp ? Date.parse(row.entry_timestamp) : Date.now(),
    entryReason: row.entry_reason ?? undefined,
    entrySource,
    workingId: row.id ?? undefined,
  }
}
