/**
 * Live Voice prompt packing — no invented levels.
 * Run: npx tsx __tests__/live_voice_prompt.test.ts
 */

import {
  LIVE_VOICE_SYSTEM_PROMPT,
  formatLiveVoiceContextForLlm,
} from '../lib/trading/liveVoicePrompt'
import type { LiveVoiceDeskContext } from '../lib/trading/liveVoiceContext'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(LIVE_VOICE_SYSTEM_PROMPT.includes('NEVER place'), 'no-order rule')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('NEVER invent'), 'no-invent rule')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('20 seconds'), 'short reply')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('2 / 2 / 2 per window'), 'Leo knows 2/2/2 per-window ladder')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Session hard cap = 3 fills'), 'Leo knows session cap is 3 fills total')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('PROGRESSIVE RISK'), 'Leo knows progressive risk ladder')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('1%'), 'Leo knows first fill 1%')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('0.5%'), 'Leo knows second fill 0.5%')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('0.25%'), 'Leo knows third fill 0.25%')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('RANGE EDGE ENTRY GATE'), 'Leo knows ±10 entry gate')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('±10 index points'), 'Leo knows ±10 band')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('RANGE VOLATILITY'), 'Leo knows range ATR volatility')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('ATR(14)'), 'Leo knows ATR(14) 5m')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('advise only'), 'Leo knows ATR is advise-only')
assert(!LIVE_VOICE_SYSTEM_PROMPT.includes('Structure has 5%'), 'Leo no longer says Structure has 5%')
assert(!LIVE_VOICE_SYSTEM_PROMPT.includes('capped at 1% manual'), 'Leo no longer says 1% manual cap')
assert(!LIVE_VOICE_SYSTEM_PROMPT.includes('1% risk. Do not invent'), 'Leo no 1% manual pin risk')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('progressive session risk ladder'), 'Leo says progressive risk for manual')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Same progressive risk ladder'), 'Leo says same ladder for manual')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('ATTEMPT LADDER'), 'ladder section')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('CONFIRM-CLOSE'), 'lunch confirm-close')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('cash-close auto-liquidation'), 'cash-close flatten')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Skip-forward'), 'skip-forward')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('US Range'), 'Nikkei US Range in Leo')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('OR30'), 'OR30 in Leo')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('NIKKEI ranges'), 'desk-specific Nikkei ladder')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('RANGE LIQUIDITY MAP'), 'Leo knows range liquidity map')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('retail BAIT'), 'Leo knows range H/L = bait')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('JUST BEYOND'), 'Leo knows stop pools beyond edges')
assert(
  LIVE_VOICE_SYSTEM_PROMPT.includes('STRATEGY RISK GEOMETRY'),
  'Leo knows strategy SL/TP geometry'
)
assert(
  LIVE_VOICE_SYSTEM_PROMPT.includes('DESK EXECUTION FLOW'),
  'Leo knows Level Finder → ticket → fill → manage'
)
assert(
  LIVE_VOICE_SYSTEM_PROMPT.includes('POST-FILL MANAGE'),
  'Leo knows post-fill manage is separate'
)
assert(
  LIVE_VOICE_SYSTEM_PROMPT.includes('opposing range edge'),
  'Leo knows opposing-edge TP'
)
assert(
  LIVE_VOICE_SYSTEM_PROMPT.includes('buy the range low') ||
    LIVE_VOICE_SYSTEM_PROMPT.includes('Reject "buy the range low'),
  'Leo rejects retail range-edge entries'
)

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
    window: { start: '09:15', end: '10:15', tz: 'America/Toronto', tzLabel: 'Montreal' },
    localTime: '09:20:00',
    tradeDate: '2026-07-15',
  },
  session: {
    phase: 'PREP',
    message: 'Prep',
    lockedInstrument: 'DOW',
    viewingInstrument: 'DOW',
    canPlaceEntry: false,
    canManagePosition: false,
    attemptsUsed: 0,
    maxAttempts: 6,
    stopHits: 0,
    maxStopHits: 2,
    morningAttempts: 0,
    ibAttempts: 0,
    lunchAttempts: 0,
    maxMorningAttempts: 2,
    maxIbAttempts: 2,
    maxLunchAttempts: 2,
    ibEligible: true,
    lunchEligible: true,
    attemptLadderLabel: 'Session 0/3 · AM 0/2 · IB 0/2 · LN 0/2',
    openPositionId: null,
    entryWindow: null,
    rangeStrategy: null,
    playbookMode: 'morning',
    playbookTitle: 'Morning playbook',
    tradeDate: '2026-07-15',
    times: {
      analyzeStart: '09:00',
      marketOpen: '09:30',
      entryClose: '10:15',
      lunchClose: '11:30',
      marketClose: '16:00',
      ibEntry: '10:30–10:45',
      lunchRangeEntry: '13:30–15:15',
      tz: 'America/Toronto',
      tzLabel: 'Montreal',
    },
  },
  risk: {
    deskRiskPercent: 0.25,
    manualRiskPercent: 0.25,
    maxAttempts: 6,
    maxStopHits: 2,
    entryRule: 'day max 6',
  },
  avwap: {
    openLabel: 'NY 9:30',
    lookbackTradingDays: 5,
    timeZone: 'America/New_York',
    cashOpenHour: 9.5,
    bandNote: 'NY 9:30 · 5 trading days prior · ±1/2/3σ',
  },
  overnight: {
    ready: true,
    regime: 'bullish',
    regimeConfidence: 70,
    recommendationConfidence: 70,
    gapPercent: 0.2,
    overnightOhlc: { open: 1, high: 2, low: 0.5, close: 1.5 },
    newsSummary: null,
    source: 'regime_cache' as const,
  },
  market: {
    livePrice: 39250,
  },
  levels: {
    source: 'ai',
    count: 1,
    focusSide: 'BUY',
    focusHint: 'bias',
    items: [
      {
        price: 42000,
        side: 'BUY',
        rank: 'primary',
        type: 'support',
        conviction: 8,
        reasoning: 'liquidity',
        source: 'ai',
        marketVerdict: null,
        testedCount: null,
        successCount: null,
      },
    ],
  },
  userPins: [],
  workingOrders: [],
  activePosition: null,
  voiceSessionId: null,
} as LiveVoiceDeskContext

const packed = formatLiveVoiceContextForLlm(mock)
assert(packed.includes('42000'), 'includes AI level price')
assert(packed.includes('bullish'), 'includes regime')
assert(packed.includes('NY 9:30'), 'includes AVWAP label')
assert(packed.includes('Morning playbook'), 'includes active playbook title')
assert(packed.includes('IB 10:30'), 'includes IB window')
assert(packed.includes('AM 0/2'), 'includes attempt ladder')
assert(packed.includes('RANGE LIQUIDITY MAP'), 'packed context has range liquidity map')
assert(packed.includes('Primary bait'), 'packed context has primary bait')
assert(packed.includes('OR30'), 'packed primary OR30 for morning')
assert(packed.includes('Initial SL/TP'), 'packed reminder has strategy SL/TP')
assert(packed.includes('Post-fill MANAGE'), 'packed reminder separates post-fill manage')
assert(!packed.includes('99999'), 'no invented price')

{
  const nikkei = {
    ...mock,
    voice: { ...mock.voice, instrument: 'NIKKEI', market: 'TOKYO' },
    session: {
      ...mock.session,
      playbookMode: 'us_range',
      playbookTitle: 'US Range playbook',
      rangeStrategy: 'us_range',
    },
  } as LiveVoiceDeskContext
  const p = formatLiveVoiceContextForLlm(nikkei)
  assert(p.includes('US Range'), 'Nikkei US Range in packed context')
  assert(p.includes('OR30 → US Range'), 'Nikkei desk range chain')
  assert(/Primary bait.*US Range/i.test(p), 'Nikkei primary bait US Range')
}

{
  const withVerdict = {
    ...mock,
    levels: {
      ...mock.levels,
      items: [
        {
          ...mock.levels.items[0]!,
          marketVerdict: 'broken',
          testedCount: 2,
          successCount: 0,
        },
      ],
    },
  } as LiveVoiceDeskContext
  const p = formatLiveVoiceContextForLlm(withVerdict)
  assert(p.includes('verdict=broken'), 'includes market verdict')
  assert(p.includes('tests=2'), 'includes test count')
}
console.log('live_voice_prompt: all passed')
