/**
 * Persist desk risk profile (OANDA cash vs Tradeify Growth $50k).
 * Client localStorage + cookie + POST /api/trading/risk-profile for Leo / Telegram.
 */

import { TRADEIFY_PROFILE_ID } from '@/lib/trading/tradeifyGrowth50k'

export type DeskRiskProfile = 'oanda_cash' | typeof TRADEIFY_PROFILE_ID

export const DESK_RISK_PROFILE_STORAGE_KEY = 'tradepulse.risk.profile'
export const DESK_RISK_PROFILE_EVENT = 'tradepulse-risk-profile'
export const DESK_RISK_PROFILE_COOKIE = 'tradepulse_risk_profile'

export function parseDeskRiskProfile(raw?: string | null): DeskRiskProfile {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (
    v === TRADEIFY_PROFILE_ID ||
    v === 'tradeify' ||
    v === 'tradeify_50k' ||
    v === 'growth_50k'
  ) {
    return TRADEIFY_PROFILE_ID
  }
  return 'oanda_cash'
}

export function isTradeifyGrowth50k(raw?: string | null): boolean {
  return parseDeskRiskProfile(raw) === TRADEIFY_PROFILE_ID
}

/** Tradeify wins if either side says so — never size 2% on a $50k eval. */
export function mergeMoneyRiskProfile(
  client?: string | null,
  persisted?: string | null
): DeskRiskProfile {
  if (isTradeifyGrowth50k(client) || isTradeifyGrowth50k(persisted)) {
    return TRADEIFY_PROFILE_ID
  }
  return 'oanda_cash'
}

export function getDeskRiskProfile(): DeskRiskProfile {
  if (typeof window === 'undefined') return 'oanda_cash'
  try {
    return parseDeskRiskProfile(localStorage.getItem(DESK_RISK_PROFILE_STORAGE_KEY))
  } catch {
    return 'oanda_cash'
  }
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

export function setDeskRiskProfile(profile: DeskRiskProfile): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DESK_RISK_PROFILE_STORAGE_KEY, profile)
    writeRiskProfileCookie(profile)
    window.dispatchEvent(
      new CustomEvent(DESK_RISK_PROFILE_EVENT, { detail: { profile } })
    )
  } catch {
    /* private mode */
  }
  syncDeskRiskProfileToServer(profile)
}
