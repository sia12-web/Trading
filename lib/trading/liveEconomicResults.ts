/**
 * Live Economic Results & Official Wire Resolver
 * Fetches and parses official releases immediately upon publication:
 * - Federal Reserve FOMC statements & Federal Funds rate decision (federalreserve.gov)
 * - BLS Consumer Price Index (cpi.rss)
 * - BLS Employment Situation / Nonfarm Payrolls (empsit.rss)
 * - Rapid financial headlines fallback (Yahoo Finance RSS)
 */

import { logger } from '@/lib/utils/logger'
import type { DeskCalendarEvent, RawDeskHeadline } from '@/lib/trading/deskNews'

export type EconomicOutcome = 'HIKE' | 'CUT' | 'HOLD' | 'BEAT' | 'MISS' | 'IN_LINE'

export interface FomcStatementResult {
  action: 'HIKE' | 'CUT' | 'HOLD'
  changeBps: number
  targetRangeRaw: string
  targetRangeNormalized: string
  topRate: string
  headline: string
  url: string
  pubDate: string
  pubMs: number
}

export interface BlsCpiResult {
  headline: string
  monthlyRate: string | null
  annualRate: string | null
  coreMonthlyRate: string | null
  pubDate: string
  pubMs: number
  url: string
}

export interface BlsNfpResult {
  headline: string
  payrollChange: string | null
  unemploymentRate: string | null
  pubDate: string
  pubMs: number
  url: string
}

export interface LiveEconomicData {
  fomc: FomcStatementResult | null
  cpi: BlsCpiResult | null
  nfp: BlsNfpResult | null
  fetchedAt: number
}

// Memory cache with dynamic TTL
let cachedEconomicData: LiveEconomicData | null = null
let lastFetchAttempt = 0

/** Convert fraction strings e.g. "3-3/4 to 4 percent" -> "3.75% - 4.00%" */
export function normalizeTargetRange(raw: string): { normalized: string; topRate: string } {
  const converted = raw
    .replace(/(\d+)[-–](\d+)\/(\d+)/g, (_, whole, num, den) => {
      const val = Number(whole) + Number(num) / Number(den)
      return val.toFixed(2)
    })
    .replace(/(\d+)\/(\d+)/g, (_, num, den) => {
      const val = Number(num) / Number(den)
      return val.toFixed(2)
    })
    .replace(/\s+percent/i, '%')
    .trim()

  const match = converted.match(/([\d.]+)%?\s+(?:to|-)\s+([\d.]+)%?/i)
  if (match) {
    const low = Number(match[1]).toFixed(2)
    const high = Number(match[2]).toFixed(2)
    return {
      normalized: `${low}% - ${high}%`,
      topRate: `${high}%`,
    }
  }

  const single = converted.match(/([\d.]+)%?/)
  if (single) {
    const rate = Number(single[1]).toFixed(2)
    return {
      normalized: `${rate}%`,
      topRate: `${rate}%`,
    }
  }

  return {
    normalized: raw,
    topRate: raw,
  }
}

/** Pure parser for Federal Reserve FOMC Statement HTML */
export function parseFomcStatementText(
  htmlText: string,
  meta?: { url?: string; pubDate?: string }
): FomcStatementResult | null {
  const clean = htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  // Look for target range decision pattern
  const m = clean.match(
    /decided to (raise|lower|maintain|hold|keep) the target range for the federal funds rate(?: by ([\d/]+) percentage point)?(?: at| to)? ([\d/–\-\s]+ to [\d/–\-\s]+ percent|[\d/–\-\s]+ percent)/i
  )

  if (!m || !m[1] || !m[3]) return null

  const rawAction = m[1].toLowerCase()
  let action: 'HIKE' | 'CUT' | 'HOLD' = 'HOLD'
  if (rawAction === 'raise') action = 'HIKE'
  else if (rawAction === 'lower') action = 'CUT'
  else action = 'HOLD'

  // Parse basis points
  let changeBps = 0
  if (m[2]) {
    const frac = m[2].trim()
    if (frac === '1/4') changeBps = 25
    else if (frac === '1/2') changeBps = 50
    else if (frac === '3/4') changeBps = 75
    else {
      const num = Number(frac)
      if (Number.isFinite(num)) changeBps = Math.round(num * 100)
    }
  }
  if (action === 'CUT' && changeBps > 0) {
    changeBps = -changeBps
  }

  const targetRangeRaw = m[3].trim()
  const { normalized, topRate } = normalizeTargetRange(targetRangeRaw)

  let headline = ''
  if (action === 'HIKE') {
    headline = `Fed raises target range by ${Math.abs(changeBps || 25)}bps to ${normalized}`
  } else if (action === 'CUT') {
    headline = `Fed cuts target range by ${Math.abs(changeBps || 25)}bps to ${normalized}`
  } else {
    headline = `Fed maintains target range at ${normalized}`
  }

  const pubDateStr = meta?.pubDate || new Date().toISOString()
  const pubMs = Date.parse(pubDateStr) || Date.now()

  return {
    action,
    changeBps,
    targetRangeRaw,
    targetRangeNormalized: normalized,
    topRate,
    headline,
    url: meta?.url || 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    pubDate: pubDateStr,
    pubMs,
  }
}

/** Pure parser for BLS CPI RSS entry */
export function parseBlsCpiEntry(entryXml: string): BlsCpiResult | null {
  const titleMatch = entryXml.match(/<title>(.*?)<\/title>/i)
  if (!titleMatch || !titleMatch[1]) return null
  const headline = titleMatch[1].trim()

  const pubMatch = entryXml.match(/<published>(.*?)<\/published>|<updated>(.*?)<\/updated>/i)
  const pubDate = pubMatch ? (pubMatch[1] || pubMatch[2] || new Date().toISOString()) : new Date().toISOString()
  const pubMs = Date.parse(pubDate) || Date.now()

  const linkMatch = entryXml.match(/<link[^>]*href=["'](.*?)["']/i)
  const url = linkMatch && linkMatch[1] ? linkMatch[1] : 'https://www.bls.gov/cpi/'

  // e.g. "CPI for all items increases 0.4% in August; gasoline rises"
  const mMatch = headline.match(/(?:increases|rises|falls|decreases|unchanged at)\s+([\d.]+%)?/i)
  let monthlyRate: string | null = null
  if (mMatch && mMatch[1]) {
    monthlyRate = mMatch[1]
    if (/falls|decreases/i.test(mMatch[0])) {
      monthlyRate = `-${monthlyRate}`
    }
  }

  // Check content for 12 months NSA
  const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/i)
  let annualRate: string | null = null
  let coreMonthlyRate: string | null = null
  if (contentMatch && contentMatch[1]) {
    const contentText = contentMatch[1]
    const annMatch = contentText.match(/(\d+\.\d+)\s+percent\s+over\s+the\s+last\s+12\s+months/i)
    if (annMatch && annMatch[1]) annualRate = `${annMatch[1]}%`

    const coreMatch = contentText.match(/all\s+items\s+less\s+food\s+and\s+energy\s+(?:rose|fell|increased|decreased)\s+([\d.]+)\s+percent/i)
    if (coreMatch && coreMatch[1]) coreMonthlyRate = `${coreMatch[1]}%`
  }

  return {
    headline,
    monthlyRate,
    annualRate,
    coreMonthlyRate,
    pubDate,
    pubMs,
    url,
  }
}

/** Pure parser for BLS Employment Situation (NFP) RSS entry */
export function parseBlsNfpEntry(entryXml: string): BlsNfpResult | null {
  const titleMatch = entryXml.match(/<title>(.*?)<\/title>/i)
  if (!titleMatch || !titleMatch[1]) return null
  const headline = titleMatch[1].trim()

  const pubMatch = entryXml.match(/<published>(.*?)<\/published>|<updated>(.*?)<\/updated>/i)
  const pubDate = pubMatch ? (pubMatch[1] || pubMatch[2] || new Date().toISOString()) : new Date().toISOString()
  const pubMs = Date.parse(pubDate) || Date.now()

  const linkMatch = entryXml.match(/<link[^>]*href=["'](.*?)["']/i)
  const url = linkMatch && linkMatch[1] ? linkMatch[1] : 'https://www.bls.gov/ces/'

  // e.g. "Payroll employment increases by 162,000 in August; unemployment rate unchanged at 4.1%"
  const payMatch = headline.match(/increases by ([\d,]+)|decreases by ([\d,]+)|changes little \(([+-]?[\d,]+)\)/i)
  let payrollChange: string | null = null
  if (payMatch) {
    const rawNum = payMatch[1] || payMatch[2] || payMatch[3]
    if (rawNum) {
      const n = parseInt(rawNum.replace(/,/g, ''), 10)
      if (Number.isFinite(n)) {
        const sign = payMatch[2] ? '-' : n > 0 ? '+' : ''
        payrollChange = `${sign}${Math.round(Math.abs(n) / 1000)}K`
      }
    }
  }

  const unempMatch = headline.match(/unemployment rate (?:unchanged at|at|falls to|rises to) ([\d.]+%)?/i)
  const unemploymentRate = unempMatch && unempMatch[1] ? unempMatch[1] : null

  return {
    headline,
    payrollChange,
    unemploymentRate,
    pubDate,
    pubMs,
    url,
  }
}

/** Fetch live Federal Reserve FOMC statement directly from Federal Reserve RSS feed */
async function fetchLiveFedFomc(): Promise<FomcStatementResult | null> {
  try {
    const res = await fetch('https://www.federalreserve.gov/feeds/press_monetary.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const xml = await res.text()
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []

    for (const item of items) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i)
      const title = (titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '').trim()

      if (/FOMC statement|Federal Reserve issues FOMC statement/i.test(title)) {
        const linkMatch = item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>|<link>(.*?)<\/link>/i)
        const link = (linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '').trim()
        const pubDateMatch = item.match(/<pubDate><!\[CDATA\[(.*?)\]\]><\/pubDate>|<pubDate>(.*?)<\/pubDate>/i)
        const pubDate = (pubDateMatch ? (pubDateMatch[1] || pubDateMatch[2] || '') : '').trim()

        if (link) {
          // Fetch statement page to parse actual text
          const pageRes = await fetch(link, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4000),
          })
          if (pageRes.ok) {
            const pageHtml = await pageRes.text()
            const parsed = parseFomcStatementText(pageHtml, { url: link, pubDate })
            if (parsed) return parsed
          }
        }
      }
    }
    return null
  } catch (err) {
    logger.debug('[LiveEconomic] Fed statement fetch error:', err)
    return null
  }
}

/** Fetch live BLS CPI release from BLS Atom feed */
async function fetchLiveBlsCpi(): Promise<BlsCpiResult | null> {
  try {
    const res = await fetch('https://www.bls.gov/feed/cpi.rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const xml = await res.text()
    const entryMatch = xml.match(/<entry>[\s\S]*?<\/entry>/i)
    if (!entryMatch) return null
    return parseBlsCpiEntry(entryMatch[0])
  } catch (err) {
    logger.debug('[LiveEconomic] BLS CPI fetch error:', err)
    return null
  }
}

/** Fetch live BLS NFP release from BLS Atom feed */
async function fetchLiveBlsNfp(): Promise<BlsNfpResult | null> {
  try {
    const res = await fetch('https://www.bls.gov/feed/empsit.rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const xml = await res.text()
    const entryMatch = xml.match(/<entry>[\s\S]*?<\/entry>/i)
    if (!entryMatch) return null
    return parseBlsNfpEntry(entryMatch[0])
  } catch (err) {
    logger.debug('[LiveEconomic] BLS NFP fetch error:', err)
    return null
  }
}

/** Helper to parse a single RSS XML item */
function parseRssItem(itemXml: string, sourceName: string): RawDeskHeadline | null {
  const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i)
  const headline = (titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '').trim()
  if (!headline) return null

  const linkMatch = itemXml.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>|<link>(.*?)<\/link>/i)
  const url = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : null

  const pubMatch = itemXml.match(/<pubDate><!\[CDATA\[(.*?)\]\]><\/pubDate>|<pubDate>(.*?)<\/pubDate>/i)
  const pubStr = pubMatch ? (pubMatch[1] || pubMatch[2] || '').trim() : null
  const dt = pubStr ? Math.floor(Date.parse(pubStr) / 1000) : Math.floor(Date.now() / 1000)

  return {
    headline,
    source: sourceName,
    datetime: dt,
    url,
    origin: 'market:general',
  }
}

/** Extract live CPI metrics from breaking financial wire headlines */
export function extractCpiFromHeadlines(headlines: RawDeskHeadline[]): BlsCpiResult | null {
  for (const h of headlines) {
    const text = h.headline
    if (!/\bcpi\b|consumer price/i.test(text)) continue

    // e.g. "US CPI rises 0.4% in September" or "Consumer prices increase 2.4% annually"
    const mMatch = text.match(/(?:cpi|consumer prices?|core cpi)[^,.;]*?(?:rises|rose|increases|increased|jumps|surged|falls|fell|slows|declines|cools|up|down)\s+([+-]?\d+(?:\.\d+)?%)/i)
    const annualMatch = text.match(/(?:annual|annualized|y\/y|year-over-year|year ago)[^,.;]*?([+-]?\d+(?:\.\d+)?%)/i) ||
                        text.match(/([+-]?\d+(?:\.\d+)?%)\s*(?:annually|annualized|y\/y|year-over-year|over the year)/i)

    if (mMatch || annualMatch) {
      return {
        headline: text,
        monthlyRate: (mMatch && mMatch[1]) ? mMatch[1] : null,
        annualRate: (annualMatch && annualMatch[1]) ? annualMatch[1] : null,
        coreMonthlyRate: null,
        pubDate: h.datetime ? new Date(h.datetime * 1000).toISOString() : new Date().toISOString(),
        pubMs: h.datetime ? h.datetime * 1000 : Date.now(),
        url: h.url || 'https://www.cnbc.com/economy/',
      }
    }
  }
  return null
}

/** Extract live NFP metrics from breaking financial wire headlines */
export function extractNfpFromHeadlines(headlines: RawDeskHeadline[]): BlsNfpResult | null {
  for (const h of headlines) {
    const text = h.headline
    if (!/\b(payroll|jobs|employment|unemployment)\b/i.test(text)) continue

    const payMatch = text.match(/(?:payrolls?|jobs?)\s+(?:rose|increased|grew|added|jumped|fell|dropped)\s+(?:by\s+)?([+-]?\d+(?:,\d+)?(?:k)?)/i)
    const unempMatch = text.match(/unemployment(?:\s+rate)?\s+(?:at|ticks? up to|ticks? down to|falls? to|rises? to|holds? at)?\s*(\d+(?:\.\d+)?%)/i)

    if (payMatch || unempMatch) {
      return {
        headline: text,
        payrollChange: (payMatch && payMatch[1]) ? payMatch[1] : null,
        unemploymentRate: (unempMatch && unempMatch[1]) ? unempMatch[1] : null,
        pubDate: h.datetime ? new Date(h.datetime * 1000).toISOString() : new Date().toISOString(),
        pubMs: h.datetime ? h.datetime * 1000 : Date.now(),
        url: h.url || 'https://www.cnbc.com/economy/',
      }
    }
  }
  return null
}

/** Fetch breaking market headlines from fast wire RSS feeds (CNBC Economy, CNBC Finance, MarketWatch) */
export async function fetchBreakingEconomicHeadlines(): Promise<RawDeskHeadline[]> {
  const feeds = [
    { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'CNBC Economy' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', source: 'MarketWatch' },
    { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC Finance' },
  ]

  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const res = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) return []
      const xml = await res.text()
      const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []
      const list: RawDeskHeadline[] = []
      for (const it of items.slice(0, 15)) {
        const item = parseRssItem(it, f.source)
        if (item) list.push(item)
      }
      return list
    })
  )

  const combined: RawDeskHeadline[] = []
  const seen = new Set<string>()

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const h of r.value) {
        const k = h.headline.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (!seen.has(k)) {
          seen.add(k)
          combined.push(h)
        }
      }
    }
  }

  // Sort descending by publication time
  combined.sort((a, b) => b.datetime - a.datetime)
  return combined
}

/** Backwards compatibility alias */
export const fetchYahooFinanceHeadlines = fetchBreakingEconomicHeadlines

/** Numeric parser for values like "2.4%", "162K", "3.75", "-0.1%" */
function parseNumericValue(val: string | number | null | undefined): number | null {
  if (val == null) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  const cleaned = String(val)
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/K/i, '')
    .replace(/M/i, '')
    .replace(/B/i, '')
    .trim()
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

/** Compute economic beat/miss outcome by comparing actual vs consensus */
export function computeEconomicOutcome(
  eventName: string,
  actual: string | number | null | undefined,
  estimate: string | number | null | undefined
): 'BEAT' | 'MISS' | 'IN_LINE' | null {
  const act = parseNumericValue(actual)
  const est = parseNumericValue(estimate)
  if (act == null || est == null) return null

  const diff = act - est
  if (Math.abs(diff) < 0.0001) return 'IN_LINE'

  const lower = eventName.toLowerCase()

  // For Unemployment / Jobless Claims: lower number is better/beat, higher is worse/miss
  if (lower.includes('unemployment') || lower.includes('jobless claims') || lower.includes('initial claims')) {
    return diff < 0 ? 'BEAT' : 'MISS'
  }

  // For Inflation (CPI, Core CPI, PPI, PCE):
  // When actual > estimate, that is a BEAT (Hot inflation). When actual < estimate, that is a MISS (Cool inflation).
  // For Employment / Growth (NFP, GDP, Retail Sales, PMIs):
  // When actual > estimate, that is a BEAT.
  return diff > 0 ? 'BEAT' : 'MISS'
}

/**
 * Fetch all live economic release results with dynamic TTL:
 * - 10s TTL during active release window
 * - 60s TTL standard
 */
export async function getLiveEconomicData(opts?: { force?: boolean; ttlMs?: number }): Promise<LiveEconomicData> {
  const now = Date.now()
  const ttl = opts?.ttlMs ?? 60_000

  if (!opts?.force && cachedEconomicData && now - cachedEconomicData.fetchedAt < ttl) {
    return cachedEconomicData
  }

  if (now - lastFetchAttempt < 5000 && cachedEconomicData) {
    return cachedEconomicData
  }
  lastFetchAttempt = now

  try {
    const [fomc, cpi, nfp, wireHeadlines] = await Promise.all([
      fetchLiveFedFomc(),
      fetchLiveBlsCpi(),
      fetchLiveBlsNfp(),
      fetchBreakingEconomicHeadlines(),
    ])

    // If official BLS feeds failed (e.g. Akamai bot protection), fall back to breaking wire headline extraction
    const resolvedCpi = cpi || (wireHeadlines.length > 0 ? extractCpiFromHeadlines(wireHeadlines) : null)
    const resolvedNfp = nfp || (wireHeadlines.length > 0 ? extractNfpFromHeadlines(wireHeadlines) : null)

    cachedEconomicData = {
      fomc: fomc || cachedEconomicData?.fomc || null,
      cpi: resolvedCpi || cachedEconomicData?.cpi || null,
      nfp: resolvedNfp || cachedEconomicData?.nfp || null,
      fetchedAt: now,
    }
    return cachedEconomicData
  } catch (err) {
    logger.warn('[LiveEconomic] Failed to fetch live economic data:', err)
    return cachedEconomicData || { fomc: null, cpi: null, nfp: null, fetchedAt: now }
  }
}

/**
 * Enriches calendar events with live actuals, target ranges, outcomes, and release status
 */
export function enrichCalendarEventWithLiveResult(
  event: DeskCalendarEvent,
  liveData: LiveEconomicData,
  nowMs: number = Date.now()
): DeskCalendarEvent {
  const evName = (event.event || '').toLowerCase()
  const country = (event.country || '').toUpperCase()

  // 1. Fed Funds Rate / FOMC Statement
  if (country === 'US' || country === 'USD') {
    if (
      evName.includes('federal funds rate') ||
      evName.includes('fomc rate') ||
      evName.includes('interest rate decision') ||
      evName.includes('fomc statement')
    ) {
      if (liveData.fomc) {
        const fomc = liveData.fomc
        const eventMs = Date.parse(event.time)
        const isTodayEvent = !Number.isNaN(eventMs) && Math.abs(eventMs - fomc.pubMs) <= 24 * 3600 * 1000
        const isLiveOrPassed = !Number.isNaN(eventMs) && nowMs >= eventMs - 120_000

        if (isTodayEvent || isLiveOrPassed) {
          const actionText = fomc.action === 'HIKE' ? `+${fomc.changeBps || 25}bps HIKE` : fomc.action === 'CUT' ? `-${Math.abs(fomc.changeBps || 25)}bps CUT` : 'HOLD'
          return {
            ...event,
            actual: fomc.topRate,
            outcome: fomc.action,
            changeBps: fomc.changeBps,
            targetRange: fomc.targetRangeNormalized,
            resultHeadline: fomc.headline,
            resultUrl: fomc.url,
            releasedAt: fomc.pubDate,
            isReleased: true,
            deskNote: `🎯 FOMC RESULT: ${fomc.headline} (${actionText})`,
          }
        }
      }
    }

    // 2. CPI (Consumer Price Index)
    if (evName.includes('cpi') || evName.includes('consumer price index')) {
      if (liveData.cpi) {
        const cpi = liveData.cpi
        const eventMs = Date.parse(event.time)
        const isLiveOrPassed = !Number.isNaN(eventMs) && nowMs >= eventMs - 120_000

        if (isLiveOrPassed && (cpi.monthlyRate || cpi.annualRate)) {
          const actualVal = evName.includes('y/y') && cpi.annualRate ? cpi.annualRate : cpi.monthlyRate || cpi.annualRate
          const outcome = computeEconomicOutcome(event.event, actualVal, event.estimate)
          const outcomeLabel = outcome === 'BEAT' ? 'HOT INFLATION (BEAT)' : outcome === 'MISS' ? 'COOLING INFLATION (MISS)' : outcome === 'IN_LINE' ? 'IN-LINE' : ''
          return {
            ...event,
            actual: actualVal,
            outcome,
            resultHeadline: cpi.headline,
            resultUrl: cpi.url,
            releasedAt: cpi.pubDate,
            isReleased: true,
            deskNote: `🎯 CPI RESULT: ${actualVal}${outcomeLabel ? ` [${outcomeLabel}]` : ''} vs Est ${event.estimate ?? 'N/A'} (Prior ${event.prev ?? 'N/A'})`,
          }
        }
      }
    }

    // 3. Nonfarm Payrolls / Employment
    if (evName.includes('non-farm') || evName.includes('nonfarm') || evName.includes('employment change')) {
      if (liveData.nfp && liveData.nfp.payrollChange) {
        const nfp = liveData.nfp
        const eventMs = Date.parse(event.time)
        const isLiveOrPassed = !Number.isNaN(eventMs) && nowMs >= eventMs - 120_000

        if (isLiveOrPassed) {
          const outcome = computeEconomicOutcome(event.event, nfp.payrollChange, event.estimate)
          return {
            ...event,
            actual: nfp.payrollChange,
            outcome,
            resultHeadline: nfp.headline,
            resultUrl: nfp.url,
            releasedAt: nfp.pubDate,
            isReleased: true,
            deskNote: `🎯 NFP RESULT: ${nfp.payrollChange} vs Est ${event.estimate ?? 'N/A'} (${nfp.headline})`,
          }
        }
      }
    }

    if (evName.includes('unemployment rate')) {
      if (liveData.nfp && liveData.nfp.unemploymentRate) {
        const nfp = liveData.nfp
        const eventMs = Date.parse(event.time)
        const isLiveOrPassed = !Number.isNaN(eventMs) && nowMs >= eventMs - 120_000

        if (isLiveOrPassed) {
          const outcome = computeEconomicOutcome(event.event, nfp.unemploymentRate, event.estimate)
          return {
            ...event,
            actual: nfp.unemploymentRate,
            outcome,
            resultHeadline: nfp.headline,
            resultUrl: nfp.url,
            releasedAt: nfp.pubDate,
            isReleased: true,
            deskNote: `🎯 UNEMPLOYMENT RESULT: ${nfp.unemploymentRate} vs Est ${event.estimate ?? 'N/A'}`,
          }
        }
      }
    }
  }

  // 4. If already has an actual (e.g. from calendar feed directly, like ForexFactory or Finnhub)
  if (event.actual != null && String(event.actual).trim() !== '') {
    const outcome = event.outcome || computeEconomicOutcome(event.event, event.actual, event.estimate)
    const isInflation = /cpi|inflation|ppi|pce/i.test(evName)
    let outcomeNote = ''
    if (outcome === 'BEAT') {
      outcomeNote = isInflation ? 'HOT (BEAT)' : 'BEAT'
    } else if (outcome === 'MISS') {
      outcomeNote = isInflation ? 'COOL (MISS)' : 'MISS'
    } else if (outcome === 'IN_LINE') {
      outcomeNote = 'IN-LINE'
    }

    const note = `🎯 RELEASED: ${event.actual}${outcomeNote ? ` [${outcomeNote}]` : ''} vs Est ${event.estimate ?? 'N/A'} (Prior ${event.prev ?? 'N/A'})`

    return {
      ...event,
      outcome,
      isReleased: true,
      deskNote: event.deskNote && event.deskNote.includes('🎯') ? event.deskNote : note,
    }
  }

  return event
}

