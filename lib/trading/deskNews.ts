/**
 * Desk news — tag, rank, and frame Finnhub headlines for DOW / NASDAQ / NIKKEI.
 * Context only — never a trade signal.
 */

export type DeskNewsInstrument = 'DOW' | 'NASDAQ' | 'NIKKEI'
export type DeskNewsTag = 'MACRO' | 'EARNINGS' | 'GEO' | 'FLOW' | 'OTHER'
export type DeskNewsWindowHours = 2 | 12 | 24

export type RawDeskHeadline = {
  headline: string
  source: string
  datetime: number
  url?: string | null
  summary?: string | null
  related?: string | null
  /** Hint from fetch path (proxy symbol or market category) */
  origin?: string
}

export type DeskNewsCard = {
  id: string
  instruments: DeskNewsInstrument[]
  headline: string
  source: string
  url: string | null
  datetime: number
  tag: DeskNewsTag
  deskNote: string
  summary: string | null
}

export type DeskCalendarEvent = {
  id: string
  time: string
  country: string
  event: string
  impact: string
  instruments: DeskNewsInstrument[]
  deskNote: string
}

const PREFERRED_SOURCES = [
  'reuters',
  'bloomberg',
  'nikkei',
  'wsj',
  'wall street journal',
  'cnbc',
  'financial times',
  'marketwatch',
  'yahoo',
  'associated press',
]

const DOW_KEYS =
  /\b(dow|djia|industrial average|blue.?chip|dia\b|caterpillar|boeing|walmart|goldman|jpmorgan|home depot)\b/i
const NASDAQ_KEYS =
  /\b(nasdaq|ndx|qqq|mega.?cap tech|nvidia|nvda|apple|aapl|microsoft|msft|meta|amazon|amzn|tesla|tsla|google|alphabet|googl)\b/i
const NIKKEI_KEYS =
  /\b(nikkei|japan|tokyo|boj|yen|usdjpy|softbank|toyota|sony|nintendo|japan.?equity|asia.?session)\b/i

const MACRO_KEYS =
  /\b(fed|fomc|cpi|inflation|jobs|payroll|nfp|gdp|rate.?cut|rate.?hike|treasury|yield|powell|boj|ecb|pce|unemployment)\b/i
const EARNINGS_KEYS =
  /\b(earn(ings)?|guidance|eps|revenue|beat|miss|quarterly|results)\b/i
const GEO_KEYS =
  /\b(war|sanction|tariff|geopolit|election|conflict|missile|invasion|opec|middle east|taiwan|china.?risk)\b/i
const FLOW_KEYS =
  /\b(etf|flow|futures|option|put.?call|short.?interest|liquidation|squeeze|volume.?spike)\b/i

export function normalizeHeadlineKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tagDeskNews(headline: string, summary?: string | null): DeskNewsTag {
  const text = `${headline} ${summary || ''}`
  if (MACRO_KEYS.test(text)) return 'MACRO'
  if (EARNINGS_KEYS.test(text)) return 'EARNINGS'
  if (GEO_KEYS.test(text)) return 'GEO'
  if (FLOW_KEYS.test(text)) return 'FLOW'
  return 'OTHER'
}

export function instrumentsForHeadline(
  headline: string,
  summary?: string | null,
  related?: string | null,
  origin?: string
): DeskNewsInstrument[] {
  const text = `${headline} ${summary || ''} ${related || ''} ${origin || ''}`
  const hit = new Set<DeskNewsInstrument>()

  if (DOW_KEYS.test(text) || /\bDIA\b/.test(origin || '')) hit.add('DOW')
  if (NASDAQ_KEYS.test(text) || /\bQQQ\b/.test(origin || '')) hit.add('NASDAQ')
  if (NIKKEI_KEYS.test(text) || /\bEWJ\b/.test(origin || '')) hit.add('NIKKEI')

  // Proxy origin without keyword hit still maps to that desk
  if (origin === 'DIA') hit.add('DOW')
  if (origin === 'QQQ') hit.add('NASDAQ')
  if (origin === 'EWJ') hit.add('NIKKEI')

  // Broad US risk-on/off market news → both US desks
  if (hit.size === 0 && /\b(stock|equity|wall street|s&p|spx|futures)\b/i.test(text)) {
    hit.add('DOW')
    hit.add('NASDAQ')
  }

  if (hit.size === 0) {
    // Unscoped general → all three so All-tab still useful; desk tabs filter later
    return ['DOW', 'NASDAQ', 'NIKKEI']
  }
  return Array.from(hit)
}

export function deskNoteFor(
  tag: DeskNewsTag,
  instruments: DeskNewsInstrument[],
  headline: string
): string {
  const desks = instruments.join(' · ')
  const lower = headline.toLowerCase()
  switch (tag) {
    case 'MACRO':
      if (/\bcpi|inflation|pce\b/.test(lower)) {
        return `Macro print — watch rate-cut odds; can whip ${desks} risk appetite.`
      }
      if (/\bfed|fomc|powell|rate\b/.test(lower)) {
        return `Central-bank / rates story — primary driver for ${desks} bias.`
      }
      if (/\bboj|yen|japan\b/.test(lower)) {
        return `Japan/BoJ macro — Nikkei and USDJPY-sensitive risk first.`
      }
      return `Macro catalyst for ${desks} — context only, not an entry.`
    case 'EARNINGS':
      return `Earnings/guidance — name-level flow that can leak into ${desks}.`
    case 'GEO':
      return `Geopolitical risk — risk-off impulse possible for ${desks}.`
    case 'FLOW':
      return `Flow/positioning headline — watch for chase or squeeze in ${desks}.`
    default:
      return `Desk context for ${desks} — use for bias, not as a trade signal.`
  }
}

function sourceRank(source: string): number {
  const s = source.toLowerCase()
  const idx = PREFERRED_SOURCES.findIndex((p) => s.includes(p))
  return idx === -1 ? 50 : idx
}

export function buildDeskNewsCards(
  raw: RawDeskHeadline[],
  opts?: {
    windowHours?: DeskNewsWindowHours
    nowUnix?: number
    limitPerDesk?: number
    sessionFilter?: boolean
    focusMarket?: 'NY' | 'TOKYO' | null
  }
): DeskNewsCard[] {
  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000)
  const windowHours = opts?.windowHours ?? 12
  const cutoff = nowUnix - windowHours * 3600
  const limit = opts?.limitPerDesk ?? 10
  const sessionFilter = !!opts?.sessionFilter
  const focus = opts?.focusMarket ?? null

  const seen = new Set<string>()
  const cards: DeskNewsCard[] = []

  const sorted = [...raw].sort((a, b) => {
    if (b.datetime !== a.datetime) return b.datetime - a.datetime
    return sourceRank(a.source) - sourceRank(b.source)
  })

  for (const item of sorted) {
    if (!item.headline || !Number.isFinite(item.datetime)) continue
    if (item.datetime < cutoff) continue
    const key = normalizeHeadlineKey(item.headline)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const instruments = instrumentsForHeadline(
      item.headline,
      item.summary,
      item.related,
      item.origin
    )
    if (sessionFilter && focus === 'NY') {
      if (!instruments.includes('DOW') && !instruments.includes('NASDAQ')) continue
    }
    if (sessionFilter && focus === 'TOKYO') {
      if (!instruments.includes('NIKKEI')) continue
    }

    const tag = tagDeskNews(item.headline, item.summary)
    cards.push({
      id: `${item.datetime}-${key.slice(0, 40)}`,
      instruments,
      headline: item.headline.trim(),
      source: (item.source || 'Finnhub').trim(),
      url: item.url || null,
      datetime: item.datetime,
      tag,
      deskNote: deskNoteFor(tag, instruments, item.headline),
      summary: item.summary?.trim() || null,
    })
  }

  // Cap overall while keeping roughly fair mix — slice after sort
  return cards.slice(0, limit * 3)
}

export function filterCardsForDesk(
  cards: DeskNewsCard[],
  desk: DeskNewsInstrument | 'ALL',
  limit = 10
): DeskNewsCard[] {
  if (desk === 'ALL') return cards.slice(0, limit)
  return cards.filter((c) => c.instruments.includes(desk)).slice(0, limit)
}

export function instrumentsForCalendarEvent(country: string, event: string): DeskNewsInstrument[] {
  const text = `${country} ${event}`
  if (/\b(JP|Japan|BoJ|Tokyo)\b/i.test(text)) return ['NIKKEI']
  if (/\b(US|USA|United States|Fed|FOMC)\b/i.test(text)) return ['DOW', 'NASDAQ']
  if (/\b(EU|ECB|UK|GBP|Euro)\b/i.test(text)) return ['DOW', 'NASDAQ', 'NIKKEI']
  return ['DOW', 'NASDAQ', 'NIKKEI']
}

export function deskNoteForCalendar(instruments: DeskNewsInstrument[], impact: string): string {
  const desks = instruments.join(' · ')
  const hi = /high/i.test(impact)
  return hi
    ? `High-impact print — expect volatility in ${desks}. Context only.`
    : `Scheduled event for ${desks} — note the clock before entries.`
}
