import type { AnchoredVwapBenchmark5M, ContextBar } from '@/lib/chart/context55'

export interface Context55CacheEntry {
  benchmark: AnchoredVwapBenchmark5M
  dailyBars: ContextBar[]
  source: 'cme_globex' | 'yahoo_cme'
  timestamp: number
}

const cache = new Map<string, Context55CacheEntry>()

export function readContext55Cache(instrument: string): Context55CacheEntry | undefined {
  return cache.get(instrument)
}

export function writeContext55Cache(instrument: string, entry: Context55CacheEntry): void {
  cache.set(instrument, entry)
}

export function invalidateContext55Cache(instrument?: string): void {
  if (instrument) cache.delete(instrument)
  else cache.clear()
}
