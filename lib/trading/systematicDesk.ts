/**
 * Systematic NY desk flags (PRD 2026-08-26).
 * Live product: DOW / NASDAQ / GOLD / CRUDE, CALL ON, no Leo / Level Finder /
 * Highlight Time / Simulation / Nikkei.
 */

export const SYSTEMATIC_LIVE_DESK = true

export const LIVE_DESK_NAMES = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const
export type LiveDeskName = (typeof LIVE_DESK_NAMES)[number]

export function isLiveDeskName(value: string): value is LiveDeskName {
  return (LIVE_DESK_NAMES as readonly string[]).includes(value)
}
