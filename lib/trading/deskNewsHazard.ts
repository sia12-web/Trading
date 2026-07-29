/**
 * Desk news hazards — Finnhub economic calendar → soft trade warnings.
 * Warn-only (no entry block). Times spoken as Montreal.
 */

import {
  type DeskCalendarEvent,
  type DeskNewsInstrument,
} from '@/lib/trading/deskNews'

export const NEWS_CAREFUL_MS = 60 * 60 * 1000
export const NEWS_STAND_ASIDE_MS = 15 * 60 * 1000

export type NewsHazardLevel = 'none' | 'careful' | 'stand_aside'

export type DeskNewsHazard = {
  id: string
  event: string
  country: string
  impact: string
  instruments: DeskNewsInstrument[]
  /** Event instant (ms). Null if time unparseable. */
  atMs: number | null
  /** Montreal clock label e.g. 08:30 */
  montrealHms: string | null
  level: NewsHazardLevel
  /** Chip / toast line */
  chip: string
  title: string
  body: string
}

const TRADER_TZ = 'America/Toronto'

/** Finnhub calendar times are usually `YYYY-MM-DD HH:MM:SS` (UTC) or ISO. */
export function parseCalendarEventMs(
  time: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!time || typeof time !== 'string') return null
  const trimmed = time.trim()
  if (!trimmed) return null

  // Already a unix seconds / ms number as string
  if (/^\d{10,13}$/.test(trimmed)) {
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return null
    return n > 1e12 ? n : n * 1000
  }

  // "2026-07-29 12:30:00" → treat as UTC (Finnhub economic calendar)
  const m = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  )
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}Z`
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return null
    // Reject nonsense far outside ±7d of now
    if (Math.abs(ms - nowMs) > 7 * 86400000) return null
    return ms
  }

  const fallback = Date.parse(trimmed)
  if (!Number.isFinite(fallback)) return null
  if (Math.abs(fallback - nowMs) > 7 * 86400000) return null
  return fallback
}

export function isHighImpact(impact: string | null | undefined): boolean {
  const s = String(impact || '')
    .trim()
    .toLowerCase()
  if (!s) return false
  // Finnhub uses "high" / "medium" / "low"; some feeds use "3" for red/high.
  if (s === '3' || s === 'red') return true
  return /\bhigh\b/.test(s)
}

export function formatMontrealHms(atMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TRADER_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(atMs))
}

export function classifyNewsHazardLevel(
  atMs: number | null,
  nowMs: number = Date.now()
): NewsHazardLevel {
  if (atMs == null || !Number.isFinite(atMs)) return 'none'
  const delta = atMs - nowMs
  // After the print, keep stand-aside for the same ±15m window
  if (Math.abs(delta) <= NEWS_STAND_ASIDE_MS) return 'stand_aside'
  if (delta > 0 && delta <= NEWS_CAREFUL_MS) return 'careful'
  return 'none'
}

export function eventTouchesInstrument(
  event: DeskCalendarEvent,
  instrument: DeskNewsInstrument
): boolean {
  return event.instruments.includes(instrument)
}

function hazardCopy(
  level: NewsHazardLevel,
  montrealHms: string | null,
  country: string,
  eventName: string
): { chip: string; title: string; body: string } {
  const when = montrealHms ? `${montrealHms} Montreal` : 'today'
  const label = `${country} ${eventName}`.trim()
  if (level === 'stand_aside') {
    return {
      chip: `${when} · ${label} · STAND ASIDE ±15m`,
      title: `News stand-aside — ${label}`,
      body: `High-impact ${label} at ${when}. Soft warn only — prefer no new probes ±15 minutes around the print.`,
    }
  }
  if (level === 'careful') {
    return {
      chip: `${when} · ${label} · careful (≤60m)`,
      title: `News soon — ${label}`,
      body: `High-impact ${label} at ${when}. Be careful into the print (within 60 minutes).`,
    }
  }
  return {
    chip: montrealHms ? `${montrealHms} · ${label} · HIGH` : `${label} · HIGH`,
    title: `Today's news — ${label}`,
    body: `High-impact ${label}${montrealHms ? ` at ${when}` : ''} on the desk calendar. Context only — not a trade signal.`,
  }
}

/** Build hazard rows for one instrument from Finnhub calendar payload. */
export function buildDeskNewsHazards(args: {
  calendar: DeskCalendarEvent[]
  instrument: DeskNewsInstrument
  nowMs?: number
  /** Include upcoming highs even outside careful window (for day digest) */
  includeUpcomingDay?: boolean
}): DeskNewsHazard[] {
  const nowMs = args.nowMs ?? Date.now()
  const out: DeskNewsHazard[] = []

  for (const ev of args.calendar) {
    if (!isHighImpact(ev.impact)) continue
    if (!eventTouchesInstrument(ev, args.instrument)) continue
    const atMs = parseCalendarEventMs(ev.time, nowMs)
    const level = classifyNewsHazardLevel(atMs, nowMs)
    const montrealHms = atMs != null ? formatMontrealHms(atMs) : null

    // Day digest: keep upcoming highs even if >60m away; also keep
    // unparseable high-impact rows so we never silently drop a red print.
    const includeIdleUpcoming =
      !!args.includeUpcomingDay &&
      (atMs == null ||
        (atMs >= nowMs - NEWS_STAND_ASIDE_MS && atMs <= nowMs + 24 * 3600 * 1000))

    if (level === 'none' && !includeIdleUpcoming) continue

    const effectiveLevel: NewsHazardLevel =
      level === 'none' && includeIdleUpcoming ? 'none' : level
    const copy = hazardCopy(effectiveLevel, montrealHms, ev.country, ev.event)
    out.push({
      id: ev.id,
      event: ev.event,
      country: ev.country,
      impact: ev.impact,
      instruments: ev.instruments,
      atMs,
      montrealHms,
      level: effectiveLevel,
      chip: copy.chip,
      title: copy.title,
      body: copy.body,
    })
  }

  out.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity))
  return out
}

/** Worst active hazard for the banner chip (stand_aside > careful > next high). */
export function pickBannerHazard(
  hazards: DeskNewsHazard[]
): DeskNewsHazard | null {
  const stand = hazards.find((h) => h.level === 'stand_aside')
  if (stand) return stand
  const careful = hazards.find((h) => h.level === 'careful')
  if (careful) return careful
  return hazards.find((h) => h.level === 'none' && h.atMs != null) ?? hazards[0] ?? null
}

export function formatDayNewsDigest(
  hazards: DeskNewsHazard[],
  instrument: DeskNewsInstrument,
  nowMs: number = Date.now()
): { title: string; body: string; telegram: string } | null {
  const upcoming = hazards.filter(
    (h) => h.atMs == null || h.atMs >= nowMs - NEWS_STAND_ASIDE_MS
  )
  if (upcoming.length === 0) return null
  const lines = upcoming.slice(0, 5).map((h) => h.chip)
  const title = `${instrument} desk news — high-impact today`
  const body = lines.join(' · ')
  return {
    title,
    body,
    telegram: `${title}\n${lines.map((l) => `• ${l}`).join('\n')}\nSoft warn only — not a trade signal.`,
  }
}
