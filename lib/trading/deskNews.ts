/**
 * Desk news — tag, rank, and frame Finnhub headlines for DOW / NASDAQ / NIKKEI.
 * Context only — never a trade signal.
 */

export type DeskNewsInstrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | 'SILVER'
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
  actual?: string | number | null
  estimate?: string | number | null
  prev?: string | number | null
  outcome?: 'HIKE' | 'CUT' | 'HOLD' | 'BEAT' | 'MISS' | 'IN_LINE' | null
  changeBps?: number | null
  targetRange?: string | null
  resultHeadline?: string | null
  resultUrl?: string | null
  releasedAt?: string | null
  isReleased?: boolean
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
  /\b(nasdaq|ndx|qqq|mega.?cap tech|nvidia|nvda|apple|aapl|microsoft|msft|meta|amazon|amzn|tesla|tsla|google|alphabet|googl|samsung|sk.?hynix|semiconductor|chip)\b/i
const NIKKEI_KEYS =
  /\b(nikkei|japan|tokyo|boj|yen|usdjpy|softbank|toyota|sony|nintendo|japan.?equity|asia.?session)\b/i
const KOREA_KEYS =
  /\b(korea|korean|seoul|krw|samsung|sk.?hynix|north korea|dprk|peninsula)\b/i

const GOLD_KEYS =
  /\b(gold|xau|bullion|mgc|gc1|gld|precious.?metal)\b/i
const CRUDE_KEYS =
  /\b(crude|wti|brent|oil\b|opec|cl1|uso|energy.?oil)\b/i
const SILVER_KEYS =
  /\b(silver|xag|slv|sil1|si1|comex.?silver)\b/i

const MACRO_KEYS =
  /\b(fed|fomc|cpi|inflation|jobs|payroll|nfp|gdp|rate.?cut|rate.?hike|treasury|yield|powell|boj|ecb|pce|unemployment)\b/i
const EARNINGS_KEYS =
  /\b(earn(ings)?|guidance|eps|revenue|beat|miss|quarterly|results)\b/i
const GEO_KEYS =
  /\b(war|sanction|tariff|geopolit|election|conflict|missile|invasion|opec|middle east|taiwan|china.?risk|korea|korean|north korea|dprk|peninsula)\b/i
const FLOW_KEYS =
  /\b(etf|flow|futures|option|put.?call|short.?interest|liquidation|squeeze|volume.?spike)\b/i

/** Finnhub uses seconds; tolerate accidental ms. Reject nonsense. */
export function normalizeNewsDatetime(raw: number, nowUnix = Math.floor(Date.now() / 1000)): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null
  let sec = raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw)
  // Reject far-future clock skew ( > 1h ahead )
  if (sec > nowUnix + 3600) return null
  // Reject ancient noise before year ~2000
  if (sec < 946684800) return null
  return sec
}

/** Only allow http(s) source links — drop javascript:/data: etc. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

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
  if (GOLD_KEYS.test(text) || /\bGLD\b/.test(origin || '')) hit.add('GOLD')
  if (CRUDE_KEYS.test(text) || /\bUSO\b/.test(origin || '')) hit.add('CRUDE')
  if (SILVER_KEYS.test(text) || /\bSLV\b/.test(origin || '')) hit.add('SILVER')

  // Korea / peninsula risk → US indices first (semis/risk), Asia if Japan session channel
  if (KOREA_KEYS.test(text)) {
    hit.add('NASDAQ')
    hit.add('DOW')
    if (/\b(asia|japan|nikkei|overnight|risk.?off)\b/i.test(text)) {
      hit.add('NIKKEI')
    }
  }

  // Proxy origin without keyword hit still maps to that desk
  if (origin === 'DIA') hit.add('DOW')
  if (origin === 'QQQ') hit.add('NASDAQ')
  if (origin === 'EWJ') hit.add('NIKKEI')
  if (origin === 'SLV') hit.add('SILVER')

  // Broad US risk-on/off market news → both US desks
  if (hit.size === 0 && /\b(stock|equity|wall street|s&p|spx|futures|market rally|selloff|treasury|rate cut|rate hike)\b/i.test(text)) {
    hit.add('DOW')
    hit.add('NASDAQ')
  }

  // Only return instruments if there was a verified relevant match (no spamming all desks)
  return Array.from(hit)
}

/**
 * Institutional filter: Is this headline truly market-moving and relevant to CME futures?
 * Rejects clickbait, lifestyle, retail consumer fluff, and irrelevant noise.
 */
export function isReallyImportantHeadline(headline: string, summary?: string | null): boolean {
  if (!headline || typeof headline !== 'string') return false
  const text = `${headline} ${summary || ''}`.toLowerCase()

  if (/\b(horoscope|celebrity|entertainment|lifestyle|recipe|lottery|giveaway|sponsored|top deals|best buys|black friday|shopping)\b/i.test(text)) {
    return false
  }

  return (
    MACRO_KEYS.test(text) ||
    GEO_KEYS.test(text) ||
    DOW_KEYS.test(text) ||
    NASDAQ_KEYS.test(text) ||
    NIKKEI_KEYS.test(text) ||
    GOLD_KEYS.test(text) ||
    CRUDE_KEYS.test(text) ||
    SILVER_KEYS.test(text) ||
    EARNINGS_KEYS.test(text) ||
    /\b(yield|treasury|recession|deficit|dollar|dxy|wall street|equities|futures|rally|selloff|market rout|rate cut|rate hike|central bank|inflation|liquidity|absorption|tightening|easing|crude|opec)\b/i.test(text)
  )
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
      if (KOREA_KEYS.test(lower)) {
        return `Korea/peninsula risk — watch NASDAQ semis & US risk appetite; ${desks} may feel spillover.`
      }
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

function matchesFocusMarket(
  instruments: DeskNewsInstrument[],
  focus: 'NY' | 'TOKYO'
): boolean {
  if (focus === 'NY') return instruments.includes('DOW') || instruments.includes('NASDAQ')
  return instruments.includes('NIKKEI')
}

/**
 * Build ranked, deduped cards for the window.
 * Session filter is NOT applied here — apply via filterCardsForDesk so
 * per-desk tabs stay complete when browsing off-focus desks.
 */
export function buildDeskNewsCards(
  raw: RawDeskHeadline[],
  opts?: {
    windowHours?: DeskNewsWindowHours
    nowUnix?: number
    limitPerDesk?: number
  }
): DeskNewsCard[] {
  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000)
  const windowHours = opts?.windowHours ?? 12
  const cutoff = nowUnix - windowHours * 3600
  const limit = opts?.limitPerDesk ?? 10

  const seen = new Set<string>()
  const cards: DeskNewsCard[] = []

  const sorted = [...raw].sort((a, b) => {
    if (b.datetime !== a.datetime) return b.datetime - a.datetime
    return sourceRank(a.source) - sourceRank(b.source)
  })

  for (const item of sorted) {
    if (!item.headline) continue
    const datetime = normalizeNewsDatetime(item.datetime, nowUnix)
    if (datetime == null || datetime < cutoff) continue

    // Check market importance
    if (!isReallyImportantHeadline(item.headline, item.summary)) continue

    const key = normalizeHeadlineKey(item.headline)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const instruments = instrumentsForHeadline(
      item.headline,
      item.summary,
      item.related,
      item.origin
    )
    if (instruments.length === 0) continue

    const tag = tagDeskNews(item.headline, item.summary)
    const source = (item.source || 'Finnhub').trim() || 'Finnhub'
    cards.push({
      id: `${datetime}-${source.slice(0, 12)}-${key.slice(0, 48)}`,
      instruments,
      headline: item.headline.trim(),
      source,
      url: safeHttpUrl(item.url),
      datetime,
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
  limit = 10,
  opts?: {
    sessionFilter?: boolean
    focusMarket?: 'NY' | 'TOKYO' | null
  }
): DeskNewsCard[] {
  let list =
    desk === 'ALL' ? cards : cards.filter((c) => c.instruments.includes(desk))

  // Session filter only shapes the ALL feed — desk tabs always show that desk's news
  if (opts?.sessionFilter && opts.focusMarket && desk === 'ALL') {
    list = list.filter((c) => matchesFocusMarket(c.instruments, opts.focusMarket!))
  }

  return list.slice(0, limit)
}

/**
 * Institutional filter: Is this economic calendar event truly market-moving and important for day trading CME futures?
 * Rejects low-impact minor indicators, irrelevant foreign countries, and noise prints.
 */
export function isReallyImportantCalendarEvent(event: {
  country?: string | null
  event?: string | null
  impact?: string | null
}): boolean {
  if (!event || !event.event) return false
  const evText = event.event.trim().toLowerCase()
  const country = (event.country || '').trim().toUpperCase()
  const impact = (event.impact || '').trim().toLowerCase()

  // 1. Noise Filter: Discard minor, low-volatility statistical reports
  const isNoise = /\b(car registration|vehicle sales|wholesale inventory|wholesale price|mortgage application|mba|redbook|consumer credit|tertiary|leading indicator|economic tendency|trade balance|current account|building permit|housing start|nahb|richmond fed|kansas fed|dallas fed|construction spending|house price index|bci|import price|export price)\b/i.test(
    `${country} ${evText}`
  )
  if (isNoise && !/\b(cpi|fomc|payrolls|gdp|ism)\b/i.test(evText)) {
    return false
  }

  // 2. Country Relevance Filter:
  // CME US futures react primarily to US data, Japan (Nikkei/USDJPY carry), China (commodities), or major ECB/BoE rate decisions.
  const isRelevantCountry =
    country === 'US' ||
    country === 'USA' ||
    country === 'UNITED STATES' ||
    country === 'JP' ||
    country === 'JAPAN' ||
    country === 'CN' ||
    country === 'CHINA' ||
    ((country === 'EU' || country === 'EZ' || country === 'DE' || country === 'GERMANY' || country === 'GB' || country === 'UK') &&
      /\b(rate decision|interest rate|ecb|boe|flash pmi)\b/i.test(evText))

  if (!isRelevantCountry) {
    // Only accept OPEC / crude inventory events from other origins
    if (/\b(opec|crude oil|eia|petroleum)\b/i.test(evText)) {
      return true
    }
    return false
  }

  // 3. Core Market-Moving Catalysts:
  const isMarketMover =
    // Federal Reserve & Central Banks
    /\b(fomc|federal reserve|fed interest rate|fed funds|rate decision|rate statement|powell|dot plot|fomc minutes|bank of japan|boj|ueda|ecb|boe)\b/i.test(evText) ||
    // Inflation & Price Pressures
    /\b(cpi|consumer price index|core cpi|pce|core pce|personal consumption expenditures|ppi|producer price index|tokyo cpi)\b/i.test(evText) ||
    // Employment & Labor Market
    /\b(nonfarm payroll|non-farm payroll|nfp|unemployment rate|average hourly earnings|jobless claims|initial claims|jolts|adp employment)\b/i.test(evText) ||
    // Economic Growth & Consumption
    /\b(gdp|gross domestic product|retail sales|core retail sales|durable goods)\b/i.test(evText) ||
    // Activity PMIs & Consumer Sentiment
    /\b(ism manufacturing|ism services|ism non-manufacturing|flash pmi|michigan consumer sentiment|cb consumer confidence|tankan)\b/i.test(evText) ||
    // Energy & Inventories
    /\b(eia|crude oil inventories|crude inventories|gasoline stocks|cushing|opec)\b/i.test(evText) ||
    // US Treasury Auctions
    /\b(10-year note auction|30-year bond auction|treasury quarterly refunding)\b/i.test(evText)

  if (isMarketMover) {
    if (impact === 'low') {
      // For low-rated items, only keep critical catalysts like Initial Jobless Claims, EIA, or core prints
      return /\b(jobless claims|initial claims|crude oil|eia|cpi|fomc|payrolls)\b/i.test(evText)
    }
    return true
  }

  // 4. Officially high impact from primary economic centers
  if ((impact === 'high' || impact === '3' || impact === 'red') && (country === 'US' || country === 'USA' || country === 'JP')) {
    return true
  }

  return false
}

export function instrumentsForCalendarEvent(country: string, event: string): DeskNewsInstrument[] {
  const text = `${country} ${event}`
  if (/\b(Crude|Oil|EIA|Petroleum|Gasoline|OPEC|Natural Gas|Distillate)\b/i.test(text)) {
    return ['CRUDE']
  }
  if (/\b(Gold|Silver|Bullion|Precious|TIPS|10-Year Note|30-Year Bond)\b/i.test(text)) {
    return /\b(Silver|XAG)\b/i.test(text) ? ['SILVER'] : ['GOLD', 'SILVER']
  }
  if (/\b(JP|Japan|BoJ|Tokyo|Yen|Tankan)\b/i.test(text)) {
    return ['NIKKEI', 'DOW', 'NASDAQ']
  }
  if (/\b(FOMC|Fed|CPI|PCE|NFP|Nonfarm|Payrolls|Jobless|GDP|ISM|Retail Sales)\b/i.test(text)) {
    return ['DOW', 'NASDAQ', 'NIKKEI', 'GOLD', 'SILVER']
  }
  return ['DOW', 'NASDAQ', 'GOLD', 'SILVER']
}

export function deskNoteForCalendar(
  instruments: DeskNewsInstrument[],
  impact: string,
  extra?: {
    actual?: string | number | null
    estimate?: string | number | null
    resultHeadline?: string | null
    outcome?: string | null
    isReleased?: boolean
  }
): string {
  const desks = instruments.join(' · ')
  if (extra?.isReleased || extra?.actual != null) {
    if (extra?.resultHeadline) {
      return `🎯 ${extra.resultHeadline} · Volatility active in ${desks}.`
    }
    const outcomeStr = extra?.outcome ? ` [${extra.outcome}]` : ''
    const estStr = extra?.estimate ? ` (Exp: ${extra.estimate})` : ''
    return `🎯 RELEASED: ${extra.actual}${outcomeStr}${estStr} · Volatility active in ${desks}.`
  }
  const hi = /high/i.test(impact)
  return hi
    ? `High-impact print — expect volatility in ${desks}. Context only.`
    : `Scheduled event for ${desks} — note the clock before entries.`
}
