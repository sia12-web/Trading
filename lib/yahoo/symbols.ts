/**
 * Yahoo symbols for the live Tradeify desk.
 * CME micros/minis match Tradovate MYM / MNQ / NKD — not OANDA US30/NAS100/JP225.
 */

import type { Instrument } from '@/types/price-feed'

/** Same scale as Tradovate MYM / MNQ / NKD. */
export const YAHOO_CME_SYMBOLS: Record<Instrument, string> = {
  DOW: 'MYM=F',
  NASDAQ: 'MNQ=F',
  NIKKEI: 'NKD=F',
}

/** Cash indices (OANDA CFD scale). Fallback only — IB will not match Tradovate. */
export const YAHOO_CASH_INDEX_SYMBOLS: Record<Instrument, string> = {
  DOW: '^DJI',
  NASDAQ: '^NDX',
  NIKKEI: '^N225',
}

export const YAHOO_SYMBOLS = YAHOO_CME_SYMBOLS
