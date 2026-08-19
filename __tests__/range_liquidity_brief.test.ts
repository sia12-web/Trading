/**
 * Range liquidity brief — OR30 / slot-2 / slot-3 facts for Level Finder.
 * Run: npx tsx __tests__/range_liquidity_brief.test.ts
 */

import {
  buildRangeLiquidityBrief,
  formatRangeLiquidityBriefForPrompt,
} from '../lib/trading/rangeLiquidityBrief'
import { readFileSync } from 'fs'
import { join } from 'path'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** 09:30 ET Jul 15 2026 */
const NY_OPEN = Math.floor(Date.UTC(2026, 6, 15, 9 + 4, 30, 0) / 1000)
/** 09:00 JST Jul 15 2026 */
const TK_OPEN = Math.floor(Date.UTC(2026, 6, 15, 9 - 9, 0, 0) / 1000)

function nyBars(): Array<{
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}> {
  const bars = []
  // Minute bars from open through afternoon (covers OR30, IB, lunch 12–13:30)
  for (let i = 0; i < 300; i++) {
    const t = NY_OPEN + i * 60
    const inOr30 = i < 30
    const inLunch = i >= 150 && i < 240 // ~12:00–13:30
    bars.push({
      time: t,
      open: 52000,
      high: inOr30 && i === 10 ? 52120 : inLunch && i === 180 ? 52200 : 52040,
      low: inOr30 && i === 15 ? 51940 : inLunch && i === 200 ? 51900 : 51970,
      close: 52010,
      volume: 100,
    })
  }
  return bars
}

function tokyoBars(): Array<{
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}> {
  const bars = []
  // Tokyo cash morning + prior NYC RTH bars for US Range
  // Prior day NYC RTH ~ Jul 14 09:30–16:00 ET
  const nyPriorOpen = Math.floor(Date.UTC(2026, 6, 14, 9 + 4, 30, 0) / 1000)
  for (let i = 0; i < 390; i++) {
    const t = nyPriorOpen + i * 60
    bars.push({
      time: t,
      open: 39000,
      high: i === 50 ? 39200 : 39050,
      low: i === 80 ? 38800 : 38950,
      close: 39020,
      volume: 80,
    })
  }
  // Tokyo cash day
  for (let i = 0; i < 180; i++) {
    const t = TK_OPEN + i * 60
    bars.push({
      time: t,
      open: 39000,
      high: i < 30 && i === 8 ? 39150 : 39040,
      low: i < 30 && i === 12 ? 38920 : 38970,
      close: 39010,
      volume: 90,
    })
  }
  return bars
}

{
  const tipTime = NY_OPEN + 5 * 3600 // ~14:30 ET — all three ranges formed
  const brief = buildRangeLiquidityBrief({
    instrument: 'DOW',
    candlesH1: nyBars(),
    tip: 52150,
    nowUnix: tipTime,
    analysisMode: 'ib',
  })
  assert(brief != null, 'DOW brief built')
  assert(brief!.or30 != null, 'DOW OR30 shaped')
  assert(brief!.slot2 != null, 'DOW OR30 (slot 2) shaped')
  assert(brief!.slot3 != null, 'DOW IB (slot 3) shaped')
  assert(brief!.slot2Label === 'OR30', 'DOW slot2 = OR30')
  assert(brief!.slot3Label === 'IB', 'DOW slot3 = IB')
  assert(brief!.activeLabel === 'IB', 'active = IB')
  assert(brief!.active != null, 'active edges present')
  assert(
    brief!.pocVsActive === 'inside' ||
      brief!.pocVsActive === 'outside' ||
      brief!.pocVsActive === 'unknown',
    'pocVsActive set'
  )

  const text = formatRangeLiquidityBriefForPrompt(brief!)
  assert(/RANGE LIQUIDITY MAP/i.test(text), 'map header')
  assert(/Slot 1 — OR15/i.test(text), 'OR15 in prompt')
  assert(/Slot 2 — OR30/i.test(text), 'OR30 in prompt')
  assert(/Slot 3 — IB/i.test(text), 'IB in prompt')
  assert(/PRIMARY BAIT \(IB\)/i.test(text), 'primary bait')
  assert(/retail BAIT/i.test(text), 'bait rule')
  assert(/Open range → OR30 → IB/.test(text), 'NY desk map')
  assert(/OPENING TYPE/.test(text), 'opening type always in brief')
  assert(/CONTROL \(Dalton — RF \+ dPOC\)/.test(text), 'control always in brief')
  assert(/CALL \(desk — bias \+ legal ±10\)/.test(text), 'CALL always in brief')
  assert(brief!.activeAtr == null, 'no ATR without 5m bars')
}

{
  const m5: Array<{ high: number; low: number; close: number }> = []
  let c = 52000
  for (let i = 0; i < 40; i++) {
    m5.push({ high: c + 25, low: c - 25, close: c + 2 })
    c += 3
  }
  const withAtr = buildRangeLiquidityBrief({
    instrument: 'DOW',
    candlesH1: nyBars(),
    tip: 52050,
    nowUnix: NY_OPEN + 4 * 3600,
    analysisMode: 'ib',
    candles5m: m5,
  })
  assert(withAtr != null, 'brief with 5m')
  assert(withAtr!.activeAtr != null, 'active ATR when 5m present')
  const atrText = formatRangeLiquidityBriefForPrompt(withAtr!)
  assert(/RANGE VOLATILITY/i.test(atrText), 'ATR block in prompt')
  assert(/advise only/i.test(atrText), 'advise-only wording')
}

{
  const morning = buildRangeLiquidityBrief({
    instrument: 'DOW',
    candlesH1: nyBars(),
    tip: 52050,
    nowUnix: NY_OPEN + 45 * 60,
    analysisMode: 'morning',
  })
  assert(morning != null, 'morning brief')
  assert(morning!.activeLabel === 'OR15', 'morning primary OR15')
  assert(morning!.or15 != null, 'OR15 after 45m')
}

{
  // During morning (10:20) IB may print as forming for Level Finder prep — entries wait until 10:30
  const ibWin = buildRangeLiquidityBrief({
    instrument: 'DOW',
    candlesH1: nyBars(),
    tip: 52050,
    nowUnix: NY_OPEN + 50 * 60, // 10:20 ET
    analysisMode: 'ib',
  })
  assert(ibWin != null && ibWin.slot3 != null, 'IB edges during IB prep')
  assert(ibWin!.slot3!.complete === false, 'IB still forming at 10:20')
  assert(ibWin!.activeLabel === 'IB', 'active IB')
}

{
  const tipTime = TK_OPEN + 5 * 3600 // afternoon Tokyo
  const brief = buildRangeLiquidityBrief({
    instrument: 'NIKKEI',
    candlesH1: tokyoBars(),
    tip: 39100,
    nowUnix: tipTime,
    analysisMode: 'us_range',
  })
  assert(brief != null, 'Nikkei brief built')
  assert(brief!.tokyo === true, 'tokyo flag')
  assert(brief!.slot2Label === 'US Range', 'Nikkei slot2 = US Range')
  assert(brief!.slot3Label === 'Tokyo IB', 'Nikkei slot3 = Tokyo IB')
  assert(brief!.activeLabel === 'US Range', 'active US Range')
  // US Range should print when prior NYC bars exist
  assert(brief!.slot2 != null, 'US Range edges from prior NYC')
  assert(brief!.or30 != null, 'Nikkei OR30')
  assert(brief!.slot3 != null, 'Tokyo IB shaped')

  const text = formatRangeLiquidityBriefForPrompt(brief!)
  assert(/Open range → US Range \(prior NYC\) → Tokyo IB/.test(text), 'Nikkei desk map')
  assert(/Slot 2 — US Range/i.test(text), 'US Range in prompt')
  assert(/Slot 3 — Tokyo IB/i.test(text), 'Tokyo IB in prompt')
  assert(/PRIMARY BAIT \(US Range\)/i.test(text), 'US Range primary')
}

{
  const ibMode = buildRangeLiquidityBrief({
    instrument: 'NIKKEI',
    candlesH1: tokyoBars(),
    tip: 39050,
    nowUnix: TK_OPEN + 5 * 3600,
    analysisMode: 'ib',
  })
  assert(ibMode!.activeLabel === 'Tokyo IB', 'Nikkei ib mode → Tokyo IB primary')
}

// Prompt sentinel: Level Finder system prompt contains RANGE LIQUIDITY MAP
{
  const src = readFileSync(
    join(__dirname, '../lib/services/levelFinderAgent/levelFinderAgent.ts'),
    'utf8'
  )
  assert(/RANGE LIQUIDITY MAP/.test(src), 'Level Finder has RANGE LIQUIDITY MAP')
  assert(/YESTERDAY PROFILE/.test(src), 'Level Finder has YESTERDAY PROFILE')
  assert(/OPENING TYPE/.test(src), 'Level Finder has OPENING TYPE')
  assert(/CONTROL \(Dalton — RF \+ dPOC\)/.test(src), 'Level Finder has CONTROL')
  assert(/CALL \(desk — bias \+ legal ±10\)/.test(src), 'Level Finder has CALL')
  assert(/does not pick extra entries/.test(src), 'Level Finder must not pick extra entries from CALL')
  assert(/never NY IB/.test(src), 'Level Finder Nikkei CALL is not NY IB')
  assert(/dPOC is not the fill/.test(src), 'Level Finder CALL dPOC is not the fill')
  assert(/does not pick entries/.test(src), 'Level Finder must not pick entries from RF')
  assert(/not volume POC/.test(src), 'Level Finder dPOC ≠ volume POC')
  assert(/Slot 1 Open range/.test(src), 'Open range slot in prompt')
  assert(/Slot 2 US Range/.test(src), 'US Range slot in prompt')
  assert(/Slot 3 IB/.test(src) || /Slot 3 Tokyo IB/.test(src), 'IB slot in prompt')
  assert(/First tag of IB H\/L is NOT the entry/.test(src), 'first IB tag is not the entry')
  assert(/rangeLiquidityBriefText/.test(src), 'user prompt wires range brief')
}

{
  const prep = readFileSync(
    join(__dirname, '../lib/services/autoLevelPrep.ts'),
    'utf8'
  )
  assert(/buildRangeLiquidityBrief/.test(prep), 'autoLevelPrep builds range brief')
  assert(/rangeLiquidityBriefText/.test(prep), 'autoLevelPrep passes range brief')
}

console.log('range_liquidity_brief: all passed')
