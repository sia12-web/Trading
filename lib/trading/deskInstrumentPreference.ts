/**
 * Remember the live desk instrument across refresh (DOW / NASDAQ / NIKKEI).
 * Clock-in lock still overrides the *view* while active, but must NOT overwrite
 * the stored preference (otherwise refresh always snaps back to the locked desk).
 */

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
 */
export const DESK_VISIBLE_BARS = 420

export function deskVisibleLogicalRange(barCount: number): { from: number; to: number } {
  const last = Math.max(barCount - 1, 0)
  const visible = Math.min(Math.max(barCount, 1), DESK_VISIBLE_BARS)
  return {
    from: last - visible + 1,
    to: last + 3,
  }
}

export function deskBarSpacing(containerWidth: number, barCount: number): number {
  const visible = Math.min(Math.max(barCount, 1), DESK_VISIBLE_BARS)
  return Math.min(8, Math.max(3, (containerWidth - 40) / visible))
}
