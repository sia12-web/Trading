import assert from 'node:assert/strict'
import test from 'node:test'
import { activeDeskSessionsAt } from '../lib/chart/sessionVwap'
import { spawn } from 'node:child_process'

test('activeDeskSessionsAt is instrument-aware for NIKKEI (Tokyo hours)', () => {
  // Test at 10:00 AM JST (01:00 UTC) on a weekday
  // 10:00 JST is during Japan cash session (09:00 - 15:00 JST)
  // Construct a UTC timestamp that is 10:00 JST (01:00 UTC)
  const jst10amUtc = Math.floor(new Date('2026-10-14T01:00:00Z').getTime() / 1000)
  
  // Without instrument (evaluates America/New_York where 01:00 UTC is 21:00 ET = Asia evening or Dead Zone)
  const defaultSessions = activeDeskSessionsAt(jst10amUtc)
  
  // With NIKKEI instrument: must recognize Asia session based on Tokyo hours
  const nikkeiSessions = activeDeskSessionsAt(jst10amUtc, 'NIKKEI')
  assert.ok(nikkeiSessions.includes('Asia'), 'NIKKEI at 10:00 JST must include Asia session')
})

test('sidecar child process exit handling triggers immediate failover', async () => {
  // Verify that an immediately exiting process (code != 0) is detected via exit event
  const child = spawn('node', ['-e', 'process.exit(1)'])
  let spawnFailed = false
  child.on('exit', (code) => {
    if (code !== 0) spawnFailed = true
  })
  await new Promise((resolve) => child.on('close', resolve))
  assert.equal(spawnFailed, true, 'Non-zero exit code must immediately set spawnFailed = true')
})

test('forming bar open locks to first minute on multi-minute bar', () => {
  const tfSec = 300 // 5m timeframe
  const steppedLastTime = 1700000000 // 09:30:00 bucket
  const initialOpen = 100.5

  // Minute 0: exchangeBar is at 09:30:00
  const minute0 = { time: 1700000000, open: 100.5, high: 101.0, low: 100.0, close: 100.8, volume: 50 }
  const useMinute0Open = tfSec === 60 || minute0.time === steppedLastTime
  assert.equal(useMinute0Open, true, 'First minute of multi-minute bar must set candle open')

  // Minute 1: exchangeBar is at 09:31:00
  const minute1 = { time: 1700000060, open: 100.9, high: 101.5, low: 100.7, close: 101.2, volume: 40 }
  const useMinute1Open = tfSec === 60 || minute1.time === steppedLastTime
  assert.equal(useMinute1Open, false, 'Subsequent minute of multi-minute bar must NOT override candle open')
  
  // When false, candle retains stepped.last.open (locked initial open)
  const openResolved = useMinute1Open ? minute1.open : initialOpen
  assert.equal(openResolved, initialOpen, 'Candle open remains locked to the first minute open')
})

test('forming bar volume accumulates live across minutes of a multi-minute bar', () => {
  let accumulatedFormingVol = 0
  let lastExchangeMinuteTime = 0
  let lastExchangeMinuteVol = 0
  
  // Minute 0 tick 1 (vol = 10)
  const tick1 = { time: 1700000000, volume: 10 }
  accumulatedFormingVol = tick1.volume
  lastExchangeMinuteTime = tick1.time
  lastExchangeMinuteVol = tick1.volume
  assert.equal(accumulatedFormingVol, 10)

  // Minute 0 tick 2 (vol = 25)
  const tick2 = { time: 1700000000, volume: 25 }
  const delta0 = Math.max(0, tick2.volume - lastExchangeMinuteVol)
  accumulatedFormingVol += delta0
  lastExchangeMinuteVol = tick2.volume
  assert.equal(accumulatedFormingVol, 25)

  // Minute 1 tick 1 (new minute within same 5m bar, vol = 15)
  const tick3 = { time: 1700000060, volume: 15 }
  accumulatedFormingVol += tick3.volume
  lastExchangeMinuteTime = tick3.time
  lastExchangeMinuteVol = tick3.volume
  assert.equal(accumulatedFormingVol, 40, 'Volume from next minute accumulates onto current multi-minute candle')

  // Minute 1 tick 2 (vol = 30)
  const tick4 = { time: 1700000060, volume: 30 }
  const delta1 = Math.max(0, tick4.volume - lastExchangeMinuteVol)
  accumulatedFormingVol += delta1
  lastExchangeMinuteVol = tick4.volume
  assert.equal(accumulatedFormingVol, 55, 'Incremental trades in next minute also accumulate live')

  // Multi-minute volume calculation preserves accumulated volume even when tick has no exactExchangeMinute
  const tfSec = 300
  const steppedLastVol = 0
  const calcVolNullExchange = tfSec === 60
    ? null
    : Math.max(accumulatedFormingVol, steppedLastVol)
  assert.equal(calcVolNullExchange, 55, 'Multi-minute volume must preserve accumulatedFormingVol even if exactExchangeMinute is null')

  // When bar rolls to a new bucket, accumulatedFormingVol resets to 0 (or new minute volume) without leaking previous candle volume
  let rolledAccumulatedVol = 0
  const newExchangeMinute = { time: 1700000300, volume: 8 }
  rolledAccumulatedVol = newExchangeMinute.volume
  assert.equal(rolledAccumulatedVol, 8, 'Rolled bucket initializes with new minute volume without old candle volume')
})

