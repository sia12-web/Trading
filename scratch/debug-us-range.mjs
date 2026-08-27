import { tokyoDeskSessionAt } from '../lib/chart/sessionVwap'
import {
  computeNikkeiUsRangeBreakout,
  inNikkeiUsBuildSession,
} from '../lib/chart/nikkeiUsRangeBreakout'

function jstUnix(y: number, m: number, d: number, h: number, min: number) {
  return Math.floor(Date.UTC(y, m - 1, d, h - 9, min, 0) / 1000)
}

const times = [
  [15, 22, 30],
  [15, 23, 0],
  [16, 4, 0],
  [16, 10, 0],
  [16, 10, 5],
] as const
for (const [d, h, m] of times) {
  const t = jstUnix(2026, 7, d, h, m)
  console.log(
    `${d} ${h}:${m}`,
    'sess',
    tokyoDeskSessionAt(t),
    'build',
    inNikkeiUsBuildSession(t)
  )
}

const candles = []
for (let i = 0; i < 20; i++) {
  candles.push({
    time: jstUnix(2026, 7, 15, 18, i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  })
}
candles.push({
  time: jstUnix(2026, 7, 15, 22, 30),
  open: 105,
  high: 108,
  low: 104,
  close: 106,
  volume: 1000,
})
candles.push({
  time: jstUnix(2026, 7, 15, 23, 0),
  open: 106,
  high: 110,
  low: 105,
  close: 109,
  volume: 1000,
})
candles.push({
  time: jstUnix(2026, 7, 15, 23, 0) + 5 * 60,
  open: 106,
  high: 110,
  low: 105,
  close: 109,
  volume: 1000,
})
candles.push({
  time: jstUnix(2026, 7, 16, 4, 0),
  open: 109,
  high: 109.5,
  low: 100,
  close: 101,
  volume: 1000,
})
candles.push({
  time: jstUnix(2026, 7, 16, 10, 0),
  open: 109,
  high: 109.8,
  low: 108.5,
  close: 109.5,
  volume: 1000,
})
candles.push({
  time: jstUnix(2026, 7, 16, 10, 5),
  open: 109.5,
  high: 112,
  low: 109,
  close: 111.5,
  volume: 2500,
})
console.log(JSON.stringify(computeNikkeiUsRangeBreakout(candles), null, 2))
