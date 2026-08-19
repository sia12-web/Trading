/**
 * GET /api/trading/quote?instrument=DOW
 * Live OANDA mid shifted by CME basis so the tip matches Tradovate MYM / MNQ / NKD.
 * Delayed Yahoo futures lasts are never served as the live price.
 */

import { NextResponse } from 'next/server'
import { getDayPreviousClose } from '@/lib/yahoo/quote'
import { getOandaPrice } from '@/lib/oanda/pricing'
import {
  applyCmeBasis,
  getCmeBasis,
  getLastKnownCmeBasis,
  warmCmeBasis,
  CME_BASIS_REFRESH_MS,
} from '@/lib/trading/cmeBasis'
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
        { error: 'Desk quote supports DOW, NASDAQ, or NIKKEI' },
        { status: 400 }
      )
    }

    const headers = {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }

    // Focus window only (open − 30m → cash close) — no overnight/pre-focus OANDA burn
    const stream = isChartStreamAllowed(instrument)
    if (!stream.open) {
      return NextResponse.json(
        { error: stream.reason, instrument, price: null, frozen: true },
        { status: 200, headers }
      )
    }

    const oanda = await getOandaPrice(instrument)

    // Warm hub + recent basis: shift the live mid and answer without a Yahoo hop.
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

    // Cold basis — pair delayed CME last with a same-age OANDA mid, never
    // display the 10-minute-old futures print as the live tip.
    const basis = await warmCmeBasis(instrument)
    const shift = basis ?? getLastKnownCmeBasis(instrument)

    if (oanda?.price && oanda.price > 0) {
      const price = applyCmeBasis(oanda.price, shift)
      const previous_close = getDayPreviousClose(instrument) ?? price
      const change = price - previous_close
      const change_pct = previous_close ? (change / previous_close) * 100 : 0

      return NextResponse.json(
        {
          instrument,
          source: shift != null ? 'cme' : 'oanda',
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
