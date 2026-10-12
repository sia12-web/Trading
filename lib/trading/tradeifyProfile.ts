/**
 * Desk Risk Profile: Personal Futures Risk.
 */

import { PERSONAL_PROFILE_ID, TRADEIFY_PROFILE_ID } from '@/lib/trading/tradeifyGrowth50k'

export type DeskRiskProfile = 'personal_futures' | typeof TRADEIFY_PROFILE_ID

export const DESK_RISK_PROFILE_STORAGE_KEY = 'tradepulse.risk.profile'
export const DESK_RISK_PROFILE_EVENT = 'tradepulse-risk-profile'
export const DESK_RISK_PROFILE_COOKIE = 'tradepulse_risk_profile'

export function parseDeskRiskProfile(_raw?: string | null): DeskRiskProfile {
  return PERSONAL_PROFILE_ID
}

export function isTradeifyGrowth50k(raw?: string | null): boolean {
  if (raw == null) return true
  return parseDeskRiskProfile(raw) === PERSONAL_PROFILE_ID
}

export const isPersonalFutures = isTradeifyGrowth50k

export function mergeMoneyRiskProfile(
  _client?: string | null,
  _persisted?: string | null
): DeskRiskProfile {
  return PERSONAL_PROFILE_ID
}

export function getDeskRiskProfile(): DeskRiskProfile {
  return PERSONAL_PROFILE_ID
}

function applyLocalDeskRiskProfile(profile: DeskRiskProfile): void {
  try {
    localStorage.setItem(DESK_RISK_PROFILE_STORAGE_KEY, profile)
    writeRiskProfileCookie(profile)
    window.dispatchEvent(
      new CustomEvent(DESK_RISK_PROFILE_EVENT, { detail: { profile } })
    )
  } catch {
    /* private mode */
  }
}

export async function hydrateDeskRiskProfileFromServer(): Promise<DeskRiskProfile> {
  if (typeof window === 'undefined') return PERSONAL_PROFILE_ID
  applyLocalDeskRiskProfile(PERSONAL_PROFILE_ID)
  syncDeskRiskProfileToServer(PERSONAL_PROFILE_ID)
  return PERSONAL_PROFILE_ID
}

function writeRiskProfileCookie(profile: DeskRiskProfile): void {
  try {
    document.cookie = `${DESK_RISK_PROFILE_COOKIE}=${encodeURIComponent(profile)}; Path=/; Max-Age=31536000; SameSite=Lax`
  } catch {
    /* private mode */
  }
}

export function syncDeskRiskProfileToServer(profile: DeskRiskProfile = getDeskRiskProfile()): void {
  if (typeof window === 'undefined') return
  writeRiskProfileCookie(profile)
  void fetch('/api/trading/risk-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  }).catch(() => {})
}

export function setDeskRiskProfile(_profile?: DeskRiskProfile): void {
  if (typeof window === 'undefined') return
  applyLocalDeskRiskProfile(PERSONAL_PROFILE_ID)
  syncDeskRiskProfileToServer(PERSONAL_PROFILE_ID)
}
