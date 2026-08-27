/**
 * Persist Asia OCO overlays on desk_settings.asia_signals (plus process memory).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsiaDeskBook, AsiaDeskOverlay, AsiaInstrument } from '@/lib/trading/asiaDesk'
import { logger } from '@/lib/utils/logger'

type AsiaSignalsRow = {
  overlays?: AsiaDeskBook
  telegramKeys?: string[]
}

const g = globalThis as typeof globalThis & {
  __asiaDeskByUser?: Map<string, AsiaSignalsRow>
}

function memoryMap(): Map<string, AsiaSignalsRow> {
  if (!g.__asiaDeskByUser) g.__asiaDeskByUser = new Map()
  return g.__asiaDeskByUser
}

function parseRow(raw: unknown): AsiaSignalsRow {
  if (!raw || typeof raw !== 'object') return { overlays: {}, telegramKeys: [] }
  const row = raw as AsiaSignalsRow
  return {
    overlays: row.overlays && typeof row.overlays === 'object' ? row.overlays : {},
    telegramKeys: Array.isArray(row.telegramKeys) ? row.telegramKeys.filter((k) => typeof k === 'string') : [],
  }
}

export async function loadAsiaDeskBook(
  supabase: SupabaseClient | null | undefined,
  userId: string
): Promise<AsiaSignalsRow> {
  const mem = memoryMap().get(userId)
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('desk_settings')
        .select('asia_signals')
        .eq('user_id', userId)
        .maybeSingle()
      if (!error && data) {
        const parsed = parseRow((data as { asia_signals?: unknown }).asia_signals)
        memoryMap().set(userId, parsed)
        return parsed
      }
    } catch (err) {
      logger.warn('asia_desk.load_failed', { err })
    }
  }
  return mem ?? { overlays: {}, telegramKeys: [] }
}

export async function saveAsiaDeskBook(
  supabase: SupabaseClient | null | undefined,
  userId: string,
  next: AsiaSignalsRow
): Promise<void> {
  memoryMap().set(userId, next)
  if (!supabase || !userId) return
  try {
    const { data } = await supabase
      .from('desk_settings')
      .select('user_id, risk_profile')
      .eq('user_id', userId)
      .maybeSingle()
    if (data) {
      const { error } = await supabase
        .from('desk_settings')
        .update({ asia_signals: next, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
      if (error) logger.warn('asia_desk.update_failed', { err: error.message })
      return
    }
    const { error } = await supabase.from('desk_settings').insert({
      user_id: userId,
      asia_signals: next,
    })
    if (error) logger.warn('asia_desk.insert_failed', { err: error.message })
  } catch (err) {
    logger.warn('asia_desk.save_failed', { err })
  }
}

export async function upsertAsiaOverlay(
  supabase: SupabaseClient | null | undefined,
  userId: string,
  overlay: AsiaDeskOverlay
): Promise<AsiaSignalsRow> {
  const row = await loadAsiaDeskBook(supabase, userId)
  const overlays: AsiaDeskBook = { ...(row.overlays || {}), [overlay.instrument]: overlay }
  const next = { overlays, telegramKeys: row.telegramKeys || [] }
  await saveAsiaDeskBook(supabase, userId, next)
  return next
}

export function overlayForInstrument(
  row: AsiaSignalsRow,
  instrument: string | null | undefined
): AsiaDeskOverlay | null {
  if (instrument !== 'DOW' && instrument !== 'GOLD') return null
  return row.overlays?.[instrument as AsiaInstrument] ?? null
}

export async function claimAsiaTelegramKey(
  supabase: SupabaseClient | null | undefined,
  userId: string,
  key: string
): Promise<boolean> {
  const row = await loadAsiaDeskBook(supabase, userId)
  const keys = row.telegramKeys || []
  if (keys.includes(key)) return false
  const nextKeys = [...keys, key].slice(-80)
  await saveAsiaDeskBook(supabase, userId, {
    overlays: row.overlays || {},
    telegramKeys: nextKeys,
  })
  return true
}
