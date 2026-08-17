/**
 * Manage RVOL / options / verdict scoring.
 * Run: npx tsx __tests__/manage_signals.test.ts
 */

import {
  computeRvol,
  optionsProxySymbol,
  scoreManageVerdict,
  summarizeOptionsFlow,
} from '../lib/trading/manageSignals'
import { structureVsOpenBook } from '../lib/trading/manageOpenBook'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const vols = Array.from({ length: 20 }, () => 100).concat([200])
  const r = computeRvol(vols)
  assert(r != null && Math.abs(r - 2) < 1e-9, 'RVOL 2.0×')
  assert(computeRvol([1, 2, 3]) === null, 'RVOL needs history')

  // In-progress bar often has volume 0 — skip it
  const withZeroTip = Array.from({ length: 20 }, () => 100).concat([200, 0])
  const r2 = computeRvol(withZeroTip)
  assert(r2 != null && Math.abs(r2 - 2) < 1e-9, 'RVOL skips trailing zero bar')
  assert(computeRvol([0, 0, 0]) === null, 'all-zero RVOL is n/a')
}

{
  const bear = summarizeOptionsFlow([{ volume: 100 }], [{ volume: 200 }], 'DIA', 'test')
  assert(bear.bias === -1, 'put-heavy bearish')
  const bull = summarizeOptionsFlow([{ volume: 200 }], [{ volume: 100 }], 'QQQ', 'test')
  assert(bull.bias === 1, 'call-heavy bullish')
}

{
  assert(optionsProxySymbol('DOW') === 'DIA', 'DIA')
  assert(optionsProxySymbol('NASDAQ') === 'QQQ', 'QQQ')
  assert(optionsProxySymbol('NIKKEI') === 'EWJ', 'EWJ')
}

{
  const pull = scoreManageVerdict({
    movePct: -0.2,
    newsScore: 2,
    rvol: 0.8,
    optionsBias: 1,
    direction: 'LONG',
  })
  assert(pull.verdict === 'pullback', 'mild adverse + support = pullback')

  const rev = scoreManageVerdict({
    movePct: -0.55,
    newsScore: -1,
    rvol: 2.2,
    optionsBias: -1,
    direction: 'LONG',
  })
  assert(rev.verdict === 'reversal', 'sharp adverse + RVOL/options = reversal')
  assert(rev.confidence >= 70, 'reversal conf')

  const shortPull = scoreManageVerdict({
    movePct: -0.22,
    newsScore: 1,
    rvol: 0.9,
    optionsBias: -1,
    direction: 'SHORT',
  })
  assert(shortPull.verdict === 'pullback', 'puts support SHORT pullback')

  const hold = scoreManageVerdict({
    movePct: 0.35,
    newsScore: 0,
    rvol: 1.1,
    optionsBias: 0,
    direction: 'LONG',
  })
  assert(hold.verdict === 'hold', 'in favor = hold')
}

{
  const broke = structureVsOpenBook({
    direction: 'LONG',
    tip: 51900,
    rangeHigh: 52120,
    rangeLow: 51940,
    rangeLabel: 'OR30',
  })
  assert(broke.rangeState === 'broke_against', 'LONG below L is against')
  const rev = scoreManageVerdict({
    movePct: -0.18,
    newsScore: 1,
    rvol: 1.8,
    optionsBias: 1,
    direction: 'LONG',
    structure: broke,
  })
  assert(rev.verdict === 'reversal', 'broke H/L against + volume = leave')
}

{
  const mid = structureVsOpenBook({
    direction: 'LONG',
    tip: 52030,
    rangeHigh: 52120,
    rangeLow: 51940,
    rangeLabel: 'OR30',
  })
  assert(mid.midPullback, 'near mid is pullback magnet')
  const pull = scoreManageVerdict({
    movePct: -0.16,
    newsScore: 0,
    rvol: 0.7,
    optionsBias: 0,
    direction: 'LONG',
    structure: mid,
  })
  assert(pull.verdict === 'pullback', 'inside mid + quiet volume = pullback')
}

{
  const driveFail = structureVsOpenBook({
    direction: 'LONG',
    tip: 52000,
    rangeHigh: 52120,
    rangeLow: 51940,
    rangeLabel: 'OR30',
    openingType: 'OPEN_DRIVE',
    openingDirection: 'up',
    failedDrive: true,
  })
  assert(driveFail.openingAgainst, 'Drive FAIL vs LONG')
  const leave = scoreManageVerdict({
    movePct: -0.1,
    newsScore: 1,
    rvol: 1.0,
    optionsBias: 1,
    direction: 'LONG',
    structure: driveFail,
  })
  assert(leave.verdict === 'reversal', 'Drive fail = leave')
}

{
  const flipped = structureVsOpenBook({
    direction: 'LONG',
    tip: 52000,
    rangeHigh: 52120,
    rangeLow: 51940,
    rangeLabel: 'IB',
    controlLabel: 'ONE-TF SELL',
    callSide: 'SHORT',
  })
  assert(flipped.callAgainst && flipped.controlAgainst, 'CALL+Control against')
  const rev = scoreManageVerdict({
    movePct: -0.2,
    newsScore: 1,
    rvol: 1.1,
    optionsBias: 1,
    direction: 'LONG',
    structure: flipped,
  })
  assert(rev.verdict === 'reversal', 'CALL+Control against = reverse')
}

console.log('manage_signals.test.ts: all assertions passed')
