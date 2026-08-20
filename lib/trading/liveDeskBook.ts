/**
 * Live $50k book: NYC desk — DOW / NASDAQ / GOLD / CRUDE.
 * Shared 3-fill session; switch freely among the four after clock-in.
 * Nikkei stays on Simulation.
 */

export const LIVE_CLOCK_INSTRUMENTS = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const
export type LiveClockInstrument = (typeof LIVE_CLOCK_INSTRUMENTS)[number]

export const LIVE_CLOCK_REFUSE =
  'Live desk is NYC only (DOW / NASDAQ / GOLD / CRUDE). Nikkei is Simulation.'

export function isLiveClockInstrument(
  instrument: string | null | undefined
): instrument is LiveClockInstrument {
  return (
    instrument === 'DOW' ||
    instrument === 'NASDAQ' ||
    instrument === 'GOLD' ||
    instrument === 'CRUDE'
  )
}

/**
 * Free-switch desk: never treat another NY book as glance-only.
 * Kept for call-site compatibility; always false.
 */
export function isNyGlanceChart(
  _locked: string | null | undefined,
  _viewing: string | null | undefined
): boolean {
  return false
}

/** Live book labels — micros / full CL. */
export function liveDeskContractLabel(instrument: string | null | undefined): string {
  if (instrument === 'DOW') return 'DOW · MYM'
  if (instrument === 'NASDAQ') return 'NASDAQ · MNQ'
  if (instrument === 'GOLD') return 'GOLD · MGC'
  if (instrument === 'CRUDE') return 'CRUDE · CL'
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
  if (instrument === 'GOLD') {
    return 'Micro Gold MGC — match Tradovate MGC / TradingView MGC1!, not full GC.'
  }
  if (instrument === 'CRUDE') {
    return 'Crude oil CL — match Tradovate CL / TradingView CL1!. Shared 3-fill desk with indexes + gold.'
  }
  return ''
}

export function clockedNameOnlyMessage(locked: string | null | undefined): string {
  return `NY desk clocked in (${liveDeskContractLabel(locked) || 'board'}). Switch freely among DOW / NASDAQ / GOLD / CRUDE — shared 3 fills.`
}

/** Prefer viewing book; fall back to locked preference, then first visible. */
export function resolveClockedChartInstrument(args: {
  locked: string | null | undefined
  viewing: string | null | undefined
  visible: readonly string[]
}): string {
  const visible = args.visible.filter((v) => typeof v === 'string' && v.length > 0)
  const viewing =
    args.viewing && visible.includes(args.viewing) ? args.viewing : null
  if (viewing) return viewing
  const locked = args.locked && visible.includes(args.locked) ? args.locked : null
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
      error: 'Clock in on DOW, NASDAQ, GOLD, or CRUDE. Shared 3 fills across the NY board.',
    }
  }
  // Free switch: already clocked into another NY name is OK — preference updates.
  return { ok: true, instrument: args.instrument }
}
