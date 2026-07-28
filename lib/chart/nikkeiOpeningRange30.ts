/**
 * Re-export — prefer `@/lib/chart/openingRange30` (DOW / NASDAQ / NIKKEI).
 */
export {
  OR30_MINUTES,
  OR30_COLORS,
  NIKKEI_OR30_MINUTES,
  NIKKEI_OR30_COLORS,
  computeOr30Range,
  computeNikkeiOr30Range,
  computeOr30Signals,
  or30LineSeriesData,
  nikkeiOr30LineSeriesData,
  isOr30Instrument,
  isNikkeiOr30Instrument,
  or30WindowLabel,
  type Or30Range,
  type NikkeiOr30Range,
} from '@/lib/chart/openingRange30'
