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
