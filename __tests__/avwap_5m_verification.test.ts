import {
  get5MonthAnchorUnix,
  barCivilDate,
  compute5MonthAnchoredVwap,
  compute5MonthAnchoredVwapFromDailyBars,
  type ContextBar,
} from '../lib/chart/context55'
import { NY_DESK_CLOCK, TOKYO_DESK_CLOCK } from '../lib/chart/sessionVwap'
import { snapDailyUnix } from '../lib/chart/chartTime'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

// 1. Oct 12, 2026 anchor check (5 calendar months prior = May 12, 2026)
const oct12Unix = Math.floor(new Date('2026-10-12T14:00:00Z').getTime() / 1000)
const anchorUnix = get5MonthAnchorUnix(oct12Unix, NY_DESK_CLOCK)
const anchorYmd = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY_DESK_CLOCK.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(anchorUnix * 1000))
console.log('NY Anchor YMD:', anchorYmd)
assert(anchorYmd === '2026-05-12', `Expected 2026-05-12, got ${anchorYmd}`)

// Tokyo Clock Anchor check
const tokyoAnchorUnix = get5MonthAnchorUnix(oct12Unix, TOKYO_DESK_CLOCK)
const tokyoAnchorYmd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TOKYO_DESK_CLOCK.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(tokyoAnchorUnix * 1000))
console.log('Tokyo Anchor YMD:', tokyoAnchorYmd)
assert(tokyoAnchorYmd === '2026-05-12', `Expected 2026-05-12, got ${tokyoAnchorYmd}`)

// 2. Generate 200 synthetic daily bars ending today
const bars: ContextBar[] = []
for (let i = 200; i >= 0; i--) {
  const t = snapDailyUnix(oct12Unix - i * 86400)
  const d = new Date(t * 1000).getUTCDay()
  if (d === 0 || d === 6) continue // skip weekends
  bars.push({
    time: t,
    open: 40000 + (200 - i) * 10,
    high: 40100 + (200 - i) * 10,
    low: 39900 + (200 - i) * 10,
    close: 40050 + (200 - i) * 10,
    volume: 100000,
  })
}

// 3. Compute Benchmark and Series
const bench = compute5MonthAnchoredVwapFromDailyBars(bars, oct12Unix, NY_DESK_CLOCK)
assert(bench !== null, 'Benchmark should not be null')
console.log('Benchmark:', {
  anchorDate: bench?.anchorDate,
  barCount: bench?.barCount,
  vwap: bench?.vwap,
  sigma1Upper: bench?.sigma1Upper,
  sigma1Lower: bench?.sigma1Lower,
  sigma2Upper: bench?.sigma2Upper,
  sigma2Lower: bench?.sigma2Lower,
  sigma3Upper: bench?.sigma3Upper,
  sigma3Lower: bench?.sigma3Lower,
})

const series = compute5MonthAnchoredVwap({
  bars,
  instrument: 'DOW',
})
assert(series !== null, 'Series should not be null')
const lastPoint = series!.vwap[series!.vwap.length - 1]!
const lastU1 = series!.upper1[series!.upper1.length - 1]!
const lastL1 = series!.lower1[series!.lower1.length - 1]!
const lastU2 = series!.upper2[series!.upper2.length - 1]!
const lastL2 = series!.lower2[series!.lower2.length - 1]!
const lastU3 = series!.upper3[series!.upper3.length - 1]!
const lastL3 = series!.lower3[series!.lower3.length - 1]!

console.log('Series Last Point:', {
  pointsCount: series?.vwap.length,
  vwap: lastPoint.value,
  sigma1Upper: lastU1.value,
  sigma1Lower: lastL1.value,
  sigma2Upper: lastU2.value,
  sigma2Lower: lastL2.value,
  sigma3Upper: lastU3.value,
  sigma3Lower: lastL3.value,
})

// First point of series MUST be May 12, 2026 (5 months ago, NOT 5 days ago!)
const firstPointYmd = barCivilDate(series!.vwap[0]!.time, NY_DESK_CLOCK.timeZone)
console.log('First series point date:', firstPointYmd)
assert(firstPointYmd === '2026-05-12', `First series point must be 2026-05-12, got ${firstPointYmd}`)

// Verification: Benchmark and Series MUST match exactly!
assert(bench?.barCount === series?.vwap.length, `Bar count match: ${bench?.barCount} === ${series?.vwap.length}`)
assert(bench?.vwap === lastPoint.value, `VWAP match: ${bench?.vwap} === ${lastPoint.value}`)
assert(bench?.sigma1Upper === lastU1.value, `+1σ match: ${bench?.sigma1Upper} === ${lastU1.value}`)
assert(bench?.sigma1Lower === lastL1.value, `-1σ match: ${bench?.sigma1Lower} === ${lastL1.value}`)
assert(bench?.sigma2Upper === lastU2.value, `+2σ match: ${bench?.sigma2Upper} === ${lastU2.value}`)
assert(bench?.sigma2Lower === lastL2.value, `-2σ match: ${bench?.sigma2Lower} === ${lastL2.value}`)
assert(bench?.sigma3Upper === lastU3.value, `+3σ match: ${bench?.sigma3Upper} === ${lastU3.value}`)
assert(bench?.sigma3Lower === lastL3.value, `-3σ match: ${bench?.sigma3Lower} === ${lastL3.value}`)

// Mathematical integrity of bands
assert(lastU1.value > lastPoint.value, '+1σ > VWAP')
assert(lastPoint.value > lastL1.value, 'VWAP > -1σ')
assert(lastU2.value > lastU1.value, '+2σ > +1σ')
assert(lastL1.value > lastL2.value, '-1σ > -2σ')
assert(lastU3.value > lastU2.value, '+3σ > +2σ')
assert(lastL2.value > lastL3.value, '-2σ > -3σ')

// Equidistance of sigma multipliers
const s1 = Number((lastU1.value - lastPoint.value).toFixed(2))
const s2 = Number(((lastU2.value - lastPoint.value) / 2).toFixed(2))
const s3 = Number(((lastU3.value - lastPoint.value) / 3).toFixed(2))
console.log('Standard deviation multipliers check:', { s1, s2, s3 })
assert(Math.abs(s1 - s2) <= 0.05, '1σ and 2σ band spacing is consistent')
assert(Math.abs(s1 - s3) <= 0.05, '1σ and 3σ band spacing is consistent')

console.log('✅ ALL 5M AVWAP ANCHOR AND BANDS TESTS PASSED PERFECTLY!')
