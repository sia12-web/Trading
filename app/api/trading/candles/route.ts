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
import { fetchDatabentoLiveSnapshot } from '@/lib/databento/liveHub'
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

interface CachedCandleEntry {
  data: any
  expiresAt: number
}

const candleMemoryCache = new Map<string, CachedCandleEntry>()

function pruneExpiredCandleCache() {
  const now = Date.now()
  for (const [key, entry] of candleMemoryCache.entries()) {
    if (entry.expiresAt < now) {
      candleMemoryCache.delete(key)
    }
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
        // For 1m, 8 calendar days guarantees at least 5 full trading sessions across weekends
        const fetchDays =
          timeframe === '1m'
            ? Math.max(days, 8)
            : Math.max(days, AVWAP_CANDLE_FETCH_CALENDAR_DAYS)

        // 1. Prioritize real-time OANDA 24/7 continuous candles with CME basis for sub-second live continuum
        //    (Databento historical batch is delayed 15m; OANDA provides zero-lag up-to-the-second candles)
        if (isOandaConfigured()) {
          try {
            const oanda = await getOandaCandles(instrument, resolution, fetchDays)
            if (oanda?.candles?.length) {
              if (getCmeBasis(instrument) == null && getLastKnownCmeBasis(instrument) == null) {
                await warmCmeBasis(instrument)
              }
              const basis =
                getCmeBasis(instrument) ??
                getLastKnownCmeBasis(instrument) ??
                (instrument === 'DOW' ? 60.5 : instrument === 'NASDAQ' ? 36.5 : instrument === 'GOLD' ? 48.0 : 0)
              candles = applyCmeBasisToCandles(oanda.candles, basis)
              source = 'oanda'
            }
          } catch (err) {
            logger.warn(`[Candles] OANDA fetch failed for ${instrument}, falling back to Databento`, err)
          }
        }

        // 2. Fallback to CME Globex MDP 3.0 candles via Databento archive when OANDA unavailable
        if ((!candles || candles.length === 0) && isDatabentoConfigured()) {
          try {
            const databento = await getDatabentoCandles(instrument, resolution, fetchDays)
            if (databento?.candles?.length) {
              candles = databento.candles
              source = 'databento'
            }
          } catch (err) {
            logger.warn(`[Candles] Databento fetch failed for ${instrument}, falling back to Yahoo`, err)
          }
        }

        // 3. Fallback to Yahoo if both OANDA and Databento were unavailable
        if (!candles || candles.length === 0) {
          const yahoo = await getYahooCandles(instrument, resolution, fetchDays)
          if (yahoo?.candles?.length) {
            candles = yahoo.candles
            source = 'yahoo'
          }
        }

        if (candles?.length) {
          candles = clipAfternoonBars(candles, instrument)
        }

        // 4. If Databento Live is active, merge the live forming 1m candle directly from CME Globex
        if (candles?.length && !isDaily && isDatabentoConfigured()) {
          try {
            const snap = await fetchDatabentoLiveSnapshot()
            const forming = snap?.forming?.[instrument]
            if (forming && forming.close > 0) {
              const last = candles[candles.length - 1]!
              if (forming.time === last.time) {
                candles[candles.length - 1] = {
                  ...last,
                  high: Math.max(last.high, forming.high),
                  low: Math.min(last.low, forming.low),
                  close: forming.close,
                  volume: Math.max(last.volume, forming.volume),
                }
              } else if (forming.time > last.time) {
                candles.push({
                  time: forming.time,
                  open: forming.open,
                  high: forming.high,
                  low: forming.low,
                  close: forming.close,
                  volume: forming.volume,
                })
              }
              source = 'databento'
            }
          } catch {
            /* ignore */
          }
        }
      }
    }

    if (candles && asOf != null && Number.isFinite(asOf)) {
      candles = candles.filter((c) => c.time <= asOf)
    }
    if (candles?.length && !isDaily) {
      candles = dropImplausibleDeskBars(candles, instrument, timeframe)
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

    // Cache TTL: 60s for daily, 600s for historical replay dates, 8s for intraday
    const ttlMs = isDaily ? 60_000 : endDate ? 600_000 : 8_000
    candleMemoryCache.set(cacheKey, {
      data: payload,
      expiresAt: now + ttlMs,
    })
    if (candleMemoryCache.size > 100) {
      pruneExpiredCandleCache()
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
