/**
 * Remember the live desk instrument across refresh (DOW / NASDAQ / NIKKEI).
 * Clock-in lock still overrides the *view* while active, but must NOT overwrite
 * the stored preference (otherwise refresh always snaps back to the locked desk).
 */

import { DESK_BAR_SPACING } from '../chart/deskChartTheme'

export type DeskInstrumentPref = 'DOW' | 'NASDAQ' | 'NIKKEI'

const STORAGE_KEY = 'tradepulse.desk.instrument'

export function parseDeskInstrument(
  value: string | null | undefined
): DeskInstrumentPref | null {
  if (!value) return null
  const u = value.trim().toUpperCase()
  if (u === 'DOW' || u === 'NASDAQ' || u === 'NIKKEI') return u
  return null
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
