/**
 * Shared OANDA practice/live config.
 */

import type { Instrument } from '@/types/price-feed'

export const OANDA_INSTRUMENTS: Partial<Record<Instrument, string>> = {
  DOW: 'US30_USD',
  NASDAQ: 'NAS100_USD',
  NIKKEI: 'JP225_USD',
}

export function oandaBaseUrl(): string {
  const env = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase()
  return env === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com'
}

/** Persistent pricing stream host (different from REST api-fx*) */
export function oandaStreamBaseUrl(): string {
  const env = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase()
  return env === 'live'
    ? 'https://stream-fxtrade.oanda.com'
    : 'https://stream-fxpractice.oanda.com'
}

const OANDA_TO_DESK: Record<string, Instrument> = {
  US30_USD: 'DOW',
  NAS100_USD: 'NASDAQ',
  JP225_USD: 'NIKKEI',
}

export function fromOandaInstrument(symbol: string): Instrument | null {
  return OANDA_TO_DESK[symbol] ?? null
}

export function oandaAccountId(): string {
  return (process.env.OANDA_ACCOUNT_ID || '').trim()
}

export function oandaApiKey(): string {
  return (process.env.OANDA_API_KEY || '').trim()
}

export function isOandaConfigured(): boolean {
  return Boolean(oandaApiKey() && oandaAccountId())
}

/** When true (default if configured), open/close hit the broker. */
export function shouldExecuteOandaOrders(): boolean {
  if (!isOandaConfigured()) return false
  const flag = (process.env.OANDA_EXECUTE_ORDERS || 'true').toLowerCase()
  return flag !== 'false' && flag !== '0' && flag !== 'off'
}

export function oandaHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${oandaApiKey()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export function toOandaInstrument(instrument: Instrument): string | null {
  return OANDA_INSTRUMENTS[instrument] || null
}
