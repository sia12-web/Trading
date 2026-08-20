/**
 * Yahoo symbols for the live Tradeify desk.
 * CME micros/minis match Tradovate MYM / MNQ / NKD / MGC / CL — not OANDA CFDs.
 */

import type { Instrument } from '@/types/price-feed'

/** Same scale as Tradovate MYM / MNQ / NKD / MGC / CL. */
export const YAHOO_CME_SYMBOLS: Record<Instrument, string> = {
  DOW: 'MYM=F',
  NASDAQ: 'MNQ=F',
  NIKKEI: 'NKD=F',
  GOLD: 'MGC=F',
  CRUDE: 'CL=F',
}

/** Cash indices / spots (OANDA CFD scale). Fallback only — IB will not match Tradovate. */
export const YAHOO_CASH_INDEX_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NIKKEI: '^N225',
  GOLD: 'GC=F',
  CRUDE: 'CL=F',
}

export const YAHOO_SYMBOLS = YAHOO_CME_SYMBOLS
