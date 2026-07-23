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
    window: { start: '09:15', end: '10:15', tz: 'America/New_York', tzLabel: 'ET' },
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
    maxAttempts: 2,
    stopHits: 0,
    maxStopHits: 2,
    openPositionId: null,
    entryWindow: null,
    tradeDate: '2026-07-15',
    times: {
      analyzeStart: '09:00',
      marketOpen: '09:30',
      entryClose: '10:15',
      lunchClose: '11:30',
      marketClose: '16:00',
      tz: 'America/New_York',
      tzLabel: 'ET',
    },
  },
  risk: {
    deskRiskPercent: 5,
    manualRiskPercent: 1,
    maxAttempts: 2,
    maxStopHits: 2,
    entryRule: 'first 45',
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
assert(!packed.includes('99999'), 'no invented price')

console.log('live_voice_prompt: all passed')
