import assert from 'node:assert/strict'
import {
  computeAnchoredVwap,
  computeVolumeProfile,
  pushVwapTick,
  stallOccupancy,
  timeOpportunity,
  volumeDivergence,
} from './auction'
import { buildDowMarket } from './marketData'
import { STORES } from './stores'
import type { OhlcvBar } from './types'

function bar(partial: Partial<OhlcvBar> & { close: number }): OhlcvBar {
  return {
    time: partial.time ?? 0,
    open: partial.open ?? partial.close,
    high: partial.high ?? partial.close + 5,
    low: partial.low ?? partial.close - 5,
    close: partial.close,
    volume: partial.volume ?? 1000,
  }
}

const profileBars: OhlcvBar[] = []
for (let i = 0; i < 40; i++) {
  const poc = i > 8 && i < 22
  const hvn = i > 28 && i < 34
  const lvn = i >= 23 && i <= 26
  const close = 42000 + i * 8
  profileBars.push(
    bar({
      time: i * 300,
      close,
      high: close + 6,
      low: close - 6,
      volume: poc ? 5000 : hvn ? 2800 : lvn ? 200 : 900,
    }),
  )
}

const vp = computeVolumeProfile(profileBars)
assert.ok(vp, 'volume profile computes')
assert.ok(vp.poc.price > vp.val && vp.poc.price < vp.vah, 'POC inside 70% value area')
assert.ok(vp.hvn.kind === 'hvn' && vp.hvn.price !== vp.poc.price, 'HVN distinct from POC')
assert.ok(vp.lvn.kind === 'lvn', 'LVN present')
assert.ok(vp.lvn.volume < vp.hvn.volume, 'LVN thinner than HVN')
assert.ok(vp.lvn.volume < vp.poc.volume, 'POC is the peak')

const daily: OhlcvBar[] = []
for (let i = 0; i < 20; i++) {
  daily.push(bar({ time: i * 86400, close: 40000 + i * 10, volume: 1e6 + i * 1000 }))
}
const av = computeAnchoredVwap(daily)
assert.ok(av, 'AVWAP computes')
assert.ok(av.upper1 > av.vwap && av.lower1 < av.vwap, '±1σ bands surround VWAP')
const next = pushVwapTick(av, av.vwap + 500, 5e6)
assert.ok(next.vwap > av.vwap, 'AVWAP updates toward new prints')

const confirm = volumeDivergence({ kind: 'hvn', liveVolume: 2000, typicalVolume: 1000 })
const empty = volumeDivergence({ kind: 'hvn', liveVolume: 200, typicalVolume: 1000 })
assert.ok(confirm > 0 && empty < 0, 'HVN divergence signs')

const thinOk = volumeDivergence({ kind: 'lvn', liveVolume: 100, typicalVolume: 400 })
const flood = volumeDivergence({ kind: 'lvn', liveVolume: 900, typicalVolume: 400 })
assert.ok(thinOk > 0 && flood < 0, 'LVN flood is adverse divergence')

const early = timeOpportunity({ kind: 'poc', tpoAtPrice: 0.4, sessionProgress: 0.05 })
const late = timeOpportunity({ kind: 'poc', tpoAtPrice: 9, sessionProgress: 0.8 })
assert.ok(early.opportunity > late.opportunity, 'time spent at POC reduces opportunity')
assert.equal(late.fairToday, true)

const dow = buildDowMarket()
assert.ok(dow.yesterday.poc.price > 40000, 'DOW yesterday POC in index territory')
assert.ok(dow.fiveDay.poc.price > 40000, '5D POC in index territory')
assert.ok(dow.avwap.sigma > 0, '5M AVWAP has volatility')
assert.equal(STORES.filter((s) => s.range === 'yesterday').length, 3)
assert.equal(STORES.filter((s) => s.range === 'fiveDay').length, 3)
assert.ok(STORES.filter((s) => s.range === 'fiveMonth').length >= 1)

const emptyHvn = stallOccupancy({
  kind: 'hvn',
  divergence: -0.85,
  timeOpportunity: 0.8,
  shutter: 1,
  floorAlive: 1,
  phase: 'live',
})
assert.ok(emptyHvn.hollow, 'HVN advertising empty reads hollow')
const floodLvn = stallOccupancy({
  kind: 'lvn',
  divergence: -0.9,
  timeOpportunity: 0.7,
  shutter: 1,
  floorAlive: 1,
  phase: 'live',
})
assert.ok(floodLvn.clogged, 'LVN flood clogs the dock')
const asleep = stallOccupancy({
  kind: 'poc',
  divergence: 0.6,
  timeOpportunity: 1,
  shutter: 0,
  floorAlive: 0,
  phase: 'preopen',
})
assert.equal(asleep.occupancy, 0)
assert.equal(asleep.door, 0)

const settled = stallOccupancy({
  kind: 'poc',
  divergence: 0.55,
  timeOpportunity: 0.22,
  shutter: 1,
  floorAlive: 1,
  phase: 'live',
})
assert.ok(settled.door < 0.45, 'already-fair door eases shut')
assert.ok(settled.occupancy > 0.4, 'already-fair POC still holds the volume')

const boosted = stallOccupancy({
  kind: 'hvn',
  divergence: 0.15,
  timeOpportunity: 0.7,
  shutter: 1,
  floorAlive: 1,
  phase: 'live',
  printBoost: 1,
})
assert.ok(boosted.occupancy > 0.55, 'a print fills the stall')
assert.ok(boosted.printBoost === 1)

const foundry = STORES.find((s) => s.building === 'foundry')!
const pit = STORES.find((s) => s.building === 'pit')!
const loft = STORES.find((s) => s.building === 'loft')!
const spire = STORES.find((s) => s.building === 'spire')!
assert.ok(pit.position[0] < foundry.position[0] - 4, 'Five-Month pit sits west of Foundry')
assert.ok(loft.position[0] < -10, 'loft is on the west wall')
assert.ok(spire.position[0] < -10, 'spire is on the west wall')
assert.ok(pit.position[2] > 2, 'discount pit is camera-near west')

console.log('auction tests: ok')
console.log(
  `Y POC ${dow.yesterday.poc.price}  HVN ${dow.yesterday.hvn.price}  LVN ${dow.yesterday.lvn.price}`,
)
console.log(
  `5D POC ${dow.fiveDay.poc.price}  HVN ${dow.fiveDay.hvn.price}  LVN ${dow.fiveDay.lvn.price}`,
)
console.log(`5M AVWAP ${dow.avwap.vwap.toFixed(1)}  σ ${dow.avwap.sigma.toFixed(1)}`)
