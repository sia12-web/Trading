/**
 * Compare TradePulse IB (OANDA mid/bid + cash Yahoo) vs CME futures (YM=F / NQ=F).
 * Run: node scratch/probe-ib-tradovate.mjs
 */
import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const idx = trimmed.indexOf('=')
  if (idx < 0) continue
  const key = trimmed.slice(0, idx).trim()
  let val = trimmed.slice(idx + 1).trim()
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1)
  }
  process.env[key] = val
}

const OPEN_NY = '2026-08-18T13:30:00Z' // 09:30 EDT
const END_NY = '2026-08-18T14:30:00Z' // 10:30 EDT
const openUnix = Math.floor(new Date(OPEN_NY).getTime() / 1000)
const endUnix = Math.floor(new Date(END_NY).getTime() / 1000)

function ibOf(bars, { includeEndBar = false } = {}) {
  const ibBars = bars.filter((c) =>
    includeEndBar ? c.time >= openUnix && c.time <= endUnix : c.time >= openUnix && c.time < endUnix
  )
  if (!ibBars.length) return null
  let hi = -Infinity
  let lo = Infinity
  let loTime = 0
  let hiTime = 0
  for (const c of ibBars) {
    if (c.high > hi) {
      hi = c.high
      hiTime = c.time
    }
    if (c.low < lo) {
      lo = c.low
      loTime = c.time
    }
  }
  return {
    n: ibBars.length,
    high: hi,
    low: lo,
    highAt: new Date(hiTime * 1000).toISOString(),
    lowAt: new Date(loTime * 1000).toISOString(),
    first: new Date(ibBars[0].time * 1000).toISOString(),
    last: new Date(ibBars[ibBars.length - 1].time * 1000).toISOString(),
  }
}

async function yahoo(symbol, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${openUnix - 3600}&period2=${endUnix + 3600}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradePulse/1.0)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) return { symbol, error: `HTTP ${res.status}`, bars: [] }
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  const timestamps = result?.timestamp || []
  const quote = result?.indicators?.quote?.[0]
  const bars = []
  for (let i = 0; i < timestamps.length; i++) {
    if (quote?.open?.[i] == null) continue
    bars.push({
      time: timestamps[i],
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
    })
  }
  return { symbol, bars }
}

async function oanda(symbol, granularity, price) {
  const base =
    process.env.OANDA_ENVIRONMENT === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com'
  const params = new URLSearchParams({
    granularity,
    price,
    from: new Date((openUnix - 600) * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000000Z'),
    to: new Date((endUnix + 600) * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000000Z'),
  })
  const url = `${base}/v3/instruments/${symbol}/candles?${params}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.OANDA_API_KEY}`,
      Accept: 'application/json',
    },
  })
  const text = await res.text()
  if (!res.ok) return { symbol, price, error: `${res.status} ${text.slice(0, 180)}`, bars: [] }
  const json = JSON.parse(text)
  const bars = []
  for (const c of json.candles || []) {
    const px = c.mid || c.bid || c.ask
    if (!px) continue
    bars.push({
      time: Math.floor(new Date(c.time).getTime() / 1000),
      open: parseFloat(px.o),
      high: parseFloat(px.h),
      low: parseFloat(px.l),
      close: parseFloat(px.c),
    })
  }
  return { symbol, price, bars }
}

function print(label, pack) {
  if (pack.error) {
    console.log(`\n${label}: ERROR ${pack.error}`)
    return
  }
  const a = ibOf(pack.bars, { includeEndBar: false })
  const b = ibOf(pack.bars, { includeEndBar: true })
  console.log(`\n${label}  bars=${pack.bars.length}`)
  console.log(
    `  IB [9:30,10:30)  H=${a?.high}  L=${a?.low}  n=${a?.n}  lowAt=${a?.lowAt}  first=${a?.first} last=${a?.last}`
  )
  console.log(
    `  IB [9:30,10:30]  H=${b?.high}  L=${b?.low}  n=${b?.n}  lowAt=${b?.lowAt}`
  )
}

const jobs = await Promise.all([
  oanda('US30_USD', 'M5', 'M'),
  oanda('US30_USD', 'M5', 'B'),
  oanda('US30_USD', 'M1', 'M'),
  oanda('NAS100_USD', 'M5', 'M'),
  oanda('NAS100_USD', 'M1', 'M'),
  yahoo('YM=F', '5m'),
  yahoo('YM=F', '1m'),
  yahoo('NQ=F', '5m'),
  yahoo('NQ=F', '1m'),
  yahoo('MYM=F', '5m'),
  yahoo('MNQ=F', '5m'),
  yahoo('^DJI', '5m'),
  yahoo('^NDX', '5m'),
])

const labels = [
  'OANDA US30 M5 MID (TradePulse DOW)',
  'OANDA US30 M5 BID',
  'OANDA US30 M1 MID',
  'OANDA NAS100 M5 MID (TradePulse NASDAQ)',
  'OANDA NAS100 M1 MID',
  'Yahoo YM=F 5m (Tradovate YM/MYM)',
  'Yahoo YM=F 1m',
  'Yahoo NQ=F 5m (Tradovate NQ/MNQ)',
  'Yahoo NQ=F 1m',
  'Yahoo MYM=F 5m',
  'Yahoo MNQ=F 5m',
  'Yahoo ^DJI 5m cash',
  'Yahoo ^NDX 5m cash',
]

labels.forEach((l, i) => print(l, jobs[i]))
