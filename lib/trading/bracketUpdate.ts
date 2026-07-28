/**
 * Validate SL/TP brackets relative to entry and direction.
 * Shared by update-brackets API and unit tests.
 */

export type BracketDirection = 'LONG' | 'SHORT' | 'long' | 'short'

export type BracketUpdateInput = {
  entryPrice: number
  direction: BracketDirection
  stopLossPrice?: number | null
  profitTargetPrice?: number | null
  currentStopLoss?: number | null
  currentProfitTarget?: number | null
}

export type BracketUpdateResult =
  | {
      ok: true
      stopLossPrice: number
      profitTargetPrice: number | null
      changedSl: boolean
      changedTp: boolean
    }
  | { ok: false; error: string }

function isLong(direction: BracketDirection): boolean {
  return direction === 'LONG' || direction === 'long'
}

export function validateBracketUpdate(input: BracketUpdateInput): BracketUpdateResult {
  const entry = Number(input.entryPrice)
  if (!Number.isFinite(entry) || entry <= 0) {
    return { ok: false, error: 'Invalid entry price' }
  }

  const hasSl = input.stopLossPrice != null && Number.isFinite(Number(input.stopLossPrice))
  const hasTp =
    input.profitTargetPrice != null && Number.isFinite(Number(input.profitTargetPrice))

  if (!hasSl && !hasTp) {
    return { ok: false, error: 'Provide stop_loss_price and/or profit_target_price' }
  }

  const long = isLong(input.direction)
  const nextSl = hasSl ? Number(input.stopLossPrice) : Number(input.currentStopLoss)
  const nextTp = hasTp
    ? Number(input.profitTargetPrice)
    : input.currentProfitTarget != null && Number.isFinite(Number(input.currentProfitTarget))
      ? Number(input.currentProfitTarget)
      : null

  if (!Number.isFinite(nextSl) || nextSl <= 0) {
    return { ok: false, error: 'Invalid stop loss' }
  }

  if (long) {
    if (!(nextSl < entry)) {
      return { ok: false, error: 'LONG stop loss must be below entry' }
    }
  } else if (!(nextSl > entry)) {
    return { ok: false, error: 'SHORT stop loss must be above entry' }
  }

  if (hasTp) {
    if (!Number.isFinite(nextTp!) || nextTp! <= 0) {
      return { ok: false, error: 'Invalid take profit' }
    }
    if (long) {
      if (!(nextTp! > entry)) {
        return { ok: false, error: 'LONG take profit must be above entry' }
      }
    } else if (!(nextTp! < entry)) {
      return { ok: false, error: 'SHORT take profit must be below entry' }
    }
  }

  const curSl = Number(input.currentStopLoss)
  const curTp =
    input.currentProfitTarget != null ? Number(input.currentProfitTarget) : null
  const changedSl = hasSl && Math.abs(nextSl - curSl) > 1e-9
  const changedTp =
    hasTp &&
    (curTp == null || !Number.isFinite(curTp) || Math.abs(nextTp! - curTp) > 1e-9)

  if (!changedSl && !changedTp) {
    return { ok: false, error: 'No change' }
  }

  return {
    ok: true,
    stopLossPrice: nextSl,
    profitTargetPrice: nextTp,
    changedSl: !!changedSl,
    changedTp: !!changedTp,
  }
}
