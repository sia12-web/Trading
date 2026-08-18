/**
 * IB extend vs revert — first tag is not the entry.
 * Run: npx tsx __tests__/ib_extend_advice.test.ts
 */

import assert from 'node:assert/strict'
import { computeInitialBalance, type DeskBar } from '../lib/trading/deskLevels'
import {
  VALUE_ACCEPTANCE_RAMP_FULL_MS,
} from '../lib/trading/valueAcceptance'
import {
  applyIbLiquiditySwingToRange,
  computeIbExtendAdvice,
  findIbLiquiditySwing,
  isIbContextBoxReasoning,
  isIbExtendInstrument,
  type IbAdviceBar,
} from '../lib/trading/ibExtendAdvice'

const OPEN = 1_700_000_000
const IB_END = OPEN + 60 * 60
const STEP = 5 * 60

function ibSessionBars(): IbAdviceBar[] {
  const out: IbAdviceBar[] = []
  for (let t = OPEN; t < IB_END; t += STEP) {
    out.push({ time: t, open: 105, high: 110, low: 100, close: 105 })
  }
  return out
}

function bar(
  time: number,
  high: number,
  low: number,
  close: number
): IbAdviceBar {
  return { time, open: close, high, low, close }
}

function asDesk(bars: IbAdviceBar[]): DeskBar[] {
  return bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: 1,
  }))
}

/** IB lock + first tag + swing high at 113 (confirmed) — no raid yet. */
function throughSwing(): IbAdviceBar[] {
  const bars = ibSessionBars()
  bars.push(bar(IB_END, 110.5, 104, 108))
  bars.push(bar(IB_END + STEP, 109, 103, 107))
  bars.push(bar(IB_END + STEP * 2, 113, 108, 111))
  bars.push(bar(IB_END + STEP * 3, 111.5, 107, 109))
  return bars
}

function throughRaid(): { bars: IbAdviceBar[]; raidTime: number } {
  const bars = throughSwing()
  const raidTime = IB_END + STEP * 4
  bars.push(bar(raidTime, 114.5, 111, 113.8))
  return { bars, raidTime }
}

function sitOutside(from: number, lastPrice: number): IbAdviceBar[] {
  const extra: IbAdviceBar[] = []
  const hold = VALUE_ACCEPTANCE_RAMP_FULL_MS / 1000
  for (let t = from + STEP; t <= from + hold; t += STEP) {
    extra.push(bar(t, lastPrice + 0.4, lastPrice - 0.4, lastPrice))
  }
  return extra
}

function sitInside(from: number, lastPrice: number): IbAdviceBar[] {
  const extra: IbAdviceBar[] = []
  const hold = VALUE_ACCEPTANCE_RAMP_FULL_MS / 1000
  for (let t = from + STEP; t <= from + hold; t += STEP) {
    extra.push(bar(t, lastPrice + 0.4, lastPrice - 0.4, lastPrice))
  }
  return extra
}

{
  assert.equal(isIbExtendInstrument('DOW'), true)
  assert.equal(isIbExtendInstrument('NASDAQ'), true)
  assert.equal(isIbExtendInstrument('NIKKEI'), false)
  assert.equal(
    isIbContextBoxReasoning('Initial Balance high (first 60m) — afternoon watch'),
    true
  )
  assert.equal(
    isIbContextBoxReasoning('Liquidity swing at IB high — test this level'),
    false
  )
  const snapped = applyIbLiquiditySwingToRange(
    { label: 'IB', high: 110, low: 100 },
    { kind: 'high', price: 113, time: 1, confirmTime: 2 }
  )
  assert.equal(snapped.high, 113, '±10 high snaps to swing')
  assert.equal(snapped.low, 100, 'untagged edge stays IB low')
}

{
  const bars = ibSessionBars().slice(0, 6)
  const ib = computeInitialBalance(asDesk(bars), OPEN, OPEN + 30 * 60)
  assert.equal(ib, null, 'IB not shaped before +60m')
  const advice = computeIbExtendAdvice({
    instrument: 'DOW',
    ib,
    candles: bars,
    nowUnix: OPEN + 30 * 60,
    useCall: false,
    callSide: 'WAIT',
  })
  assert.equal(advice.ibComplete, false)
  assert.equal(advice.isGo, false)
  assert.notEqual(advice.regime, 'extend_high')
  assert.notEqual(advice.regime, 'extend_low')
  assert.equal(advice.phase, 'ib_forming')
}

{
  const bars = throughSwing().slice(0, ibSessionBars().length + 1)
  const ib = computeInitialBalance(asDesk(ibSessionBars()), OPEN, IB_END)
  assert.ok(ib)
  const advice = computeIbExtendAdvice({
    instrument: 'NASDAQ',
    ib,
    candles: bars,
    nowUnix: IB_END + 60,
    useCall: false,
    callSide: 'LONG',
  })
  assert.equal(advice.ibComplete, true)
  assert.equal(advice.phase, 'first_tag')
  assert.equal(advice.regime, 'waiting')
  assert.equal(advice.isGo, false)
  assert.ok(advice.firstTag)
  assert.equal(advice.swing, null)
}

{
  const bars = throughSwing()
  const ib = computeInitialBalance(asDesk(bars), OPEN, IB_END)!
  const swing = findIbLiquiditySwing(bars, ib)
  assert.ok(swing)
  assert.equal(swing.kind, 'high')
  const advice = computeIbExtendAdvice({
    instrument: 'DOW',
    ib,
    candles: bars,
    nowUnix: bars[bars.length - 1]!.time,
    useCall: false,
    callSide: 'LONG',
  })
  assert.equal(advice.phase, 'swing')
  assert.equal(advice.regime, 'waiting')
  assert.equal(advice.isGo, false)
  assert.ok(advice.swing)
}

{
  const { bars: raidBars, raidTime } = throughRaid()
  const hold = sitOutside(raidTime, 113.8)
  const bars = [...raidBars, ...hold]
  const ib = computeInitialBalance(asDesk(bars), OPEN, IB_END)!
  const nowUnix = raidTime + VALUE_ACCEPTANCE_RAMP_FULL_MS / 1000
  const advice = computeIbExtendAdvice({
    instrument: 'DOW',
    ib,
    candles: bars,
    nowUnix,
    lastPrice: 113.8,
    useCall: false,
    callSide: 'LONG',
  })
  assert.equal(advice.phase, 'extend', advice.message)
  assert.equal(advice.regime, 'extend_high')
  assert.equal(advice.isGo, true)
  assert.equal(advice.adviceSide, 'LONG')
  assert.equal(advice.raid?.outsideRead?.state, 'looking_accepted')
}

{
  const { bars: raidBars, raidTime } = throughRaid()
  const backTime = raidTime + STEP
  const back = bar(backTime, 112, 104, 105)
  const hold = sitInside(backTime, 105)
  const bars = [...raidBars, back, ...hold]
  const ib = computeInitialBalance(asDesk(bars), OPEN, IB_END)!
  const nowUnix = backTime + VALUE_ACCEPTANCE_RAMP_FULL_MS / 1000
  const advice = computeIbExtendAdvice({
    instrument: 'NASDAQ',
    ib,
    candles: bars,
    nowUnix,
    lastPrice: 105,
    useCall: false,
    callSide: 'SHORT',
  })
  assert.equal(advice.phase, 'revert', advice.message)
  assert.equal(advice.regime, 'balance')
  assert.equal(advice.isGo, true)
  assert.equal(advice.adviceSide, 'SHORT')
  assert.equal(advice.raid?.insideRead?.state, 'looking_accepted')
}

{
  const { bars: raidBars, raidTime } = throughRaid()
  const hold = sitOutside(raidTime, 113.8)
  const bars = [...raidBars, ...hold]
  const ib = computeInitialBalance(asDesk(bars), OPEN, IB_END)!
  const nowUnix = raidTime + VALUE_ACCEPTANCE_RAMP_FULL_MS / 1000
  const advice = computeIbExtendAdvice({
    instrument: 'DOW',
    ib,
    candles: bars,
    nowUnix,
    lastPrice: 113.8,
    useCall: true,
    callSide: 'SHORT',
  })
  assert.equal(advice.regime, 'stand_down')
  assert.equal(advice.isGo, false)
  assert.equal(advice.adviceSide, 'LONG')
  assert.match(advice.message, /CALL ON does not agree/i)
}

{
  const nikkei = computeIbExtendAdvice({
    instrument: 'NIKKEI',
    ib: computeInitialBalance(asDesk(ibSessionBars()), OPEN, IB_END),
    candles: throughSwing(),
    nowUnix: IB_END + 3600,
    useCall: false,
    callSide: 'LONG',
  })
  assert.equal(nikkei.isGo, false)
  assert.equal(nikkei.phase, 'idle')
}

console.log('ib_extend_advice: all passed')
