/**
 * Desk Risk Profiles:
 * 1. TopstepX $1,500 Challenge (Prop firm copy-trading: +$1,500 target, -$500 max loss floor).
 * 2. Personal Futures Desk.
 */

import {
  computeTopstepXChallengeState,
  validateTopstepXOrderRisk,
  type TopstepXChallengeState,
} from './topstepXChallenge'

export const DEFAULT_PERSONAL_BALANCE = 50_000
export const DEFAULT_RISK_PER_TRADE_DOLLARS = 50 // TopstepX recommended risk per trade
export const PERSONAL_MAX_DAILY_FILLS = 5

export type DeskRiskProfile = 'topstepx_1500' | 'personal_futures'

export const DESK_RISK_PROFILE_STORAGE_KEY = 'tradepulse.risk.profile'
export const DESK_RISK_PROFILE_EVENT = 'tradepulse-risk-profile'

export function parseDeskRiskProfile(raw?: string | null): DeskRiskProfile {
  if (raw === 'personal_futures') return 'personal_futures'
  return 'topstepx_1500' // Default to active TopstepX Challenge
}

export function isTradeifyGrowth50k(_raw?: string | null): boolean {
  return false
}

export function isTopstepXChallenge(profile?: DeskRiskProfile | string | null): boolean {
  return !profile || profile === 'topstepx_1500'
}

export function getDeskRiskProfile(): DeskRiskProfile {
  if (typeof window === 'undefined') return 'topstepx_1500'
  try {
    const v = window.localStorage.getItem(DESK_RISK_PROFILE_STORAGE_KEY)
    return parseDeskRiskProfile(v)
  } catch {
    return 'topstepx_1500'
  }
}

export async function hydrateDeskRiskProfileFromServer(): Promise<DeskRiskProfile> {
  return getDeskRiskProfile()
}

export type PersonalPlaceDecision = {
  allowed: boolean
  fillsUsed: number
  riskDollars: number
  refuseReason: 'ok' | 'session_full' | 'breach_guard' | 'high_risk'
  refuseMessage: string
  copyCommand?: string
  remainingRoomAfterLoss?: number
}

export function resolveTopstepXPlace(args: {
  instrument: string
  entryPrice: number
  stopLossPrice: number
  quantity?: number
  currentState?: TopstepXChallengeState
  fillsUsed?: number
}): PersonalPlaceDecision {
  const { instrument, entryPrice, stopLossPrice, quantity = 1, currentState, fillsUsed = 0 } = args
  const state = currentState || computeTopstepXChallengeState()

  const riskCheck = validateTopstepXOrderRisk({
    instrument,
    entryPrice,
    stopLossPrice,
    quantity,
    currentState: state,
  })

  if (!riskCheck.allowed) {
    return {
      allowed: false,
      fillsUsed,
      riskDollars: riskCheck.dollarRisk,
      refuseReason: 'breach_guard',
      refuseMessage: riskCheck.warning || 'Exceeds TopstepX loss buffer to -$500 floor',
      copyCommand: riskCheck.copyCommand,
      remainingRoomAfterLoss: riskCheck.remainingRoomAfterLoss,
    }
  }

  return {
    allowed: true,
    fillsUsed,
    riskDollars: riskCheck.dollarRisk,
    refuseReason: riskCheck.warning ? 'high_risk' : 'ok',
    refuseMessage: riskCheck.warning || 'OK',
    copyCommand: riskCheck.copyCommand,
    remainingRoomAfterLoss: riskCheck.remainingRoomAfterLoss,
  }
}

export function resolvePersonalPlace(args: {
  fillsUsed?: number
  riskDollars?: number
}): PersonalPlaceDecision {
  const fills = args.fillsUsed ?? 0
  const risk = args.riskDollars ?? DEFAULT_RISK_PER_TRADE_DOLLARS

  return {
    allowed: true,
    fillsUsed: fills,
    riskDollars: risk,
    refuseReason: 'ok',
    refuseMessage: 'OK',
  }
}

/** Backward compatibility aliases */
export const resolveTradeifyPlace = resolvePersonalPlace
export const TRADEIFY_STARTING_BALANCE = DEFAULT_PERSONAL_BALANCE
export const TRADEIFY_PROFILE_ID = 'topstepx_1500'
export function tradeifyMustFlatten(): boolean {
  return false
}
export function tradeifyFlattenOverridesKeepOpen(): boolean {
  return false
}
