import assert from 'node:assert/strict'
import {
  computeAnchoredVwap,
  computeVolumeProfile,
  pushVwapTick,
  stallOccupancy,
  timeOpportunity,
  volumeDivergence,
  rangeHeight,
  PRINT_HOLD_MS,
} from './auction'
import { buildDowMarket } from './marketData'
import { OPEN_CINEMATIC_SEC } from './session'
import { COURT_SIGNS, COURT_STENCILS, porchOf, STORE_PLAQUES, STORES, storeShortName, cameraLadderLocals, apronGaugeLocal } from './stores'
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
  printSide: 'buy',
})
assert.ok(boosted.occupancy > 0.55, 'a print fills the stall')
assert.ok(boosted.printBoost === 1)
assert.ok(boosted.door > 0.7, 'a take throws the door')

const foundry = STORES.find((s) => s.building === 'foundry')!
const pit = STORES.find((s) => s.building === 'pit')!
const loft = STORES.find((s) => s.building === 'loft')!
const spire = STORES.find((s) => s.building === 'spire')!
const mill = STORES.find((s) => s.building === 'mill')!
assert.ok(pit.position[0] < foundry.position[0] - 5, 'Five-Month pit sits west of Foundry')
assert.ok(loft.position[0] < -10, 'loft is on the west wall')
assert.ok(spire.position[0] < -10, 'spire is on the west wall')
assert.ok(pit.position[2] > spire.position[2], 'discount pit is camera-near of the spire')
assert.ok(spire.position[2] > loft.position[2], 'spire sits between pit and loft')
assert.deepEqual(
  STORES.map((s) => s.building),
  ['foundry', 'hall', 'dock', 'yard', 'mill', 'alley', 'spire', 'loft', 'pit'],
)
assert.ok(['FOUNDRY', 'AUCTION HALL', 'LOADING DOCK', 'BEAM YARD', 'SAWTOOTH MILL', 'THE ALLEY', 'ANCHOR SPIRE', 'PREMIUM LOFT', 'DISCOUNT PIT'].every((n) => STORES.some((s) => s.name === n)))

const pitPorch = porchOf(pit)
const millPorch = porchOf(mill)
assert.ok(pitPorch.x > pit.position[0] + 1.5, 'west porch faces the courtyard (east)')
assert.ok(millPorch.x < mill.position[0] - 1.5, 'east porch faces the courtyard (west)')

const faded = stallOccupancy({
  kind: 'hvn',
  divergence: 0.7,
  timeOpportunity: 0.7,
  shutter: 1,
  floorAlive: 1,
  phase: 'live',
  printBoost: 1,
  printSide: 'sell',
})
assert.ok(faded.occupancy < 0.25, 'a fade empties the porch')
assert.ok(faded.door < 0.4, 'a fade drops the shutter')

const lo = 42000
const hi = 43000
assert.ok(Math.abs(rangeHeight(lo, lo, hi, 0.3, 3.6) - 0.3) < 1e-6, 'range low sits on the bottom storey')
assert.ok(Math.abs(rangeHeight(hi, lo, hi, 0.3, 3.6) - 3.6) < 1e-6, 'range high sits on the top storey')
const yVal = rangeHeight(42200, lo, hi, 0.3, 3.6)
const yVah = rangeHeight(42800, lo, hi, 0.3, 3.6)
assert.ok(yVal > 0.3 && yVah < 3.6 && yVah - yVal > 0.5, 'value area is a countable mid belt')

assert.equal(OPEN_CINEMATIC_SEC, 12, 'cash open holds twelve wall-clock seconds')
assert.ok(PRINT_HOLD_MS >= 12000, 'take dump stays long enough to film still and video')
const yard = STORES.find((s) => s.building === 'yard')!
assert.ok(yard.position[0] > 8 && yard.position[2] < mill.position[2] - 4, 'YARD is the far east crane store')
assert.deepEqual(
  COURT_SIGNS.map((s) => s.word),
  ['YESTERDAY', 'FIVE-DAY', 'FIVE-MONTH', 'YARD'],
  'all four court names stay on low signs',
)
assert.deepEqual(
  COURT_STENCILS.map((s) => s.word),
  ['YESTERDAY', 'FIVE-DAY', 'FIVE-MONTH', 'YARD'],
  'yesterday / five-day / five-month / yard stay as ground stencils',
)
for (const sign of COURT_SIGNS.filter((s) => s.word !== 'YARD')) {
  assert.ok(sign.z > 12.4, `${sign.word} plaque stays camera-near of the hall, not behind it`)
}
assert.ok(
  COURT_SIGNS.find((s) => s.word === 'YESTERDAY')!.z > 13.2,
  'YESTERDAY stays on a south-apron plaque so the full word is not eaten by the hall or gates',
)
assert.ok(
  Math.abs(COURT_SIGNS.find((s) => s.word === 'YESTERDAY')!.x) < 1.2,
  'YESTERDAY sits in the south-gate gap, not on a gate leaf that ate DAY',
)
assert.ok(
  COURT_SIGNS.find((s) => s.word === 'YARD')!.x > 12,
  'YARD plaque stays on the east crane dirt, not the mill wall',
)
assert.ok(
  COURT_SIGNS.find((s) => s.word === 'YARD')!.z > 1.5,
  'YARD court name sits on the camera-near east wall, not the back crane',
)
assert.ok(
  COURT_SIGNS.find((s) => s.word === 'FIVE-DAY')!.x > 8,
  'FIVE-DAY plaque stays east of the south-gate trees so the full word reads',
)
assert.ok(
  COURT_SIGNS.filter((s) => s.word !== 'YARD').every((s) => s.z > 13.2 && s.z < 15.5),
  'court names sit on the south apron inside the Clash crop so YESTERDAY is not clipped to YESTER',
)
assert.ok(
  COURT_SIGNS.find((s) => s.word === 'YESTERDAY')!.wide >= 4.4,
  'YESTERDAY is the full word on the wall strip',
)
assert.deepEqual(
  STORE_PLAQUES.map((s) => s.word),
  ['FOUNDRY', 'HALL', 'DOCK', 'ALLEY', 'MILL', 'YARD', 'PIT', 'SPIRE', 'LOFT'],
  'all nine store names sit on camera-near plaques with the court signs',
)
assert.ok(
  STORE_PLAQUES.every((s) => s.wide >= 2.5),
  'store name plaques are Clash-readable, not inspect-only',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'MILL')!.x > 8,
  'MILL is named on the east court, not only YARD',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'ALLEY')!.x > 8,
  'ALLEY is named on the east court',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'SPIRE')!.x < -8,
  'SPIRE sits on the west-south wall with PIT/LOFT, left of the gate that ate the word',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'PIT')!.x < -12,
  'PIT is a west-apron word, not stacked under FOUNDRY',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'HALL')!.z > 14.9,
  'HALL is a south-wall word in the gate gap, not behind a gate leaf',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'DOCK')!.z > 11.5,
  'DOCK plaque sits camera-near of the loading bay, in the default crop',
)
for (let i = 0; i < STORE_PLAQUES.length; i++) {
  for (let j = i + 1; j < STORE_PLAQUES.length; j++) {
    const a = STORE_PLAQUES[i]
    const b = STORE_PLAQUES[j]
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    assert.ok(d > 1.85, `${a.word} and ${b.word} plaques overlap (${d.toFixed(2)})`)
  }
}
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'SPIRE')!.z > 14.9,
  'SPIRE plaque sits on the camera-near south wall with FIVE-MONTH',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'LOFT')!.z > 11.5,
  'LOFT plaque sits in the default Clash crop with the court names',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'FOUNDRY')!.z > 12.4,
  'FOUNDRY plaque sits left of the south gate so the word is not only a fascia',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'PIT')!.z > 12.5,
  'PIT plaque stays camera-near of the five-month court',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'HALL')!.z > 12.5,
  'HALL plaque sits in the south-gate gap so the word reads with YESTERDAY',
)
assert.ok(
  STORE_PLAQUES.find((s) => s.word === 'YARD')!.z > 0,
  'YARD is a word on the east apron in the default crop, not only the crane',
)
assert.equal(storeShortName('y-poc'), 'HALL', 'tape never prints AUCTION from AUCTION HALL')
assert.equal(storeShortName('y-hvn'), 'FOUNDRY')
assert.equal(storeShortName('y-lvn'), 'DOCK')
assert.equal(storeShortName('5d-poc'), 'MILL')
assert.equal(storeShortName('avwap'), 'SPIRE')

const yFaces = cameraLadderLocals('yesterday', 4, 4)
assert.ok(yFaces.some((f) => f.face === 'south' && f.p[2] > 0), 'yesterday thermometer on the south (camera-near) wall')
assert.ok(yFaces.some((f) => f.face === 'east' && f.p[0] > 0), 'yesterday thermometer on the east (camera-right) wall')
const dFaces = cameraLadderLocals('fiveDay', 4, 4)
assert.ok(dFaces.some((f) => f.face === 'south' && f.p[0] > 0), 'five-day south face is local +X (world +Z)')
assert.ok(dFaces.some((f) => f.face === 'east' && f.p[2] < 0), 'five-day east face is local -Z (world +X)')
const mFaces = cameraLadderLocals('fiveMonth', 4, 4)
assert.ok(mFaces.some((f) => f.face === 'south' && f.p[0] < 0), 'five-month south face is local -X (world +Z)')
assert.ok(mFaces.some((f) => f.face === 'east' && f.p[2] > 0), 'five-month courtyard face is local +Z (world +X)')
const apronY = apronGaugeLocal('yesterday', 4, 4)
const apronD = apronGaugeLocal('fiveDay', 4, 4)
const apronM = apronGaugeLocal('fiveMonth', 4, 4)
assert.ok(apronY[0] > 0 && apronY[2] > 0, 'yesterday apron gauge on +X+Z corner')
assert.ok(apronD[0] > 0 && apronD[2] < 0, 'five-day apron gauge maps to world +X+Z')
assert.ok(apronM[0] < 0 && apronM[2] > 0, 'five-month apron gauge maps to world +X+Z')

const hallTime = timeOpportunity({ kind: 'poc', tpoAtPrice: 6.2, sessionProgress: 0.02 })
const millTime = timeOpportunity({ kind: 'poc', tpoAtPrice: 0.4, sessionProgress: 0.02 })
assert.ok(hallTime.fairToday && hallTime.opportunity < millTime.opportunity, 'yesterday POC is already fair; five-day POC still a window')
assert.ok(hallTime.opportunity < 0.38, 'yesterday POC opportunity is low enough to fly a FAIR flag')
const foundryTime = timeOpportunity({ kind: 'hvn', tpoAtPrice: 0.8, sessionProgress: 0.02 })
assert.ok(!foundryTime.fairToday && foundryTime.opportunity > 0.5, 'yesterday HVN is still a window, not FAIR')

console.log('auction tests: ok')
console.log(
  `Y POC ${dow.yesterday.poc.price}  HVN ${dow.yesterday.hvn.price}  LVN ${dow.yesterday.lvn.price}`,
)
console.log(
  `5D POC ${dow.fiveDay.poc.price}  HVN ${dow.fiveDay.hvn.price}  LVN ${dow.fiveDay.lvn.price}`,
)
console.log(`5M AVWAP ${dow.avwap.vwap.toFixed(1)}  σ ${dow.avwap.sigma.toFixed(1)}`)
