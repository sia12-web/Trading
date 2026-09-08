/**
 * Real-Time Confluence Divergence Entry Scanner
 *
 * Monitors CME Futures (DOW, NASDAQ, GOLD, CRUDE) live:
 * 1. Checks Market Profile (Yesterday VAL, VAH, POC) + Session VWAP ±1σ bands
 * 2. Scans for John Kurisko Fast/Slow Stochastic (14,3,3) Divergences
 * 3. Triggers Audible Chime & Visual Alarms when an entry setup confirms
 * 4. Outputs exact Tradeify 50k Brackets (Entry, Stop Loss, 70% TP1, 30% TP2 Runner)
 * 5. Saves active alerts to data/active-signals.json
 */

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { getOandaCandlesRange } from '@/lib/oanda/candles'
import { warmCmeBasis, getCmeBasis, applyCmeBasisToCandles } from '@/lib/trading/cmeBasis'
import { computeYesterdayProfile } from '@/lib/trading/yesterdayProfile'
import {
  calculateStochastic,
  evaluateConfluenceSignal,
  type Candle,
  type ConfluenceSignal,
} from '@/lib/trading/confluenceDivergenceStrategy'
import type { Instrument } from '@/types/price-feed'

const MONITORED_INSTRUMENTS: Instrument[] = ['GOLD', 'DOW', 'NASDAQ', 'CRUDE']
const SCAN_INTERVAL_MS = 10_000 // Scan every 10 seconds
const ALERTS_FILE = path.join(process.cwd(), 'data', 'active-signals.json')

// Sound trigger for Windows
function playAlarmSound(type: 'BUY' | 'SELL') {
  try {
    process.stdout.write('\x07') // Terminal Bell
    if (process.platform === 'win32') {
      const pitch = type === 'BUY' ? '900, 150); [console]::beep(1300, 300' : '1300, 150); [console]::beep(800, 300'
      exec(`powershell -Command "[console]::beep(${pitch})"`)
    }
  } catch {}
}

function calculateSessionVwap(bars: Candle[]): { vwap: number; upper1: number; lower1: number } {
  let sumPV = 0
  let sumV = 0
  let sumP2V = 0

  for (const b of bars) {
    const p = (b.high + b.low + b.close) / 3
    const vol = b.volume > 0 ? b.volume : 1
    sumPV += p * vol
    sumP2V += p * p * vol
    sumV += vol
  }

  if (sumV === 0) return { vwap: 0, upper1: 0, lower1: 0 }
  const vwap = sumPV / sumV
  const variance = Math.max(0, sumP2V / sumV - vwap * vwap)
  const std = Math.sqrt(variance)

  return {
    vwap: Number(vwap.toFixed(2)),
    upper1: Number((vwap + std).toFixed(2)),
    lower1: Number((vwap - std).toFixed(2)),
  }
}

// Track cooldown to prevent spamming alarms for the same setup (15 min cooldown)
const lastAlerts = new Map<string, number>()

function emitAlarm(signal: ConfluenceSignal, currentPrice: number) {
  playAlarmSound(signal.direction)

  const isBuy = signal.direction === 'BUY'
  const dirColor = isBuy ? '\x1b[32;1m' : '\x1b[31;1m'
  const reset = '\x1b[0m'
  const bold = '\x1b[1m'
  const yellow = '\x1b[33;1m'
  const cyan = '\x1b[36;1m'

  const timeStr = new Date(signal.time * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
  })

  console.log(`\n\x1b[47m\x1b[30m   🚨 TRADE ALARM TRIGGERED: ${signal.instrument} ${signal.direction}   ${reset}`)
  console.log(`╔══════════════════════════════════════════════════════════════════════════╗`)
  console.log(`║ ${bold}MARKET:${reset}    ${cyan}${signal.instrument.padEnd(8)}${reset} │ ${bold}TIME (ET):${reset} ${timeStr}                  ║`)
  console.log(`║ ${bold}ACTION:${reset}    ${dirColor}${signal.direction === 'BUY' ? '🟢 BUY / LONG' : '🔴 SELL / SHORT'}${reset.padEnd(14)} │ ${bold}CURRENT PRICE:${reset} ${yellow}${currentPrice}${reset} ║`)
  console.log(`╟──────────────────────────────────────────────────────────────────────────╢`)
  console.log(`║ 📍 ${bold}LOCATION CONFLUENCE:${reset} ${signal.locationReason.padEnd(46)}║`)
  console.log(`║ ⚡ ${bold}TRIGGER:${reset}             ${signal.triggerReason.padEnd(46)}║`)
  console.log(`╟──────────────────────────────────────────────────────────────────────────╢`)
  console.log(`║ 🎯 ${bold}ENTRY ORDER:${reset}         ${cyan}${signal.entryPrice}${reset.padEnd(49)}║`)
  console.log(`║ 🛑 ${bold}STOP LOSS:${reset}           \x1b[31m${signal.stopLoss} (${signal.riskPoints.toFixed(2)} pts risk)${reset.padEnd(35)}║`)
  console.log(`║ 💰 ${bold}TP1 (SCALE 70%):${reset}    \x1b[32m${signal.tp1} (+${signal.rMultipleTp1}R) -> Move SL to BE${reset.padEnd(30)}║`)
  console.log(`║ 🚀 ${bold}TP2 (RUNNER 30%):${reset}   \x1b[32m${signal.tp2} (+${signal.rMultipleTp2}R / Opposite VA)${reset.padEnd(31)}║`)
  console.log(`╚══════════════════════════════════════════════════════════════════════════╝\n`)

  // Save to active signals file
  try {
    const dir = path.dirname(ALERTS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    let existing: any[] = []
    if (fs.existsSync(ALERTS_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8'))
      } catch {}
    }

    const payload = {
      ...signal,
      currentPrice,
      detectedAtEt: timeStr,
      detectedAtUnix: Math.floor(Date.now() / 1000),
    }

    // Keep last 50 alerts
    existing.unshift(payload)
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(existing.slice(0, 50), null, 2))
  } catch (e) {
    console.error('Failed to save alert to file:', e)
  }
}

async function scanInstrument(instrument: Instrument) {
  await warmCmeBasis(instrument)
  const basis = getCmeBasis(instrument) ?? 0

  const nowSec = Math.floor(Date.now() / 1000)
  // Fetch last 3 days of 5m candles to establish Yesterday profile and today's session
  const startSec = nowSec - 3 * 86400

  const res = await getOandaCandlesRange(instrument, '5', startSec, nowSec)
  if (!res?.candles || res.candles.length < 24) return

  const candles = applyCmeBasisToCandles(res.candles, basis)

  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const fmtTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })

  // Group by NYC date
  const daysMap = new Map<string, Candle[]>()
  for (const c of candles) {
    const d = new Date(c.time * 1000)
    const etDate = fmtDate.format(d)
    const list = daysMap.get(etDate) ?? []
    list.push(c)
    daysMap.set(etDate, list)
  }

  const dayKeys = Array.from(daysMap.keys()).sort()
  if (dayKeys.length < 2) return

  const priorDayKey = dayKeys[dayKeys.length - 2]!
  const todayKey = dayKeys[dayKeys.length - 1]!
  const priorBars = daysMap.get(priorDayKey)!
  const todayBars = daysMap.get(todayKey)!

  if (priorBars.length < 12 || todayBars.length < 6) return

  // Compute Yesterday's Profile
  const ydayProfile = computeYesterdayProfile({
    instrument,
    candles: priorBars.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    asOfUnix: priorBars[priorBars.length - 1]!.time,
  })

  const valueArea = ydayProfile
    ? { vah: ydayProfile.vah, val: ydayProfile.val, poc: ydayProfile.poc }
    : null

  // Tag today's bars with ET time
  const taggedToday = todayBars.map((c) => {
    const d = new Date(c.time * 1000)
    const timeStr = fmtTime.format(d)
    const [h, m] = timeStr.split(':').map(Number)
    const etMins = (h || 0) * 60 + (m || 0)
    return { ...c, etMins }
  })

  // Filter RTH session bars (9:30 AM to 4:00 PM ET)
  const rthBars = taggedToday.filter((b) => b.etMins >= 570 && b.etMins <= 960)
  const activeBars = rthBars.length >= 6 ? rthBars : todayBars

  const vwap = calculateSessionVwap(activeBars)
  const stochPoints = calculateStochastic(activeBars, 14, 3, 3)

  const signal = evaluateConfluenceSignal({
    instrument,
    bars: activeBars,
    stochPoints,
    valueArea,
    vwap,
  })

  if (signal) {
    const latestBar = activeBars[activeBars.length - 1]!
    const alertKey = `${instrument}_${signal.direction}_${signal.locationReason}_${Math.floor(latestBar.time / 900)}`
    const lastTime = lastAlerts.get(alertKey) || 0

    // Cooldown check (prevent multiple alerts for the same bar setup within 15 min)
    if (Date.now() - lastTime > 15 * 60 * 1000) {
      lastAlerts.set(alertKey, Date.now())
      emitAlarm(signal, latestBar.close)
    }
  }
}

async function startScanner() {
  console.clear()
  console.log(`====================================================================`)
  console.log(`📡 REAL-TIME CONFLUENCE DIVERGENCE SCANNER ACTIVE`)
  console.log(`====================================================================`)
  console.log(`Tracking Markets:  ${MONITORED_INSTRUMENTS.join(', ')}`)
  console.log(`Strategy:          Market Profile (VAL/VAH/POC) + VWAP ±1σ + Kurisko Stoch (14,3,3)`)
  console.log(`Session Anchor:    NYC Regular Trading Hours (9:30 AM - 4:00 PM ET)`)
  console.log(`Alarm Status:      Audio Chime ON | Console Box ON | JSON Feed ON`)
  console.log(`Polling Frequency: Every ${SCAN_INTERVAL_MS / 1000}s`)
  console.log(`====================================================================\n`)
  console.log(`Listening for institutional confluence entry setups...\n`)

  const scanLoop = async () => {
    const nowStr = new Date().toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
    })

    process.stdout.write(`\r[${nowStr} ET] Scanning ${MONITORED_INSTRUMENTS.join(' | ')}... `)

    for (const inst of MONITORED_INSTRUMENTS) {
      try {
        await scanInstrument(inst)
      } catch (e) {
        // Continue scan
      }
    }
  }

  // Initial immediate scan
  await scanLoop()

  // Continuous interval
  setInterval(scanLoop, SCAN_INTERVAL_MS)
}

startScanner().catch(console.error)
