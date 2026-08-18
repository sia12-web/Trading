/**
 * Desk instrument preference persistence.
 * Run: npx tsx __tests__/desk_instrument_preference.test.ts
 */

import {
  parseDeskInstrument,
  deskVisibleLogicalRange,
  deskBarSpacing,
  encodeDeskViewport,
  decodeDeskViewport,
  resolveInitialDeskChartInstrument,
  DESK_VISIBLE_BARS,
} from '../lib/trading/deskInstrumentPreference'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(parseDeskInstrument('NASDAQ') === 'NASDAQ', 'NASDAQ')
assert(parseDeskInstrument('nasdaq') === 'NASDAQ', 'case')
assert(parseDeskInstrument('DOW') === 'DOW', 'DOW')
assert(parseDeskInstrument('NIKKEI') === null, 'live ignores stored NIKKEI')
assert(parseDeskInstrument('SPX') === null, 'reject junk')
assert(parseDeskInstrument(null) === null, 'null')
assert(parseDeskInstrument('') === null, 'empty')

assert(
  resolveInitialDeskChartInstrument({ clockLock: 'NASDAQ', preference: 'DOW' }) === 'NASDAQ',
  'clock lock beats remembered DOW tab'
)
assert(
  resolveInitialDeskChartInstrument({ clockLock: null, preference: 'NASDAQ' }) === 'NASDAQ',
  'preference used when no clock lock'
)
assert(
  resolveInitialDeskChartInstrument({ clockLock: 'NIKKEI', preference: 'NASDAQ' }) === 'NASDAQ',
  'NIKKEI clock lock ignored; preference used'
)
assert(
  resolveInitialDeskChartInstrument({ clockLock: 'NIKKEI', preference: 'NIKKEI' }) === 'DOW',
  'NIKKEI lock+pref fall back to DOW'
)

{
  const r = deskVisibleLogicalRange(3000)
  assert(r.to === 3002, `tip to ${r.to}`)
  assert(r.from === 3000 - DESK_VISIBLE_BARS, `from ${r.from}`)
  assert(r.to - r.from < 3000, 'not full history')
}

{
  const r = deskVisibleLogicalRange(50)
  assert(r.from === 0, 'small history starts at 0')
  assert(r.to === 52, 'small history tip')
}

{
  const spacing = deskBarSpacing(900, 3000)
  assert(spacing >= 12 && spacing <= 14, `spacing ${spacing}`)
}

{
  const fitted = deskVisibleLogicalRange(3000)
  const encoded = encodeDeskViewport(fitted, 3000)
  assert(!!encoded, 'encode tip window')
  const later = decodeDeskViewport(encoded!, 3100)
  assert(later.to - later.from === encoded!.span, `span held ${later.to - later.from}`)
  assert(3100 - 1 - later.from === encoded!.fromEnd, 'stays tip-relative after new bars')
}

console.log('desk_instrument_preference.test.ts: all passed')
