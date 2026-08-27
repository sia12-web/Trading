/**
 * Scan OANDA M5 for the locked Asia recipes, persist overlays, Telegram once per event.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import {
  applyCmeBasisToCandles,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
} from '@/lib/trading/cmeBasis'
import {
  ASIA_DESK_INSTRUMENTS,
  asiaTelegramKey,
  evaluateAsiaDeskOverlay,
  formatAsiaDeskTelegram,
  type AsiaDeskOverlay,
  type AsiaInstrument,
} from '@/lib/trading/asiaDesk'
import {
  claimAsiaTelegramKey,
  loadAsiaDeskBook,
  upsertAsiaOverlay,
} from '@/lib/trading/asiaDeskStore'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'

export type AsiaScanResult = {
  overlays: Partial<Record<AsiaInstrument, AsiaDeskOverlay>>
  telegram: Array<{ instrument: AsiaInstrument; event: string; sent: boolean; skipped?: string }>
}

async function candlesFor(instrument: AsiaInstrument) {
  await warmCmeBasis(instrument as Instrument).catch(() => null)
  const pack = await getOandaCandles(instrument as Instrument, '5', 2)
  if (!pack?.candles?.length) return []
  const basis = getCmeBasis(instrument as Instrument) ?? getLastKnownCmeBasis(instrument as Instrument)
  return applyCmeBasisToCandles(pack.candles, basis)
}

export async function runAsiaDeskScan(args: {
  supabase: SupabaseClient | null
  userId: string
  now?: Date
  notify?: boolean
}): Promise<AsiaScanResult> {
  const now = args.now ?? new Date()
  const overlays: Partial<Record<AsiaInstrument, AsiaDeskOverlay>> = {}
  const telegram: AsiaScanResult['telegram'] = []

  for (const instrument of ASIA_DESK_INSTRUMENTS) {
    try {
      const candles = await candlesFor(instrument)
      const overlay = evaluateAsiaDeskOverlay({
        instrument,
        candles,
        now,
        source: 'oanda',
      })
      if (!overlay) continue
      overlays[instrument] = overlay
      await upsertAsiaOverlay(args.supabase, args.userId, overlay)
      if (!args.notify) continue
      const text = formatAsiaDeskTelegram(overlay)
      if (!text) continue
      const key = asiaTelegramKey(overlay)
      const stored = await loadAsiaDeskBook(args.supabase, args.userId)
      if ((stored.telegramKeys || []).includes(key)) {
        telegram.push({ instrument, event: overlay.event, sent: false, skipped: 'deduped' })
        continue
      }
      const sent = await sendTelegramMessage(text)
      if (sent.ok && !sent.skipped) {
        await claimAsiaTelegramKey(args.supabase, args.userId, key)
        telegram.push({ instrument, event: overlay.event, sent: true })
      } else {
        telegram.push({
          instrument,
          event: overlay.event,
          sent: false,
          skipped: sent.ok ? sent.reason : sent.error,
        })
      }
    } catch (err) {
      logger.warn('asia_desk.scan_instrument_failed', { instrument, err })
    }
  }

  const stored = await loadAsiaDeskBook(args.supabase, args.userId)
  return {
    overlays: { ...(stored.overlays || {}), ...overlays },
    telegram,
  }
}

export async function runAsiaDeskScanForDeskUser(now: Date = new Date()): Promise<AsiaScanResult | null> {
  const { resolveDeskUser } = await import('@/lib/utils/devAuth')
  const user = await resolveDeskUser()
  if (!user) return null
  const supabase = createAdminClient()
  return runAsiaDeskScan({ supabase, userId: user.id, now, notify: true })
}
