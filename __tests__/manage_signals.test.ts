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

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const vols = Array.from({ length: 20 }, () => 100).concat([200])
  const r = computeRvol(vols)
  assert(r != null && Math.abs(r - 2) < 1e-9, 'RVOL 2.0×')
  assert(computeRvol([1, 2, 3]) === null, 'RVOL needs history')
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

console.log('manage_signals.test.ts: all assertions passed')
