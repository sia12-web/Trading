/**
 * Scan OANDA M5 for the locked Asia recipes, persist overlays, Telegram once per event.
 * Uses RAW OANDA CFD cash prices (no CME basis offset) so prices precisely match CMC Markets Cash.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import {
  ASIA_DESK_INSTRUMENTS,
  evaluateAsiaDeskOverlay,
  type AsiaDeskOverlay,
  type AsiaInstrument,
} from '@/lib/trading/asiaDesk'
import {
  loadAsiaDeskBook,
  upsertAsiaOverlay,
} from '@/lib/trading/asiaDeskStore'
import {
  sendAsianEdgeExecutionAlert,
  sendAsianEdgeOutingAlert,
} from '@/lib/notify/telegram'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'

export type AsiaScanResult = {
  overlays: Partial<Record<AsiaInstrument, AsiaDeskOverlay>>
  telegram: Array<{ instrument: AsiaInstrument; event: string; sent: boolean; skipped?: string }>
}

// In-memory deduplicator to prevent duplicate Telegram alerts across polling ticks
const sentTelegramKeys = new Set<string>()

async function candlesFor(instrument: AsiaInstrument) {
  // Use raw OANDA cash candles directly without CME basis offset to match CMC Markets Cash prices
  const pack = await getOandaCandles(instrument as Instrument, '5', 2)
  if (!pack?.candles?.length) return []
  return pack.candles
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

      // Telegram notification dispatch (CMC Markets Cash prices)
      if (args.notify && overlay.event && overlay.event !== 'idle' && overlay.event !== 'building') {
        const dedupeKey = `${instrument}-${overlay.lockDate}-${overlay.event}`
        if (!sentTelegramKeys.has(dedupeKey)) {
          if (overlay.event === 'place_both' && overlay.qualified) {
            const risk = overlay.buyStop - overlay.asiaMid
            await sendAsianEdgeExecutionAlert({
              instrument: `${instrument} (CMC Cash)`,
              action: 'BOTH_PLACED',
              entry: overlay.buyStop,
              stopLoss: overlay.asiaMid,
              takeProfit: overlay.longTp,
              riskPts: risk,
              contracts: overlay.contracts,
              timeNote: '02:00–03:30 ET Execution Window',
            })
            sentTelegramKeys.add(dedupeKey)
            telegram.push({ instrument, event: overlay.event, sent: true })
          } else if (overlay.event === 'flatten') {
            await sendAsianEdgeOutingAlert({
              instrument: `${instrument} (CMC Cash)`,
              reason: 'FLATTEN_1025',
              timeNote: '10:25 ET Mandatory Outing',
              note: 'Hard exit mandate before NY mid-day chop',
            })
            sentTelegramKeys.add(dedupeKey)
            telegram.push({ instrument, event: overlay.event, sent: true })
          } else if (overlay.event === 'cancel_unfilled') {
            await sendAsianEdgeOutingAlert({
              instrument: `${instrument} (CMC Cash)`,
              reason: 'CANCEL_UNFILLED_0330',
              timeNote: '03:30 ET Order Cutoff',
              note: 'Unfilled breakout stops cancelled',
            })
            sentTelegramKeys.add(dedupeKey)
            telegram.push({ instrument, event: overlay.event, sent: true })
          }
        } else {
          telegram.push({ instrument, event: overlay.event, sent: false, skipped: 'Already sent' })
        }
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
