/**
 * Live $50k book: NYC only, one clock-in name, micros (MYM / MNQ).
 * Nikkei stays on Simulation. Oil/gold/beans are out.
 */

export const LIVE_CLOCK_INSTRUMENTS = ['DOW', 'NASDAQ'] as const
export type LiveClockInstrument = (typeof LIVE_CLOCK_INSTRUMENTS)[number]

export const LIVE_CLOCK_REFUSE =
  'Live desk is NYC only (DOW / NASDAQ · MYM / MNQ). Nikkei is Simulation.'

export function isLiveClockInstrument(
  instrument: string | null | undefined
): instrument is LiveClockInstrument {
  return instrument === 'DOW' || instrument === 'NASDAQ'
}

/** True when the chart/API is on the unclocked NY twin — not a tradable view. */
export function isNyGlanceChart(
  locked: string | null | undefined,
  viewing: string | null | undefined
): boolean {
  return (
    isLiveClockInstrument(locked) &&
    isLiveClockInstrument(viewing) &&
    locked !== viewing
  )
}

/** Live book labels — micros only. DOW≠NASDAQ (Dow ~53k vs Nasdaq-100 ~30k). */
export function liveDeskContractLabel(instrument: string | null | undefined): string {
  if (instrument === 'DOW') return 'DOW · MYM'
  if (instrument === 'NASDAQ') return 'NASDAQ · MNQ'
  if (instrument === 'NIKKEI') return 'NIKKEI'
  return instrument?.trim() || '—'
}

export function liveDeskIndexHint(instrument: string | null | undefined): string {
  if (instrument === 'DOW') {
    return 'Micro Dow MYM — Dow points (~53k). TradingView MNQ is Nasdaq-100 (~30k), a different index.'
  }
  if (instrument === 'NASDAQ') {
    return 'Micro Nasdaq MNQ — Nasdaq-100 points (~30k). Match TradingView MNQ, not MYM/Dow (~53k).'
  }
  return ''
}

export function clockedNameOnlyMessage(locked: string | null | undefined): string {
  return `Clocked ${liveDeskContractLabel(locked)} — one name today. Tickets stay on ${liveDeskContractLabel(locked)}.`
}

/** Clocked name owns the chart. No twin tab / glance view while the lock is live. */
export function resolveClockedChartInstrument(args: {
  locked: string | null | undefined
  viewing: string | null | undefined
  visible: readonly string[]
}): string {
  const visible = args.visible.filter((v) => typeof v === 'string' && v.length > 0)
  const locked = args.locked && visible.includes(args.locked) ? args.locked : null
  const viewing =
    args.viewing && visible.includes(args.viewing) ? args.viewing : null
  if (locked) return locked
  return viewing || visible[0] || 'DOW'
}

export function assertLiveClockIn(args: {
  market: string | null | undefined
  instrument: string | null | undefined
  existingInstrument?: string | null
  alreadyClockedIn?: boolean
}): { ok: true; instrument: LiveClockInstrument } | { ok: false; error: string } {
  if (args.market === 'TOKYO' || args.instrument === 'NIKKEI') {
    return { ok: false, error: LIVE_CLOCK_REFUSE }
  }
  if (args.market && args.market !== 'NY') {
    return { ok: false, error: LIVE_CLOCK_REFUSE }
  }
  if (!isLiveClockInstrument(args.instrument)) {
    return {
      ok: false,
      error: 'Clock in on DOW or NASDAQ (MYM / MNQ). Name is locked for the session.',
    }
  }
  if (
    args.alreadyClockedIn &&
    args.existingInstrument &&
    isLiveClockInstrument(args.existingInstrument) &&
    args.existingInstrument !== args.instrument
  ) {
    return {
      ok: false,
      error: `Already clocked into ${args.existingInstrument} — name is locked for this session.`,
    }
  }
  return { ok: true, instrument: args.instrument }
}
