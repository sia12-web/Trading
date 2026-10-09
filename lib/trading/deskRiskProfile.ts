/**
 * Desk Risk Profiles:
 * Personal Futures Desk Risk & Position Limits.
 */

export const DEFAULT_PERSONAL_BALANCE = 50_000
export const DEFAULT_RISK_PER_TRADE_DOLLARS = 50
export const PERSONAL_MAX_DAILY_FILLS = 5

export type DeskRiskProfile = 'personal_futures'

export const DESK_RISK_PROFILE_STORAGE_KEY = 'tradepulse.risk.profile'
export const DESK_RISK_PROFILE_EVENT = 'tradepulse-risk-profile'

export function parseDeskRiskProfile(_raw?: string | null): DeskRiskProfile {
  return 'personal_futures'
}

export function isTradeifyGrowth50k(_raw?: string | null): boolean {
  return false
}


export function getDeskRiskProfile(): DeskRiskProfile {
  return 'personal_futures'
}

export async function hydrateDeskRiskProfileFromServer(): Promise<DeskRiskProfile> {
  return 'personal_futures'
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
export const TRADEIFY_PROFILE_ID = 'personal_futures'
export function tradeifyMustFlatten(): boolean {
  return false
}
export function tradeifyFlattenOverridesKeepOpen(): boolean {
  return false
}
