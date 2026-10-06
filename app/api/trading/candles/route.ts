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
import { getDayPreviousClose } from '@/lib/yahoo/quote'
import {
  applyCmeBasisToCandles,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
} from '@/lib/trading/cmeBasis'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  clipAfternoonBars,
  isLiveDeskInstrument,
  sessionFor,
} from '@/lib/trading/sessionGate'
import {
  dropImplausibleDeskBars,
  liveQuoteDisagreesWithReference,
} from '@/lib/chart/liveFormingBar'
import { AVWAP_CANDLE_FETCH_CALENDAR_DAYS } from '@/lib/chart/sessionVwap'
import { nyDateTimeToUnix, tokyoDateTimeToUnix } from '@/lib/utils/dateUtils'
import type { Instrument } from '@/types/price-feed'
import { getDatabentoCandles, getDatabentoRecent1m, isDatabentoConfigured } from '@/lib/databento/client'
import { fetchDatabentoLiveBars, getLatestDatabentoLiveQuote, resolveDatabentoLiveQuote } from '@/lib/databento/liveHub'
import { liveTapeHasVendorGap, mergeTapeBars, overlayVendorWithTape } from '@/lib/databento/liveOverlay'
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

interface CachedCandleEntry {
  data: any
  freshUntil: number
  staleUntil: number
}

type CandleRow = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** One background rebuild per key so a burst of chart switches shares a single fetch. */
const candleRefreshInflight = new Set<string>()

function candleCacheWindows(
  isDaily: boolean,
  historical: boolean,
  source: string
): { fresh: number; stale: number } {
  if (historical) return { fresh: 600_000, stale: 1_800_000 }
  if (isDaily) return { fresh: 60_000, stale: 600_000 }
  // The chart stream owns the forming bar. This window is so a market or
  // timeframe switch paints the last book instead of waiting on Yahoo again.
  if (source === 'databento') return { fresh: 20_000, stale: 120_000 }
  return { fresh: 15_000, stale: 120_000 }
}

/**
 * Splice the lagged vendor tail with CME prints. Returns null when there is
 * nothing newer to apply (or the contracts disagree).
 */
async function overlayLiveTape(
  candles: CandleRow[],
  instrument: Instrument,
  resolution: string,
  timeframe: string
): Promise<CandleRow[] | null> {
  const stepSec = resolutionSeconds(resolution, timeframe)
  const vendorLast = candles[candles.length - 1]!.time
  const liveBars = await fetchDatabentoLiveBars(instrument, vendorLast)
  let histTail = null
  if (liveTapeHasVendorGap(liveBars, vendorLast, stepSec)) {
    histTail = await getDatabentoRecent1m(instrument, vendorLast)
  }
  const tape = mergeTapeBars(histTail || [], liveBars || [])
  if (!tape.length) return null
  const spliced = overlayVendorWithTape(candles, tape, stepSec, instrument)
  if (!spliced.applied) {
    logger.warn(`[Candles] Skipping Databento overlay for ${instrument}: same-bar contract mismatch`)
    return null
  }
  return spliced.candles
}

const candleMemoryCache = new Map<string, CachedCandleEntry>()

/** Hard ceiling on retained payloads. Replay requests carry a distinct `as_of` per call,
 *  so expiry alone can never bring the map back down. */
const CANDLE_CACHE_MAX_ENTRIES = 200

function pruneCandleCache() {
  const now = Date.now()
  for (const [key, entry] of candleMemoryCache.entries()) {
    if (entry.staleUntil < now) {
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

function scheduleCandleRefresh(cacheKey: string, request: Request) {
  if (candleRefreshInflight.has(cacheKey)) return
  candleRefreshInflight.add(cacheKey)
  const headers = new Headers(request.headers)
  headers.set('x-candle-revalidate', '1')
  void GET(new Request(request.url, { headers, method: 'GET' })).finally(() => {
    candleRefreshInflight.delete(cacheKey)
  })
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

    // Quote is derived from the last bar (or an already-warm print), so quote=0
    // and quote=1 share one book. Switches must not miss just because the flag differs.
    const cacheKey = `${instrument}:${timeframe}:${days}:${endDate || 'live'}:${asOfParam || 'none'}`
    const now = Date.now()
    const revalidate = request.headers.get('x-candle-revalidate') === '1'
    const cached = candleMemoryCache.get(cacheKey)
    if (!revalidate && cached && cached.freshUntil > now) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Candle-Cache': 'HIT',
        },
      })
    }
    if (!revalidate && cached && cached.staleUntil > now) {
      scheduleCandleRefresh(cacheKey, request)
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Candle-Cache': 'STALE',
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

    let candles: CandleRow[] | null = null
    let source: 'databento' | 'oanda' | 'yahoo' | 'empty' = 'empty'
    let overlayLate: Promise<CandleRow[] | null> | null = null

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

        // 4. Overlay the tail with real CME Globex 1m prints. Yahoo/OANDA lag the
        //    tape by several minutes. A fast sidecar splice stays on the response.
        //    A slow historical backfill must not hold the bars the chart is waiting on.
        if (candles?.length && !isDaily && isDatabentoConfigured()) {
          try {
            const work = overlayLiveTape(candles, instrument, resolution, timeframe)
            const raced = await Promise.race([
              work.then((rows) => ({ timedOut: false as const, rows })),
              new Promise<{ timedOut: true; rows: null }>((resolve) =>
                setTimeout(() => resolve({ timedOut: true, rows: null }), 700)
              ),
            ])
            if (!raced.timedOut && raced.rows) {
              candles = raced.rows
              source = 'databento'
            } else if (raced.timedOut) {
              overlayLate = work
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
    // The chart has its own quote stream. Do not hold the bars for OANDA or
    // Yahoo quote round-trips — last close paints immediately, and a print that
    // is already in memory (or returns within 180ms) replaces it.
    {
      const last = candles[candles.length - 1]!
      quote = { price: last.close, change: 0, change_pct: 0 }
      if (includeQuote && !endDate && isDatabentoConfigured()) {
        let dbLive = getLatestDatabentoLiveQuote(instrument)
        if (!dbLive) {
          dbLive = await Promise.race([
            resolveDatabentoLiveQuote(instrument),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 180)),
          ])
        }
        const bookTip = candles[candles.length - 1]
        const bookClose = bookTip?.close
        if (
          dbLive &&
          dbLive.price > 0 &&
          !(
            bookClose &&
            liveQuoteDisagreesWithReference(
              dbLive.price,
              dbLive.timestamp,
              bookClose,
              bookTip?.time ?? 0,
              instrument
            )
          )
        ) {
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

    const windows = candleCacheWindows(isDaily, Boolean(endDate), source)
    // A tail that is still splicing must not be served as fresh for the full window.
    const freshMs = overlayLate ? 2_000 : windows.fresh
    candleMemoryCache.set(cacheKey, {
      data: payload,
      freshUntil: now + freshMs,
      staleUntil: now + windows.stale,
    })
    if (candleMemoryCache.size > CANDLE_CACHE_MAX_ENTRIES) {
      pruneCandleCache()
    }

    if (overlayLate) {
      const lateKey = cacheKey
      const lateInstrument = instrument
      const lateTimeframe = timeframe
      const lateAsOf = asOf
      const latePayload = payload
      void overlayLate.then((rows) => {
        if (!rows?.length) return
        let next = rows
        if (lateAsOf != null && Number.isFinite(lateAsOf)) {
          next = next.filter((c) => c.time <= lateAsOf)
        }
        next = dropImplausibleDeskBars(next, lateInstrument, lateTimeframe)
        next = fillCandleGaps(next, lateTimeframe, lateInstrument)
        if (!next.length) return
        const held = candleMemoryCache.get(lateKey)
        if (
          held?.data?.source === 'databento' &&
          held.freshUntil > Date.now() &&
          Array.isArray(held.data.candles) &&
          held.data.candles.length >= next.length
        ) {
          return
        }
        const tip = next[next.length - 1]!
        const upgraded = {
          ...latePayload,
          source: 'databento' as const,
          candles: next.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          quote: {
            price: tip.close,
            change: latePayload.quote?.change ?? 0,
            change_pct: latePayload.quote?.change_pct ?? 0,
            previous_close: latePayload.quote?.previous_close,
          },
        }
        const t = Date.now()
        const w = candleCacheWindows(false, false, 'databento')
        candleMemoryCache.set(lateKey, {
          data: upgraded,
          freshUntil: t + w.fresh,
          staleUntil: t + w.stale,
        })
      })
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Candle-Cache': revalidate ? 'REFRESH' : 'MISS',
        ...(overlayLate ? { 'X-Candle-Tail': 'pending' } : {}),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candle fetch failed'
    logger.error('candles.failed', { err: error, message })
    return NextResponse.json({ error: message, candles: [] }, { status: 500 })
  }
}
