/**
 * Live / late desk brief — ranks DOW · NASDAQ · NIKKEI on what is still
 * tradeable NOW vs dead. Rules-first from clocks, ladder, shaped ranges.
 * Used by the live chart late-join overlay and Telegram Late Desk Brief.
 */

import {
  attemptLadderFromCounts,
  bucketDisplayLabel,
  bucketWindowSec,
  bucketWindowUnlockMessage,
  formatAttemptLadderShort,
  isBucketWindowOpen,
  type AttemptLadder,
} from '@/lib/trading/attemptLadder'
import {
  deskPlaybookTitle,
  resolveDeskPlaybookMode,
  type DeskPlaybookMode,
} from '@/lib/trading/deskPlaybookMode'
import {
  deskMarketFor,
  isOr30MorningEntryWindowOpen,
  sessionFor,
  type DeskInstrument,
  type DeskMarket,
} from '@/lib/trading/sessionGate'
import {
  rangeEdgeBandLegend,
  type RangeEdgeLevels,
} from '@/lib/trading/rangeEdgeEntryGate'
import {
  TRADER_DISPLAY_LABEL,
  deskLocalHmsAsTraderDisplay,
} from '@/lib/chart/traderDisplayTz'
import { parseTimeToSeconds } from '@/lib/utils/timeUtils'

export type BookLifecycle = 'open' | 'forming' | 'dead' | 'upcoming'

export type DeskBookLine = {
  label: string
  state: BookLifecycle
  probesUsed: number
  probesMax: number
  note: string
}

export type InstrumentDeskCard = {
  instrument: DeskInstrument
  market: DeskMarket
  rankScore: number
  playbookMode: DeskPlaybookMode
  playbookTitle: string
  tradeableNow: boolean
  openBook: string | null
  deadBooks: string[]
  nextUnlock: string | null
  books: DeskBookLine[]
  /** Eligible ±10 legend for the open book only (null when sit-out / forming). */
  bandHint: string | null
  activeRange: RangeEdgeLevels | null
  ladderLabel: string
  summaryLine: string
}

export type LiveDeskSuggestion =
  | {
      kind: 'trade'
      instrument: DeskInstrument
      book: string
      text: string
    }
  | { kind: 'sit_out'; text: string }

export type LiveDeskBrief = {
  asOfIso: string
  asOfDisplay: string
  focusMarket: DeskMarket | 'ALL'
  instruments: InstrumentDeskCard[]
  bullets: string[]
  suggestion: LiveDeskSuggestion
}

export type ShapedRangeInput = {
  high: number
  low: number
  complete?: boolean
} | null

export type InstrumentBriefFacts = {
  instrument: DeskInstrument
  ladder?: AttemptLadder
  or30?: ShapedRangeInput
  ib?: ShapedRangeInput
  usRange?: ShapedRangeInput
  lunchRange?: ShapedRangeInput
  /** Overnight / regime one-liner (optional). */
  overnightNote?: string | null
  tip?: number | null
}

function timeInTz(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  let hour = parts.find((p) => p.type === 'hour')?.value || '00'
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  const second = parts.find((p) => p.type === 'second')?.value || '00'
  return `${hour}:${minute}:${second}`
}

function weekdayInTz(now: Date, timeZone: string): boolean {
  const d = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
    now
  )
  return d !== 'Sat' && d !== 'Sun'
}

function montrealClock(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

function shaped(
  r: ShapedRangeInput,
  label: string
): RangeEdgeLevels | null {
  if (!r || !(r.high > r.low)) return null
  if (r.complete === false) return null
  return { high: r.high, low: r.low, label }
}

function or30State(
  instrument: DeskInstrument,
  now: Date,
  or30: ShapedRangeInput,
  ladder: AttemptLadder
): DeskBookLine {
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const open = parseTimeToSeconds(s.marketOpen)
  const or30Lock = open + 30 * 60
  const entryClose = parseTimeToSeconds(s.entryClose)
  const used = ladder.morningAttempts
  const max = ladder.maxMorningAttempts

  if (t < open) {
    return {
      label: 'OR30',
      state: 'upcoming',
      probesUsed: used,
      probesMax: max,
      note: `Forms at cash open · locks ~${deskLocalHmsAsTraderDisplay(
        s.marketOpen === '09:30:00' ? '10:00:00' : '09:30:00',
        s.tz,
        now
      )} ${TRADER_DISPLAY_LABEL}`,
    }
  }
  if (t < or30Lock) {
    return {
      label: 'OR30',
      state: 'forming',
      probesUsed: used,
      probesMax: max,
      note: 'OR30 forming — do not enter until the first 30 minutes lock',
    }
  }
  if (!ladder.morningEligible || used >= max) {
    return {
      label: 'OR30',
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note:
        used >= max
          ? 'OR30 closed — probes used (2/2). Do not enter.'
          : 'OR30 closed — morning bucket released. Do not enter.',
    }
  }
  if (!isOr30MorningEntryWindowOpen(instrument, now) || t > entryClose) {
    return {
      label: 'OR30',
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note: 'OR30 closed — morning entry window over. Do not enter.',
    }
  }
  if (!or30 || or30.complete !== true) {
    return {
      label: 'OR30',
      state: 'forming',
      probesUsed: used,
      probesMax: max,
      note: 'OR30 not shaped yet — wait for lock',
    }
  }
  return {
    label: 'OR30',
    state: 'open',
    probesUsed: used,
    probesMax: max,
    note: `Open · ${used}/${max} probes · ±10 ${rangeEdgeBandLegend({ label: 'OR30', high: or30.high, low: or30.low })}`,
  }
}

function midBookLine(
  instrument: DeskInstrument,
  now: Date,
  ladder: AttemptLadder,
  range: ShapedRangeInput,
  label: string
): DeskBookLine {
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const used = ladder.ibAttempts
  const max = ladder.maxIbAttempts
  const open = isBucketWindowOpen(market, 'ib', t)

  if (!ladder.ibEligible && used >= max) {
    return {
      label,
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note: `${label} closed — probes used (2/2). Do not enter.`,
    }
  }
  if (!ladder.ibEligible) {
    return {
      label,
      state: 'upcoming',
      probesUsed: used,
      probesMax: max,
      note: bucketWindowUnlockMessage(market, 'ib', instrument, now),
    }
  }
  if (!open) {
    // Eligible early (morning probes exhausted) but mid window not started yet
    // → upcoming, never "dead" before the unlock clock.
    const win = bucketWindowSec(market, 'ib')
    if (win && t < win.start) {
      return {
        label,
        state: 'upcoming',
        probesUsed: used,
        probesMax: max,
        note: bucketWindowUnlockMessage(market, 'ib', instrument, now),
      }
    }
    return {
      label,
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note: `${label} closed — window over. Do not enter.`,
    }
  }
  if (label === 'US Range') {
    if (!range || range.complete !== true) {
      return {
        label,
        state: 'forming',
        probesUsed: used,
        probesMax: max,
        note: 'US Range not shaped (prior NYC) — wait',
      }
    }
  } else if (!range) {
    return {
      label,
      state: 'forming',
      probesUsed: used,
      probesMax: max,
      note: `${label} still forming — do not enter until first-hour lock`,
    }
  }

  const edges = shaped(range, label)
  return {
    label,
    state: 'open',
    probesUsed: used,
    probesMax: max,
    note: edges
      ? `Open · ${used}/${max} probes · ±10 ${rangeEdgeBandLegend(edges)}`
      : `Open · ${used}/${max} probes`,
  }
}

function lateBookLine(
  instrument: DeskInstrument,
  now: Date,
  ladder: AttemptLadder,
  range: ShapedRangeInput,
  label: string
): DeskBookLine {
  const market = deskMarketFor(instrument)
  const s = sessionFor(instrument)
  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const used = ladder.lunchAttempts
  const max = ladder.maxLunchAttempts
  const open = isBucketWindowOpen(market, 'lunch_range', t)

  if (!ladder.lunchEligible && used >= max) {
    return {
      label,
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note: `${label} closed — probes used (2/2). Do not enter.`,
    }
  }
  if (!ladder.lunchEligible) {
    return {
      label,
      state: 'upcoming',
      probesUsed: used,
      probesMax: max,
      note: bucketWindowUnlockMessage(market, 'lunch_range', instrument, now),
    }
  }
  if (!open) {
    const win = bucketWindowSec(market, 'lunch_range')
    if (win && t < win.start) {
      return {
        label,
        state: 'upcoming',
        probesUsed: used,
        probesMax: max,
        note: bucketWindowUnlockMessage(market, 'lunch_range', instrument, now),
      }
    }
    return {
      label,
      state: 'dead',
      probesUsed: used,
      probesMax: max,
      note: `${label} closed — window over. Do not enter.`,
    }
  }
  if (!range || (label !== 'Tokyo IB' && range.complete !== true)) {
    if (!range) {
      return {
        label,
        state: 'forming',
        probesUsed: used,
        probesMax: max,
        note: `${label} not shaped yet — wait for lock`,
      }
    }
  }
  const edges = shaped(range, label)
  return {
    label,
    state: 'open',
    probesUsed: used,
    probesMax: max,
    note: edges
      ? `Open · ${used}/${max} probes · ±10 ${rangeEdgeBandLegend(edges)}`
      : `Open · ${used}/${max} probes`,
  }
}

/**
 * Build one instrument card from ladder + shaped-range facts (no I/O).
 */
export function buildInstrumentDeskCard(
  facts: InstrumentBriefFacts,
  now: Date = new Date()
): InstrumentDeskCard {
  const instrument = facts.instrument
  const market = deskMarketFor(instrument)
  const tokyo = instrument === 'NIKKEI'
  const s = sessionFor(instrument)
  const ladder =
    facts.ladder ??
    attemptLadderFromCounts({
      morningAttempts: 0,
      ibAttempts: 0,
      lunchAttempts: 0,
      now,
      instrument,
    })

  const playbookMode = resolveDeskPlaybookMode({
    instrument,
    now,
    ladder,
  })
  const playbookTitle = deskPlaybookTitle(playbookMode, instrument)

  const books: DeskBookLine[] = []
  books.push(or30State(instrument, now, facts.or30 ?? null, ladder))
  if (tokyo) {
    books.push(
      midBookLine(instrument, now, ladder, facts.usRange ?? null, 'US Range')
    )
    books.push(
      lateBookLine(instrument, now, ladder, facts.ib ?? null, 'Tokyo IB')
    )
  } else {
    books.push(midBookLine(instrument, now, ladder, facts.ib ?? null, 'IB'))
    books.push(
      lateBookLine(instrument, now, ladder, facts.lunchRange ?? null, 'Lunch-range')
    )
  }

  const openBooks = books.filter((b) => b.state === 'open')
  const deadBooks = books.filter((b) => b.state === 'dead').map((b) => b.label)
  const openBook = openBooks[0]?.label ?? null
  const tradeableNow =
    weekdayInTz(now, s.tz) &&
    !ladder.dayLocked &&
    openBooks.length > 0

  let nextUnlock: string | null = null
  for (const b of books) {
    if (b.state === 'upcoming' || b.state === 'forming') {
      nextUnlock = `${b.label}: ${b.note}`
      break
    }
  }

  let activeRange: RangeEdgeLevels | null = null
  if (openBook === 'OR30') activeRange = shaped(facts.or30 ?? null, 'OR30')
  else if (openBook === 'IB') activeRange = shaped(facts.ib ?? null, 'IB')
  else if (openBook === 'Tokyo IB')
    activeRange = shaped(facts.ib ?? null, 'Tokyo IB')
  else if (openBook === 'US Range')
    activeRange = shaped(facts.usRange ?? null, 'US Range')
  else if (openBook === 'Lunch-range')
    activeRange = shaped(facts.lunchRange ?? null, 'Lunch-range')

  const bandHint =
    tradeableNow && activeRange
      ? `±10 ${rangeEdgeBandLegend(activeRange)} on ${openBook}`
      : null

  // Rank: tradeable open books first, then forming, then upcoming, then dead/day-locked
  let rankScore = 0
  if (ladder.dayLocked) rankScore = -100
  else if (tradeableNow) {
    rankScore = 100 + openBooks.reduce((n, b) => n + (b.probesMax - b.probesUsed), 0) * 10
    if (playbookMode === 'morning' && openBook === 'OR30') rankScore += 5
  } else if (books.some((b) => b.state === 'forming')) rankScore = 40
  else if (books.some((b) => b.state === 'upcoming')) rankScore = 20
  else rankScore = 0

  const t = parseTimeToSeconds(timeInTz(now, s.tz))
  const close = parseTimeToSeconds(s.marketClose)
  const open = parseTimeToSeconds(s.marketOpen)
  if (!weekdayInTz(now, s.tz) || t >= close || t < open - 30 * 60) {
    // Outside cash / focus — demote unless somehow still tradeable
    if (!tradeableNow) rankScore = Math.min(rankScore, 5)
  }

  const summaryLine = tradeableNow
    ? `${instrument}: trade ${openBook} (${openBooks[0]?.probesUsed}/${openBooks[0]?.probesMax})`
    : deadBooks.length === books.length || ladder.dayLocked
      ? `${instrument}: sit out — ${ladder.dayLocked ? 'session 3/3' : 'no live books'}`
      : `${instrument}: wait — ${nextUnlock ?? playbookTitle}`

  return {
    instrument,
    market,
    rankScore,
    playbookMode,
    playbookTitle,
    tradeableNow,
    openBook,
    deadBooks,
    nextUnlock,
    books,
    bandHint,
    activeRange,
    ladderLabel: formatAttemptLadderShort(ladder, instrument),
    summaryLine,
  }
}

function buildBullets(
  cards: InstrumentDeskCard[],
  factsByInst: Map<DeskInstrument, InstrumentBriefFacts>,
  now: Date
): string[] {
  const bullets: string[] = []
  const ny = cards.find((c) => c.instrument === 'DOW')
  const nas = cards.find((c) => c.instrument === 'NASDAQ')
  const nik = cards.find((c) => c.instrument === 'NIKKEI')

  const overnight =
    factsByInst.get('DOW')?.overnightNote ||
    factsByInst.get('NASDAQ')?.overnightNote ||
    factsByInst.get('NIKKEI')?.overnightNote
  if (overnight) {
    bullets.push(`Overnight / bias: ${overnight}`)
  } else {
    bullets.push(
      `As of ${montrealClock(now)} ${TRADER_DISPLAY_LABEL} — ranking from shaped ranges + desk clocks (rules-first).`
    )
  }

  for (const card of [ny, nas, nik].filter(Boolean) as InstrumentDeskCard[]) {
    const or30 = card.books.find((b) => b.label === 'OR30')
    if (or30?.state === 'dead') {
      bullets.push(`${card.instrument}: OR30 closed — do not enter.`)
    } else if (or30?.state === 'forming') {
      bullets.push(`${card.instrument}: OR30 still forming — no ±10 yet.`)
    } else if (or30?.state === 'open') {
      bullets.push(`${card.instrument}: OR30 open (${or30.probesUsed}/${or30.probesMax}).`)
    }
  }

  const live = cards.filter((c) => c.tradeableNow)
  if (live.length === 0) {
    bullets.push('Nothing left to trade across DOW / NASDAQ / NIKKEI — sit out.')
  } else {
    bullets.push(
      `Still live: ${live.map((c) => `${c.instrument} ${c.openBook}`).join(', ')}.`
    )
  }

  return bullets.slice(0, 5)
}

function buildSuggestion(
  cards: InstrumentDeskCard[],
  focusMarket: DeskMarket | 'ALL' = 'ALL'
): LiveDeskSuggestion {
  // Telegram digests are desk-scoped — never suggest the off-focus market.
  const scoped =
    focusMarket === 'ALL'
      ? cards
      : cards.filter((c) => c.market === focusMarket)
  const pool = scoped.length > 0 ? scoped : cards
  const best = pool.find((c) => c.tradeableNow && c.openBook)
  if (!best || !best.openBook) {
    const desk =
      focusMarket === 'TOKYO'
        ? 'NIKKEI'
        : focusMarket === 'NY'
          ? 'DOW / NASDAQ'
          : 'DOW / NASDAQ / NIKKEI'
    return {
      kind: 'sit_out',
      text: `Sit out — no eligible open books on ${desk} right now. Dead ranges stay closed; wait for the next unlock or next session.`,
    }
  }
  return {
    kind: 'trade',
    instrument: best.instrument,
    book: best.openBook,
    text: `Trade ${best.instrument} on ${best.openBook}${
      best.bandHint ? ` (${best.bandHint})` : ''
    }. Dead books stay closed — remaining probes only.`,
  }
}

/**
 * Rank DOW / NASDAQ / NIKKEI for the late / live desk brief.
 */
export function buildLiveDeskBrief(
  factsList: InstrumentBriefFacts[],
  now: Date = new Date(),
  focusMarket: DeskMarket | 'ALL' = 'ALL'
): LiveDeskBrief {
  const factsByInst = new Map<DeskInstrument, InstrumentBriefFacts>()
  for (const f of factsList) factsByInst.set(f.instrument, f)

  const instruments: DeskInstrument[] = ['DOW', 'NASDAQ', 'NIKKEI']
  const cards = instruments.map((instrument) =>
    buildInstrumentDeskCard(
      factsByInst.get(instrument) ?? { instrument },
      now
    )
  )
  cards.sort((a, b) => b.rankScore - a.rankScore || a.instrument.localeCompare(b.instrument))

  // Focus desk cards first in the ranked list (still show all three for Live Trading).
  if (focusMarket === 'NY' || focusMarket === 'TOKYO') {
    cards.sort((a, b) => {
      const aFocus = a.market === focusMarket ? 1 : 0
      const bFocus = b.market === focusMarket ? 1 : 0
      if (aFocus !== bFocus) return bFocus - aFocus
      return b.rankScore - a.rankScore || a.instrument.localeCompare(b.instrument)
    })
  }

  return {
    asOfIso: now.toISOString(),
    asOfDisplay: `${montrealClock(now)} ${TRADER_DISPLAY_LABEL}`,
    focusMarket,
    instruments: cards,
    bullets: buildBullets(cards, factsByInst, now),
    suggestion: buildSuggestion(cards, focusMarket),
  }
}

/** Compact Telegram / UI lines for one card. */
export function formatInstrumentBriefLines(card: InstrumentDeskCard): string[] {
  const lines = [
    `${card.tradeableNow ? '●' : '○'} ${card.instrument} — ${card.summaryLine}`,
    `  ${card.ladderLabel}`,
  ]
  for (const b of card.books) {
    const tag =
      b.state === 'open'
        ? 'OPEN'
        : b.state === 'dead'
          ? 'DEAD'
          : b.state === 'forming'
            ? 'FORMING'
            : 'NEXT'
    lines.push(`  · ${b.label} [${tag}] ${b.note}`)
  }
  if (card.bandHint) lines.push(`  Bands: ${card.bandHint}`)
  return lines
}

export function formatLiveDeskBriefText(brief: LiveDeskBrief): string {
  const lines = [
    `Late Desk Brief · as of ${brief.asOfDisplay}`,
    '────────────',
    ...brief.instruments.flatMap((c, i) => [
      `${i + 1}. ${c.instrument}${c.tradeableNow ? ' ★' : ''}`,
      ...formatInstrumentBriefLines(c).slice(1),
    ]),
    '',
    'What happened',
    ...brief.bullets.map((b) => `• ${b}`),
    '',
    brief.suggestion.kind === 'sit_out'
      ? `→ ${brief.suggestion.text}`
      : `→ ${brief.suggestion.text}`,
    '',
    'Telegram does not clock you in — open Live Trading in the app to join late.',
  ]
  return lines.join('\n')
}

/** Re-export for callers that need bucket labels without importing attemptLadder. */
export { bucketDisplayLabel }
