/**
 * Afternoon desk brief — pure facts from tools we already have.
 * Used to brief Level Finder after lunch (watch-only). No new data vendors.
 *
 * Sources: Yahoo H1 candles + volume, cash-open clock, Initial Balance,
 * AVWAP bands, volume-profile POC, morning FLIP/RETEST candidates.
 */

import { computeAnchoredVwap, deskClockFor, cashOpenUnixForYmd } from '@/lib/chart/sessionVwap'
import { computeVolumeProfile } from '@/lib/chart/volumeProfile'
import {
  computeInitialBalance,
  type DeskBar,
} from '@/lib/trading/deskLevels'
import { sessionFor, type DeskInstrument } from '@/lib/trading/sessionGate'

export type AfternoonReaction = {
  level: number
  play: string
  type: string
  note?: string
}

export type AfternoonDeskBrief = {
  instrument: DeskInstrument
  tip: number
  openUnix: number
  lunchUnix: number
  /** First-hour IB (null if not shaped) */
  ib: { high: number; low: number; mid: number } | null
  ibState: 'above' | 'inside' | 'below' | 'unknown'
  morning: {
    high: number
    low: number
    mid: number
    range: number
    /** Sum of H1 volume from open → lunch */
    volume: number
    barCount: number
  } | null
  avwap: number | null
  tipVsAvwapPct: number | null
  poc: number | null
  reactions: AfternoonReaction[]
}

function dateKeyInTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function parseHmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number)
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
}

/** Local-session seconds since midnight for a unix timestamp. */
function localSeconds(unix: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unix * 1000))
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return parseHmsToSeconds(`${hour}:${minute}:${second}`)
}

function mapReactions(rows: unknown[]): AfternoonReaction[] {
  if (!Array.isArray(rows)) return []
  const out: AfternoonReaction[] = []
  for (const raw of rows) {
    const r = raw as Record<string, unknown>
    const level = Number(r.level)
    if (!(level > 0)) continue
    out.push({
      level: Math.round(level * 100) / 100,
      play: String(r.play || 'WATCH'),
      type: String(r.candidate_type || r.original_type || r.type || 'level'),
      note: typeof r.note === 'string' ? r.note : undefined,
    })
  }
  return out.slice(0, 8)
}

/**
 * Build afternoon brief from H1 desk bars + optional morning-review candidates.
 * Only uses existing desk tools — no external APIs beyond the candles already fetched.
 */
export function buildAfternoonDeskBrief(args: {
  instrument: DeskInstrument
  candlesH1: DeskBar[]
  tip: number
  nowUnix?: number
  afternoonCandidates?: unknown[]
}): AfternoonDeskBrief | null {
  const { instrument, tip } = args
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1000)
  const bars = [...args.candlesH1]
    .filter((b) => Number.isFinite(b.time) && b.time > 0)
    .sort((a, b) => a.time - b.time)
  if (bars.length < 2 || !(tip > 0)) return null

  const s = sessionFor(instrument)
  const ymd = dateKeyInTz(nowUnix, s.tz)
  const clock = deskClockFor(instrument)
  const openUnix = cashOpenUnixForYmd(ymd, clock)
  const lunchSec = parseHmsToSeconds(s.lunchClose)
  const openSec = parseHmsToSeconds(s.marketOpen)
  // Approximate lunch unix from open + (lunch - open) on same local day
  const lunchUnix = openUnix + (lunchSec - openSec)

  const morningBars = bars.filter((b) => {
    if (b.time < openUnix) return false
    return localSeconds(b.time, s.tz) < lunchSec
  })

  let morning: AfternoonDeskBrief['morning'] = null
  if (morningBars.length >= 1) {
    let hi = -Infinity
    let lo = Infinity
    let vol = 0
    for (const c of morningBars) {
      if (c.high > hi) hi = c.high
      if (c.low < lo) lo = c.low
      vol += Math.max(0, c.volume || 0)
    }
    if (Number.isFinite(hi) && Number.isFinite(lo) && hi >= lo) {
      morning = {
        high: Math.round(hi * 100) / 100,
        low: Math.round(lo * 100) / 100,
        mid: Math.round(((hi + lo) / 2) * 100) / 100,
        range: Math.round((hi - lo) * 100) / 100,
        volume: Math.round(vol),
        barCount: morningBars.length,
      }
    }
  }

  const ibRange = computeInitialBalance(bars, openUnix, Math.max(nowUnix, lunchUnix))
  const ib = ibRange
    ? {
        high: ibRange.high,
        low: ibRange.low,
        mid: Math.round(((ibRange.high + ibRange.low) / 2) * 100) / 100,
      }
    : null

  let ibState: AfternoonDeskBrief['ibState'] = 'unknown'
  if (ib) {
    if (tip > ib.high) ibState = 'above'
    else if (tip < ib.low) ibState = 'below'
    else ibState = 'inside'
  }

  const scoped = bars.filter((b) => b.time >= openUnix - 5 * 86400)
  const bands = computeAnchoredVwap(scoped.length ? scoped : bars, clock)
  const avwap =
    bands && bands.vwap.length
      ? bands.vwap[bands.vwap.length - 1]!.value
      : null
  const tipVsAvwapPct =
    avwap && avwap > 0 ? Math.round(((tip - avwap) / avwap) * 10000) / 100 : null

  const profile = computeVolumeProfile(
    (morningBars.length >= 4 ? morningBars : bars).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.max(1, c.volume || 0),
    }))
  )
  const poc = profile?.poc?.price != null ? Math.round(profile.poc.price * 100) / 100 : null

  return {
    instrument,
    tip: Math.round(tip * 100) / 100,
    openUnix,
    lunchUnix,
    ib,
    ibState,
    morning,
    avwap: avwap != null ? Math.round(avwap * 100) / 100 : null,
    tipVsAvwapPct,
    poc,
    reactions: mapReactions(args.afternoonCandidates ?? []),
  }
}

/** Prompt block for afternoon Level Finder — facts only from desk tools. */
export function formatAfternoonDeskBriefForPrompt(brief: AfternoonDeskBrief): string {
  const lines: string[] = [
    'AFTERNOON DESK BRIEF (facts from our tools only — Yahoo H1 volume/candles, IB, AVWAP, POC, morning-review reactions):',
    `Instrument: ${brief.instrument} · tip ${brief.tip}`,
  ]

  if (brief.ib) {
    lines.push(
      `Initial Balance (first cash hour): H ${brief.ib.high} / L ${brief.ib.low} / mid ${brief.ib.mid} · tip is ${brief.ibState.toUpperCase()} IB`
    )
    if (brief.ibState === 'above') {
      lines.push(
        'IB break UP — pros watch for trend continuation or failed-break back into IB; prior IB high often becomes support.'
      )
    } else if (brief.ibState === 'below') {
      lines.push(
        'IB break DOWN — pros watch for trend continuation or failed-break reclaim; prior IB low often becomes resistance.'
      )
    } else {
      lines.push(
        'Inside IB — pros expect range/mean-reversion until a clean volume break of IB H or L.'
      )
    }
  } else {
    lines.push('Initial Balance: not shaped yet from available bars.')
  }

  if (brief.morning) {
    lines.push(
      `Morning session (open→lunch): H ${brief.morning.high} / L ${brief.morning.low} / mid ${brief.morning.mid} · range ${brief.morning.range} · H1 volume sum ${brief.morning.volume} across ${brief.morning.barCount} bars`
    )
  }

  if (brief.avwap != null) {
    const side =
      brief.tipVsAvwapPct == null
        ? ''
        : brief.tipVsAvwapPct >= 0
          ? `tip ABOVE AVWAP by ${brief.tipVsAvwapPct}%`
          : `tip BELOW AVWAP by ${Math.abs(brief.tipVsAvwapPct)}%`
    lines.push(`5-session AVWAP: ${brief.avwap}${side ? ` · ${side}` : ''}`)
  }

  if (brief.poc != null) {
    lines.push(`Morning/session volume POC (our volume-by-price tool): ${brief.poc}`)
  }

  if (brief.reactions.length) {
    lines.push('Morning level reactions (graded on real candles — FLIP/RETEST watch list):')
    for (const r of brief.reactions) {
      lines.push(
        `- ${r.play} ${r.type} @ ${r.level}${r.note ? ` — ${r.note}` : ''}`
      )
    }
  } else {
    lines.push('Morning reactions: none stored yet (clock-in + morning-review required).')
  }

  lines.push(
    'Pro afternoon checklist (use ONLY evidence in this brief + the candle tables below — do not invent feeds):',
    '1) Did morning break IB with volume, or was it a quiet range day?',
    '2) Which morning levels HELD vs BROKE (FLIP = broken→flip side; RETEST = held→retest)?',
    '3) Where is tip vs IB, morning mid, AVWAP, and POC — those are the afternoon magnets.',
    '4) Prefer watch levels at: IB H/L, morning H/L, flipped morning levels, AVWAP/POC confluence.',
    '5) Afternoon is WATCH-ONLY on this desk — return levels for observation / memory, not new morning entries.'
  )

  return '\n' + lines.join('\n') + '\n'
}
