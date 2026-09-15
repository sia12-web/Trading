import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import test from 'node:test'
import assert from 'node:assert/strict'
import { currentActiveSessionInfo, computeSessionHighlightSpans } from '@/lib/chart/sessionVwap'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { GET as getQuote } from '@/app/api/trading/quote/route'
import { GET as getCandles } from '@/app/api/trading/candles/route'

test('CME futures and live Asia session', async (t) => {
  await t.test('currentActiveSessionInfo identifies active Asia session at 22:00 EDT', () => {
    // 2026-09-08 02:00 UTC = 2026-09-07 22:00 EDT (mid-Asia session)
    const midAsiaDate = new Date('2026-09-08T02:00:00.000Z')
    const info = currentActiveSessionInfo(midAsiaDate)
    assert.ok(info, 'Active session info should not be null')
    assert.equal(info.name, 'Asia')
    // Asia starts at 18:00 EDT on 2026-09-07 = 2026-09-07 22:00 UTC = 1788818400
    assert.equal(info.startUnix, 1788818400)
  })

  await t.test('getYahooQuote returns real CME futures quote for NASDAQ and DOW', async () => {
    const nq = await getYahooQuote('NASDAQ')
    assert.ok(nq, 'NASDAQ CME quote should exist')
    assert.equal(nq.symbol, 'MNQ=F')
    assert.ok(nq.price > 10000, `NASDAQ CME price should be realistic (got ${nq.price})`)

    const ym = await getYahooQuote('DOW')
    assert.ok(ym, 'DOW CME quote should exist')
    assert.equal(ym.symbol, 'MYM=F')
    assert.ok(ym.price > 30000, `DOW CME price should be realistic (got ${ym.price})`)
  })

  await t.test('/api/trading/quote serves CME futures prices without freezing during active sessions', async () => {
    const res = await getQuote(new Request('http://localhost:3000/api/trading/quote?instrument=NASDAQ'))
    const data = await res.json()
    assert.equal(data.instrument, 'NASDAQ')
    assert.equal(data.source, 'cme')
    assert.ok(data.price > 10000, `Expected price > 10000, got ${data.price}`)
  })

  await t.test('/api/trading/quote serves real CME futures price for DOW matching TradingView', async () => {
    const res = await getQuote(new Request('http://localhost:3000/api/trading/quote?instrument=DOW'))
    const data = await res.json()
    assert.equal(data.instrument, 'DOW')
    assert.equal(data.source, 'cme')
    assert.ok(data.price > 52200, `Expected DOW price on TradingView MYMZ26 scale (> 52200), got ${data.price}`)
  })

  await t.test('/api/trading/candles serves real CME Globex candles for DOW matching TradingView MYMZ26', async () => {
    const res = await getCandles(new Request('http://localhost:3000/api/trading/candles?instrument=DOW&timeframe=5m'))
    const data = await res.json()
    assert.ok(data.candles.length > 0, 'Should have candles')
    assert.ok(data.source === 'yahoo' || data.source === 'databento', `Expected CME source (yahoo or databento), got ${data.source}`)
    const last = data.candles[data.candles.length - 1]
    assert.ok(last.close > 52200, `Expected DOW last candle close on MYMZ26 scale (> 52200), got ${last.close}`)
  })
})
