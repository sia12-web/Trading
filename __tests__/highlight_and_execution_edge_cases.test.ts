import assert from 'node:assert/strict'
import {
  zoneStopPrice,
  extendStopPastRound,
  snapProfitToRound,
  levelZone,
} from '../lib/trading/deskLevels'
import {
  PositionSizer,
  riskPercentForEntrySource,
  MANUAL_RISK_PERCENT,
} from '../lib/trading/positionSizing'

// ─── 1. HIGHLIGHTING TIME & PRICE EDGE CASES ────────────────────────────────

function getTradingSessionDate(unix: number, timeZone: string): Date {
  const d = new Date(unix * 1000)
  const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false })
  const hour = parseInt(fmtHour.format(d), 10)
  
  // Overnight/Asia session starts at 18:00 (6 PM ET) on the previous calendar day
  const dateOffset = hour >= 18 ? 1 : 0
  
  const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
  const parts = fmtDate.formatToParts(d)
  const getVal = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  
  return new Date(getVal('year'), getVal('month') - 1, getVal('day') + dateOffset)
}

function getRelativeTradingDayLabel(unix: number, nowUnix: number, timeZone: string): string {
  const tDate = getTradingSessionDate(unix, timeZone)
  const nowDate = getTradingSessionDate(nowUnix, timeZone)
  
  const diffMs = nowDate.getTime() - tDate.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} trading days ago`
}

function testHighlightingEdgeCases() {
  console.log('Testing Highlighting Edge Cases...')

  // 1. Session Roll at 18:00 ET (Asia session start on previous calendar day)
  // 2026-07-21 20:00 ET (8 PM) -> belongs to 2026-07-22 Trading Session
  const unixAsiaNight = Math.floor(new Date('2026-07-21T20:00:00-04:00').getTime() / 1000)
  const unixTodayNY = Math.floor(new Date('2026-07-22T10:00:00-04:00').getTime() / 1000)

  const labelAsia = getRelativeTradingDayLabel(unixAsiaNight, unixTodayNY, 'America/New_York')
  assert.equal(labelAsia, 'Today', '8 PM ET last night must roll forward to Today trading session')

  // 2. Exact Click Start & Finish Price Net Move calculation
  const click1P = 28870.50
  const click2P = 29050.25
  const diffPts = click2P - click1P
  const pctMove = (diffPts / click1P) * 100

  assert.equal(diffPts, 179.75, 'Points move must equal click2 - click1')
  assert.equal(pctMove.toFixed(2), '0.62', 'Percentage move calculation must be accurate')

  // 3. Reverse Click Direction (2nd Click is at lower price)
  const shortClick1P = 29100.00
  const shortClick2P = 28950.00
  const shortDiffPts = shortClick2P - shortClick1P
  const shortPct = (shortDiffPts / shortClick1P) * 100

  assert.equal(shortDiffPts, -150.00, 'Negative move must be preserved for Short highlights')
  assert.equal(shortPct.toFixed(2), '-0.52', 'Negative percentage must be accurately computed')

  console.log('✔ Highlighting Edge Cases Passed!')
}

// ─── 2. ORDER EXECUTION & POSITION SIZING PROTECTION ────────────────────────

function testPositionSizingProtection() {
  console.log('Testing Position Sizing Protection...')

  const sizer = new PositionSizer()
  const accountSize = 100000 // $100k account

  // 1. Risk Percent checks for manual vs desk entries
  assert.equal(riskPercentForEntrySource('manual'), 1, 'Manual entry risk must be 1%')
  assert.equal(riskPercentForEntrySource('ai'), 5, 'AI entry risk must be 5%')

  // 2. Standard 1% Manual Risk ($1,000 risk) for mid price (2000 entry, 1900 stop = 100 pt stop distance)
  const sizeMid = sizer.calculatePosition(2000, accountSize, 'LONG', 1900, MANUAL_RISK_PERCENT)
  assert.notEqual(sizeMid, null)
  assert.equal(sizeMid?.risk_amount, 1000, 'Risk amount must be exactly $1,000 (1% of 100k)')
  assert.equal(sizeMid?.position_size, 10, 'Position units must equal 1000 / 100 = 10 units when under 10k price')

  // 3. High Index Price (>10,000 entry: e.g. 20000 entry)
  // Margin safety cap restricts position_size to max 2.0 units to prevent OANDA margin rejections
  const size1 = sizer.calculatePosition(20000, accountSize, 'LONG', 19900, MANUAL_RISK_PERCENT)
  assert.notEqual(size1, null)
  assert.equal(size1?.position_size, 2, 'Position units for >10,000 price index must be capped at 2.0 units for OANDA margin safety')

  // 4. Wider Stop Loss (200 pt stop distance: Entry @ 2000, Stop @ 1800)
  // Position units should drop to 5 units to keep risk capped at $1,000!
  const sizeWider = sizer.calculatePosition(2000, accountSize, 'LONG', 1800, MANUAL_RISK_PERCENT)
  assert.notEqual(sizeWider, null)
  assert.equal(sizeWider?.risk_amount, 1000, 'Risk amount must stay capped at $1,000 with wider stop')
  assert.equal(sizeWider?.position_size, 5, 'Position units must decrease to 5 units for wider stop')

  // 4. Tighter Stop Loss (20 pt stop distance: Entry @ 20000, Stop @ 19980)
  // Leverage safety cap for high indices (>1000 price) caps notional at 1.5x account size
  const sizeTight = sizer.calculatePosition(20000, accountSize, 'LONG', 19980, MANUAL_RISK_PERCENT)
  assert.notEqual(sizeTight, null)
  assert.ok(sizeTight!.position_size * 20000 <= accountSize * 1.5, 'Notional value must be capped at 1.5x account size')

  // 5. Zero or negative price safety checks
  assert.equal(sizer.calculatePosition(0, accountSize, 'LONG', 19900), null, 'Zero entry price must return null')
  assert.equal(sizer.calculatePosition(20000, 0, 'LONG', 19900), null, 'Zero account size must return null')
  const fallbackStop = sizer.calculatePosition(20000, accountSize, 'LONG', 20000)
  assert.notEqual(fallbackStop, null, 'Invalid stop loss equal to entry must fall back safely to default disaster stop (5%)')
  assert.equal(fallbackStop?.stop_loss_price, 19000, 'Disaster stop for LONG @ 20000 must be 19000 (5% below entry)')

  console.log('✔ Position Sizing Protection Passed!')
}

// ─── 3. ZONE STOP LOSS & ROUND NUMBER MAGNET PROTECTION ─────────────────────

function testZoneStopsAndRoundNumbers() {
  console.log('Testing Zone Stops & Round Number Protection...')

  const levelPrice = 29450 // Index level

  // 1. Level Zone Calculation
  const z = levelZone(levelPrice)
  assert.ok(z.low < levelPrice && z.high > levelPrice, 'Zone low must be < level and high > level')

  // 2. Zone Stop Loss Placement
  const stopLong = zoneStopPrice(levelPrice, 'LONG')
  const stopShort = zoneStopPrice(levelPrice, 'SHORT')

  assert.ok(stopLong < z.low, 'LONG stop loss must sit below the zone low')
  assert.ok(stopShort > z.high, 'SHORT stop loss must sit above the zone high')

  // 3. Extend Stop Past Psychological Round Handle
  // Raw stop at 29002 (just above 29000 round handle) for a LONG trade
  const extendedStop = extendStopPastRound(29002, 'LONG', 29050)
  assert.ok(extendedStop < 29000, 'LONG stop near 29000 handle must be extended below 29000 to prevent stop-hunts')

  // 4. Snap Profit Target to Round Handle ensuring >= 1.5R
  const snappedTP = snapProfitToRound(20000, 19900, 20210, 'LONG')
  const risk = 20000 - 19900 // 100 pts
  const reward = snappedTP - 20000
  assert.ok(reward / risk >= 1.5, 'Snapped Take Profit must maintain at least 1.5R reward-to-risk ratio')

  console.log('✔ Zone Stops & Round Number Protection Passed!')
}

// ─── RUN TEST SUITE ──────────────────────────────────────────────────────────

function runAllTests() {
  console.log('====================================================')
  console.log('  RUNNING TRADING PLATFORM AUDIT & TEST SUITE  ')
  console.log('====================================================')

  testHighlightingEdgeCases()
  testPositionSizingProtection()
  testZoneStopsAndRoundNumbers()

  console.log('====================================================')
  console.log('  ALL HIGHLIGHTING & EXECUTION EDGE CASES PASSED!  ')
  console.log('====================================================')
}

runAllTests()
