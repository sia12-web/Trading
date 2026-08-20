/**
 * Shared OANDA practice/live config.
 */

import type { Instrument } from '@/types/price-feed'

export const OANDA_INSTRUMENTS: Partial<Record<Instrument, string>> = {
  DOW: 'US30_USD',
  NASDAQ: 'NAS100_USD',
  NIKKEI: 'JP225_USD',
  GOLD: 'XAU_USD',
  CRUDE: 'WTICO_USD',
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
  XAU_USD: 'GOLD',
  WTICO_USD: 'CRUDE',
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

/** Live desk is Tradeify / TradingView paste — never send OANDA orders. */
export function shouldExecuteOandaOrders(): boolean {
  return false
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
