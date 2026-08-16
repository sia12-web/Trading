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
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('fill #1 = **$400**'), 'Leo knows first fill $400')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('fill #2 = **$250**'), 'Leo knows second fill $250')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('fill #3 = **$150**'), 'Leo knows third fill $150')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('$400 → $250 → $150'), 'Leo knows Tradeify dollar ladder')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('1.5R of that stop'), 'Leo knows 1:1.5 TP')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('DESK NEWS HAZARDS'), 'Leo knows desk news hazards')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Stand aside'), 'Leo knows stand-aside window')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Finnhub calendar'), 'Leo knows Finnhub calendar source')
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
  LIVE_VOICE_SYSTEM_PROMPT.includes('1.5R of the protective stop'),
  'Leo knows initial TP is 1:1.5'
)
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('YESTERDAY PROFILE'), 'Leo knows yesterday profile')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('OPENING TYPE'), 'Leo knows Dalton opening type')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Open-Drive'), 'Leo knows Open-Drive')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Never unlocks off-band'), 'Leo knows opening type is not an off-band unlock')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('CONTROL (Dalton — RF + dPOC)'), 'Leo knows Dalton control')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('ONE-TF BUY'), 'Leo knows ONE-TF BUY')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Never relabel Open type'), 'Leo must not relabel Open from RF')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('dPOC'), 'Leo knows dPOC')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('Never call it volume POC'), 'Leo must not call dPOC volume POC')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('90–110%'), 'Leo knows superimpose band')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('holding extreme'), 'Leo knows holding extreme SL')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('not US Range'), 'Leo knows Nikkei yesterday is Tokyo cash')
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
      ibEntry: '10:30–13:30',
      lunchRangeEntry: '13:30–15:15',
      tz: 'America/Toronto',
      tzLabel: 'Montreal',
    },
    timing: {
      asOfIso: '2026-07-15T13:20:00.000Z',
      montrealTime: '09:20:00',
      montrealLabel: 'Montreal',
      deskLocalTime: '09:20:00',
      deskTz: 'America/New_York',
      deskTzLabel: 'NY desk clock',
      instrument: 'DOW',
      market: 'NY',
      playbookMode: 'morning',
      or30: {
        status: 'forming',
        sentence: 'OR30 is FORMING — entry CLOSED until lock at 10:00 Montreal.',
      },
      mid: {
        label: 'IB',
        status: 'not_yet',
        sentence: 'IB not open yet — opens when first-hour IB locks at 10:30 Montreal.',
      },
      late: {
        label: 'Lunch-range',
        status: 'not_yet',
        sentence: 'Lunch-range not open until 13:30 Montreal — do not call lunch open.',
      },
      facts: [
        'Wall clock NOW: 09:20:00 Montreal · desk local 09:20:00 (NY desk clock).',
        'OR30 is FORMING — entry CLOSED until lock at 10:00 Montreal.',
        'IB not open yet — opens when first-hour IB locks at 10:30 Montreal.',
        'Lunch-range not open until 13:30 Montreal — do not call lunch open.',
        'Active playbook mode from clocks: morning.',
      ],
    },
  },
  risk: {
    deskRiskPercent: 2,
    manualRiskPercent: 2,
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
assert(packed.includes('Opening type'), 'packed reminder has Dalton opening type')
assert(packed.includes('Control (Dalton RF + dPOC)'), 'packed reminder has Dalton control')
assert(packed.includes('does not change Open type'), 'packed reminder: control does not relabel Open')
assert(packed.includes('Post-fill MANAGE'), 'packed reminder separates post-fill manage')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('SESSION CLOCK STATUS'), 'Leo knows SESSION CLOCK STATUS ground truth')
assert(LIVE_VOICE_SYSTEM_PROMPT.includes('never invent that OR30 is still open'), 'Leo must not invent OR30 open')
assert(packed.includes('SESSION CLOCK STATUS'), 'packed context has SESSION CLOCK STATUS')
assert(packed.includes('OR30 status=forming'), 'packed OR30 forming from mock timing')
assert(packed.includes('Lunch-range not open until 13:30'), 'packed lunch not-yet sentence')
assert(!packed.includes('99999'), 'no invented price')
assert(!packed.includes('TRADEIFY GROWTH $50k'), 'profile off stays silent')

{
  const nikkei = {
    ...mock,
    voice: { ...mock.voice, instrument: 'NIKKEI', market: 'TOKYO' },
    session: {
      ...mock.session,
      playbookMode: 'us_range',
      playbookTitle: 'US Range playbook',
      rangeStrategy: 'us_range',
      timing: {
        ...mock.session.timing,
        instrument: 'NIKKEI' as const,
        market: 'TOKYO' as const,
        playbookMode: 'us_range',
        deskTz: 'Asia/Tokyo',
        deskTzLabel: 'Tokyo desk clock',
        or30: {
          status: 'finished' as const,
          sentence: 'OR30 entry is CLOSED (finished) — morning ±10 ended.',
        },
        mid: {
          label: 'US Range',
          status: 'open' as const,
          sentence: 'US Range is OPEN — prior NYC H/L.',
        },
        late: {
          label: 'Tokyo IB',
          status: 'not_yet' as const,
          sentence: 'Tokyo IB not open yet — unlocks at first-hour lock.',
        },
        facts: mock.session.timing.facts,
      },
    },
  } as LiveVoiceDeskContext
  const p = formatLiveVoiceContextForLlm(nikkei)
  assert(p.includes('US Range'), 'Nikkei US Range in packed context')
  assert(p.includes('OR30 → US Range'), 'Nikkei desk range chain')
  assert(/Primary bait.*US Range/i.test(p), 'Nikkei primary bait US Range')
  assert(p.includes('US Range status=open'), 'Nikkei packed US Range status')
  assert(p.includes('Tokyo IB status=not_yet'), 'Nikkei packed Tokyo IB not_yet')
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
