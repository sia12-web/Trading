/**
 * Shared quote and FRED reads for the fundamentals desks.
 * A number reaches the dashboard only after one of these calls returns it.
 */

export interface YahooPrint {
  price: number
  changePct: number
  previousClose: number | null
}

export async function fetchYahooPrint(symbol: string): Promise<YahooPrint | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    const price = Number(meta?.regularMarketPrice)
    const previous = Number(meta?.chartPreviousClose || meta?.previousClose)
    if (!(price > 0)) return null
    const previousClose = previous > 0 ? previous : null
    const changePct = previousClose ? +(((price - previousClose) / previousClose) * 100).toFixed(2) : 0
    return { price, changePct, previousClose }
  } catch {
    return null
  }
}

/** Latest numeric observation. Skips FRED's "." missing marker. */
export async function fetchFredLatest(seriesId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4500),
      }
    )
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.trim().split('\n')
    for (let i = lines.length - 1; i >= 1; i--) {
      const line = lines[i]
      if (!line) continue
      const parts = line.split(',')
      const raw = parts[1]?.trim()
      if (!raw || raw === '.') continue
      const value = Number(raw)
      if (Number.isFinite(value)) return value
    }
    return null
  } catch {
    return null
  }
}

/**
 * ICE BofA OAS on FRED is a percent (3.15 = 315 bps).
 * A print already above 25 is treated as basis points so a unit change cannot print 31,500.
 */
export function oasToBps(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value > 25 ? Math.round(value) : Math.round(value * 100)
}

export function cloneState<T>(value: T): T {
  return structuredClone(value)
}

export function markFeedsDisconnected<T extends { status: string; lastSync: string; latency?: string }>(
  feeds: T[]
): T[] {
  return feeds.map((feed) => ({
    ...feed,
    status: 'FALLBACK' as T['status'],
    lastSync: 'Not connected',
    ...(feed.latency !== undefined ? { latency: 'not connected' } : {}),
  }))
}

/** Clears invented driver cards. Live refresh writes back only the series it fetched. */
export function blankDriverCards(
  drivers: Record<string, { summary?: string; stance?: string; lastUpdated?: string; metrics?: object[] }>
): void {
  for (const driver of Object.values(drivers)) {
    if (driver.summary !== undefined) driver.summary = 'Not on this feed.'
    if (driver.stance !== undefined) driver.stance = 'NEUTRAL'
    if (driver.lastUpdated !== undefined) driver.lastUpdated = ''
    for (const metric of driver.metrics ?? []) {
      const row = metric as Record<string, unknown>
      if ('value' in row) row.value = '—'
      if (typeof row.currentValue === 'number') row.currentValue = 0
      if (typeof row.currentValue === 'string') row.currentValue = '—'
      if ('change' in row) row.change = ''
      if ('priorValue' in row && typeof row.priorValue === 'number') row.priorValue = 0
      if (typeof row.stance === 'string') row.stance = 'NEUTRAL'
      if (typeof row.trend === 'string') row.trend = 'FLAT'
      if (typeof row.note === 'string') row.note = 'Not on this feed'
    }
  }
}

export function markFeed<T extends { id: string; status: string; lastSync: string; latency?: string }>(
  feeds: T[],
  id: string,
  connected: boolean,
  latency = 'Yahoo, delayed'
): void {
  const feed = feeds.find((item) => item.id === id)
  if (!feed) return
  feed.status = (connected ? 'ONLINE' : 'FALLBACK') as T['status']
  feed.lastSync = connected ? new Date().toISOString() : 'Not connected'
  if (feed.latency !== undefined) feed.latency = connected ? latency : 'not connected'
}
