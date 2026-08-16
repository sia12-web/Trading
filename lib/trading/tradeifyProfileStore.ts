/**
 * Server-readable desk risk profile (Slice 5).
 * Live desk is Tradeify Growth $50k only — cookie / hint / env cannot switch to OANDA.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { TRADEIFY_PROFILE_ID } from '@/lib/trading/tradeifyGrowth50k'
import {
  mergeMoneyRiskProfile,
  parseDeskRiskProfile,
  type DeskRiskProfile,
} from '@/lib/trading/tradeifyProfile'
import { logger } from '@/lib/utils/logger'

export const DESK_RISK_PROFILE_COOKIE = 'tradepulse_risk_profile'

const g = globalThis as typeof globalThis & {
  __deskRiskProfileByUser?: Map<string, DeskRiskProfile>
}

function memoryMap(): Map<string, DeskRiskProfile> {
  if (!g.__deskRiskProfileByUser) g.__deskRiskProfileByUser = new Map()
  return g.__deskRiskProfileByUser
}

export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('=') || '')
  }
  return null
}

export function riskProfileCookieHeader(profile: DeskRiskProfile): string {
  return `${DESK_RISK_PROFILE_COOKIE}=${encodeURIComponent(profile)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function rememberServerRiskProfile(userId: string, profile: DeskRiskProfile): void {
  if (!userId) return
  memoryMap().set(userId, profile)
}

export function readRememberedRiskProfile(userId: string): DeskRiskProfile | null {
  if (!userId) return null
  return memoryMap().get(userId) ?? null
}

function envRiskProfile(): DeskRiskProfile | null {
  const raw = process.env.DESK_RISK_PROFILE
  if (!raw) return null
  return parseDeskRiskProfile(raw)
}

export async function loadPersistedRiskProfile(
  supabase: SupabaseClient | null | undefined,
  userId: string
): Promise<DeskRiskProfile | null> {
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('desk_settings')
        .select('risk_profile')
        .eq('user_id', userId)
        .maybeSingle()
      if (!error && data) {
        const profile = parseDeskRiskProfile((data as { risk_profile?: string }).risk_profile)
        rememberServerRiskProfile(userId, profile)
        return profile
      }
    } catch (err) {
      logger.warn('tradeify.profile_load_failed', { err })
    }
  }
  return readRememberedRiskProfile(userId) ?? envRiskProfile()
}

export async function persistServerRiskProfile(
  supabase: SupabaseClient | null | undefined,
  userId: string,
  profile: DeskRiskProfile
): Promise<void> {
  rememberServerRiskProfile(userId, profile)
  if (!supabase || !userId) return
  try {
    const { error } = await supabase.from('desk_settings').upsert(
      {
        user_id: userId,
        risk_profile: profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    if (error) {
      logger.warn('tradeify.profile_persist_failed', { error: error.message })
    }
  } catch (err) {
    logger.warn('tradeify.profile_persist_failed', { err })
  }
}

/**
 * Money path is Tradeify only — stale OANDA cookie / hint cannot size 2%.
 */
export async function resolveMoneyRiskProfile(_args: {
  supabase?: SupabaseClient | null
  userId?: string | null
  hint?: string | null
  cookieHeader?: string | null
}): Promise<DeskRiskProfile> {
  return mergeMoneyRiskProfile(null, null)
}

export async function resolveDeskRiskProfileForUser(_args: {
  supabase?: SupabaseClient | null
  userId?: string | null
  hint?: string | null
  cookieHeader?: string | null
}): Promise<DeskRiskProfile> {
  return TRADEIFY_PROFILE_ID
}
