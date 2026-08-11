/**
 * Position sizing calculator
 * Live range-edge desk: progressive session risk 2% → 1% → 0.5%
 * (fill #1 / #2 / #3), win or loss — then session locks at 3 fills.
 * Formula: position_size = risk_amount / |entry - stop|
 */

import { logger } from '@/lib/utils/logger'
import { snapProfitToRound } from '@/lib/trading/deskLevels'
import type { PositionSizing, EntryDirection } from '@/types/trading'

/** @deprecated Prefer riskPercentForSessionAttempt */
export const DESK_RISK_PERCENT = 5
/** @deprecated Prefer riskPercentForSessionAttempt */
export const MANUAL_RISK_PERCENT = 1
/** Session fill #1 risk */
export const SESSION_RISK_FIRST_PERCENT = 2
/** Session fill #2 risk (after any W/L on #1) */
export const SESSION_RISK_SECOND_PERCENT = 1
/** Session fill #3 (last) risk */
export const SESSION_RISK_THIRD_PERCENT = 0.5
/**
 * Floor / last-probe risk — kept for callers that still import the old name.
 * Prefer {@link riskPercentForSessionAttempt}.
 */
export const RANGE_EDGE_RISK_PERCENT = SESSION_RISK_THIRD_PERCENT
const MAX_LOSS_PERCENT = 0.05 // 5% max loss per trade (default disaster stop)
/** With tight zone stops, cap exposure so risk-per-point can't blow up notional */
const MAX_NOTIONAL_MULT = 5

/**
 * Default reward multiple when SL moves: TP = entry ± R × |entry − stop|.
 * Magnets may seed the initial ticket TP; manual SL edits re-lock to this R.
 */
export const DEFAULT_TAKE_PROFIT_R = 2
/** Floor reward distance as a fraction of entry (same as sizing preview / strategy 2R fallback). */
export const MIN_TAKE_PROFIT_ENTRY_FRAC = 0.005

export type DeskEntrySource = 'ai' | 'structure' | 'manual'

/**
 * Recompute take-profit from stop distance at a fixed R-multiple.
 * Used when the trader drags/edits SL so TP tracks risk (not sticky magnets).
 */
export function takeProfitFromStopR(args: {
  entry: number
  stop: number
  direction: 'LONG' | 'SHORT' | 'long' | 'short'
  rMultiple?: number
}): number {
  const entry = Number(args.entry)
  const stop = Number(args.stop)
  const dir =
    String(args.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const r =
    args.rMultiple != null && Number.isFinite(args.rMultiple) && args.rMultiple > 0
      ? args.rMultiple
      : DEFAULT_TAKE_PROFIT_R
  if (!(entry > 0) || !Number.isFinite(stop)) return entry
  const risk = Math.abs(entry - stop)
  if (!(risk > 0)) return entry
  const rewardDistance = Math.max(risk * r, entry * MIN_TAKE_PROFIT_ENTRY_FRAC)
  return dir === 'LONG' ? entry + rewardDistance : entry - rewardDistance
}

/**
 * Progressive desk risk from how many session fills already landed
 * (working limits do not count until filled). Win/loss/breakeven all the same:
 *   0 fills → 2% (first probe)
 *   1 fill  → 1% (second)
 *   2+      → 0.5% (third / last before session lock)
 */
export function riskPercentForSessionAttempt(sessionFillsUsed?: number | null): number {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  if (used <= 0) return SESSION_RISK_FIRST_PERCENT
  if (used === 1) return SESSION_RISK_SECOND_PERCENT
  return SESSION_RISK_THIRD_PERCENT
}

/** Short chip: `Risk 2% (fill 1/3)` */
export function formatSessionRiskChip(sessionFillsUsed?: number | null): string {
  const used = Math.max(0, Math.floor(Number(sessionFillsUsed) || 0))
  const pct = riskPercentForSessionAttempt(used)
  const fillNum = Math.min(used + 1, 3)
  return `Risk ${pct}% (fill ${fillNum}/3)`
}

/**
 * Live desk entries (ai / structure / manual) share the same progressive ladder.
 * Pass today's filled attempt count so risk steps 2 → 1 → 0.5.
 */
export function riskPercentForEntrySource(
  _source?: DeskEntrySource | string | null,
  sessionFillsUsed?: number | null
): number {
  return riskPercentForSessionAttempt(sessionFillsUsed)
}

const MIN_ACCOUNT = 100
const MAX_ACCOUNT = 10_000_000

/**
 * Prefer server DESK_ACCOUNT_SIZE when set; otherwise clamp client value.
 * Prevents inflated account_size from inflating dollar risk (Sentinel M1).
 */
export function resolveDeskAccountSize(clientSize?: number | null): number | null {
  const envRaw = process.env.DESK_ACCOUNT_SIZE
  if (envRaw != null && String(envRaw).trim() !== '') {
    const envSize = Number(envRaw)
    if (Number.isFinite(envSize) && envSize >= MIN_ACCOUNT && envSize <= MAX_ACCOUNT) {
      return envSize
    }
  }
  if (typeof clientSize !== 'number' || !Number.isFinite(clientSize)) return null
  if (clientSize < MIN_ACCOUNT || clientSize > MAX_ACCOUNT) return null
  return clientSize
}

export function normalizeEntrySource(
  raw?: string | null,
  fallback: DeskEntrySource = 'ai'
): DeskEntrySource {
  if (raw === 'manual' || raw === 'structure' || raw === 'ai') return raw
  if (raw === 'chart_level') return 'ai'
  return fallback
}

export class PositionSizer {
  /**
   * Calculate position sizing from entry price and account size.
   * Default stop is ±5% from entry; pass `stopLossPrice` for a zone-based
   * stop (beyond the level's zone edge) — risk amount stays the same, the
   * position size adapts to the true stop distance.
   * Position size = risk_amount / (entry_price - stop_loss_price)
   */
  calculatePosition(
    entryPrice: number,
    accountSize: number,
    direction: EntryDirection,
    stopLossPrice?: number,
    riskPercent: number = RANGE_EDGE_RISK_PERCENT
  ): PositionSizing | null {
    // Validate inputs
    if (entryPrice <= 0) {
      logger.error('PositionSizer: Invalid entry price', { entryPrice })
      return null
    }

    if (accountSize <= 0) {
      logger.error('PositionSizer: Invalid account size', { accountSize })
      return null
    }

    const riskPct =
      Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : RANGE_EDGE_RISK_PERCENT
    const riskAmount = accountSize * (riskPct / 100)

    // Stop: custom (zone-based) if valid for the direction, else default ±5%
    const customStopValid =
      stopLossPrice != null &&
      stopLossPrice > 0 &&
      (direction === 'LONG' ? stopLossPrice < entryPrice : stopLossPrice > entryPrice)

    const stopLossPriceFinal = customStopValid
      ? stopLossPrice!
      : direction === 'LONG'
        ? entryPrice * (1 - MAX_LOSS_PERCENT)
        : entryPrice * (1 + MAX_LOSS_PERCENT)

    // Ensure stop loss is different from entry
    if (Math.abs(stopLossPriceFinal - entryPrice) < 0.01) {
      logger.error('PositionSizer: Stop loss too close to entry', {
        entryPrice,
        stopLossPrice: stopLossPriceFinal,
      })
      return null
    }

    // Calculate position size (capped so tight stops can't create runaway notional)
    const priceDistance = Math.abs(entryPrice - stopLossPriceFinal)
    let positionSize = riskAmount / priceDistance

    // For high-priced indices (JP225, US30, NAS100 with price > 1000), cap notional leverage to 1.5x account size
    const effectiveMaxMult = entryPrice > 1000 ? 1.5 : MAX_NOTIONAL_MULT
    const maxSize = (accountSize * effectiveMaxMult) / entryPrice
    if (positionSize > maxSize) positionSize = maxSize

    // Safety cap for high indices so unit size never triggers OANDA insufficient margin rejection
    if (entryPrice > 10000 && positionSize > 2.0) {
      positionSize = 2.0
    }

    // Validate position size
    if (positionSize <= 0 || !isFinite(positionSize)) {
      logger.error('PositionSizer: Invalid position size calculation', {
        riskAmount,
        priceDistance,
        positionSize,
      })
      return null
    }

    // Verify risk doesn't exceed max
    const maxRisk = positionSize * priceDistance
    const riskPercentActual = (maxRisk / accountSize) * 100

    if (riskPercentActual > riskPct + 0.1) {
      // Allow 0.1% tolerance for rounding
      logger.error('PositionSizer: Risk exceeds maximum', {
        riskPercent: riskPercentActual,
        maxRisk,
        accountSize,
        riskPct,
      })
      return null
    }

    logger.debug('PositionSizer: Position calculated', {
      entryPrice,
      stopLossPrice: stopLossPriceFinal,
      positionSize,
      riskAmount,
      riskPercent: riskPct,
      direction,
    })

    return {
      account_size: accountSize,
      risk_percent: riskPct,
      risk_amount: riskAmount,
      entry_price: entryPrice,
      stop_loss_price: stopLossPriceFinal,
      position_size: positionSize,
      direction,
    }
  }

  /**
   * Validate position sizing parameters
   */
  validatePositionSize(position: PositionSizing): boolean {
    if (position.account_size <= 0) {
      logger.error('PositionSizer: Invalid account size', { size: position.account_size })
      return false
    }

    if (position.entry_price <= 0) {
      logger.error('PositionSizer: Invalid entry price', { price: position.entry_price })
      return false
    }

    if (position.stop_loss_price <= 0) {
      logger.error('PositionSizer: Invalid stop loss', { price: position.stop_loss_price })
      return false
    }

    if (position.position_size <= 0) {
      logger.error('PositionSizer: Invalid position size', { size: position.position_size })
      return false
    }

    if (position.risk_amount <= 0) {
      logger.error('PositionSizer: Invalid risk amount', { amount: position.risk_amount })
      return false
    }

    // Verify stop loss is on correct side
    if (position.direction === 'LONG' && position.stop_loss_price >= position.entry_price) {
      logger.error('PositionSizer: LONG stop loss must be below entry')
      return false
    }

    if (position.direction === 'SHORT' && position.stop_loss_price <= position.entry_price) {
      logger.error('PositionSizer: SHORT stop loss must be above entry')
      return false
    }

    // Verify risk doesn't exceed account
    const maxRisk = position.position_size * Math.abs(position.entry_price - position.stop_loss_price)
    if (maxRisk > position.account_size) {
      logger.error('PositionSizer: Risk exceeds account size', { maxRisk, account: position.account_size })
      return false
    }

    return true
  }

  /**
   * Calculate P&L for closed position
   * CRITICAL: Guard against division by zero
   */
  calculatePnL(
    entryPrice: number,
    exitPrice: number,
    positionSize: number,
    direction: EntryDirection
  ): { profitLoss: number; profitLossPercent: number } {
    // CRITICAL FIX: Prevent division by zero
    if (entryPrice <= 0 || positionSize <= 0) {
      logger.error('PositionSizer.calculatePnL: Invalid parameters', {
        entryPrice,
        positionSize,
      })
      throw new Error(`Invalid parameters for P&L calculation: entryPrice=${entryPrice}, positionSize=${positionSize}`)
    }

    let profitLoss: number

    if (direction === 'LONG') {
      profitLoss = (exitPrice - entryPrice) * positionSize
    } else {
      profitLoss = (entryPrice - exitPrice) * positionSize
    }

    // Account value at entry = entryPrice * positionSize
    // P&L percent = (profitLoss / accountValueAtEntry) * 100
    const accountValueAtEntry = entryPrice * positionSize
    const profitLossPercent = (profitLoss / accountValueAtEntry) * 100

    return {
      profitLoss: Math.round(profitLoss * 100) / 100, // Round to 2 decimals
      profitLossPercent: Math.round(profitLossPercent * 100) / 100,
    }
  }
}

// Singleton instance
let positionSizerInstance: PositionSizer | null = null

export function getPositionSizer(): PositionSizer {
  if (!positionSizerInstance) {
    positionSizerInstance = new PositionSizer()
  }
  return positionSizerInstance
}

/**
 * Client-safe preview of the same sizing used by open-route.
 * Pass `stopLossPrice` (e.g. beyond the level's zone edge) for zone-based
 * risk — same risk amount, size adapts to the true stop distance.
 */
export function previewPositionSizing(
  entryPrice: number,
  accountSize: number,
  direction: EntryDirection,
  stopLossPrice?: number,
  riskPercent: number = RANGE_EDGE_RISK_PERCENT
): {
  stop_loss_price: number
  position_size: number
  risk_amount: number
  risk_percent: number
  notional: number
  profit_target_price: number
} | null {
  if (entryPrice <= 0 || accountSize <= 0) return null
  const riskPct =
    Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : RANGE_EDGE_RISK_PERCENT
  const risk_amount = accountSize * (riskPct / 100)

  const customStopValid =
    stopLossPrice != null &&
    stopLossPrice > 0 &&
    (direction === 'LONG' ? stopLossPrice < entryPrice : stopLossPrice > entryPrice)

  const stop_loss_price = customStopValid
    ? stopLossPrice!
    : direction === 'LONG'
      ? entryPrice * (1 - MAX_LOSS_PERCENT)
      : entryPrice * (1 + MAX_LOSS_PERCENT)

  const priceDistance = Math.abs(entryPrice - stop_loss_price)
  if (priceDistance < 0.01) return null
  let position_size = risk_amount / priceDistance
  const effectiveMaxMult = entryPrice > 1000 ? 1.5 : MAX_NOTIONAL_MULT
  const maxSize = (accountSize * effectiveMaxMult) / entryPrice
  if (position_size > maxSize) position_size = maxSize
  if (entryPrice > 10000 && position_size > 2.0) {
    position_size = 2.0
  }
  if (!Number.isFinite(position_size) || position_size <= 0) return null
  // Target: with a zone stop use 2R (risk-symmetric, min 0.5% move);
  // with the default disaster stop keep the classic 1% day-trade target
  const rawTarget = customStopValid
    ? takeProfitFromStopR({
        entry: entryPrice,
        stop: stop_loss_price,
        direction,
        rMultiple: DEFAULT_TAKE_PROFIT_R,
      })
    : direction === 'LONG'
      ? entryPrice * 1.01
      : entryPrice * 0.99
  const profit_target_price = snapProfitToRound(
    entryPrice,
    stop_loss_price,
    rawTarget,
    direction
  )
  return {
    stop_loss_price,
    position_size,
    risk_amount: position_size * priceDistance,
    risk_percent: riskPct,
    notional: position_size * entryPrice,
    profit_target_price,
  }
}
