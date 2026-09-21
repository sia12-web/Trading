/**
 * GET /api/trading/candles?instrument=DOW|NASDAQ|NIKKEI|GOLD|CRUDE&timeframe=5m&days=5
 * CME futures first (MYM / MNQ / NKD / MGC / CL) so IB matches Tradovate; OANDA CFD fallback.
 * Live: full day continuum (morning + afternoon + overnight). Trading stays morning-only.
 * Sim/dated: full cash session continuum (entries still morning-gated in the UI).
 */

import { NextResponse } from 'next/server'
import { getYahooCandles, getYahooCandlesRange } from '@/lib/yahoo/candles'
import { getOandaCandles, getOandaCandlesRange } from '@/lib/oanda/candles'
import { isOandaConfigured } from '@/lib/oanda/config'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { getDayPreviousClose, getYahooQuote } from '@/lib/yahoo/quote'
import {
  applyCmeBasis,
  applyCmeBasisToCandles,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  clipAfternoonBars,
  isLiveDeskInstrument,
  sessionFor,
} from '@/lib/trading/sessionGate'
import { dropImplausibleDeskBars } from '@/lib/chart/liveFormingBar'
import { AVWAP_CANDLE_FETCH_CALENDAR_DAYS } from '@/lib/chart/sessionVwap'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Instrument } from '@/types/price-feed'
import { getDatabentoCandles, isDatabentoConfigured } from '@/lib/databento/client'
import { fetchDatabentoLiveBars, resolveDatabentoLiveQuote } from '@/lib/databento/liveHub'
import { fillCandleGaps } from '@/lib/chart/candleGapFiller'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const RES_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
  'D': 'D',
}

const RES_SECONDS: Record<string, number> = {
  '1': 60,
  '5': 300,
  '15': 900,
  '30': 1800,
  '60': 3600,
  '240': 14400,
}

function resolutionSeconds(resolution: string, timeframe: string): number {
  return RES_SECONDS[resolution] ?? RES_SECONDS[RES_MAP[timeframe] ?? ''] ?? 300
}

type LiveBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Roll the sidecar's 1m bars up to the requested resolution. Input is oldest-first. */
function aggregateLiveBars(bars: LiveBar[], stepSec: number): LiveBar[] {
  const out: LiveBar[] = []
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / stepSec) * stepSec
    const cur = out[out.length - 1]
    if (!cur || cur.time !== bucket) {
      out.push({
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
    } else {
      cur.high = Math.max(cur.high, bar.high)
      cur.low = Math.min(cur.low, bar.low)
      cur.close = bar.close
      cur.volume += bar.volume
    }
  }
  return out
}

interface CachedCandleEntry {
  data: any
  expiresAt: number
}

const candleMemoryCache = new Map<string, CachedCandleEntry>()

/** Hard ceiling on retained payloads. Replay requests carry a distinct `as_of` per call,
 *  so expiry alone can never bring the map back down. */
const CANDLE_CACHE_MAX_ENTRIES = 200

function pruneCandleCache() {
  const now = Date.now()
  for (const [key, entry] of candleMemoryCache.entries()) {
    if (entry.expiresAt < now) {
      candleMemoryCache.delete(key)
    }
  }
  // Map iterates in insertion order, so the front is always the oldest entry.
  while (candleMemoryCache.size > CANDLE_CACHE_MAX_ENTRIES) {
    const oldest = candleMemoryCache.keys().next()
    if (oldest.done) break
    candleMemoryCache.delete(oldest.value)
  }
}

export async function GET(request: Request) {
  try {
    const user = await getOrCreateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument
    const timeframe = searchParams.get('timeframe') || '5m'
    const isDaily = timeframe === '1D' || timeframe === 'D'
    const defaultDays = isDaily ? 730 : 5
    const maxDays = isDaily ? 1825 : 14
    // Cap lookback — AVWAP needs ~5 sessions (or 730 days for 1D); hard max 14 calendar days (1825 for 1D)
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || String(defaultDays), 10), 1), maxDays)
    const endDate = searchParams.get('date') || searchParams.get('end_date')
    const asOfParam = searchParams.get('as_of')
    const asOf = asOfParam ? parseInt(asOfParam, 10) : null
    const includeQuote = searchParams.get('quote') !== '0'

    // Server-side fast cache check (instant response on timeframe/instrument switching)
    const cacheKey = `${instrument}:${timeframe}:${days}:${endDate || 'live'}:${asOfParam || 'none'}:${includeQuote ? '1' : '0'}`
    const now = Date.now()
    const cached = candleMemoryCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Candle-Cache': 'HIT',
        },
      })
    }

    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json(
        { error: 'Desk chart supports DOW, NASDAQ, GOLD, or CRUDE' },
        { status: 400 }
      )
    }

    const resolution = RES_MAP[timeframe] || '5'
    const sess = sessionFor(instrument)
    const toUnix = instrument === 'NIKKEI' ? tokyoDateTimeToUnix : nyDateTimeToUnix

    type CandleRow = {
      time: number
      open: number
      high: number
      low: number
      close: number
      volume: number
    }
    let candles: CandleRow[] | null = null
    let source: 'databento' | 'oanda' | 'yahoo' | 'empty' = 'empty'

    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      // Sim / dated: full cash session (open → close) so afternoon chart keeps printing.
      // Entries stay morning-gated in the sim desk UI — not by truncating candles.
      const [ch, cm] = sess.marketClose.split(':').map(Number)
      const endUnix = toUnix(endDate, ch!, cm || 0) + 60
      // Extra lead-in for Tokyo overnight + Yahoo/OANDA gaps
      const leadDays = instrument === 'NIKKEI' ? 3 : 2
      const startUnix =
        endUnix - Math.max(days, 5) * 24 * 3600 - leadDays * 24 * 3600

      const [yahoo, oanda] = await Promise.all([
        getYahooCandlesRange(instrument, resolution, startUnix, endUnix),
        getOandaCandlesRange(instrument, resolution, startUnix, endUnix),
      ])
      if (yahoo?.candles?.length) {
        candles = yahoo.candles
        source = 'yahoo'
      } else if (oanda?.candles?.length) {
        candles = oanda.candles
        source = 'oanda'
      }
      // Keep afternoon bars on the replay day (and priors) — matches live continuum
    } else {
      if (isDaily) {
        // Daily chart: fetch full multi-year daily history directly from Yahoo Finance in ~50ms
        const yahoo = await getYahooCandles(instrument, 'D', days)
        if (yahoo?.candles?.length) {
          candles = yahoo.candles
          source = 'yahoo'
        }
      } else {
        // Intraday (1m, 5m, 15m, 30m, 1H, 4H):
        // For 1m, 3 calendar days guarantees at least 5 full RTH sessions Mon-Fri.
        // Previously 8 days caused ~11,520 raw bars to be fetched; 3 days = ~4,320 bars,
        // trimmed to ~1,950 (5 × 6.5h × 60min) by lastNTradingSessions.
        const fetchDays =
          timeframe === '1m'
            ? Math.max(days, 3)
            : Math.max(days, AVWAP_CANDLE_FETCH_CALENDAR_DAYS)

        // 1. Direct CME Globex futures candles (MYM=F, MNQ=F, NKD=F, MGC=F, CL=F) matching Tradovate & TradingView
        try {
          const yahoo = await getYahooCandles(instrument, resolution, fetchDays)
          if (yahoo?.candles?.length) {
            candles = yahoo.candles
            source = 'yahoo'
          }
        } catch (err) {
          logger.warn(`[Candles] Yahoo CME fetch failed for ${instrument}, falling back to Databento/OANDA`, err)
        }

        // 2. Fallback to CME Globex MDP 3.0 candles via Databento archive when Yahoo unavailable
        if ((!candles || candles.length === 0) && isDatabentoConfigured()) {
          try {
            const databento = await getDatabentoCandles(instrument, resolution, fetchDays)
            if (databento?.candles?.length) {
              candles = databento.candles
              source = 'databento'
            }
          } catch (err) {
            logger.warn(`[Candles] Databento fetch failed for ${instrument}, falling back to OANDA`, err)
          }
        }

        // 3. Fallback to OANDA 24/7 continuous CFDs shifted by CME basis if CME direct feeds unavailable
        if ((!candles || candles.length === 0) && isOandaConfigured()) {
          try {
            const oanda = await getOandaCandles(instrument, resolution, fetchDays)
            if (oanda?.candles?.length) {
              let basis = getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)
              if (basis == null) {
                basis = await warmCmeBasis(instrument)
              }
              candles = applyCmeBasisToCandles(oanda.candles, basis)
              source = 'oanda'
            }
          } catch (err) {
            logger.warn(`[Candles] OANDA fetch failed for ${instrument}`, err)
          }
        }

        if (candles?.length) {
          candles = clipAfternoonBars(candles, instrument)
        }

        // 4. Overlay the tail of the series with real CME Globex prints. Yahoo and OANDA
        //    both publish intraday bars several minutes behind the tape, and fillCandleGaps
        //    would otherwise reconstruct that window as flat zero-volume bars — fabricated
        //    OHLC that every downstream overlay (VWAP, profile, IB, excess, delta) reads as
        //    real. These bars are built from the live tick stream, so there is no lag.
        if (candles?.length && !isDaily && isDatabentoConfigured()) {
          try {
            const stepSec = resolutionSeconds(resolution, timeframe)
            const vendorLast = candles[candles.length - 1]!.time
            // Re-fetch the last vendor bucket too: it is usually still incomplete.
            const liveBars = await fetchDatabentoLiveBars(instrument, vendorLast)
            if (liveBars?.length) {
              const merged = aggregateLiveBars(liveBars, stepSec)
              if (merged.length > 0) {
                const firstLive = merged[0]!.time
                const kept = candles.filter((c) => c.time < firstLive)
                const overlap = candles.find((c) => c.time === firstLive)
                // The sidecar may have started part-way through the oldest overlapping
                // bucket, so union it with the vendor bar instead of replacing it.
                // Later buckets are fully covered by the live stream.
                if (overlap) {
                  const live = merged[0]!
                  merged[0] = {
                    time: live.time,
                    open: overlap.open,
                    high: Math.max(overlap.high, live.high),
                    low: Math.min(overlap.low, live.low),
                    close: live.close,
                    volume: Math.max(overlap.volume, live.volume),
                  }
                }
                candles = [...kept, ...merged]
                source = 'databento'
              }
            }
          } catch (err) {
            logger.warn(`[Candles] Databento live bar overlay failed for ${instrument}`, err)
          }
        }
      }
    }

    if (candles && asOf != null && Number.isFinite(asOf)) {
      candles = candles.filter((c) => c.time <= asOf)
    }
    if (candles?.length && !isDaily) {
      candles = dropImplausibleDeskBars(candles, instrument, timeframe)
      candles = fillCandleGaps(candles, timeframe, instrument)
    }

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        {
          error: 'No candle data',
          instrument,
          candles: [],
          source: 'empty',
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      )
    }

    let quote: {
      price: number
      change: number
      change_pct: number
      previous_close?: number
    } | null = null
    if (includeQuote) {
      // Real CME Globex print first, matching /api/trading/quote. Anything below is a
      // basis-shifted proxy, so preferring them here would hand the chart a different
      // opening tip than the stream it is about to attach to.
      if (!endDate && isDatabentoConfigured()) {
        const dbLive = await resolveDatabentoLiveQuote(instrument)
        if (dbLive && dbLive.price > 0) {
          const previous_close = getDayPreviousClose(instrument) ?? dbLive.price
          const change = dbLive.price - previous_close
          quote = {
            price: dbLive.price,
            change,
            change_pct: previous_close ? (change / previous_close) * 100 : 0,
            previous_close,
          }
        }
      }
      // Only reached without a live exchange print — skipping it also saves a round trip.
      if (!quote) {
        try {
          // Live tip on CME scale (same path as /quote) so painted ±10 bands
          // and the streaming last share one book.
          const o = await getOandaPrice(instrument)
          const basis =
            getCmeBasis(instrument) ?? getLastKnownCmeBasis(instrument)
          if (!endDate && (basis == null || getCmeBasis(instrument, CME_BASIS_REFRESH_MS) == null)) {
            void warmCmeBasis(instrument)
          }
          if (!endDate && o?.price && o.price > 0 && (basis != null || (instrument !== 'GOLD' && instrument !== 'CRUDE'))) {
            const price = applyCmeBasis(o.price, basis)
            const previous_close = getDayPreviousClose(instrument) ?? price
            const change = price - previous_close
            quote = {
              price,
              change,
              change_pct: previous_close ? (change / previous_close) * 100 : 0,
              previous_close,
            }
          }
        } catch {
          /* fallback to CME */
        }
      }

      // Direct CME futures fallback from exchange feed (Tradovate / CME MYM, MNQ, NKD, MGC, CL)
      if (!quote && !endDate) {
        try {
          const yq = await getYahooQuote(instrument)
          if (yq?.price && yq.price > 0) {
            const price = yq.price
            const previous_close = yq.previous_close || price
            const change = yq.change || (price - previous_close)
            quote = {
              price,
              change,
              change_pct: yq.change_pct || (previous_close ? (change / previous_close) * 100 : 0),
              previous_close,
            }
          }
        } catch {
          /* fallback to last candle */
        }
      }

      if (!quote) {
        const last = candles[candles.length - 1]!
        quote = { price: last.close, change: 0, change_pct: 0 }
      }
    } else {
      const last = candles[candles.length - 1]!
      quote = { price: last.close, change: 0, change_pct: 0 }
    }

    const payload = {
      instrument,
      timeframe,
      source,
      candles: candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      quote,
    }

    // Cache TTL: 60s for daily, 600s for historical replay dates, 5s for intraday.
    // The chart re-polls bars every 15s, so a longer intraday TTL stacks on top of that
    // interval and the tape can sit up to 30s behind. 5s still absorbs the burst of
    // duplicate requests that a panel mount fires off.
    const ttlMs = isDaily ? 60_000 : endDate ? 600_000 : 5_000
    candleMemoryCache.set(cacheKey, {
      data: payload,
      expiresAt: now + ttlMs,
    })
    if (candleMemoryCache.size > CANDLE_CACHE_MAX_ENTRIES) {
      pruneCandleCache()
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Candle-Cache': 'MISS',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candle fetch failed'
    logger.error('candles.failed', { err: error, message })
    return NextResponse.json({ error: message, candles: [] }, { status: 500 })
  }
}
