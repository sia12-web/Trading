/**
 * Remember the live desk instrument across refresh (DOW / NASDAQ / NIKKEI).
 * Clock-in lock still overrides while active.
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
