import {
  SESSION_STYLES,
  SESSION_WINDOWS,
  activeDeskSessionsAt,
  nyDeskSessionAt,
  computeSessionHighlightSpans,
  projectSessionHighlightRects,
  sessionLegendLabel,
} from '../lib/chart/sessionVwap'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function et(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(new Date(Date.UTC(y, m - 1, d, h + 4, min)).getTime() / 1000)
}

function makeBars(
  start: number,
  end: number,
  step = 300
): Array<{
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}> {
  const out = []
  for (let t = start; t <= end; t += step) {
    out.push({
      time: t,
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      volume: 1000,
    })
  }
  return out
}

console.log('--- Testing TradingView Session Colors & Styles ---')
assert(SESSION_STYLES.Asia.line === '#2962FF', 'Tokyo line is TradingView blue #2962FF')
assert(SESSION_STYLES.London.line === '#FF9800', 'London line is TradingView amber #FF9800')
assert(SESSION_STYLES['New York'].line === '#089981', 'New York line is TradingView teal #089981')
assert(sessionLegendLabel('Asia') === 'Tokyo', "Asia is displayed as 'Tokyo'")
assert(sessionLegendLabel('London') === 'London', "London is displayed as 'London'")
assert(sessionLegendLabel('New York') === 'New York', "New York is displayed as 'New York'")

console.log('--- Testing London + New York Overlap Detection ---')
const sess0800 = activeDeskSessionsAt(et(2026, 7, 15, 8, 0))
assert(sess0800.includes('London') && !sess0800.includes('New York'), '08:00 ET is London only')

const sess1000 = activeDeskSessionsAt(et(2026, 7, 15, 10, 0))
assert(sess1000.includes('London'), '10:00 ET includes London')
assert(sess1000.includes('New York'), '10:00 ET includes New York')
assert(sess1000.length === 2, '10:00 ET is London + New York overlap')

const sess1400 = activeDeskSessionsAt(et(2026, 7, 15, 14, 0))
assert(!sess1400.includes('London') && sess1400.includes('New York'), '14:00 ET is New York only')

const sess1700 = activeDeskSessionsAt(et(2026, 7, 15, 17, 0))
assert(sess1700.length === 0, '17:00 ET is dead zone')

const sess2100 = activeDeskSessionsAt(et(2026, 7, 15, 21, 0))
assert(sess2100.includes('Asia'), '21:00 ET is Tokyo/Asia')

console.log('--- Testing Concurrent Overlapping Spans ---')
const startT = et(2026, 7, 15, 3, 0)
const endT = et(2026, 7, 15, 14, 0)
const candles = makeBars(startT, endT)

const { spans, candleTimes } = computeSessionHighlightSpans({
  candles,
  asOfUnix: endT,
})

const lonSpan = spans.find((s) => s.name === 'London')
const nySpan = spans.find((s) => s.name === 'New York')

assert(lonSpan != null, 'Must have a London span')
assert(nySpan != null, 'Must have a New York span')

assert(lonSpan.startT === startT, 'London starts at 03:00 ET')
const expectedLonClose = et(2026, 7, 15, 11, 30)
assert(lonSpan.endT >= expectedLonClose, 'London continues until 11:30 ET despite NY opening at 09:30')

const expectedNyOpen = et(2026, 7, 15, 9, 30)
assert(nySpan.startT === expectedNyOpen, 'New York starts at 09:30 ET')
assert(nySpan.endT > lonSpan.endT, 'New York continues past London close')

// Scale timestamps linearly to 0..800px coordinate space
const { rects } = projectSessionHighlightRects({
  spans,
  candleTimes,
  timeScale: {
    timeToCoordinate: (t) => ((Number(t) - startT) / (endT - startT)) * 800,
    height: () => 600,
  },
  priceToY: (price) => 300 - (price - 100) * 10,
  priceScaleWidth: 70,
  containerWidth: 1000,
  containerHeight: 600,
  sessionPaint: 'full',
})

const lonCol = rects.find((r) => r.name === 'London' && r.isColumn)
const nyCol = rects.find((r) => r.name === 'New York' && r.isColumn)
const lonBox = rects.find((r) => r.name === 'London' && !r.isColumn)
const nyBox = rects.find((r) => r.name === 'New York' && !r.isColumn)

assert(lonCol != null, 'London column rect rendered')
assert(nyCol != null, 'New York column rect rendered')
assert(lonBox != null, 'London range box rect rendered')
assert(nyBox != null, 'New York range box rect rendered')

assert(lonCol.left < nyCol.left, 'London opens before New York')
assert(lonCol.left + lonCol.width > nyCol.left, 'London column extends into New York column (overlap)')
assert(lonBox.left + lonBox.width > nyBox.left, 'London range box extends into New York range box (overlap)')

console.log('✅ All session overlap and TradingView visual tests passed!')
