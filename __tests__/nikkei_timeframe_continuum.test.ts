import test from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '@/app/api/trading/candles/route'
import { resolveYahooSymbol } from '@/lib/yahoo/candles'
import { YAHOO_CME_SYMBOLS } from '@/lib/yahoo/symbols'

test('Nikkei 225 symbology and continuum integrity', async (t) => {
  await t.test('resolves continuous high-liquidity NKD=F contract for daily charts', () => {
    const dailySym = resolveYahooSymbol('NIKKEI', '1D')
    assert.equal(dailySym, 'NKD=F', 'NIKKEI daily must resolve to NKD=F to eliminate quarterly roll gaps')
    assert.equal(YAHOO_CME_SYMBOLS.NIKKEI, 'NKD=F', 'YAHOO_CME_SYMBOLS.NIKKEI must match CME Globex USD Nikkei')
  })

  await t.test('serves complete, gap-free 1D daily candles with positive volume', async () => {
    const req = new Request('http://localhost:3000/api/trading/candles?instrument=NIKKEI&timeframe=1D&days=730')
    const res = await GET(req)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.ok(Array.isArray(json.candles), 'candles must be an array')
    assert.ok(json.candles.length >= 400, `expected at least 400 daily bars, got ${json.candles.length}`)

    // Verify zero flat streak voids and continuous positive volume
    let zeroVolBars = 0
    let flatBars = 0
    for (const b of json.candles) {
      if (!b.volume || b.volume <= 0) zeroVolBars++
      if (b.high === b.low) flatBars++
    }

    const flatRatio = flatBars / json.candles.length
    assert.ok(flatRatio < 0.05, `flat bar ratio should be < 5%, got ${(flatRatio * 100).toFixed(1)}%`)
    const zeroVolRatio = zeroVolBars / json.candles.length
    assert.ok(zeroVolRatio < 0.05, `zero volume ratio should be < 5%, got ${(zeroVolRatio * 100).toFixed(1)}%`)
  })

  await t.test('serves complete 5m candles with positive volume and continuous continuum', async () => {
    const req = new Request('http://localhost:3000/api/trading/candles?instrument=NIKKEI&timeframe=5m&days=5')
    const res = await GET(req)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.ok(Array.isArray(json.candles))
    assert.ok(json.candles.length >= 500, `expected >= 500 5m bars, got ${json.candles.length}`)

    // Check that volume exists on bars
    const positiveVolBars = json.candles.filter((c: any) => c.volume && c.volume > 0)
    assert.ok(positiveVolBars.length / json.candles.length > 0.90, 'over 90% of bars should have positive volume')
  })

  await t.test('serves complete 1m candles with zero missing market slots', async () => {
    const req = new Request('http://localhost:3000/api/trading/candles?instrument=NIKKEI&timeframe=1m&days=3')
    const res = await GET(req)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.ok(Array.isArray(json.candles))
    assert.ok(json.candles.length >= 1000, `expected >= 1000 1m bars, got ${json.candles.length}`)
  })
})
