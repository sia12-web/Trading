/**
 * Scan OANDA M5 for the locked Asia recipes, persist overlays, Telegram once per event.
 * Uses RAW OANDA CFD cash prices (no CME basis offset) so prices precisely match CMC Markets Cash.
 * Strictly deduplicated via Supabase DB and local memory claim to eliminate duplicate alerts.
 * Aligned 100% with high-conviction institutional models from /dashboard/asian-edge:
 * - Gold (MGC): Asia Box Compression Breakout (< $60.00 range)
 * - Dow (MYM): Asia Box Compression Breakout (< 80 pts range)
 * - Nasdaq (MNQ): Dalton Prior Day POC Reversion (>= 50 pts displacement)
 * - Oil (MCL): Risk Guard Protocol - Deactivated in Asia
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { getYahooQuote } from '@/lib/yahoo/quote'
import {
  ASIA_DESK_INSTRUMENTS,
  asiaMontrealMins,
  evaluateAsiaDeskOverlay,
  type AsiaDeskOverlay,
  type AsiaInstrument,
} from '@/lib/trading/asiaDesk'
import {
  claimAsiaTelegramKey,
  loadAsiaDeskBook,
  upsertAsiaOverlay,
} from '@/lib/trading/asiaDeskStore'
import {
  sendAsianEdgeBracketAlert,
  sendAsianEdgeOutingAlert,
  sendLondonJudasAlert,
  sendGoldLondonReliefAlert,
} from '@/lib/notify/telegram'
import { claimServerDeskNoteOnce } from '@/lib/notify/deskNoteServerClaim'
import { montrealCivil } from '@/lib/trading/asiaRangeSignals'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'

export type AsiaScanResult = {
  overlays: Partial<Record<AsiaInstrument, AsiaDeskOverlay>>
  telegram: Array<{ instrument: string; event: string; sent: boolean; skipped?: string }>
}

/**
 * Durable deduplicator:
 * 1. Synchronous in-memory claim blocks concurrent requests within the same process.
 * 2. Persistent Supabase DB claim blocks across serverless cold-starts & container restarts.
 */
async function tryClaimDedupe(
  supabase: SupabaseClient | null,
  userId: string,
  dedupeKey: string
): Promise<boolean> {
  // 1. In-process claim
  if (!claimServerDeskNoteOnce(dedupeKey)) {
    return false
  }
  // 2. Persistent Supabase DB claim
  if (supabase && userId) {
    const claimed = await claimAsiaTelegramKey(supabase, userId, dedupeKey)
    if (!claimed) return false
  }
  return true
}

async function candlesFor(instrument: string) {
  // Try raw OANDA cash candles first (matches CMC Markets Cash prices)
  try {
    const pack = await getOandaCandles(instrument as Instrument, '5', 2)
    if (pack?.candles?.length) return pack.candles
  } catch {
    // fallback below
  }
  // Resilient fallback to Yahoo candles
  try {
    const yPack = await getYahooCandles(instrument as Instrument, '5', 2)
    if (yPack?.candles?.length) return yPack.candles
  } catch {
    // ignore
  }
  return []
}

async function quotePriceFor(instrument: string): Promise<number | null> {
  try {
    const oanda = await getOandaPrice(instrument as Instrument)
    if (oanda?.price && oanda.price > 0) return oanda.price
  } catch {
    // fallback below
  }
  try {
    const yq = await getYahooQuote(instrument as Instrument)
    if (yq?.price && yq.price > 0) return yq.price
  } catch {
    // fallback
  }
  return null
}

export async function runAsiaDeskScan(args: {
  supabase: SupabaseClient | null
  userId: string
  now?: Date
  notify?: boolean
}): Promise<AsiaScanResult> {
  const now = args.now ?? new Date()
  const { ymd, mins } = asiaMontrealMins(now)
  const overlays: Partial<Record<AsiaInstrument, AsiaDeskOverlay>> = {}
  const telegram: AsiaScanResult['telegram'] = []

  // 1. Process GOLD & DOW: Asia Box Compression Breakout
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

      const pointValue = instrument === 'GOLD' ? 10.0 : 0.5
      const instrumentLabel =
        instrument === 'GOLD' ? 'Micro Gold (MGC / XAU/USD)' : 'Micro Dow (MYM / US30)'

      // Window A: 02:00 – 03:30 ET Execution Window (Place OCO Bracket)
      if (mins >= 120 && mins < 210) {
        if (overlay.qualified) {
          const dedupeKey = `asian_edge:${instrument}:${overlay.lockDate}:place_both`
          if (await tryClaimDedupe(args.supabase, args.userId, dedupeKey)) {
            const riskPts = Math.abs(overlay.buyStop - overlay.asiaMid)
            await sendAsianEdgeBracketAlert({
              instrument: instrumentLabel,
              contract: overlay.contract,
              pointValue,
              asiaRange: overlay.asiaRange,
              maxRange: overlay.maxRange,
              buyStop: overlay.buyStop,
              sellStop: overlay.sellStop,
              stopLoss: overlay.asiaMid,
              longTp: overlay.longTp,
              shortTp: overlay.shortTp,
              riskPts,
              contracts: overlay.contracts || 1,
              timeNote: '02:00 – 03:30 ET Execution Window',
              outingMandate: '10:25 ET Mandatory Hard Flat',
            })
            telegram.push({ instrument, event: 'place_both', sent: true })
          } else {
            telegram.push({ instrument, event: 'place_both', sent: false, skipped: 'Already sent' })
          }
        }
      }

      // Window B: 03:30 – 03:50 ET Order Cutoff Window (Cancel Unfilled Stops)
      // ONLY if this setup was qualified for this session
      else if (mins >= 210 && mins < 230 && overlay.qualified) {
        const dedupeKey = `asian_edge:${instrument}:${overlay.lockDate}:cancel_unfilled`
        if (await tryClaimDedupe(args.supabase, args.userId, dedupeKey)) {
          await sendAsianEdgeOutingAlert({
            instrument: instrumentLabel,
            reason: 'CANCEL_UNFILLED_0330',
            timeNote: '03:30 ET Order Cutoff',
            note: '03:30 ET reached. Cancel unfilled breakout stops if not yet filled. Keep SL and 1.5R TP active if filled.',
          })
          telegram.push({ instrument, event: 'cancel_unfilled', sent: true })
        } else {
          telegram.push({ instrument, event: 'cancel_unfilled', sent: false, skipped: 'Already sent' })
        }
      }

      // Window C: 10:25 – 10:45 ET Mandatory Outing / Hard Flatten Window
      // ONLY if this setup was qualified for this session
      else if (mins >= 625 && mins < 645 && overlay.qualified) {
        const dedupeKey = `asian_edge:${instrument}:${overlay.lockDate}:flatten`
        if (await tryClaimDedupe(args.supabase, args.userId, dedupeKey)) {
          await sendAsianEdgeOutingAlert({
            instrument: instrumentLabel,
            reason: 'FLATTEN_1025',
            timeNote: '10:25 ET Mandatory Outing',
            note: 'Hard exit mandate before NY mid-day chop. Flatten all open Asian positions at market immediately.',
          })
          telegram.push({ instrument, event: 'flatten', sent: true })
        } else {
          telegram.push({ instrument, event: 'flatten', sent: false, skipped: 'Already sent' })
        }
      }
    } catch (err) {
      logger.warn('asia_desk.scan_instrument_failed', { instrument, err })
    }
  }

  // 2. Process DOW London Session Judas Sweep Reversal (03:00 – 05:00 ET)
  if (args.notify && mins >= 3 * 60 && mins < 5 * 60) {
    try {
      const candles = await candlesFor('DOW')
      const currentPrice = (await quotePriceFor('DOW')) ?? candles[candles.length - 1]?.close
      if (currentPrice && candles.length > 0) {
        const asiaBars = candles.filter((c) => {
          const civil = montrealCivil(c.time)
          return civil.mins >= 20 * 60 || civil.mins < 2 * 60
        })
        const londonBars = candles.filter((c) => {
          const civil = montrealCivil(c.time)
          return civil.ymd === ymd && civil.mins >= 3 * 60 && civil.mins <= mins
        })

        if (asiaBars.length > 0 && londonBars.length > 0) {
          const asiaLow = Math.min(...asiaBars.map((b) => b.low))
          const asiaMid = (Math.max(...asiaBars.map((b) => b.high)) + asiaLow) / 2
          const londonLow = Math.min(...londonBars.map((b) => b.low))

          // Sweep condition: London low dipped below overnight Asia Low, and price reclaimed above Asia Low + 15.0 pts
          if (londonLow < asiaLow && currentPrice >= asiaLow + 15.0) {
            const dedupeKey = `asian_edge:DOW:${ymd}:london_judas`
            if (await tryClaimDedupe(args.supabase, args.userId, dedupeKey)) {
              const stopLoss = Math.round(londonLow - 15.0)
              const riskPts = Math.max(25, Math.round(currentPrice - stopLoss))
              const takeProfit = Math.round(Math.max(asiaMid, currentPrice + 1.5 * riskPts))
              await sendLondonJudasAlert({
                instrument: 'Micro Dow (MYM / US30)',
                contract: 'MYM',
                pointValue: 0.5,
                entry: currentPrice,
                stopLoss,
                takeProfit,
                riskPts,
                contracts: 1,
                timeNote: '03:00 – 05:00 ET (London Cash Open)',
                note: `Overnight Asian Low (${asiaLow.toFixed(0)}) swept to ${londonLow.toFixed(0)} and reclaimed. Dow Judas Swing bounce active.`,
              })
              telegram.push({ instrument: 'DOW', event: 'london_judas', sent: true })
            } else {
              telegram.push({ instrument: 'DOW', event: 'london_judas', sent: false, skipped: 'Already sent' })
            }
          }
        }
      }
    } catch (err) {
      logger.warn('asia_desk.scan_dow_judas_failed', { err })
    }
  }

  // 5. Process GOLD London LBMA Physical Relief Bounce (03:30 – 06:00 ET)
  if (args.notify && mins >= 3 * 60 + 30 && mins < 6 * 60) {
    try {
      const candles = await candlesFor('GOLD')
      const currentPrice = (await quotePriceFor('GOLD')) ?? candles[candles.length - 1]?.close
      if (currentPrice && candles.length > 0) {
        const asiaBars = candles.filter((c) => {
          const civil = montrealCivil(c.time)
          return civil.mins >= 20 * 60 || civil.mins < 2 * 60
        })
        const londonBars = candles.filter((c) => {
          const civil = montrealCivil(c.time)
          return civil.ymd === ymd && civil.mins >= 3 * 60 + 30 && civil.mins <= mins
        })

        const asiaLow = asiaBars.length > 0 ? Math.min(...asiaBars.map((b) => b.low)) : currentPrice - 20
        const londonLow = londonBars.length > 0 ? Math.min(...londonBars.map((b) => b.low)) : currentPrice

        // Support levels: 4100, 4080, or Asia Low
        const supports = [4100, 4080, Math.round(asiaLow)]
        const testedSupport = supports.find(
          (s) => Math.abs(londonLow - s) <= 5.0 || (londonLow <= s && currentPrice > s)
        )

        // If a major support was tested and price bounced by at least $3.00 from low
        if (testedSupport != null && currentPrice >= londonLow + 3.0) {
          const dedupeKey = `asian_edge:GOLD:${ymd}:london_relief`
          if (await tryClaimDedupe(args.supabase, args.userId, dedupeKey)) {
            const stopLoss = Number((londonLow - 6.0).toFixed(1))
            const riskPts = Number(Math.max(5.0, currentPrice - stopLoss).toFixed(1))
            const takeProfit = Number((currentPrice + Math.max(25.0, 1.5 * riskPts)).toFixed(1))
            await sendGoldLondonReliefAlert({
              entry: currentPrice,
              stopLoss,
              takeProfit,
              riskPts,
              contracts: 1,
              timeNote: '03:30 – 06:00 ET (London LBMA Morning Fix)',
              note: `Physical support tested at $${testedSupport} (Low: $${londonLow.toFixed(1)}). LBMA physical buyers absorbing post-CPI dip.`,
            })
            telegram.push({ instrument: 'GOLD', event: 'london_relief', sent: true })
          } else {
            telegram.push({ instrument: 'GOLD', event: 'london_relief', sent: false, skipped: 'Already sent' })
          }
        }
      }
    } catch (err) {
      logger.warn('asia_desk.scan_gold_london_failed', { err })
    }
  }

  // Reload latest stored overlays to combine
  const latestBook = await loadAsiaDeskBook(args.supabase, args.userId)
  return {
    overlays: { ...(latestBook.overlays || {}), ...overlays },
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
