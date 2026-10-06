/**
 * Desk honesty helpers.
 * A figure is shown only when a feed actually returned it.
 * Keyword matches never authorize an inventory, a yield, or a point impact.
 */

export const UNAVAILABLE = 'Unavailable'

export interface QuoteSourcing {
  prompt?: boolean
  brent?: boolean
  crack?: boolean
  nq?: boolean
  es?: boolean
  ym?: boolean
  dji?: boolean
  rty?: boolean
  us2y?: boolean
  us5y?: boolean
  us10y?: boolean
  us10yReal?: boolean
  us5yReal?: boolean
  breakeven?: boolean
  vix?: boolean
  vxn?: boolean
  dxy?: boolean
  gold?: boolean
  silver?: boolean
  eurusd?: boolean
  usdjpy?: boolean
  hyOas?: boolean
  nkd?: boolean
  sox?: boolean
  news?: boolean
}

export function confidencePercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  if (value > 0 && value <= 1) return Math.round(value * 100)
  return Math.round(Math.min(100, Math.max(0, value)))
}

export function showNumber(
  live: boolean | undefined,
  value: number | null | undefined,
  digits = 2,
  suffix = '',
): string {
  if (!live || value == null || !Number.isFinite(value)) return UNAVAILABLE
  return `${value.toFixed(digits)}${suffix}`
}

export function sortByDatetimeDesc<T extends { datetime: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
}

export function textContainsNumber(text: string, value: number): boolean {
  if (!Number.isFinite(value)) return false
  const abs = Math.abs(value)
  const forms = [String(value), String(abs), abs.toFixed(0), abs.toFixed(1), abs.toFixed(2), String(Math.round(abs))]
  return forms.some((form) => form.length > 0 && text.includes(form))
}

/** Point impacts are echoed only when that magnitude is already in the source note. */
export function sourcedImpact(rawText: string, impact: number | null | undefined): number | null {
  if (impact == null || !Number.isFinite(impact) || impact === 0) return null
  return textContainsNumber(rawText, impact) ? impact : null
}

export function scrubSummary(rawText: string, summary: string): string {
  const cited = summary.match(/-?\d+(?:\.\d+)?/g) || []
  const invented = cited.some((token) => !rawText.includes(token))
  if (invented || !summary.trim()) {
    return 'The note names a topic. It does not include a sourced print, so no inventory, yield, or point impact is stated.'
  }
  return summary
}

export function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function tokyoCashPhase(now = new Date()): 'PREP' | 'MORNING_CASH' | 'LUNCH_BREAK' | 'AFTERNOON_CASH' | 'CLOSED' {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    hourCycle: 'h23',
    minute: 'numeric',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  const mins = hour * 60 + minute
  if (mins >= 8 * 60 && mins < 9 * 60) return 'PREP'
  if (mins >= 9 * 60 && mins < 11 * 60 + 30) return 'MORNING_CASH'
  if (mins >= 11 * 60 + 30 && mins < 12 * 60 + 30) return 'LUNCH_BREAK'
  if (mins >= 12 * 60 + 30 && mins < 15 * 60) return 'AFTERNOON_CASH'
  return 'CLOSED'
}

const LIVE_FEED = new Set(['ONLINE', 'ACTIVE', 'POLLING'])

export function connectedFeedCount(feeds: Array<{ status: string }>): { connected: number; total: number } {
  return {
    connected: feeds.filter((feed) => LIVE_FEED.has(feed.status)).length,
    total: feeds.length,
  }
}

export function markFeed<T extends { id: string; status: string; lastSync: string }>(
  feeds: T[],
  id: string,
  status: T['status'],
  lastSync: string,
): void {
  const feed = feeds.find((row) => row.id === id)
  if (!feed) return
  feed.status = status
  feed.lastSync = lastSync
}

export function whenSourced(live: boolean | undefined, text: string): string {
  return live ? text : UNAVAILABLE
}

export function blankMetricValues<
  T extends {
    metrics: Array<{ label: string; value: string | number; change?: string; stance?: string }>
    summary?: string
    stance?: string
  },
>(record: Record<string, T>): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, row] of Object.entries(record)) {
    next[key] = {
      ...row,
      ...(row.stance !== undefined ? { stance: 'NEUTRAL' as T['stance'] } : {}),
      ...(row.summary !== undefined ? { summary: 'Unavailable until a live print is on the feed.' } : {}),
      metrics: row.metrics.map((metric) => ({
        ...metric,
        value: 'Unavailable',
        ...(metric.change !== undefined ? { change: 'Unavailable' } : {}),
        ...(metric.stance !== undefined ? { stance: 'NEUTRAL' } : {}),
      })),
    }
  }
  return next
}

export function withholdFeeds<T extends { status: string; lastSync: string; latency?: string }>(feeds: T[]): T[] {
  return feeds.map((feed) => ({
    ...feed,
    status: 'UNAVAILABLE' as T['status'],
    lastSync: 'Not probed',
    ...(feed.latency !== undefined ? { latency: '—' } : {}),
  }))
}
