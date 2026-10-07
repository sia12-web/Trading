import assert from 'node:assert/strict'
import {
  computeNewsCatalystVwap,
  pickNewsCatalyst,
  projectBandSeriesOntoTimes,
  newsAvwapPointsFrom1m,
  type NewsCatalystInfo,
} from '../lib/chart/newsCatalystVwap'
import type { SessionBar } from '../lib/chart/sessionVwap'
import type { DeskCalendarEvent } from '../lib/trading/deskNews'

function build1mBars(startUnix: number, count: number): SessionBar[] {
  const out: SessionBar[] = []
  let price = 100
  for (let i = 0; i < count; i++) {
    const open = price
    const close = price + (i % 7 === 0 ? 0.8 : i % 5 === 0 ? -0.4 : 0.15)
    const high = Math.max(open, close) + 0.2
    const low = Math.min(open, close) - 0.2
    out.push({
      time: startUnix + i * 60,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 10) * 12,
    })
    price = close
  }
  return out
}

function downsample(bars: SessionBar[], stepSec: number): SessionBar[] {
  const buckets = new Map<number, SessionBar>()
  for (const b of bars) {
    const t = Math.floor(b.time / stepSec) * stepSec
    const cur = buckets.get(t)
    if (!cur) {
      buckets.set(t, { ...b, time: t })
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close
      cur.volume += b.volume
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

const eventUnix = Math.floor(Date.UTC(2026, 9, 7, 12, 30, 0) / 1000) // 08:30 ET
const bars1m = build1mBars(eventUnix - 120 * 60, 400)
const news: DeskCalendarEvent[] = [
  {
    id: 'cpi-0830',
    time: new Date(eventUnix * 1000).toISOString(),
    event: 'CPI m/m',
    impact: 'High',
    country: 'US',
    instruments: ['DOW'],
    deskNote: '',
    actual: '0.3%',
    estimate: '0.2%',
    prev: '0.2%',
  },
]

const on1m = computeNewsCatalystVwap(bars1m, news)
assert.ok(on1m, '1m news AVWAP must compute')
assert.ok(on1m!.latestVwap > 0)

const times5m = downsample(bars1m, 300).map((b) => b.time)
const times30m = downsample(bars1m, 1800).map((b) => b.time)
const on5mPaint = computeNewsCatalystVwap(bars1m, news, on1m!.catalyst.id, times5m)
const on30mPaint = computeNewsCatalystVwap(bars1m, news, on1m!.catalyst.id, times30m)
assert.ok(on5mPaint && on30mPaint)
assert.equal(on5mPaint!.latestVwap, on1m!.latestVwap, '5m paint must keep the 1m VWAP tip')
assert.equal(on30mPaint!.latestVwap, on1m!.latestVwap, '30m paint must keep the 1m VWAP tip')
assert.equal(on5mPaint!.catalyst.id, on30mPaint!.catalyst.id, 'same catalyst across paints')

const wrongTf = computeNewsCatalystVwap(downsample(bars1m, 1800), news)
assert.ok(wrongTf)
assert.notEqual(
  wrongTf!.latestVwap,
  on1m!.latestVwap,
  'sanity: computing ON 30m bars alone would change the tip — that path is what we removed'
)

const catalysts: NewsCatalystInfo[] = [
  {
    id: 'bar-surge-1',
    title: 'Spike',
    country: 'US',
    impact: 'High',
    eventTimeUnix: eventUnix + 3600,
    eventTimeFormatted: 'later',
    barTimeUnix: eventUnix + 3600,
    barIndex: 10,
    atrAtRelease: 9,
    baselineAtr: 1,
    atrSurgeRatio: 9,
    barRange: 9,
  },
  {
    id: 'cpi-0830',
    title: 'CPI m/m',
    country: 'US',
    impact: 'High',
    eventTimeUnix: eventUnix,
    eventTimeFormatted: 'cpi',
    barTimeUnix: eventUnix,
    barIndex: 5,
    atrAtRelease: 2,
    baselineAtr: 1,
    atrSurgeRatio: 2,
    barRange: 2,
  },
]
const picked = pickNewsCatalyst(catalysts)
assert.equal(picked?.id, 'cpi-0830', 'calendar event beats a later bar-surge id')

const projected = projectBandSeriesOntoTimes(on1m!.bands, times5m)
assert.equal(projected.vwap[projected.vwap.length - 1]!.value, on1m!.latestVwap)

const pts = newsAvwapPointsFrom1m(bars1m, eventUnix, times5m)
assert.ok(pts && pts.length >= 2)
assert.equal(pts![pts!.length - 1]!.vwap, on1m!.latestVwap)

console.log('news catalyst vwap timeframe-invariant ok')
