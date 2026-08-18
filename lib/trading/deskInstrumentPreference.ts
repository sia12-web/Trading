/**
 * Remember the live desk instrument across refresh (DOW / NASDAQ).
 * Clock-in lock owns the *view* while active. Preference is only for unclocked
 * browse — a remembered DOW tab must not hide a NASDAQ clock-in (MYM ~53k vs MNQ ~30k).
 * Persisted NIKKEI is ignored (live desk is NYC only; Nikkei stays on Simulation).
 */

import { DESK_BAR_SPACING } from '../chart/deskChartTheme'

export type DeskInstrumentPref = 'DOW' | 'NASDAQ'

const STORAGE_KEY = 'tradepulse.desk.instrument'

export function parseDeskInstrument(
  value: string | null | undefined
): DeskInstrumentPref | null {
  if (!value) return null
  const u = value.trim().toUpperCase()
  if (u === 'DOW' || u === 'NASDAQ') return u
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
 * First chart name: clock-in lock beats a remembered DOW tab.
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
    const fromUrl = parseDeskInstrument(
      new URLSearchParams(window.location.search).get('instrument')
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
    const fromUrl = parseDeskInstrument(
      new URLSearchParams(window.location.search).get('instrument')
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

export function deskVisibleBarCount(containerWidth: number, barCount: number): number {
  const byWidth = Math.floor(Math.max(containerWidth - 80, 240) / DESK_BAR_SPACING)
  return Math.min(Math.max(barCount, 1), Math.max(40, byWidth))
}

export function deskVisibleLogicalRange(
  barCount: number,
  containerWidth = 1160
): { from: number; to: number } {
  const last = Math.max(barCount - 1, 0)
  const visible = deskVisibleBarCount(containerWidth, barCount)
  return {
    from: last - visible + 1,
    to: last + 3,
  }
}

export function deskBarSpacing(_containerWidth: number, _barCount: number): number {
  return DESK_BAR_SPACING
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
  containerWidth = 1160
): { from: number; to: number } {
  const fallback = deskVisibleLogicalRange(barCount, containerWidth)
  if (!Number.isFinite(saved.fromEnd) || !Number.isFinite(saved.span) || saved.span < 8) {
    return fallback
  }
  const last = Math.max(barCount - 1, 0)
  const span = Math.min(Math.max(saved.span, 20), Math.max(barCount + 6, 20))
  const from = Math.max(0, Math.min(last, last - saved.fromEnd))
  return { from, to: from + span }
}

const VIEW_KEY = (instrument: string) => `tradepulse.chart.view.${instrument}`

export function saveDeskViewport(
  instrument: string,
  range: { from: number; to: number },
  barCount: number
): void {
  if (typeof window === 'undefined' || barCount < 2) return
  const encoded = encodeDeskViewport(range, barCount)
  if (!encoded) return
  try {
    sessionStorage.setItem(VIEW_KEY(instrument), JSON.stringify(encoded))
  } catch {
    /* private mode */
  }
}

export function loadDeskViewport(
  instrument: string,
  barCount: number,
  containerWidth = 1160
): { from: number; to: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(VIEW_KEY(instrument))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedDeskViewport
    return decodeDeskViewport(parsed, barCount, containerWidth)
  } catch {
    return null
  }
}

export type DeskOverlayToggles = {
  levels: boolean
  or30: boolean
  ib: boolean
  lunch: boolean
  us: boolean
  yday: boolean
  opening: boolean
  control: boolean
}

const OVERLAY_DEFAULTS: DeskOverlayToggles = {
  levels: false,
  or30: false,
  ib: false,
  lunch: false,
  us: false,
  yday: false,
  opening: false,
  control: false,
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
      or30: !!parsed.or30,
      ib: !!parsed.ib,
      lunch: !!parsed.lunch,
      us: !!parsed.us,
      yday: !!parsed.yday,
      opening: !!parsed.opening,
      control: !!parsed.control,
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
