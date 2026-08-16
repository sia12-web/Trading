/**
 * Desk risk profile. Live desk is Tradeify Growth $50k only — no OANDA switch.
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

/** Live money path is Tradeify only — never size OANDA 2% on this desk. */
export function mergeMoneyRiskProfile(
  _client?: string | null,
  _persisted?: string | null
): DeskRiskProfile {
  return TRADEIFY_PROFILE_ID
}

export function getDeskRiskProfile(): DeskRiskProfile {
  return TRADEIFY_PROFILE_ID
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

/** Overwrite a stale OANDA cookie / desk_settings row with Tradeify. */
export async function hydrateDeskRiskProfileFromServer(): Promise<DeskRiskProfile> {
  if (typeof window === 'undefined') return TRADEIFY_PROFILE_ID
  applyLocalDeskRiskProfile(TRADEIFY_PROFILE_ID)
  syncDeskRiskProfileToServer(TRADEIFY_PROFILE_ID)
  return TRADEIFY_PROFILE_ID
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
  applyLocalDeskRiskProfile(TRADEIFY_PROFILE_ID)
  syncDeskRiskProfileToServer(TRADEIFY_PROFILE_ID)
}
