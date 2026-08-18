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
  computeYesterdayProfile,
  formatYesterdayProfileForPrompt,
} from '@/lib/trading/yesterdayProfile'
import {
  computeOpeningActivity,
  formatOpeningActivityForPrompt,
  resolveOpeningAsOfUnix,
  type OpeningActivity,
} from '@/lib/trading/openingActivity'
import {
  computeMarketControl,
  formatMarketControlForPrompt,
  resolveMarketControlAsOfUnix,
  type MarketControl,
} from '@/lib/trading/marketControl'
import {
  computeDeskCall,
  formatDeskCallForPrompt,
  resolveDeskCallAsOfUnix,
  type DeskCall,
} from '@/lib/trading/deskCall'
import type { DeskPlaybookMode } from '@/lib/trading/deskPlaybookMode'
import {
  computeInitialBalance,
  type DeskBar,
} from '@/lib/trading/deskLevels'
import { findIbLiquiditySwing } from '@/lib/trading/ibExtendAdvice'
import { sessionFor, type DeskInstrument } from '@/lib/trading/sessionGate'
import {
  buildRangeAtrSnapshot,
  formatRangeAtrAdviceLine,
  type RangeAtrSnapshot,
} from '@/lib/trading/rangeAtr'

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
  /** Active-range ATR(14) 5m — advise-only pad/trail (null if no 5m / no active range) */
  activeAtr: RangeAtrSnapshot | null
  /** Prior-cash TPO profile (YH/YL/VA/POC + open type + superimpose). */
  yesterdayProfileText: string | null
  /** Dalton opening activity (Drive / Test-Drive / Rej-Rev / Auction). */
  openingActivityText: string | null
  opening: OpeningActivity | null
  /** Dalton Rotation Factor + developing time-POC (same helper as the Ctrl chip). */
  marketControlText: string | null
  control: MarketControl | null
  /** Desk CALL — bias + legal ±10 (same helper as the Call chip). */
  deskCallText: string | null
  call: DeskCall | null
  /** NY IB: one liquidity swing at/beyond IB after lock (null while waiting). */
  ibSwingText: string | null
}

function playbookFromAnalysis(
  mode: RangeLiquidityBrief['analysisMode'],
  tokyo: boolean
): DeskPlaybookMode {
  if (mode === 'us_range') return 'us_range'
  if (mode === 'ib') return 'ib'
  if (mode === 'lunch_range') return 'lunch_range'
  if (mode === 'afternoon') return tokyo ? 'ib' : 'lunch_range'
  return 'morning'
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
  /** 5m bars for ATR(14) + yesterday TPO profile */
  candles5m?: Array<{
    time?: number
    open?: number
    high: number
    low: number
    close: number
    volume?: number
  }>
  /** 3/3, day-lock, working limit, or open book — CALL stays the read, not a fill. */
  bookLocked?: boolean
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

  const activeAtr =
    active && args.candles5m && args.candles5m.length > 0
      ? buildRangeAtrSnapshot({
          rangeLabel: active.label,
          high: active.high,
          low: active.low,
          bars: args.candles5m,
        })
      : null

  const yesterdayBars = (args.candles5m ?? []).filter(
    (b): b is {
      time: number
      open: number
      high: number
      low: number
      close: number
      volume?: number
    } =>
      typeof b.time === 'number' &&
      b.time > 0 &&
      typeof b.open === 'number' &&
      b.open > 0
  )
  const yesterday =
    yesterdayBars.length >= 8
      ? computeYesterdayProfile({
          instrument,
          candles: yesterdayBars,
          asOfUnix: nowUnix,
        })
      : null
  const yesterdayProfileText = formatYesterdayProfileForPrompt(yesterday)
  const last5 = yesterdayBars.length
    ? yesterdayBars[yesterdayBars.length - 1]!.time
    : nowUnix
  const openingAsOf = resolveOpeningAsOfUnix(instrument, last5, nowUnix)
  const opening = computeOpeningActivity({
    instrument,
    candles: yesterdayBars,
    asOfUnix: openingAsOf,
  })
  const openingActivityText = formatOpeningActivityForPrompt(opening)
  const controlAsOf = resolveMarketControlAsOfUnix(instrument, last5, nowUnix)
  const control = computeMarketControl({
    instrument,
    candles: yesterdayBars,
    asOfUnix: controlAsOf,
  })
  const marketControlText = formatMarketControlForPrompt(control)
  const callAsOf = resolveDeskCallAsOfUnix(instrument, last5, nowUnix)
  const call = computeDeskCall({
    instrument,
    candles: yesterdayBars,
    asOfUnix: callAsOf,
    playbookMode: playbookFromAnalysis(analysisMode, tokyo),
    bookLocked: args.bookLocked,
  })
  const deskCallText = formatDeskCallForPrompt(call)

  let ibSwingText: string | null = null
  if (!tokyo) {
    const swingSrc = (args.candles5m && args.candles5m.length >= 3 ? args.candles5m : bars)
      .map((b) => ({
        time: Number(b.time) || 0,
        open: Number((b as { open?: number }).open) || Number(b.close) || 0,
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Math.max(1, Number((b as { volume?: number }).volume) || 0),
      }))
      .filter((b) => b.time > 0 && b.high > 0 && b.low > 0)
    const ibLocked = computeInitialBalance(swingSrc, openUnix, nowUnix, 60)
    const swing = ibLocked ? findIbLiquiditySwing(swingSrc, ibLocked) : null
    ibSwingText = swing
      ? `Liquidity swing ${swing.kind} ${swing.price} (IB is the box; first tag is not the entry)`
      : slot2?.complete
        ? 'IB locked — no swing yet. First IB tag is liquidity building, not the entry.'
        : null
  }

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
    activeAtr,
    yesterdayProfileText,
    openingActivityText,
    opening,
    marketControlText,
    control,
    deskCallText,
    call,
    ibSwingText,
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
    'RULE: Range H/L = retail BAIT (where retail enters). 50% mid = pullback / reverse magnet (legal ±10 entry on OR30 / IB / lunch; NOT on US Range). Desk EDGE ENTRY = stop pool JUST BEYOND H/L (±0.05–0.12% / wick pad). Prefer confluence with printed POC/HVN or AVWAP. Never return the exact range H/L as the edge-hunt entry print (mid entries sit on equilibrium when mid is legal).',
    '',
  ]

  if (brief.or30) lines.push(`Slot 1 — ${formatEdge(brief.or30)}`)
  else lines.push(`Slot 1 — ${brief.slot1Label}: not shaped yet`)

  if (brief.slot2) lines.push(`Slot 2 — ${formatEdge(brief.slot2)}`)
  else lines.push(`Slot 2 — ${brief.slot2Label}: not shaped yet`)

  if (brief.slot3) lines.push(`Slot 3 — ${formatEdge(brief.slot3)}`)
  else lines.push(`Slot 3 — ${brief.slot3Label}: not shaped yet`)

  if (brief.active) {
    const usOnly =
      brief.active.label === 'US Range'
        ? ` US Range entries are ±10 of H / L only — 50% mid ${brief.active.mid} is NOT a legal entry.`
        : ` 50% mid ${brief.active.mid} = pullback/reverse entry magnet (±10).`
    lines.push(
      '',
      `PRIMARY BAIT (${brief.active.label}): hunt stops ABOVE ${brief.active.high} (short liquidity) and BELOW ${brief.active.low} (buy liquidity).${usOnly} Earlier ranges = secondary magnets / polarity flips if broken.`
    )
    if (!brief.tokyo && brief.active.label === 'IB') {
      lines.push(
        'IB EXTEND vs REVERT: IB H/L is the context BOX. First tag of IB H/L is NOT the entry. Tradable = the liquidity swing at/beyond IB (test of that swing). Raid accepted outside → EXTEND (pullback to the broken swing, not the wick). Raid accepted back inside → BALANCE toward VWAP / yPOC / dPOC. Do not emit first-tag IB break as the entry.'
      )
      if (brief.ibSwingText) lines.push(`IB LIQUIDITY: ${brief.ibSwingText}`)
    }
  } else if (brief.analysisMode === 'afternoon') {
    lines.push(
      '',
      'WATCH MODE: use all formed range edges as magnets; note which held vs broke.'
    )
  }

  if (brief.activeAtr) {
    lines.push(
      '',
      'RANGE VOLATILITY (ATR — advise only; does NOT change ±10 H/50%/L entry gate; does NOT auto-move SL/TP):',
      formatRangeAtrAdviceLine(brief.activeAtr)
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

  if (brief.yesterdayProfileText) {
    lines.push('', brief.yesterdayProfileText.trim())
  }
  if (brief.openingActivityText) {
    lines.push('', brief.openingActivityText.trim())
  }
  if (brief.marketControlText) {
    lines.push('', brief.marketControlText.trim())
  }
  if (brief.deskCallText) {
    lines.push('', brief.deskCallText.trim())
  }

  return '\n' + lines.join('\n') + '\n'
}
