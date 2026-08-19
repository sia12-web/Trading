/**
 * Map OANDA CFD mids onto CME futures so live ticks stay on Tradovate scale.
 * Basis is futures last − OANDA mid (typically ~40–80 Dow pts / ~50–90 Nasdaq pts).
 *
 * Yahoo CME lasts are ~10 minutes delayed. Pair them with a same-age OANDA mid —
 * never with the live book — then apply the cached basis to live OANDA ticks.
 */

import type { Instrument } from '@/types/price-feed'
import {
  getYahooQuote,
  isYahooPrintLiveGrade,
  isYahooPrintUsableForBasis,
} from '@/lib/yahoo/quote'
import {
  getLastStreamedPrice,
  getStreamedMidNear,
  recordOandaMidSample,
} from '@/lib/oanda/pricingStream'
import { getOandaCandlesRange } from '@/lib/oanda/candles'

/** Typical 40–80 Dow / 50–90 Nasdaq, with headroom. Outside this is a bad print. */
export const CME_BASIS_MAX_ABS: Record<Instrument, number> = {
  DOW: 120,
  NASDAQ: 140,
  NIKKEI: 150,
}

/** Tight pairing: delayed futures last vs OANDA mid of the same second. */
export const CME_BASIS_PAIR_WINDOW_MS = 2_000

/** M1 backfill is 60s bars — only used when the tick ring has no sample near the print. */
export const CME_BASIS_COLD_PAIR_WINDOW_MS = 60_000

export const CME_BASIS_SAMPLE_N = 5

/** Carry + dividends drift over hours, so a recent basis stays usable for a shift. */
export const CME_BASIS_TTL_MS = 60_000

/** How often the basis is re-derived while a desk consumer is live. */
export const CME_BASIS_REFRESH_MS = 2_000

export function cmeBasisFromPair(
  oandaMid: number,
  futuresLast: number,
  instrument: Instrument
): number | null {
  if (!(oandaMid > 0) || !(futuresLast > 0)) return null
  const basis = futuresLast - oandaMid
  const maxAbs = CME_BASIS_MAX_ABS[instrument]
  if (!(maxAbs > 0) || Math.abs(basis) > maxAbs) return null
  return basis
}

export function applyCmeBasis(
  oandaPrice: number,
  basis: number | null
): number {
  if (basis == null || !(oandaPrice > 0)) return oandaPrice
  return oandaPrice + basis
}

export function applyCmeBasisToCandles<
  T extends { open: number; high: number; low: number; close: number },
>(candles: T[], basis: number | null): T[] {
  if (basis == null || !Number.isFinite(basis)) return candles
  return candles.map((c) => ({
    ...c,
    open: c.open + basis,
    high: c.high + basis,
    low: c.low + basis,
    close: c.close + basis,
  }))
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

type BasisEntry = { basis: number; at: number }

/** Shared across SSE connections, reconnects and REST polls in this process. */
const g = globalThis as typeof globalThis & {
  __cmeBasis?: Map<Instrument, BasisEntry>
  __cmeBasisInFlight?: Map<Instrument, Promise<number | null>>
  __cmeBasisSamples?: Map<Instrument, number[]>
  __cmeBasisBackfillAt?: Map<Instrument, number>
}

function basisStore(): Map<Instrument, BasisEntry> {
  if (!g.__cmeBasis) g.__cmeBasis = new Map()
  return g.__cmeBasis
}

function inFlight(): Map<Instrument, Promise<number | null>> {
  if (!g.__cmeBasisInFlight) g.__cmeBasisInFlight = new Map()
  return g.__cmeBasisInFlight
}

function sampleStore(): Map<Instrument, number[]> {
  if (!g.__cmeBasisSamples) g.__cmeBasisSamples = new Map()
  return g.__cmeBasisSamples
}

function backfillAt(): Map<Instrument, number> {
  if (!g.__cmeBasisBackfillAt) g.__cmeBasisBackfillAt = new Map()
  return g.__cmeBasisBackfillAt
}

export function setCmeBasis(instrument: Instrument, basis: number | null): void {
  if (basis == null || !Number.isFinite(basis)) return
  basisStore().set(instrument, { basis, at: Date.now() })
}

function pushBasisSample(instrument: Instrument, basis: number): number {
  const samples = sampleStore().get(instrument) ?? []
  samples.push(basis)
  while (samples.length > CME_BASIS_SAMPLE_N) samples.shift()
  sampleStore().set(instrument, samples)
  const median = medianOf(samples) ?? basis
  setCmeBasis(instrument, median)
  return median
}

/** Cached basis strictly newer than maxAgeMs, else null. */
export function getCmeBasis(
  instrument: Instrument,
  maxAgeMs: number = CME_BASIS_TTL_MS
): number | null {
  const row = basisStore().get(instrument)
  if (!row) return null
  if (Date.now() - row.at >= maxAgeMs) return null
  return row.basis
}

/** Basis at any age — a stale shift is still far closer than an unshifted mid. */
export function getLastKnownCmeBasis(instrument: Instrument): number | null {
  return basisStore().get(instrument)?.basis ?? null
}

/**
 * Find an OANDA mid contemporaneous with the Yahoo futures print.
 * Delayed prints must not pair with the live book (that just reproduces the
 * 10-minute-old last). Live-grade prints may use the live mid.
 */
export function pairOandaMidForYahooPrint(
  instrument: Instrument,
  yahoo: { price: number; timestamp: number; delayedBySec: number },
  opts?: { fallbackMid?: number; nowMs?: number }
): number | null {
  const nowMs = opts?.nowMs ?? Date.now()
  if (!isYahooPrintUsableForBasis(yahoo, nowMs)) return null

  const tight = getStreamedMidNear(
    instrument,
    yahoo.timestamp,
    CME_BASIS_PAIR_WINDOW_MS
  )
  if (tight != null) return tight

  if (isYahooPrintLiveGrade(yahoo, nowMs)) {
    return (
      getLastStreamedPrice(instrument, CME_BASIS_PAIR_WINDOW_MS)?.price ??
      opts?.fallbackMid ??
      null
    )
  }

  return getStreamedMidNear(
    instrument,
    yahoo.timestamp,
    CME_BASIS_COLD_PAIR_WINDOW_MS
  )
}

async function backfillOandaMids(
  instrument: Instrument,
  printUnix: number
): Promise<void> {
  const last = backfillAt().get(instrument) ?? 0
  if (Date.now() - last < 60_000) return
  backfillAt().set(instrument, Date.now())
  try {
    const nowSec = Math.floor(Date.now() / 1000)
    const from = Math.max(1, Math.min(printUnix, nowSec) - 15 * 60)
    const to = nowSec
    const pack = await getOandaCandlesRange(instrument, '1', from, to)
    if (!pack?.candles?.length) return
    for (const c of pack.candles) {
      if (c.close > 0 && c.time > 0) {
        recordOandaMidSample(instrument, c.close, c.time * 1000)
      }
    }
  } catch {
    /* fail closed — keep last good basis */
  }
}

/**
 * Re-derive the basis from a Yahoo futures last paired with a same-age OANDA
 * mid, and cache the median of recent valid samples. Deduplicated per instrument.
 * Resolves to the last known basis on failure so callers never downgrade to an
 * unshifted price because of a transient error.
 */
export function warmCmeBasis(
  instrument: Instrument,
  opts?: { oandaMid?: number }
): Promise<number | null> {
  const running = inFlight().get(instrument)
  if (running) return running

  const fallbackMid = opts?.oandaMid

  const task = (async (): Promise<number | null> => {
    try {
      const yahoo = await getYahooQuote(instrument)
      if (!yahoo || !(yahoo.price > 0)) return getLastKnownCmeBasis(instrument)
      if (!isYahooPrintUsableForBasis(yahoo)) {
        return getLastKnownCmeBasis(instrument)
      }

      let mid = pairOandaMidForYahooPrint(instrument, yahoo, { fallbackMid })
      if (mid == null) {
        await backfillOandaMids(instrument, yahoo.timestamp)
        mid = pairOandaMidForYahooPrint(instrument, yahoo, { fallbackMid })
      }
      if (!(mid && mid > 0)) return getLastKnownCmeBasis(instrument)

      const next = cmeBasisFromPair(mid, yahoo.price, instrument)
      if (next == null) return getLastKnownCmeBasis(instrument)
      return pushBasisSample(instrument, next)
    } catch {
      return getLastKnownCmeBasis(instrument)
    } finally {
      inFlight().delete(instrument)
    }
  })()

  inFlight().set(instrument, task)
  return task
}

export function __resetCmeBasisForTest(): void {
  g.__cmeBasis = new Map()
  g.__cmeBasisInFlight = new Map()
  g.__cmeBasisSamples = new Map()
  g.__cmeBasisBackfillAt = new Map()
}
