/**
 * GET /api/trading/quote?instrument=DOW
 * Prefer Databento Live CME last trade; else OANDA mid + CME basis; else delayed Yahoo.
 */

import { NextResponse } from 'next/server'
import { getDayPreviousClose, getYahooQuote } from '@/lib/yahoo/quote'
import { activeDeskSessionsAt } from '@/lib/chart/sessionVwap'
import { getOandaPrice } from '@/lib/oanda/pricing'
import {
  applyCmeBasis,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
import { isDatabentoConfigured } from '@/lib/databento/client'
import { getLastDatabentoLivePrice } from '@/lib/databento/liveHub'
import { getOrCreateUser, type DeskUser } from '@/lib/utils/devAuth'
import {
  isChartStreamAllowed,
  isLiveDeskInstrument,
} from '@/lib/trading/sessionGate'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The desk re-polls this route several times a second and each call otherwise
 * costs a Supabase auth.getUser() round trip. Keyed on the credential itself
 * (Supabase auth cookies + desk secret headers) so a different, missing or
 * forged token can never hit another session's entry; only verified users are
 * cached, and only long enough to cover one poll cycle.
 */
const AUTH_TTL_MS = 5_000
const AUTH_CACHE_MAX = 64
const authCache = new Map<string, { at: number; user: DeskUser }>()

function authKey(request: Request): string {
  const supabaseCookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('sb-'))
    .sort()
    .join(';')
  return [
    supabaseCookies,
    request.headers.get('authorization') ?? '',
    request.headers.get('x-desk-secret') ?? '',
  ].join('|')
}

async function resolveDeskUserCached(request: Request): Promise<DeskUser | null> {
  const key = authKey(request)
  const hit = authCache.get(key)
  if (hit && Date.now() - hit.at < AUTH_TTL_MS) return hit.user

  const user = await getOrCreateUser(request)
  if (!user) {
    // Rejections are never cached — an unauthorized request always re-verifies.
    authCache.delete(key)
    return null
  }
  if (authCache.size >= AUTH_CACHE_MAX) authCache.clear()
  authCache.set(key, { at: Date.now(), user })
  return user
}

export async function GET(request: Request) {
  try {
    const user = await resolveDeskUserCached(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const instrument = (searchParams.get('instrument') || 'DOW') as Instrument

    if (!isLiveDeskInstrument(instrument)) {
      return NextResponse.json(
        { error: 'Desk quote supports DOW, NASDAQ, GOLD, or CRUDE' },
        { status: 400 }
      )
    }

    const headers = {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }

    // Focus window OR active desk session (Asia, London, NY) — live CME futures quotes
    const stream = isChartStreamAllowed(instrument)
    const active = activeDeskSessionsAt(Math.floor(Date.now() / 1000))
    if (!stream.open && active.length === 0) {
      return NextResponse.json(
        { error: stream.reason, instrument, price: null, frozen: true },
        { status: 200, headers }
      )
    }

    // 1. Databento Live Raw last trade (Standard Live entitlement — TCP+CRAM, not a webhook)
    if (isDatabentoConfigured()) {
      const live = getLastDatabentoLivePrice(instrument, 8_000)
      if (live?.price && live.price > 0) {
        const previous_close = getDayPreviousClose(instrument) ?? live.price
        const change = live.price - previous_close
        const change_pct = previous_close ? (change / previous_close) * 100 : 0
        return NextResponse.json(
          {
            instrument,
            source: 'databento',
            price: live.price,
            bid: live.bid,
            ask: live.ask,
            change,
            change_pct,
            previous_close,
            timestamp: live.timestamp,
          },
          { headers }
        )
      }
    }

    // 2. Try OANDA with CME basis if available and configured
    try {
      const oanda = await getOandaPrice(instrument)
      const cachedBasis = getCmeBasis(instrument)
      if (oanda?.price && oanda.price > 0 && cachedBasis != null) {
        if (getCmeBasis(instrument, CME_BASIS_REFRESH_MS) == null) {
          void warmCmeBasis(instrument)
        }
        const price = applyCmeBasis(oanda.price, cachedBasis)
        const previous_close = getDayPreviousClose(instrument) ?? price
        const change = price - previous_close
        const change_pct = previous_close ? (change / previous_close) * 100 : 0

        return NextResponse.json(
          {
            instrument,
            source: 'cme',
            price,
            bid: oanda.bid ? applyCmeBasis(oanda.bid, cachedBasis) : undefined,
            ask: oanda.ask ? applyCmeBasis(oanda.ask, cachedBasis) : undefined,
            change,
            change_pct,
            previous_close,
            timestamp: oanda.timestamp,
          },
          { headers }
        )
      }

      const basis = await warmCmeBasis(instrument)
      const staticBasis =
        instrument === 'DOW' ? 60.5 : instrument === 'NASDAQ' ? 36.5 : instrument === 'GOLD' ? 48.0 : 0
      const shift = basis ?? getLastKnownCmeBasis(instrument) ?? staticBasis
      if (oanda?.price && oanda.price > 0 && shift != null) {
        const price = applyCmeBasis(oanda.price, shift)
        const previous_close = getDayPreviousClose(instrument) ?? price
        const change = price - previous_close
        const change_pct = previous_close ? (change / previous_close) * 100 : 0

        return NextResponse.json(
          {
            instrument,
            source: 'cme',
            price,
            bid: oanda.bid ? applyCmeBasis(oanda.bid, shift) : undefined,
            ask: oanda.ask ? applyCmeBasis(oanda.ask, shift) : undefined,
            change,
            change_pct,
            previous_close,
            timestamp: oanda.timestamp,
          },
          { headers }
        )
      }
    } catch {
      /* fallback to direct CME */
    }

    // 3. Direct CME futures quote from exchange feed (MYM, MNQ, NKD, MGC, CL)
    const yq = await getYahooQuote(instrument)
    if (yq?.price && yq.price > 0) {
      const price = yq.price
      const previous_close = yq.previous_close || price
      const change = yq.change || (price - previous_close)
      const change_pct = yq.change_pct || (previous_close ? (change / previous_close) * 100 : 0)
      return NextResponse.json(
        {
          instrument,
          source: 'cme',
          price,
          bid: price,
          ask: price,
          change,
          change_pct,
          previous_close,
          timestamp: yq.timestamp || Math.floor(Date.now() / 1000),
        },
        { headers }
      )
    }

    return NextResponse.json(
      { error: 'No quote', instrument, price: null },
      { status: 200, headers }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote fetch failed'
    console.error('[quote]', message)
    return NextResponse.json({ error: message, price: null }, { status: 500 })
  }
}
