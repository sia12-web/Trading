/**
 * Remember the live desk instrument across refresh (DOW / NASDAQ / GOLD / CRUDE).
 * Clock-in lock is a preference only — free-switch among the four NY books.
 * Persisted NIKKEI is ignored (live desk is NYC only; Nikkei stays on Simulation).
 */

import { DESK_BAR_SPACING } from '../chart/deskChartTheme'
import { isLiveClockInstrument, type LiveClockInstrument } from './liveDeskBook'

export type DeskInstrumentPref = LiveClockInstrument

const STORAGE_KEY = 'tradepulse.desk.instrument'

export function parseDeskInstrument(
  value: string | null | undefined
): DeskInstrumentPref | null {
  if (!value) return null
  const u = value.trim().toUpperCase()
  if (isLiveClockInstrument(u)) return u
  return null
}

const CLOCK_LOCK_KEY = 'tradepulse.desk.clockLock'

export function loadDeskClockLock(): DeskInstrumentPref | null {
  if (typeof window === 'undefined') return null
  try {
    return parseDeskInstrument(sessionStorage.getItem(CLOCK_LOCK_KEY))
  } catch {
    return null
  }
}

export function saveDeskClockLock(instrument: DeskInstrumentPref | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!instrument) sessionStorage.removeItem(CLOCK_LOCK_KEY)
    else sessionStorage.setItem(CLOCK_LOCK_KEY, instrument)
  } catch {
    /* private mode */
  }
}

/**
 * First chart name: clock-in preference beats a remembered tab.
 * SSR has no sessionStorage — callers must hold candles until client boot.
 */
export function resolveInitialDeskChartInstrument(args: {
  clockLock?: string | null
  preference?: string | null
}): DeskInstrumentPref {
  return (
    parseDeskInstrument(args.clockLock) ??
    parseDeskInstrument(args.preference) ??
    'DOW'
  )
}

export function initialDeskChartInstrument(): DeskInstrumentPref {
  if (typeof window === 'undefined') return 'DOW'
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = parseDeskInstrument(
      params.get('instrument') ?? params.get('market')
    )
    return resolveInitialDeskChartInstrument({
      clockLock: loadDeskClockLock(),
      preference: fromUrl ?? parseDeskInstrument(localStorage.getItem(STORAGE_KEY)),
    })
  } catch {
    return 'DOW'
  }
}

/** Read URL first, then localStorage. Safe on SSR (returns DOW). */
export function getDeskInstrumentPreference(): DeskInstrumentPref {
  if (typeof window === 'undefined') return 'DOW'
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = parseDeskInstrument(
      params.get('instrument') ?? params.get('market')
    )
    if (fromUrl) return fromUrl
    return parseDeskInstrument(localStorage.getItem(STORAGE_KEY)) ?? 'DOW'
  } catch {
    return 'DOW'
  }
}

/** Persist only intentional user tab clicks — never session lock / gate sync. */
export function setDeskInstrumentPreference(instrument: DeskInstrumentPref): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, instrument)
    const url = new URL(window.location.href)
    url.searchParams.set('instrument', instrument)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* private mode / SSR */
  }
}

/**
 * Desk viewport after load / instrument switch — tip-anchored, not full history.
 * Fitting all ~3k bars makes the chart look randomly "zoomed out."
 * Bar count follows pane width so each candle stays ~DESK_BAR_SPACING px.
 */
export const DESK_VISIBLE_BARS = 90

export function deskVisibleBarCount(
  containerWidth: number,
  barCount: number,
  timeframe?: string
): number {
  const isDaily = timeframe === '1D'
  const is30m = timeframe === '30m'
  const spacing = isDaily ? 6 : is30m ? 24 : DESK_BAR_SPACING
  const byWidth = Math.floor(Math.max(containerWidth - 80, 240) / spacing)
  const minBars = isDaily ? 120 : is30m ? 24 : 40
  return Math.min(Math.max(barCount, 1), Math.max(minBars, byWidth))
}

export function deskVisibleLogicalRange(
  barCount: number,
  containerWidth = 1160,
  timeframe?: string
): { from: number; to: number } {
  const last = Math.max(barCount - 1, 0)
  const visible = deskVisibleBarCount(containerWidth, barCount, timeframe)
  return {
    from: Math.max(0, last - visible + 1),
    to: last + 3,
  }
}

export function deskBarSpacing(
  _containerWidth: number,
  _barCount: number,
  timeframe?: string
): number {
  return timeframe === '1D' ? 6 : timeframe === '30m' ? 24 : DESK_BAR_SPACING
}

/** Tip-relative viewport so new prints keep the same window after refresh. */
export type SavedDeskViewport = {
  fromEnd: number
  span: number
}

export function encodeDeskViewport(
  range: { from: number; to: number },
  barCount: number
): SavedDeskViewport | null {
  const last = Math.max(barCount - 1, 0)
  const span = range.to - range.from
  if (!Number.isFinite(span) || span < 8) return null
  return {
    fromEnd: last - range.from,
    span,
  }
}

export function decodeDeskViewport(
  saved: SavedDeskViewport,
  barCount: number,
  containerWidth = 1160,
  timeframe?: string
): { from: number; to: number } {
  const fallback = deskVisibleLogicalRange(barCount, containerWidth, timeframe)
  if (!Number.isFinite(saved.fromEnd) || !Number.isFinite(saved.span) || saved.span < 8) {
    return fallback
  }
  const is30m = timeframe === '30m'
  const expectedVisible = deskVisibleBarCount(containerWidth, barCount, timeframe)
  // If the saved span was from an old squished view (> 1.5x expected 30m visible bars), reset to fallback
  if (is30m && saved.span > expectedVisible * 1.5) {
    return fallback
  }
  const last = Math.max(barCount - 1, 0)
  const maxSpan = is30m
    ? Math.max(48, Math.floor((containerWidth - 80) / 20))
    : 10000
  const span = Math.min(Math.max(saved.span, 10), maxSpan)
  const from = last - saved.fromEnd
  return { from, to: from + span }
}

const VIEW_KEY = (instrument: string, timeframe = '5m') => `tradepulse.chart.view.${instrument}.${timeframe}`

export function saveDeskViewport(
  instrument: string,
  range: { from: number; to: number },
  barCount: number,
  timeframe = '5m'
): void {
  if (typeof window === 'undefined' || barCount < 2) return
  const encoded = encodeDeskViewport(range, barCount)
  if (!encoded) return
  try {
    sessionStorage.setItem(VIEW_KEY(instrument, timeframe), JSON.stringify(encoded))
  } catch {
    /* private mode */
  }
}

export function loadDeskViewport(
  instrument: string,
  barCount: number,
  containerWidth = 1160,
  timeframe = '5m'
): { from: number; to: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(VIEW_KEY(instrument, timeframe))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedDeskViewport
    return decodeDeskViewport(parsed, barCount, containerWidth, timeframe)
  } catch {
    return null
  }
}

export type DeskOverlayToggles = {
  levels: boolean
  or15: boolean
  or30: boolean
  ib: boolean
  lunch: boolean
  us: boolean
  yday: boolean
  opening: boolean
  control: boolean
  sessions: boolean
  auction: boolean
  dow15mFail: boolean
}

const OVERLAY_DEFAULTS: DeskOverlayToggles = {
  levels: false,
  or15: false,
  or30: false,
  ib: false,
  lunch: false,
  us: false,
  yday: false,
  opening: false,
  control: false,
  sessions: false,
  auction: false,
  dow15mFail: false,
}

const OVERLAY_KEY = 'tradepulse.chart.overlays'

export function loadDeskOverlayToggles(): DeskOverlayToggles {
  if (typeof window === 'undefined') return { ...OVERLAY_DEFAULTS }
  try {
    const raw = sessionStorage.getItem(OVERLAY_KEY)
    if (!raw) return { ...OVERLAY_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<DeskOverlayToggles>
    return {
      levels: !!parsed.levels,
      or15: !!(parsed.or15 ?? parsed.lunch),
      or30: !!parsed.or30,
      ib: !!parsed.ib,
      lunch: false,
      us: !!parsed.us,
      yday: !!parsed.yday,
      opening: !!parsed.opening,
      control: !!parsed.control,
      sessions: !!parsed.sessions,
      auction: !!parsed.auction,
      dow15mFail: !!parsed.dow15mFail,
    }
  } catch {
    return { ...OVERLAY_DEFAULTS }
  }
}

export function saveDeskOverlayToggles(toggles: DeskOverlayToggles): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(OVERLAY_KEY, JSON.stringify(toggles))
  } catch {
    /* private mode */
  }
}
