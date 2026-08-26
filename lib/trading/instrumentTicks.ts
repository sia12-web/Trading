/**
 * Desk instrument tick sizes — snap limit / SL / TP before place.
 * Indices trade in whole points on this desk (OANDA displayPrecision usually 1).
 */

export type DeskTickInstrument = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE' | 'COPPER' | 'NATGAS'

const TICK_BY_INSTRUMENT: Record<DeskTickInstrument, number> = {
  DOW: 1,
  NASDAQ: 1,
  NIKKEI: 1,
  GOLD: 0.1,
  CRUDE: 0.01,
  COPPER: 0.001,
  NATGAS: 0.001,
}

export function instrumentTick(instrument: string): number {
  if (
    instrument === 'DOW' ||
    instrument === 'NASDAQ' ||
    instrument === 'NIKKEI' ||
    instrument === 'GOLD' ||
    instrument === 'CRUDE' ||
    instrument === 'COPPER' ||
    instrument === 'NATGAS'
  ) {
    return TICK_BY_INSTRUMENT[instrument as DeskTickInstrument]
  }
  return 1
}

/** Round price to the nearest tick (half-up away from zero for ties via Math.round). */
export function snapToTick(price: number, tick: number): number {
  if (!(price > 0) || !(tick > 0)) return price
  return Math.round(price / tick) * tick
}

export function snapDeskPrice(instrument: string, price: number): number {
  return snapToTick(price, instrumentTick(instrument))
}

/** Snap a stop so it stays on the protective side of the limit after rounding. */
export function snapStopToTick(
  instrument: string,
  limit: number,
  stop: number,
  direction: 'LONG' | 'SHORT'
): number {
  const tick = instrumentTick(instrument)
  let snapped = snapToTick(stop, tick)
  const snappedLimit = snapToTick(limit, tick)
  if (direction === 'LONG') {
    if (snapped >= snappedLimit) snapped = snappedLimit - tick
  } else if (snapped <= snappedLimit) {
    snapped = snappedLimit + tick
  }
  return snapped
}

/** Snap a take-profit so it stays on the reward side of the limit. */
export function snapTargetToTick(
  instrument: string,
  limit: number,
  target: number,
  direction: 'LONG' | 'SHORT'
): number {
  const tick = instrumentTick(instrument)
  let snapped = snapToTick(target, tick)
  const snappedLimit = snapToTick(limit, tick)
  if (direction === 'LONG') {
    if (snapped <= snappedLimit) snapped = snappedLimit + tick
  } else if (snapped >= snappedLimit) {
    snapped = snappedLimit - tick
  }
  return snapped
}
