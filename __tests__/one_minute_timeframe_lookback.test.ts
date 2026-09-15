import test from 'node:test'
import assert from 'node:assert/strict'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { GET as getCandles } from '@/app/api/trading/candles/route'
import { lastNTradingSessions, NY_DESK_CLOCK } from '@/lib/chart/sessionVwap'

test('1-minute timeframe 5-day lookback continuum', async (t) => {
  await t.test('getYahooCandles clamps 1m requests <= 8 days and does not 422', async () => {
    // Calling with days=8 must safely succeed without 422
    const res = await getYahooCandles('NASDAQ', '1', 8)
    assert.ok(res, 'Yahoo 1m result should not be null')
    assert.ok(Array.isArray(res.candles), 'Yahoo 1m should return candle array')
    assert.ok(res.candles.length > 3000, `Expected > 3000 1m candles for 8 days, got ${res.candles.length}`)
  })

  await t.test('/api/trading/candles?instrument=NASDAQ&timeframe=1m returns 5+ trading days of data', async () => {
    const req = new Request('http://localhost:3000/api/trading/candles?instrument=NASDAQ&timeframe=1m&days=8')
    const res = await getCandles(req)
    assert.equal(res.status, 200, 'Candle endpoint should return 200')
    const data = await res.json()
    assert.ok(Array.isArray(data.candles), 'Should have candles array')
    assert.ok(data.candles.length > 3000, `Expected > 3000 1m candles for 8 days, got ${data.candles.length}`)

    const first = data.candles[0]
    const last = data.candles[data.candles.length - 1]
    const spanDays = (last.time - first.time) / 86400
    assert.ok(spanDays >= 5.0, `Data span must cover at least 5 calendar/trading days (got ${spanDays.toFixed(2)} days)`)

    // Verify lastNTradingSessions preserves all 5 full trading sessions
    const sessionScoped = lastNTradingSessions(data.candles, 5, NY_DESK_CLOCK)
    assert.ok(sessionScoped.length > 2000, `Session scoped should contain multiple full sessions, got ${sessionScoped.length}`)
    const sessionSpan = (sessionScoped[sessionScoped.length - 1].time - sessionScoped[0].time) / 86400
    assert.ok(sessionSpan >= 4.0, `Trimmed sessions span should cover across 5 trading days (got ${sessionSpan.toFixed(2)} days)`)
  })
})
