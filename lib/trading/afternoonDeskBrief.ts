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
  excessLevelsFromCandles,
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
  /** Excess Selling High (upper range boundary) */
  excessSelling: number | null
  /** Excess Buying Low (lower range boundary) */
  excessBuying: number | null
  rangeState: 'above_excess_selling' | 'below_excess_buying' | 'within_excess_range' | 'unknown'
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

  const excessLevels = excessLevelsFromCandles(bars, openUnix, Math.max(nowUnix, lunchUnix))
  const excessSellingLvl = excessLevels.find((l) => l.type === 'resistance')?.level ?? null
  const excessBuyingLvl = excessLevels.find((l) => l.type === 'support')?.level ?? null

  let rangeState: AfternoonDeskBrief['rangeState'] = 'unknown'
  if (excessSellingLvl != null && excessBuyingLvl != null) {
    if (tip > excessSellingLvl) rangeState = 'above_excess_selling'
    else if (tip < excessBuyingLvl) rangeState = 'below_excess_buying'
    else rangeState = 'within_excess_range'
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
    excessSelling: excessSellingLvl,
    excessBuying: excessBuyingLvl,
    rangeState,
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
    'AFTERNOON DESK BRIEF (facts from our tools only — Yahoo H1 volume/candles, Excess Selling / Buying, AVWAP, POC, morning-review reactions):',
    `Instrument: ${brief.instrument} · tip ${brief.tip}`,
  ]

  if (brief.excessSelling != null && brief.excessBuying != null) {
    lines.push(
      `Excess Reference Range: Selling High ${brief.excessSelling} / Buying Low ${brief.excessBuying} · tip is ${brief.rangeState.toUpperCase()}`
    )
    if (brief.rangeState === 'above_excess_selling') {
      lines.push(
        'Price extended above Excess Selling high — responsive buyers auctioning higher; watch for trend continuation or failed breakout back into range.'
      )
    } else if (brief.rangeState === 'below_excess_buying') {
      lines.push(
        'Price extended below Excess Buying low — responsive sellers auctioning lower; watch for trend continuation or failed auction reclaim.'
      )
    } else {
      lines.push(
        'Within Excess Range — price rotating between Excess Selling high and Excess Buying low.'
      )
    }
  } else {
    lines.push('Excess Reference Range: not shaped yet from available bars.')
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
    '1) Did morning extend past Excess Selling / Buying with volume, or rotate between extremes?',
    '2) Which morning levels HELD vs BROKE (FLIP = broken→flip side; RETEST = held→retest)?',
    '3) Where is tip vs Excess Selling, Excess Buying, morning mid, AVWAP, and POC — those are the afternoon magnets.',
    '4) Prefer watch levels at: Excess Selling High, Excess Buying Low, flipped morning levels, AVWAP/POC confluence.',
    '5) Afternoon is WATCH-ONLY on this desk — return levels for observation / memory, not new morning entries.'
  )

  return '\n' + lines.join('\n') + '\n'
}
