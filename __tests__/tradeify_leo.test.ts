/**
 * Slice 5 — Leo + Telegram Tradeify block.
 * Run: npx tsx __tests__/tradeify_leo.test.ts
 */

import {
  buildLeoSessionTiming,
  formatLeoSessionTimingForPrompt,
} from '../lib/trading/leoSessionTiming'
import {
  formatLiveVoiceContextForLlm,
  liveVoiceSystemPromptFor,
  LIVE_VOICE_SYSTEM_PROMPT,
} from '../lib/trading/liveVoicePrompt'
import type { LiveVoiceDeskContext } from '../lib/trading/liveVoiceContext'
import {
  formatTradeifyLeoBlock,
  formatTradeifyTelegramBlock,
  LIVE_VOICE_TRADEIFY_ADDENDUM,
  tradeifyFlattenMontreal,
} from '../lib/trading/tradeifyLeoBlock'
import {
  formatClockInNote,
  formatSessionScheduleBlock,
} from '../lib/notify/deskSessionNotes'
import {
  cookieValue,
  rememberServerRiskProfile,
  resolveDeskRiskProfileForUser,
} from '../lib/trading/tradeifyProfileStore'
import type { TradeifyLeoSnapshot } from '../lib/trading/tradeifyLeoBlock'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** America/New_York July = EDT (UTC-4) */
function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

const now = etDate(2026, 7, 15, 11, 0)

const snap: TradeifyLeoSnapshot = {
  active: true,
  asOfIso: now.toISOString(),
  flattenMontreal: tradeifyFlattenMontreal(now),
  leftoverDll: 1100,
  dllUsed: 150,
  dllCap: 1250,
  floorRoom: 1850,
  fillsUsed: 1,
  stepDollars: 250,
  riskDollars: 250,
  dailyPnl: -150,
  stopOutsToday: 1,
  status: 'can_trade',
  refuseReason: 'ok',
  refuseMessage: '',
  allowed: true,
  byInstrument: {
    DOW: { fills: 0, pnl: 0 },
    NASDAQ: { fills: 0, pnl: 0 },
    NIKKEI: { fills: 1, pnl: -150 },
    GOLD: { fills: 0, pnl: 0 },
    CRUDE: { fills: 0, pnl: 0 },
    RUSSELL: { fills: 0, pnl: 0 },
  },
}

const timing = buildLeoSessionTiming({ instrument: 'DOW', now })

const mock = {
  voice: {
    enabled: true,
    micAllowed: true,
    clockedIn: true,
    inVoiceWindow: true,
    devBypass: false,
    instrument: 'DOW',
    market: 'NY',
    reason: null,
    disableCode: null,
    window: { start: '09:15', end: '16:00', tz: 'America/Toronto', tzLabel: 'Montreal' },
    localTime: '11:00:00',
    tradeDate: '2026-07-15',
  },
  session: {
    phase: 'ENTRY',
    message: 'IB open',
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    canPlaceEntry: true,
    canManagePosition: true,
    attemptsUsed: 1,
    maxAttempts: 3,
    stopHits: 1,
    maxStopHits: 2,
    morningAttempts: 1,
    ibAttempts: 0,
    lunchAttempts: 0,
    maxMorningAttempts: 2,
    maxIbAttempts: 2,
    maxLunchAttempts: 2,
    ibEligible: true,
    lunchEligible: true,
    attemptLadderLabel: 'Session 1/3 · AM 1/2 · IB 0/2 · LN 0/2',
    openPositionId: null,
    entryWindow: 2,
    rangeStrategy: 'ib',
    playbookMode: 'ib',
    playbookTitle: 'IB playbook',
    tradeDate: '2026-07-15',
    times: {
      analyzeStart: '09:00',
      marketOpen: '09:30',
      entryClose: '10:15',
      lunchClose: '11:30',
      marketClose: '16:00',
      ibEntry: '10:30–13:30',
      lunchRangeEntry: '13:30–15:15',
      tz: 'America/Toronto',
      tzLabel: 'Montreal',
    },
    timing,
  },
  risk: {
    deskRiskPercent: 1,
    manualRiskPercent: 1,
    maxAttempts: 3,
    maxStopHits: 2,
    entryRule: 'Tradeify Growth $50k: $400 → $250 → $150',
  },
  tradeify: snap,
  avwap: {
    openLabel: 'NY 9:30',
    lookbackTradingDays: 5,
    timeZone: 'America/New_York',
    cashOpenHour: 9.5,
    bandNote: 'NY 9:30 · 5 trading days prior · ±1/2/3σ',
  },
  overnight: {
    ready: false,
    regime: null,
    regimeConfidence: null,
    recommendationConfidence: null,
    gapPercent: null,
    overnightOhlc: null,
    newsSummary: null,
    source: 'none' as const,
  },
  market: { livePrice: 39250 },
  levels: {
    source: 'empty' as const,
    count: 0,
    focusSide: 'BOTH' as const,
    focusHint: '',
    items: [],
  },
  userPins: [],
  workingOrders: [],
  activePosition: null,
  voiceSessionId: null,
} as LiveVoiceDeskContext

// ── Fresh clock + Tradeify block at 11:00 ET ─────────────────────────────────

assert(timing.mid.label === 'OR30', '11:00 mid is OR30')
assert(timing.mid.status === 'closed', '11:00 OR30 closed')
assert(timing.late.label === 'IB', '11:00 late is IB')
assert(timing.late.status === 'open', '11:00 IB open')
assert(formatLeoSessionTimingForPrompt(timing).includes('IB status=open'), 'clock IB open')
assert(
  formatLeoSessionTimingForPrompt(timing).includes('OR30 status=closed'),
  'clock OR30 closed'
)

const packed = formatLiveVoiceContextForLlm(mock)
assert(packed.includes('TRADEIFY GROWTH $50k'), 'Leo packed Tradeify header')
assert(packed.includes('IB status=open'), 'Leo packed IB open')
assert(packed.includes('OR30 status=closed'), 'Leo packed OR30 closed')
assert(packed.includes('$1,100') || packed.includes('$1100'), 'Leo leftover DLL')
assert(packed.includes('16:59 Montreal'), 'Leo flatten 16:59 Montreal')
assert(packed.includes(snap.asOfIso), 'Leo as-of ISO')
assert(packed.includes('NIKKEI 1 fills'), 'Leo shared Nikkei usage')
assert(!/Risk: every probe \d+%/.test(packed), 'Tradeify on does not print OANDA % risk line')
assert(!packed.toLowerCase().includes('pass today') || packed.includes('Do not say "pass today"'), 'ban pass-today')
assert(packed.includes('Do not hold overnight'), 'ban overnight')

const sys = liveVoiceSystemPromptFor(mock)
assert(sys.includes('$400'), 'Tradeify system addendum $400')
assert(sys.includes('pass today'), 'Tradeify system bans pass today')
assert(sys.includes(LIVE_VOICE_TRADEIFY_ADDENDUM.trim().slice(0, 20)), 'addendum attached')

// ── Silent when profile off ──────────────────────────────────────────────────

const off = { ...mock, tradeify: null } as LiveVoiceDeskContext
const packedOff = formatLiveVoiceContextForLlm(off)
assert(packedOff.includes('Tradeify $400'), 'desk always names Tradeify ladder')
assert(!/Risk: every probe \d+%/.test(packedOff), 'never print OANDA % risk line')
assert(liveVoiceSystemPromptFor(off).includes('TRADEIFY GROWTH $50k MODE'), 'addendum always on')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('$400 → $250 → $150'), 'base prompt is Tradeify')

assert(formatTradeifyLeoBlock(null) === '', 'null snapshot → empty Leo block')
assert(formatTradeifyTelegramBlock(undefined) === '', 'undefined → empty TG block')

const tg = formatTradeifyTelegramBlock(snap)
assert(tg.includes('Tradeify $50k'), 'TG header')
assert(tg.includes('16:59 Montreal'), 'TG flatten Montreal')
assert(tg.includes('no overnight'), 'TG no overnight')
assert(tg.includes('no pass-today'), 'TG no pass-today')
assert(tg.includes('$1,100') || tg.includes('$1100'), 'TG leftover DLL')

const schedOff = formatSessionScheduleBlock('DOW', now)
assert(schedOff.includes('Tradeify $400'), 'schedule is Tradeify')
assert(!schedOff.includes('2% → 1% → 0.5%'), 'schedule never prints OANDA %')
assert(schedOff.includes('1.5R'), 'schedule names 1:1.5')

const schedOn = formatSessionScheduleBlock('DOW', now, { tradeify: true })
assert(schedOn.includes('Tradeify $400'), 'schedule on uses dollar ladder')
assert(!schedOn.includes('2% → 1% → 0.5%'), 'schedule on drops OANDA %')

const clockOn = formatClockInNote({
  instrument: 'DOW',
  market: 'NY',
  sessionDate: '2026-07-15',
  now,
  tradeify: true,
  tradeifyLine: tg,
})
assert(clockOn.telegram.includes('Tradeify $400'), 'clock-in TG has dollar ladder')
assert(clockOn.telegram.includes('16:59 Montreal'), 'clock-in TG flatten')

// ── Profile resolve ──────────────────────────────────────────────────────────

assert(cookieValue('a=1; tradepulse_risk_profile=tradeify_growth_50k', 'tradepulse_risk_profile') === 'tradeify_growth_50k', 'cookie parse')
rememberServerRiskProfile('user-1', 'tradeify_growth_50k')

void resolveDeskRiskProfileForUser({ userId: 'user-1' }).then((fromMem) => {
  assert(fromMem === 'tradeify_growth_50k', 'memory persist')
  return resolveDeskRiskProfileForUser({
    userId: 'user-1',
    hint: 'oanda_cash',
  })
}).then((hintWins) => {
  assert(hintWins === 'tradeify_growth_50k', 'OANDA hint cannot switch the desk')
  console.log('tradeify_leo: all passed')
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
