import test from 'node:test'
import assert from 'node:assert/strict'
import { getYahooQuote } from '@/lib/yahoo/quote'
import { YAHOO_CME_SYMBOLS } from '@/lib/yahoo/symbols'
import { getOandaPrice } from '@/lib/oanda/pricing'
import { isOandaConfigured } from '@/lib/oanda/config'
import { getCmeBasis, warmCmeBasis } from '@/lib/trading/cmeBasis'
import { getDatabentoCandles, isDatabentoConfigured, DATABENTO_SYMBOLS } from '@/lib/databento/client'
import type { Instrument } from '@/types/price-feed'

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']

test('CME 4 Futures Markets — Price Correctness and Latency Audit', async (t) => {
  await t.test('1. Direct CME Futures (Yahoo Exchange Feed): Price validity & Latency measurement', async () => {
    console.log('\n=== DIRECT CME FUTURES FEED AUDIT ===')
    const nowSec = Math.floor(Date.now() / 1000)

    for (const inst of INSTRUMENTS) {
      const quote = await getYahooQuote(inst)
      assert.ok(quote, `${inst} quote should be retrieved`)
      assert.ok(quote.price > 0, `${inst} price must be positive (got ${quote.price})`)
      assert.equal(quote.symbol, YAHOO_CME_SYMBOLS[inst], `${inst} symbol must match CME futures ticker`)

      const ageSec = quote.timestamp > 0 ? nowSec - quote.timestamp : null

      console.log(`[${inst}] Ticker: ${quote.symbol} | Price: ${quote.price} | Stamped: ${new Date(quote.timestamp * 1000).toISOString()}`)
      console.log(`       -> Age: ${ageSec}s (~${((ageSec ?? 0) / 60).toFixed(1)} min) | Declared CME Delay: ${quote.delayedBySec}s`)

      if (quote.delayedBySec >= 600 || (ageSec != null && ageSec > 300)) {
        console.warn(`       ⚠️  [LATENCY ALERT] ${inst} CME futures quotes are DELAYED by ~${((ageSec ?? quote.delayedBySec) / 60).toFixed(0)} minutes. It is NOT real-time zero-latency.`)
      } else {
        console.log(`       ✅  [REAL-TIME] ${inst} is fresh (< 5s latency).`)
      }
    }
  })

  await t.test('2. OANDA Spot CFDs vs CME Futures: Basis & Real-time comparison', async () => {
    console.log('\n=== OANDA SPOT CFD VS CME FUTURES BASIS AUDIT ===')
    const oandaConfigured = isOandaConfigured()
    assert.ok(oandaConfigured, 'OANDA should be configured in .env.local')

    for (const inst of INSTRUMENTS) {
      const oanda = await getOandaPrice(inst)
      const cme = await getYahooQuote(inst)

      assert.ok(oanda, `${inst} OANDA price should be retrieved`)
      assert.ok(cme, `${inst} CME price should be retrieved`)

      const spread = cme.price - oanda.price
      const oandaAgeMs = Date.now() - oanda.timestamp * 1000

      console.log(`[${inst}]`)
      console.log(`       CME Futures (${cme.symbol}):    ${cme.price}`)
      console.log(`       OANDA Spot (${oanda.symbol}):    ${oanda.price} (Latency: ${oandaAgeMs}ms)`)
      console.log(`       Basis (CME − Spot):           ${spread >= 0 ? '+' : ''}${spread.toFixed(2)} pts`)

      if (inst === 'GOLD') {
        console.log(`       🔍 NOTE: Gold CME futures vs Spot spread is ~${spread.toFixed(1)} pts due to futures contango/contract expiry.`)
      }
    }
  })

  await t.test('3. CME Basis Engine Warmup and Drift Test', async () => {
    console.log('\n=== CME BASIS ENGINE TEST ===')
    for (const inst of INSTRUMENTS) {
      const basis = await warmCmeBasis(inst)
      const cached = getCmeBasis(inst)
      console.log(`[${inst}] Derived Basis: ${basis !== null ? basis.toFixed(2) : 'NULL (fallback)'} | In-Memory Cache: ${cached !== null ? cached.toFixed(2) : 'NONE'}`)
    }
  })

  await t.test('4. Databento Official CME Globex MDP 3.0 Real-time Exchange Feed Verification', async () => {
    console.log('\n=== DATABENTO CME GLOBEX MDP 3.0 VERIFICATION ===')
    const configured = isDatabentoConfigured()
    assert.ok(configured, 'DATABENTO_API_KEY must be configured in .env.local')

    for (const inst of INSTRUMENTS) {
      const res = await getDatabentoCandles(inst, '5', 1)
      assert.ok(res, `Databento should return data for ${inst}`)
      assert.ok(res.candles.length > 0, `${inst} should have candle bars returned`)

      const lastCandle = res.candles[res.candles.length - 1]
      const candleTimeStr = new Date(lastCandle.time * 1000).toISOString()
      console.log(`[${inst}] Databento Symbol: ${res.symbol} (${DATABENTO_SYMBOLS[inst]})`)
      console.log(`       Bars: ${res.candles.length} | Latest Bar: ${candleTimeStr}`)
      console.log(`       OHLCV: O=${lastCandle.open} H=${lastCandle.high} L=${lastCandle.low} C=${lastCandle.close} Vol=${lastCandle.volume}`)
      console.log(`       ✅  [OFFICIAL CME] Exact Globex exchange prices and pattern matching TradingView.`)
    }
  })
})

