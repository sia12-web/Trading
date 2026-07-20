/**
 * OANDA live mid pricing for desk indices (same symbols as candles/orders).
 * Prefer this over Yahoo for tip latency when the broker is configured.
 */

import type { Instrument } from '@/types/price-feed'
import {
  isOandaConfigured,
  oandaAccountId,
  oandaBaseUrl,
  oandaHeaders,
  toOandaInstrument,
} from '@/lib/oanda/config'
import { getLastStreamedPrice } from '@/lib/oanda/pricingStream'

export type OandaPriceQuote = {
  symbol: string
  price: number
  bid: number
  ask: number
  timestamp: number
  source: 'oanda'
}

const priceCache = new Map<string, { at: number; quote: OandaPriceQuote }>()
/** Short TTL — desk polls as backup; stream hub is primary */
const PRICE_TTL_MS = 100

export async function getOandaPrice(
  instrument: Instrument
): Promise<OandaPriceQuote | null> {
  // Hot path: reuse tick from active pricing stream (no REST hop)
  const streamed = getLastStreamedPrice(instrument, 1_500)
  if (streamed) return streamed

  if (!isOandaConfigured()) return null
  const symbol = toOandaInstrument(instrument)
  if (!symbol) return null

  const cached = priceCache.get(instrument)
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) {
    return cached.quote
  }

  const accountId = oandaAccountId()
  const url =
    `${oandaBaseUrl()}/v3/accounts/${encodeURIComponent(accountId)}` +
    `/pricing?instruments=${encodeURIComponent(symbol)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  try {
    const res = await fetch(url, {
      headers: oandaHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error(`[OANDA] pricing ${res.status} ${symbol}`)
      return cached?.quote ?? null
    }
    const json = await res.json()
    const row = json?.prices?.[0]
    const bid = parseFloat(row?.bids?.[0]?.price ?? row?.closeoutBid)
    const ask = parseFloat(row?.asks?.[0]?.price ?? row?.closeoutAsk)
    if (!(bid > 0) || !(ask > 0)) return cached?.quote ?? null
    const price = (bid + ask) / 2
    const timeRaw = row?.time
    const timestamp = timeRaw
      ? Math.floor(new Date(timeRaw).getTime() / 1000)
      : Math.floor(Date.now() / 1000)

    const quote: OandaPriceQuote = {
      symbol,
      price,
      bid,
      ask,
      timestamp,
      source: 'oanda',
    }
    priceCache.set(instrument, { at: Date.now(), quote })
    return quote
  } catch (e) {
    console.error(
      `[OANDA] pricing failed ${symbol}:`,
      e instanceof Error ? e.message : e
    )
    return cached?.quote ?? null
  } finally {
    clearTimeout(timer)
  }
}
