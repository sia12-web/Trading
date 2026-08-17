/**
 * Tradovate transfer — same TradePulse book, one legal Tradeify contract.
 * Run: npx tsx __tests__/tradovate_mirror.test.ts
 */

import assert from 'node:assert/strict'
import {
  buildTradovateMirrorTicket,
  deskBookLines,
  tradingViewChartUrl,
  tradingViewSymbol,
} from '../lib/trading/tradovateMirror'

const nq = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 19980,
  target: 20030,
  riskDollars: 400,
  accountName: 'TDFYG50376444860',
})
assert.ok(nq)
assert.equal(nq!.symbol, 'MNQ')
assert.equal(nq!.side, 'BUY')
assert.equal(nq!.orderType, 'LIMIT')
assert.equal(nq!.tif, 'DAY')
assert.equal(nq!.stopPts, 20)
assert.equal(nq!.qty, 10)
assert.equal(nq!.tradovateRiskDollars, 400)
assert.equal(nq!.pulseRiskDollars, 400)
assert.equal(nq!.snapped, false)
assert.ok(nq!.copyText.includes('TDFYG50376444860'))
assert.ok(nq!.copyText.includes('SYMBOL   MNQ'))
assert.ok(nq!.copyText.includes('CONTRACT Micro E-mini Nasdaq-100'))
assert.equal(nq!.contractLabel, 'Micro E-mini Nasdaq-100')
assert.ok(nq!.copyText.includes('SIDE     BUY'))
assert.ok(nq!.copyText.includes('TYPE     LIMIT'))
assert.ok(nq!.copyText.includes('TIF      DAY'))
assert.ok(nq!.copyText.includes('QTY      10'))
assert.ok(nq!.copyText.includes('ENTRY    20000'))
assert.ok(nq!.copyText.includes('SL       19980'))
assert.ok(nq!.copyText.includes('TP       20030'))
assert.ok(!nq!.copyText.includes('NQ /'))
assert.ok(!nq!.copyText.includes('MNK'))
assert.ok(nq!.copyText.includes('Front month'))
assert.ok(nq!.copyText.includes('16:59 ET'))
assert.ok(nq!.copyText.includes('Paste into TradingView Limit'))
assert.ok(nq!.copyText.includes('Micro only'))

const ym = buildTradovateMirrorTicket({
  instrument: 'DOW',
  direction: 'SHORT',
  entry: 40000,
  stop: 40080,
  target: 39880,
  riskDollars: 400,
})
assert.ok(ym)
assert.equal(ym!.side, 'SELL')
assert.equal(ym!.symbol, 'MYM')
assert.equal(ym!.qty, 10)
assert.equal(ym!.tradovateRiskDollars, 400)
assert.ok(ym!.copyText.includes('SIDE     SELL'))
assert.ok(ym!.copyText.includes('SYMBOL   MYM'))

const nkd = buildTradovateMirrorTicket({
  instrument: 'NIKKEI',
  direction: 'LONG',
  entry: 42180,
  stop: 42100,
  target: 42300,
  riskDollars: 400,
})
assert.ok(nkd)
assert.equal(nkd!.symbol, 'NKD')
assert.equal(nkd!.qty, 1)
assert.equal(nkd!.tradovateRiskDollars, 400)
assert.ok(!nkd!.copyText.includes('MNK'))
assert.ok(nkd!.copyText.includes('SYMBOL   NKD'))

const nkdSnap = buildTradovateMirrorTicket({
  instrument: 'NIKKEI',
  direction: 'LONG',
  entry: 42183,
  stop: 42101,
  target: 42302,
  riskDollars: 400,
})
assert.ok(nkdSnap)
assert.equal(nkdSnap!.symbol, 'NKD')
assert.equal(nkdSnap!.entry % 5, 0)
assert.equal(nkdSnap!.stop % 5, 0)
assert.equal(nkdSnap!.target % 5, 0)
assert.equal(nkdSnap!.snapped, true)
assert.ok(nkdSnap!.stop < nkdSnap!.entry)
assert.ok(nkdSnap!.target > nkdSnap!.entry)
assert.ok(nkdSnap!.copyText.includes('snapped'))

const nqSnap = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000.13,
  stop: 19980.13,
  target: 20030.13,
  riskDollars: 400,
})
assert.ok(nqSnap)
assert.equal(nqSnap!.entry, 20000.25)
assert.equal(nqSnap!.stop, 19980.25)
assert.equal(nqSnap!.snapped, true)
assert.ok(nqSnap!.stop < nqSnap!.entry)

const closest = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 19970,
  target: 20045,
  riskDollars: 250,
})
assert.ok(closest)
assert.equal(closest!.symbol, 'MNQ')
// 30 pts × $2 = $60/contract → 4 MNQ = $240 (closer than 5 = $300)
assert.equal(closest!.qty, 4)
assert.equal(closest!.tradovateRiskDollars, 240)
assert.ok(Math.abs(closest!.riskDeltaDollars) < Math.abs(300 - 250))

const badStop = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 20000,
  target: 20030,
  riskDollars: 400,
})
assert.equal(badStop, null)

const wrongSide = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 20020,
  target: 20030,
  riskDollars: 400,
})
assert.equal(wrongSide, null)

const shortWrong = buildTradovateMirrorTicket({
  instrument: 'DOW',
  direction: 'SHORT',
  entry: 40000,
  stop: 39920,
  target: 40120,
  riskDollars: 400,
})
assert.equal(shortWrong, null)

const noRisk = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 19980,
  target: 20030,
  riskDollars: 0,
})
assert.ok(noRisk)
assert.equal(noRisk!.qty, 0)
assert.equal(noRisk!.entry, 20000)
assert.equal(noRisk!.stop, 19980)
assert.equal(noRisk!.target, 20030)
assert.ok(noRisk!.copyText.includes('SIDE     BUY'))

const overCap = buildTradovateMirrorTicket({
  instrument: 'NASDAQ',
  direction: 'LONG',
  entry: 20000,
  stop: 19999,
  target: 20001.5,
  riskDollars: 400,
})
assert.ok(overCap)
assert.ok(overCap!.qty <= 40)
assert.equal(overCap!.overCap, true)

assert.equal(tradingViewSymbol('MNQ'), 'CME_MINI:MNQ1!')
assert.equal(tradingViewSymbol('MYM'), 'CBOT_MINI:MYM1!')
assert.equal(tradingViewSymbol('NKD'), 'CME:NKD1!')
assert.ok(tradingViewChartUrl('MNQ').includes(encodeURIComponent('CME_MINI:MNQ1!')))
assert.ok(tradingViewChartUrl('MYM').includes(encodeURIComponent('CBOT_MINI:MYM1!')))
assert.ok(tradingViewChartUrl('NKD').includes(encodeURIComponent('CME:NKD1!')))

{
  const lines = deskBookLines({
    instrument: 'NASDAQ',
    direction: 'long',
    entry: 20000.13,
    stop: 19980.13,
    target: 20030.13,
    riskDollars: 400,
  })
  assert.equal(lines.entry, 20000.25)
  assert.equal(lines.stop, 19980.25)
  assert.equal(lines.symbol, 'MNQ')
  assert.equal(lines.qty, 10)
  assert.equal(lines.sizeNote, '10 MNQ')
}

{
  const { readFileSync } = require('fs') as typeof import('fs')
  const { join } = require('path') as typeof import('path')
  const chart = readFileSync(
    join(__dirname, '../app/dashboard/chart/components/TradingChart.tsx'),
    'utf8'
  )
  assert.ok(chart.includes('workingBook?.stop'), 'working limit paints TV SL')
  assert.ok(chart.includes('workingBook?.target'), 'working limit paints TV TP')
  assert.ok(chart.includes('workingBook?.sizeNote'), 'working chip shows MYM/MNQ size')
}

console.log('tradovate_mirror.test.ts: all assertions passed')
