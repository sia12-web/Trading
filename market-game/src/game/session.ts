/** NYC cash session clock. Prototype runs faster than wall time so the open is playable. */

export const NY_OPEN_MIN = 9 * 60 + 30
export const NY_CLOSE_MIN = 16 * 60
export const PREOPEN_MIN = 9 * 60 + 28

/** Real seconds of cinematic at 9:30. Skip-to-open still plays this wake. */
export const OPEN_CINEMATIC_SEC = 10

/** Session minutes advanced per real second after the open. */
export const LIVE_TIME_SCALE = 2.4

export function formatNyClock(minutes: number): string {
  const m = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  const ss = Math.floor((m * 60) % 60)
  const h12 = ((hh + 11) % 12) + 1
  const ap = hh >= 12 ? 'PM' : 'AM'
  return `${h12}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} ${ap}`
}

export function formatNyClockShort(minutes: number): string {
  const m = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  const h12 = ((hh + 11) % 12) + 1
  const ap = hh >= 12 ? 'PM' : 'AM'
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`
}

export function sessionProgress(minutes: number): number {
  if (minutes <= NY_OPEN_MIN) return 0
  if (minutes >= NY_CLOSE_MIN) return 1
  return (minutes - NY_OPEN_MIN) / (NY_CLOSE_MIN - NY_OPEN_MIN)
}
