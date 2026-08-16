/**
 * SENTINEL — Tradeify money path, 1:1.5 SL/TP, flatten, auth contracts.
 * Run: npx tsx __tests__/sentinel_tradeify_money.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert/strict'
import {
  cookieValue,
  DESK_RISK_PROFILE_COOKIE,
} from '../lib/trading/tradeifyProfileStore'
import {
  mergeMoneyRiskProfile,
  parseDeskRiskProfile,
  isTradeifyGrowth50k,
} from '../lib/trading/tradeifyProfile'
import {
  DEFAULT_TAKE_PROFIT_R,
  getPositionSizer,
  takeProfitFromStopR,
  previewPositionSizing,
} from '../lib/trading/positionSizing'
import {
  resolveTradeifyPlace,
  tradeifyMustFlatten,
  tradeifyRiskStepDollars,
  TRADEIFY_DLL_DOLLARS,
  TRADEIFY_MIN_RISK_DOLLARS,
  TRADEIFY_RISK_FIRST_DOLLARS,
  TRADEIFY_STARTING_BALANCE,
} from '../lib/trading/tradeifyGrowth50k'
import { strategyTakeProfitPrice } from '../lib/trading/strategyRiskGeometry'
import { assertProtectiveStop } from '../lib/trading/stopLossGuard'
import { assertCronAuthorized } from '../lib/utils/devAuth'

const passed: string[] = []
const failed: { name: string; error: string }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed.push(name)
  } catch (err) {
    failed.push({ name, error: err instanceof Error ? err.message : String(err) })
  }
}

function src(rel: string): string {
  return readFileSync(join(__dirname, '..', rel), 'utf8')
}

// ─── 1:1.5 geometry ──────────────────────────────────────────────────────────

test('DEFAULT_TAKE_PROFIT_R is 1.5 not 2', () => {
  assert.equal(DEFAULT_TAKE_PROFIT_R, 1.5)
})

test('takeProfitFromStopR LONG is exact 1.5R', () => {
  const tp = takeProfitFromStopR({ entry: 40000, stop: 39800, direction: 'LONG' })
  assert.equal(tp, 40000 + 200 * 1.5)
})

test('takeProfitFromStopR SHORT is exact 1.5R', () => {
  const tp = takeProfitFromStopR({ entry: 40000, stop: 40200, direction: 'SHORT' })
  assert.equal(tp, 40000 - 200 * 1.5)
})

test('takeProfitFromStopR rejects zero/invalid with no invented target', () => {
  assert.equal(takeProfitFromStopR({ entry: 0, stop: 100, direction: 'LONG' }), 0)
  assert.equal(takeProfitFromStopR({ entry: 40000, stop: 40000, direction: 'LONG' }), 40000)
  assert.equal(takeProfitFromStopR({ entry: 40000, stop: Number.NaN, direction: 'LONG' }), 40000)
})

test('tight stop is still 1.5R (no 0.5% floor stretch)', () => {
  const entry = 42050
  const stop = 42000
  const tp = takeProfitFromStopR({ entry, stop, direction: 'LONG' })
  assert.equal(tp - entry, 50 * 1.5)
})

test('strategyTakeProfitPrice stays ≥ 1.5R and below old 2R magnet', () => {
  const entry = 42180
  const stop = 42000
  const tp = strategyTakeProfitPrice({ entry, stop, direction: 'LONG' })
  const rr = (tp - entry) / (entry - stop)
  assert.ok(rr >= 1.5 - 1e-6, `rr ${rr}`)
  assert.ok(rr < 2.2, `rr ${rr} looks like opposing-edge 2R`)
})

test('preview TP tracks 1.5R of the stop', () => {
  const prev = previewPositionSizing(40000, 100_000, 'LONG', 39800, 2)
  assert.ok(prev)
  const rr = (prev!.profit_target_price - 40000) / 200
  assert.ok(rr >= 1.5 - 0.15, `preview rr ${rr}`)
})

// ─── Hostile / confused profile input ────────────────────────────────────────

test('SQL/XSS/junk profile strings never become Tradeify', () => {
  const junk = [
    `' OR 1=1 --`,
    `<script>alert(1)</script>`,
    'javascript:alert(1)',
    '../../etc/passwd',
    'TRADEIFY_GROWTH_50K; DROP TABLE trades_journal',
    'oanda_cash\ntradeify_growth_50k',
    '1',
    '{}',
    'null',
    'undefined',
  ]
  for (const raw of junk) {
    assert.equal(parseDeskRiskProfile(raw), 'oanda_cash', raw)
    assert.equal(isTradeifyGrowth50k(raw), false, raw)
  }
})

test('known Tradeify aliases still parse', () => {
  assert.ok(isTradeifyGrowth50k('tradeify'))
  assert.ok(isTradeifyGrowth50k('tradeify_50k'))
  assert.ok(isTradeifyGrowth50k('growth_50k'))
  assert.ok(isTradeifyGrowth50k('TRADEIFY-GROWTH-50K'))
})

test('mergeMoneyRiskProfile: persist Tradeify beats hostile client hint', () => {
  assert.equal(
    mergeMoneyRiskProfile(`' OR 1=1 --`, 'tradeify_growth_50k'),
    'tradeify_growth_50k'
  )
  assert.equal(mergeMoneyRiskProfile('<script>', 'oanda_cash'), 'tradeify_growth_50k')
  assert.equal(mergeMoneyRiskProfile('tradeify', null), 'tradeify_growth_50k')
})

test('cookieValue only returns the named cookie', () => {
  const header =
    'other=tradeify_growth_50k; tradepulse_risk_profile=oanda_cash; extra=1'
  assert.equal(cookieValue(header, DESK_RISK_PROFILE_COOKIE), 'oanda_cash')
  assert.equal(cookieValue(null, DESK_RISK_PROFILE_COOKIE), null)
  assert.equal(cookieValue('', DESK_RISK_PROFILE_COOKIE), null)
  assert.equal(
    cookieValue(
      `foo=1; ${DESK_RISK_PROFILE_COOKIE}=tradeify_growth_50k`,
      DESK_RISK_PROFILE_COOKIE
    ),
    'tradeify_growth_50k'
  )
})

test('cookie injection / wrong name cannot flip profile via cookieValue', () => {
  assert.equal(
    cookieValue(
      `tradepulse_risk_profile_evil=tradeify_growth_50k; session=abc`,
      DESK_RISK_PROFILE_COOKIE
    ),
    null
  )
})

// ─── Size: client cannot oversize ────────────────────────────────────────────

test('Tradeify size = risk$ / stop distance — client 99-lot is ignored', () => {
  const sized = getPositionSizer().calculatePositionFromRiskAmount(
    20000,
    TRADEIFY_STARTING_BALANCE,
    'LONG',
    19900,
    400
  )
  assert.ok(sized)
  assert.equal(sized!.risk_amount, 400)
  assert.ok(Math.abs(sized!.position_size - 4) < 1e-9)
  assert.ok(sized!.position_size < 99)
})

test('wider stop shrinks size so $ risk stays the step', () => {
  const tight = getPositionSizer().calculatePositionFromRiskAmount(
    40000,
    50_000,
    'LONG',
    39900,
    400
  )
  const wide = getPositionSizer().calculatePositionFromRiskAmount(
    40000,
    50_000,
    'LONG',
    39600,
    400
  )
  assert.ok(tight && wide)
  assert.equal(tight!.risk_amount, 400)
  assert.equal(wide!.risk_amount, 400)
  assert.ok(wide!.position_size < tight!.position_size)
})

test('invalid stop / risk returns null (no wild size)', () => {
  assert.equal(
    getPositionSizer().calculatePositionFromRiskAmount(40000, 50_000, 'LONG', 40100, 400),
    null,
    'LONG stop above entry'
  )
  assert.equal(
    getPositionSizer().calculatePositionFromRiskAmount(40000, 50_000, 'LONG', 39900, 0),
    null,
    'zero risk'
  )
  assert.equal(
    getPositionSizer().calculatePositionFromRiskAmount(40000, 50_000, 'LONG', 39900, -400),
    null,
    'negative risk'
  )
})

test('resolveTradeifyPlace never exceeds the $400 first step', () => {
  const fat = resolveTradeifyPlace({
    now: new Date('2026-08-18T11:30:00-04:00'),
    fillsUsed: 0,
    dailyPnl: 0,
    equity: 80_000,
    peakEodBalance: 80_000,
  })
  assert.ok(fat.allowed)
  assert.ok(fat.riskDollars <= TRADEIFY_RISK_FIRST_DOLLARS)
  assert.equal(fat.riskDollars, 400)
})

test('NaN / negative fillsUsed cannot skip to a cheaper or larger step', () => {
  assert.equal(tradeifyRiskStepDollars(Number.NaN), 400)
  assert.equal(tradeifyRiskStepDollars(-3), 400)
  assert.equal(tradeifyRiskStepDollars('nope' as unknown as number), 400)
  const place = resolveTradeifyPlace({
    now: new Date('2026-08-18T11:30:00-04:00'),
    fillsUsed: Number.NaN,
    dailyPnl: 0,
  })
  assert.ok(place.allowed)
  assert.equal(place.riskDollars, 400)
})

test('NaN dailyPnl does not invent leftover DLL', () => {
  const place = resolveTradeifyPlace({
    now: new Date('2026-08-18T11:30:00-04:00'),
    fillsUsed: 0,
    dailyPnl: Number.NaN,
  })
  assert.equal(place.leftoverDll, TRADEIFY_DLL_DOLLARS)
})

test('leftover under $50 refuses — no token-size stop', () => {
  const place = resolveTradeifyPlace({
    now: new Date('2026-08-18T11:30:00-04:00'),
    fillsUsed: 0,
    dailyPnl: -(TRADEIFY_DLL_DOLLARS - (TRADEIFY_MIN_RISK_DOLLARS - 1)),
  })
  assert.equal(place.allowed, false)
})

// ─── Flatten boundaries ──────────────────────────────────────────────────────

test('flatten window is [16:59, 18:00) ET inclusive start', () => {
  assert.equal(tradeifyMustFlatten(new Date('2026-08-18T16:58:59-04:00')), false)
  assert.equal(tradeifyMustFlatten(new Date('2026-08-18T16:59:00-04:00')), true)
  assert.equal(tradeifyMustFlatten(new Date('2026-08-18T17:59:00-04:00')), true)
  assert.equal(tradeifyMustFlatten(new Date('2026-08-18T18:00:00-04:00')), false)
})

test('16:59 ET refuses new entries even with a fresh DLL', () => {
  const place = resolveTradeifyPlace({
    now: new Date('2026-08-18T16:59:00-04:00'),
    fillsUsed: 0,
    dailyPnl: 0,
  })
  assert.equal(place.allowed, false)
  assert.equal(place.refuseReason, 'must_flatten')
})

// ─── Stop guard ──────────────────────────────────────────────────────────────

test('protective stop rejects same-side / missing / too tight', () => {
  assert.equal(
    assertProtectiveStop({
      instrument: 'DOW',
      entry: 40000,
      stop: 40000,
      direction: 'LONG',
    }).ok,
    false
  )
  assert.equal(
    assertProtectiveStop({
      instrument: 'DOW',
      entry: 40000,
      stop: 40005,
      direction: 'LONG',
    }).ok,
    false
  )
  assert.equal(
    assertProtectiveStop({
      instrument: 'DOW',
      entry: Number.NaN,
      stop: 39900,
      direction: 'LONG',
    }).ok,
    false
  )
  const ok = assertProtectiveStop({
    instrument: 'DOW',
    entry: 40000,
    stop: 39800,
    direction: 'LONG',
  })
  assert.equal(ok.ok, true)
})

// ─── Cron auth ───────────────────────────────────────────────────────────────

test('CRON_SECRET set: missing bearer is denied', () => {
  const prev = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'sentinel-test-secret-not-for-prod'
  try {
    const req = new Request('http://localhost/api/trading/positions/cleanup-session')
    assert.equal(assertCronAuthorized(req), false)
    const ok = new Request('http://localhost/api/trading/positions/cleanup-session', {
      headers: { authorization: 'Bearer sentinel-test-secret-not-for-prod' },
    })
    assert.equal(assertCronAuthorized(ok), true)
    const wrong = new Request('http://localhost/api/trading/positions/cleanup-session', {
      headers: { authorization: 'Bearer wrong' },
    })
    assert.equal(assertCronAuthorized(wrong), false)
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev
  }
})

test('prod-style query-string cron secret is ignored when NODE_ENV=production', () => {
  const prevSecret = process.env.CRON_SECRET
  const prevEnv = process.env.NODE_ENV
  process.env.CRON_SECRET = 'sentinel-test-secret-not-for-prod'
  process.env.NODE_ENV = 'production'
  try {
    const req = new Request(
      'http://localhost/api/trading/positions/cleanup-session?cron_secret=sentinel-test-secret-not-for-prod'
    )
    assert.equal(assertCronAuthorized(req), false, 'query secret must not work in production')
  } finally {
    if (prevSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevSecret
    process.env.NODE_ENV = prevEnv
  }
})

// ─── Source contracts (money + auth) ─────────────────────────────────────────

test('working route: auth + user_id + server money profile + no client size', () => {
  const s = src('app/api/trading/positions/working/route.ts')
  assert.ok(s.includes('getOrCreateUser'), 'auth')
  assert.ok(s.includes("Unauthorized"), '401')
  assert.ok(s.includes(".eq('user_id', user.id)"), 'scoped to user')
  assert.ok(s.includes('resolveMoneyRiskProfile'), 'Tradeify cannot be skipped')
  assert.ok(!s.includes('body.position_size'), 'client size unused')
  assert.ok(!s.includes('body.risk_amount'), 'client risk unused')
  assert.ok(s.includes('calculatePositionFromRiskAmount'), 'Tradeify $ path')
})

test('open route: auth + user_id + server money profile', () => {
  const s = src('app/api/trading/positions/open/route.ts')
  assert.ok(s.includes('getOrCreateUser') || s.includes('resolveDeskUser'), 'auth')
  assert.ok(s.includes(".eq('user_id', user.id)"), 'scoped to user')
  assert.ok(s.includes('resolveMoneyRiskProfile'), 'Tradeify cannot be skipped')
})

test('cleanup-session: cron or desk user required', () => {
  const s = src('app/api/trading/positions/cleanup-session/route.ts')
  assert.ok(s.includes('assertCronOrDeskUser'), 'cron/desk auth')
  assert.ok(s.includes('Unauthorized'), '401')
  assert.ok(s.includes('tradeifyMustFlatten'), 'flatten flag')
})

test('risk-profile: GET/POST require desk user', () => {
  const s = src('app/api/trading/risk-profile/route.ts')
  assert.ok(s.includes('getOrCreateUser'))
  assert.ok(s.includes('Unauthorized'))
  assert.ok(s.includes('TRADEIFY_PROFILE_ID'), 'desk is Tradeify only')
})

test('Railway flatten watch is wired on boot', () => {
  const boot = src('instrumentation.ts')
  assert.ok(boot.includes('startTradeifyFlattenWatch'))
  const watch = src('lib/trading/tradeifyFlattenWatch.ts')
  assert.ok(watch.includes('cleanupDeskSession'))
  assert.ok(watch.includes('tradeifyMustFlatten'))
})

test('chart initial risk-box TP uses 1.5R helper not 1.0105', () => {
  const s = src('app/dashboard/chart/components/TradingChart.tsx')
  assert.ok(s.includes('defaultManualTarget'))
  assert.ok(s.includes('takeProfitFromStopR'))
  assert.ok(!s.includes('1.0105'), 'old 1.05% TP gone')
})

// ─── Report ──────────────────────────────────────────────────────────────────

if (failed.length) {
  console.error(`sentinel_tradeify_money: ${failed.length} failed / ${passed.length} passed`)
  for (const f of failed) console.error(`  FAIL ${f.name}: ${f.error}`)
  process.exit(1)
}

console.log(`sentinel_tradeify_money: ${passed.length} passed`)
