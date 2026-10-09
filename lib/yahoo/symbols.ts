/**
 * Yahoo symbols for the live Futures desk.
 * CME micros/minis match CME MYM / MNQ / NKD / MGC / CL — not OANDA CFDs.
 */

import type { Instrument } from '@/types/price-feed'

/** Same scale as CME MYM / MNQ / NKD / MGC / CL. */
export const YAHOO_CME_SYMBOLS: Record<Instrument, string> = {
  DOW: 'MYM=F',
  NASDAQ: 'MNQ=F',
  NIKKEI: 'NKD=F',
  GOLD: 'MGC=F',
  CRUDE: 'CL=F',
  SILVER: 'SIL=F',
}

/** Cash indices / spots (OANDA CFD scale). Fallback only — IB will not match CME futures. */
export const YAHOO_CASH_INDEX_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NIKKEI: '^N225',
  GOLD: 'GC=F',
  CRUDE: 'CL=F',
  SILVER: 'SI=F',
}

export const YAHOO_SYMBOLS = YAHOO_CME_SYMBOLS
