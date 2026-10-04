/**
 * One canonical market id for every AI stack.
 * Chart Leo / Desk News use display names (DOW, NASDAQ, …).
 * Fundamentals use futures codes (YM, NQ, …).
 * Both resolve here before anything is published or consumed.
 */

export const CANONICAL_MARKET_IDS = ['YM', 'NQ', 'GC', 'CL', 'NK225'] as const

export type CanonicalMarketId = (typeof CANONICAL_MARKET_IDS)[number]

export type CanonicalMarketMeta = {
  id: CanonicalMarketId
  displayName: 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE' | 'NIKKEI'
  exchange: 'CME'
  fundamentalsAgent: 'DOW_AGENT' | 'NASDAQ_AGENT' | 'GOLD_AGENT' | 'OIL_AGENT' | 'NIKKEI_AGENT'
  chartInstrument: 'DOW' | 'NASDAQ' | 'GOLD' | 'CRUDE' | 'NIKKEI'
}

export const CANONICAL_MARKETS: Record<CanonicalMarketId, CanonicalMarketMeta> = {
  YM: {
    id: 'YM',
    displayName: 'DOW',
    exchange: 'CME',
    fundamentalsAgent: 'DOW_AGENT',
    chartInstrument: 'DOW',
  },
  NQ: {
    id: 'NQ',
    displayName: 'NASDAQ',
    exchange: 'CME',
    fundamentalsAgent: 'NASDAQ_AGENT',
    chartInstrument: 'NASDAQ',
  },
  GC: {
    id: 'GC',
    displayName: 'GOLD',
    exchange: 'CME',
    fundamentalsAgent: 'GOLD_AGENT',
    chartInstrument: 'GOLD',
  },
  CL: {
    id: 'CL',
    displayName: 'CRUDE',
    exchange: 'CME',
    fundamentalsAgent: 'OIL_AGENT',
    chartInstrument: 'CRUDE',
  },
  NK225: {
    id: 'NK225',
    displayName: 'NIKKEI',
    exchange: 'CME',
    fundamentalsAgent: 'NIKKEI_AGENT',
    chartInstrument: 'NIKKEI',
  },
}

const ALIASES: Record<string, CanonicalMarketId> = {
  YM: 'YM',
  DOW: 'YM',
  MYM: 'YM',
  NQ: 'NQ',
  NASDAQ: 'NQ',
  MNQ: 'NQ',
  GC: 'GC',
  GOLD: 'GC',
  MGC: 'GC',
  CL: 'CL',
  CRUDE: 'CL',
  MCL: 'CL',
  WTI: 'CL',
  OIL: 'CL',
  NK225: 'NK225',
  NIKKEI: 'NK225',
  NKD: 'NK225',
}

export function resolveCanonicalMarketId(raw?: string | null): CanonicalMarketId | null {
  const key = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  if (!key) return null
  return ALIASES[key] ?? null
}

export function canonicalMarketMeta(raw?: string | null): CanonicalMarketMeta | null {
  const id = resolveCanonicalMarketId(raw)
  return id ? CANONICAL_MARKETS[id] : null
}
