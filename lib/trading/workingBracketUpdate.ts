/**
 * Working-limit bracket amend — SL frozen at place; TP may move.
 * Shared by update-working-brackets API and unit tests.
 */

import {
  validateBracketUpdate,
  type BracketDirection,
  type BracketUpdateResult,
} from '@/lib/trading/bracketUpdate'

export const WORKING_SL_LOCKED_MESSAGE =
  'Stop loss is locked on working limits — sized at place time.'

export type WorkingBracketUpdateInput = {
  entryPrice: number
  direction: BracketDirection
  stopLossPrice?: number | null
  profitTargetPrice?: number | null
  currentStopLoss: number
  currentProfitTarget?: number | null
}

export type WorkingBracketUpdateResult =
  | (BracketUpdateResult & { ok: true; changedSl: false })
  | { ok: false; error: string; slLocked?: boolean }

/** Reject any SL amend; delegate TP validation to bracketUpdate. */
export function validateWorkingBracketUpdate(
  input: WorkingBracketUpdateInput
): WorkingBracketUpdateResult {
  const curSl = Number(input.currentStopLoss)
  const hasSl =
    input.stopLossPrice != null && Number.isFinite(Number(input.stopLossPrice))

  if (hasSl && Math.abs(Number(input.stopLossPrice) - curSl) > 1e-9) {
    return { ok: false, error: WORKING_SL_LOCKED_MESSAGE, slLocked: true }
  }

  const validated = validateBracketUpdate({
    entryPrice: input.entryPrice,
    direction: input.direction,
    profitTargetPrice: input.profitTargetPrice,
    currentStopLoss: curSl,
    currentProfitTarget: input.currentProfitTarget,
  })

  if (!validated.ok) return validated

  if (validated.changedSl) {
    return { ok: false, error: WORKING_SL_LOCKED_MESSAGE, slLocked: true }
  }

  if (!validated.changedTp) {
    return { ok: false, error: 'No change' }
  }

  return {
    ok: true,
    stopLossPrice: curSl,
    profitTargetPrice: validated.profitTargetPrice,
    changedSl: false,
    changedTp: true,
  }
}

/** Compare client SL to durable working row (defense on fill). */
export function assertWorkingStopLocked(
  clientStop: number,
  workingStop: number,
  entryPrice: number
): { ok: true } | { ok: false; error: string } {
  const tol = Math.max(entryPrice * 0.001, 0.5)
  if (Math.abs(clientStop - workingStop) > tol) {
    return { ok: false, error: WORKING_SL_LOCKED_MESSAGE }
  }
  return { ok: true }
}
