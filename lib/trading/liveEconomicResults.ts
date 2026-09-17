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

/** Fetch breaking market headlines from Yahoo Finance RSS (zero-key fallback) */
export async function fetchYahooFinanceHeadlines(): Promise<RawDeskHeadline[]> {
  try {
    const res = await fetch('https://finance.yahoo.com/news/rssindex', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []

    const headlines: RawDeskHeadline[] = []
    for (const it of items.slice(0, 30)) {
      const titleMatch = it.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i)
      const headline = (titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '').trim()
      const linkMatch = it.match(/<link>(.*?)<\/link>/i)
      const url = linkMatch && linkMatch[1] ? linkMatch[1].trim() : null
      const pubMatch = it.match(/<pubDate>(.*?)<\/pubDate>/i)
      const pubStr = pubMatch && pubMatch[1] ? pubMatch[1].trim() : null
      const dt = pubStr ? Math.floor(Date.parse(pubStr) / 1000) : Math.floor(Date.now() / 1000)

      if (headline) {
        headlines.push({
          headline,
          source: 'Yahoo Finance',
          datetime: dt,
          url,
          origin: 'market:general',
        })
      }
    }
    return headlines
  } catch (err) {
    logger.debug('[LiveEconomic] Yahoo Finance RSS fetch error:', err)
    return []
  }
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
    const [fomc, cpi, nfp] = await Promise.all([
      fetchLiveFedFomc(),
      fetchLiveBlsCpi(),
      fetchLiveBlsNfp(),
    ])

    cachedEconomicData = {
      fomc: fomc || cachedEconomicData?.fomc || null,
      cpi: cpi || cachedEconomicData?.cpi || null,
      nfp: nfp || cachedEconomicData?.nfp || null,
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
        // Match if the statement is published and within 24h of the event schedule
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
          return {
            ...event,
            actual: actualVal,
            resultHeadline: cpi.headline,
            resultUrl: cpi.url,
            releasedAt: cpi.pubDate,
            isReleased: true,
            deskNote: `🎯 CPI RESULT: ${cpi.headline}`,
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
          return {
            ...event,
            actual: nfp.payrollChange,
            resultHeadline: nfp.headline,
            resultUrl: nfp.url,
            releasedAt: nfp.pubDate,
            isReleased: true,
            deskNote: `🎯 NFP RESULT: ${nfp.headline}`,
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
          return {
            ...event,
            actual: nfp.unemploymentRate,
            resultHeadline: nfp.headline,
            resultUrl: nfp.url,
            releasedAt: nfp.pubDate,
            isReleased: true,
            deskNote: `🎯 UNEMPLOYMENT RESULT: ${nfp.unemploymentRate} (${nfp.headline})`,
          }
        }
      }
    }
  }

  // If already has an actual (e.g. from calendar feed directly)
  if (event.actual != null && String(event.actual).trim() !== '') {
    return {
      ...event,
      isReleased: true,
    }
  }

  return event
}
