/**
 * Range liquidity brief — connects Level Finder (VP / retail stops) to the
 * desk’s three ranges. Pure facts from existing chart helpers; no new vendors.
 *
 *   DOW/NASDAQ: OR30 → IB → Lunch-range
 *   NIKKEI:     OR30 → US Range (prior NYC) → Tokyo IB
 *
 * Range H/L = retail bait. Desk entries = stop pools just beyond those edges,
 * with POC/HVN + AVWAP as confluence.
 */

import { computeOr30Range } from '@/lib/chart/openingRange30'
import { computeNycLunchRange } from '@/lib/chart/nycLunchSessionRange'
import { computeNikkeiUsRangeBreakout } from '@/lib/chart/nikkeiUsRangeBreakout'
import {
  computeAnchoredVwap,
  deskClockFor,
  cashOpenUnixForYmd,
} from '@/lib/chart/sessionVwap'
import { computeVolumeProfile } from '@/lib/chart/volumeProfile'
import {
  computeInitialBalance,
  type DeskBar,
} from '@/lib/trading/deskLevels'
import { sessionFor, type DeskInstrument } from '@/lib/trading/sessionGate'

export type TipVsRange = 'above' | 'inside' | 'below' | 'unknown'

export type RangeEdgeFacts = {
  label: string
  high: number
  low: number
  mid: number
  tipState: TipVsRange
  complete?: boolean
}

export type RangeLiquidityBrief = {
  instrument: DeskInstrument
  tip: number
  tokyo: boolean
  /** Slot labels for this desk */
  slot1Label: string
  slot2Label: string
  slot3Label: string
  or30: RangeEdgeFacts | null
  /** NY: IB · Tokyo: US Range */
  slot2: RangeEdgeFacts | null
  /** NY: Lunch-range · Tokyo: Tokyo IB */
  slot3: RangeEdgeFacts | null
  /** Primary bait for the active analysis mode */
  activeLabel: string | null
  active: RangeEdgeFacts | null
  poc: number | null
  hvn: number[]
  pocVsActive: 'inside' | 'outside' | 'unknown'
  avwap: number | null
  tipVsAvwapPct: number | null
  analysisMode: 'morning' | 'ib' | 'us_range' | 'lunch_range' | 'afternoon'
}

function dateKeyInTz(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000))
}

function tipVsRange(tip: number, high: number, low: number): TipVsRange {
  if (!(high >= low) || !(tip > 0)) return 'unknown'
  if (tip > high) return 'above'
  if (tip < low) return 'below'
  return 'inside'
}

/**
 * IB H/L — locked after first cash hour. Forming preview for Level Finder prep only
 * (NY IB entries unlock at 10:30 when the hour locks).
 */
function computeIbEdges(
  bars: DeskBar[],
  openUnix: number,
  nowUnix: number,
  tip: number,
  label: string
): RangeEdgeFacts | null {
  const locked = computeInitialBalance(bars, openUnix, nowUnix, 60)
  if (locked) {
    return edges(label, locked.high, locked.low, tip, true)
  }
  if (!openUnix || nowUnix < openUnix) return null
  const endUnix = openUnix + 60 * 60
  const until = Math.min(endUnix, nowUnix)
  const ibBars = bars.filter((c) => c.time >= openUnix && c.time < until)
  if (ibBars.length < 2) return null
  let hi = -Infinity
  let lo = Infinity
  for (const c of ibBars) {
    if (c.high > hi) hi = c.high
    if (c.low < lo) lo = c.low
  }
  if (!(hi >= lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return edges(label, hi, lo, tip, false)
}

function edges(
  label: string,
  high: number,
  low: number,
  tip: number,
  complete?: boolean
): RangeEdgeFacts {
  const h = Math.round(high * 100) / 100
  const l = Math.round(low * 100) / 100
  return {
    label,
    high: h,
    low: l,
    mid: Math.round(((h + l) / 2) * 100) / 100,
    tipState: tipVsRange(tip, h, l),
    complete,
  }
}

function resolveActiveLabel(
  instrument: DeskInstrument,
  mode: RangeLiquidityBrief['analysisMode']
): string | null {
  const tokyo = instrument === 'NIKKEI'
  switch (mode) {
    case 'morning':
      return 'OR30'
    case 'us_range':
      return 'US Range'
    case 'ib':
      return tokyo ? 'Tokyo IB' : 'IB'
    case 'lunch_range':
      return 'Lunch-range'
    default:
      return null
  }
}

/**
 * Build printed range H/L + VP/AVWAP facts for Level Finder.
 */
export function buildRangeLiquidityBrief(args: {
  instrument: DeskInstrument
  candlesH1: DeskBar[]
  tip: number
  nowUnix?: number
  analysisMode?: RangeLiquidityBrief['analysisMode']
}): RangeLiquidityBrief | null {
  const { instrument, tip } = args
  const analysisMode = args.analysisMode ?? 'morning'
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1000)
  const bars = [...args.candlesH1]
    .filter((b) => Number.isFinite(b.time) && b.time > 0)
    .sort((a, b) => a.time - b.time)
  if (bars.length < 2 || !(tip > 0)) return null

  const tokyo = instrument === 'NIKKEI'
  const s = sessionFor(instrument)
  const ymd = dateKeyInTz(nowUnix, s.tz)
  const clock = deskClockFor(instrument)
  const openUnix = cashOpenUnixForYmd(ymd, clock)

  const slot1Label = 'OR30'
  const slot2Label = tokyo ? 'US Range' : 'IB'
  const slot3Label = tokyo ? 'Tokyo IB' : 'Lunch-range'

  const or30Range = computeOr30Range(bars, openUnix, nowUnix)
  const or30 = or30Range
    ? edges(
        slot1Label,
        or30Range.high,
        or30Range.low,
        tip,
        nowUnix >= or30Range.endUnix
      )
    : null

  // Slot 2: NY IB · Tokyo prior NYC US Range
  let slot2: RangeEdgeFacts | null = null
  if (tokyo) {
    const us = computeNikkeiUsRangeBreakout(
      bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: Math.max(1, b.volume || 0),
      }))
    )
    if (us && us.high >= us.low) {
      slot2 = edges(slot2Label, us.high, us.low, tip, true)
    }
  } else {
    slot2 = computeIbEdges(bars, openUnix, nowUnix, tip, slot2Label)
  }

  // Slot 3: NY Lunch-range · Tokyo IB (first cash hour — traded in PM window)
  let slot3: RangeEdgeFacts | null = null
  if (tokyo) {
    slot3 = computeIbEdges(bars, openUnix, nowUnix, tip, slot3Label)
  } else {
    const lunch = computeNycLunchRange(bars, ymd, nowUnix)
    if (lunch) {
      slot3 = edges(
        slot3Label,
        lunch.high,
        lunch.low,
        tip,
        lunch.complete
      )
    }
  }

  const activeLabel = resolveActiveLabel(instrument, analysisMode)
  let active: RangeEdgeFacts | null = null
  if (activeLabel === 'OR30') active = or30
  else if (activeLabel === slot2Label) active = slot2
  else if (activeLabel === slot3Label) active = slot3

  const scoped = bars.filter((b) => b.time >= openUnix - 5 * 86400)
  const profileBars = (
    scoped.length >= 4 ? scoped : bars
  ).map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: Math.max(1, c.volume || 0),
  }))
  const profile = computeVolumeProfile(profileBars)
  const poc =
    profile?.poc?.price != null
      ? Math.round(profile.poc.price * 100) / 100
      : null
  const hvn = (profile?.hvn ?? [])
    .slice(0, 3)
    .map((h) => Math.round(h.price * 100) / 100)
    .filter((p) => p > 0)

  let pocVsActive: RangeLiquidityBrief['pocVsActive'] = 'unknown'
  if (poc != null && active) {
    pocVsActive =
      poc <= active.high && poc >= active.low ? 'inside' : 'outside'
  }

  const bands = computeAnchoredVwap(scoped.length ? scoped : bars, clock)
  const avwap =
    bands && bands.vwap.length
      ? Math.round(bands.vwap[bands.vwap.length - 1]!.value * 100) / 100
      : null
  const tipVsAvwapPct =
    avwap && avwap > 0
      ? Math.round(((tip - avwap) / avwap) * 10000) / 100
      : null

  return {
    instrument,
    tip: Math.round(tip * 100) / 100,
    tokyo,
    slot1Label,
    slot2Label,
    slot3Label,
    or30,
    slot2,
    slot3,
    activeLabel,
    active,
    poc,
    hvn,
    pocVsActive,
    avwap,
    tipVsAvwapPct,
    analysisMode,
  }
}

function formatEdge(e: RangeEdgeFacts): string {
  const done = e.complete === false ? ' (forming)' : e.complete ? ' (locked)' : ''
  return `${e.label}: H ${e.high} / L ${e.low} / mid ${e.mid}${done} · tip is ${e.tipState.toUpperCase()} ${e.label}`
}

/** Prompt block — range bait → stop pools → VP/AVWAP confluence. */
export function formatRangeLiquidityBriefForPrompt(
  brief: RangeLiquidityBrief
): string {
  const deskMap = brief.tokyo
    ? 'OR30 → US Range (prior NYC) → Tokyo IB'
    : 'OR30 → IB → Lunch-range'

  const lines: string[] = [
    'RANGE LIQUIDITY MAP (facts from our chart tools — Yahoo H1, OR30, IB/US Range, lunch-range, AVWAP, POC):',
    `Instrument: ${brief.instrument} · tip ${brief.tip} · desk ranges: ${deskMap}`,
    `Analysis mode: ${brief.analysisMode} · primary bait: ${brief.activeLabel ?? 'none (watch all formed ranges)'}`,
    '',
    'RULE: Range H/L = retail BAIT (where retail enters). Desk ENTRY = stop pool JUST BEYOND that edge (±0.05–0.12% / wick pad). Prefer confluence with printed POC/HVN or AVWAP. Never return the exact range H/L as the entry print.',
    '',
  ]

  if (brief.or30) lines.push(`Slot 1 — ${formatEdge(brief.or30)}`)
  else lines.push(`Slot 1 — ${brief.slot1Label}: not shaped yet`)

  if (brief.slot2) lines.push(`Slot 2 — ${formatEdge(brief.slot2)}`)
  else lines.push(`Slot 2 — ${brief.slot2Label}: not shaped yet`)

  if (brief.slot3) lines.push(`Slot 3 — ${formatEdge(brief.slot3)}`)
  else lines.push(`Slot 3 — ${brief.slot3Label}: not shaped yet`)

  if (brief.active) {
    lines.push(
      '',
      `PRIMARY BAIT (${brief.active.label}): hunt stops ABOVE ${brief.active.high} (short liquidity) and BELOW ${brief.active.low} (buy liquidity). Earlier ranges = secondary magnets / polarity flips if broken.`
    )
  } else if (brief.analysisMode === 'afternoon') {
    lines.push(
      '',
      'WATCH MODE: use all formed range edges as magnets; note which held vs broke.'
    )
  }

  if (brief.poc != null) {
    lines.push(
      `Session volume POC: ${brief.poc}${
        brief.active
          ? ` · POC is ${brief.pocVsActive.toUpperCase()} active ${brief.active.label}`
          : ''
      }`
    )
  }
  if (brief.hvn.length) {
    lines.push(`HVN: ${brief.hvn.join(' · ')}`)
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

  lines.push(
    '',
    'Reasoning must name the range bait, e.g. "OR30 high 44280 bait — retail shorts stop above; sell liquidity ~44310 near POC".',
    'When the primary range is formed, reject levels that only cite Asia/London with no tie to that range edge (unless prep before OR30 exists).'
  )

  return '\n' + lines.join('\n') + '\n'
}
