import { computeAnchoredVwap, computeVolumeProfile, typicalPrice } from './auction'
import type { AnchoredVwap, OhlcvBar, VolumeProfile } from './types'

/** Mulberry32 — deterministic tape so the district is the same every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OPEN_NY = 9 * 60 + 30
const CLOSE_NY = 16 * 60
const BAR_MIN = 5

function sessionBarCount(): number {
  return (CLOSE_NY - OPEN_NY) / BAR_MIN
}

function makeDay(
  rand: () => number,
  openPx: number,
  dateOffset: number,
  opts: { pocBias: number; secondMode: number; gap: number },
): OhlcvBar[] {
  const bars: OhlcvBar[] = []
  let px = openPx
  const n = sessionBarCount()
  for (let i = 0; i < n; i++) {
    const t = i / n
    const towardPoc = (opts.pocBias - px) * 0.08
    const towardSecond = Math.sin(t * Math.PI * 2) * 0.35 * (opts.secondMode - px) * 0.02
    const noise = (rand() - 0.5) * 18
    const drift = towardPoc + towardSecond + noise
    const open = px
    const close = px + drift
    const extra = 6 + rand() * 22
    const high = Math.max(open, close) + extra * rand()
    const low = Math.min(open, close) - extra * rand()
    const distPoc = Math.abs((open + close) / 2 - opts.pocBias)
    const dist2 = Math.abs((open + close) / 2 - opts.secondMode)
    const inGap = distPoc > 40 && dist2 > 40
    const volBase = inGap ? 180 + rand() * 80 : 900 + rand() * 700
    const pocBoost = distPoc < 18 ? 2200 : distPoc < 40 ? 800 : 0
    const secondBoost = dist2 < 22 ? 1400 : 0
    const volume = volBase + pocBoost + secondBoost + (t > 0.85 ? 400 : 0)
    bars.push({
      time: dateOffset * 86400 + i * BAR_MIN * 60,
      open,
      high,
      low,
      close,
      volume,
    })
    px = close
  }
  void opts.gap
  return bars
}

export type MarketSnapshot = {
  yesterday: VolumeProfile
  fiveDay: VolumeProfile
  avwap: AnchoredVwap
  yesterdayBars: OhlcvBar[]
  fiveDayBars: OhlcvBar[]
  dailyBars: OhlcvBar[]
  priorClose: number
  openPrint: number
}

export function buildDowMarket(seed = 20260920): MarketSnapshot {
  const rand = rng(seed)
  const yOpen = 42410
  const yesterdayBars = makeDay(rand, yOpen, 1, {
    pocBias: 42482,
    secondMode: 42318,
    gap: 42390,
  })

  const fiveDayBars: OhlcvBar[] = []
  let dayOpen = 42180
  const pocs = [42240, 42310, 42420, 42510, 42482]
  const seconds = [42090, 42480, 42200, 42640, 42318]
  for (let d = 0; d < 5; d++) {
    const day = makeDay(rand, dayOpen, d - 4, {
      pocBias: pocs[d]!,
      secondMode: seconds[d]!,
      gap: (pocs[d]! + seconds[d]!) / 2,
    })
    fiveDayBars.push(...day)
    dayOpen = day[day.length - 1]!.close + (rand() - 0.45) * 40
  }

  const dailyBars: OhlcvBar[] = []
  let dClose = 40120
  for (let i = 0; i < 108; i++) {
    const t = i / 107
    const target = 40120 + t * 2280 + Math.sin(i / 9) * 180
    const open = dClose
    const close = open + (target - open) * 0.18 + (rand() - 0.48) * 90
    const high = Math.max(open, close) + 20 + rand() * 70
    const low = Math.min(open, close) - 20 - rand() * 70
    const volume = 1.8e6 + rand() * 9e5
    dailyBars.push({ time: i * 86400, open, high, low, close, volume })
    dClose = close
  }

  const yesterday = computeVolumeProfile(yesterdayBars)
  const fiveDay = computeVolumeProfile(fiveDayBars)
  const avwap = computeAnchoredVwap(dailyBars)
  if (!yesterday || !fiveDay || !avwap) {
    throw new Error('Failed to build DOW auction profiles')
  }

  const priorClose = yesterdayBars[yesterdayBars.length - 1]!.close
  const openPrint = priorClose + (yesterday.poc.price - priorClose) * 0.15 + 6

  return {
    yesterday,
    fiveDay,
    avwap,
    yesterdayBars,
    fiveDayBars,
    dailyBars,
    priorClose,
    openPrint,
  }
}

export function lastTypical(bars: OhlcvBar[]): number {
  return typicalPrice(bars[bars.length - 1]!)
}
