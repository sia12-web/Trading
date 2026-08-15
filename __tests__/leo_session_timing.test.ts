/**
 * Leo session timing — fresh wall-clock OR30 / IB / lunch status.
 * Run: npx tsx __tests__/leo_session_timing.test.ts
 */

import {
  buildLeoSessionTiming,
  formatLeoSessionTimingForPrompt,
} from '../lib/trading/leoSessionTiming'
import { formatLiveVoiceContextForLlm } from '../lib/trading/liveVoicePrompt'
import type { LiveVoiceDeskContext } from '../lib/trading/liveVoiceContext'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** America/New_York July = EDT (UTC-4) */
function etDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 4, min, 0))
}

/** Asia/Tokyo = UTC+9 */
function jstDate(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, 0))
}

const Y = 2026
const M = 7
const D = 15

// ── NASDAQ / DOW mid-morning (11:00 ET): OR30 done, IB open, lunch not yet ──
{
  const now = etDate(Y, M, D, 11, 0)
  for (const inst of ['NASDAQ', 'DOW'] as const) {
    const t = buildLeoSessionTiming({ instrument: inst, now })
    assert(t.or30.status === 'finished', `${inst} 11:00 OR30 finished`)
    assert(/OR30 entry is CLOSED/i.test(t.or30.sentence), `${inst} OR30 CLOSED sentence`)
    assert(t.mid.label === 'IB', `${inst} mid label IB`)
    assert(t.mid.status === 'open', `${inst} 11:00 IB open`)
    assert(/IB is OPEN until lunch/i.test(t.mid.sentence), `${inst} IB open sentence`)
    assert(t.late.label === 'Lunch-range', `${inst} late label lunch`)
    assert(t.late.status === 'not_yet', `${inst} 11:00 lunch not yet`)
    assert(
      /Lunch-range not open until/i.test(t.late.sentence),
      `${inst} lunch not-open sentence`
    )
    assert(t.montrealTime.length >= 8, `${inst} montreal wall clock`)
    assert(t.deskLocalTime.startsWith('11:00'), `${inst} desk local 11:00`)
    const packed = formatLeoSessionTimingForPrompt(t)
    assert(packed.includes('SESSION CLOCK STATUS'), 'prompt header')
    assert(packed.includes('OR30 status=finished'), `${inst} packed OR30 finished`)
    assert(packed.includes('Lunch-range status=not_yet'), `${inst} packed lunch not_yet`)
  }
}

// ── After OR30 entry close, before IB (10:20 ET) ──
{
  const now = etDate(Y, M, D, 10, 20)
  const t = buildLeoSessionTiming({ instrument: 'NASDAQ', now })
  assert(t.or30.status === 'finished', '10:20 OR30 finished')
  assert(t.mid.status === 'not_yet', '10:20 IB not yet (locks 10:30)')
  assert(t.late.status === 'not_yet', '10:20 lunch not yet')
}

// ── OR30 locked window (10:05 ET) ──
{
  const now = etDate(Y, M, D, 10, 5)
  const t = buildLeoSessionTiming({ instrument: 'NASDAQ', now })
  assert(t.or30.status === 'locked', '10:05 OR30 locked')
  assert(/OR30 is LOCKED/i.test(t.or30.sentence), 'OR30 locked sentence')
  assert(t.mid.status === 'not_yet', '10:05 IB not yet')
  assert(t.late.status === 'not_yet', '10:05 lunch not yet')
}

// ── OR30 forming (09:45 ET) ──
{
  const now = etDate(Y, M, D, 9, 45)
  const t = buildLeoSessionTiming({ instrument: 'DOW', now })
  assert(t.or30.status === 'forming', '09:45 OR30 forming')
  assert(/FORMING/i.test(t.or30.sentence), 'forming sentence')
  assert(t.mid.status === 'not_yet', '09:45 IB not yet')
  assert(t.late.status === 'not_yet', '09:45 lunch not yet')
}

// ── After lunch opens (13:30 ET) ──
{
  const now = etDate(Y, M, D, 13, 30)
  const t = buildLeoSessionTiming({ instrument: 'NASDAQ', now })
  assert(t.or30.status === 'finished', '13:30 OR30 finished')
  assert(t.mid.status === 'closed', '13:30 IB closed')
  assert(t.late.status === 'open', '13:30 lunch open')
  assert(/Lunch-range is OPEN/i.test(t.late.sentence), 'lunch open sentence')
}

// ── Before lunch, IB still open (13:00 ET) ──
{
  const now = etDate(Y, M, D, 13, 0)
  const t = buildLeoSessionTiming({ instrument: 'DOW', now })
  assert(t.or30.status === 'finished', '13:00 OR30 finished')
  assert(t.mid.status === 'open', '13:00 IB still open')
  assert(t.late.status === 'not_yet', '13:00 lunch not yet')
  assert(
    /Lunch-range not open until 13:30/i.test(t.late.sentence),
    '13:00 lunch not until 13:30 Montreal'
  )
}

// ── NIKKEI: during optional OR30 (09:35 JST) — US Range clock open, Tokyo IB not yet ──
{
  const now = jstDate(Y, M, D, 9, 35)
  const t = buildLeoSessionTiming({ instrument: 'NIKKEI', now })
  assert(t.or30.status === 'locked', 'Nikkei 09:35 OR30 locked')
  assert(t.mid.label === 'US Range', 'Nikkei mid = US Range')
  assert(t.mid.status === 'open', 'Nikkei US Range open at 09:35')
  assert(t.late.label === 'Tokyo IB', 'Nikkei late = Tokyo IB')
  assert(t.late.status === 'not_yet', 'Nikkei Tokyo IB not yet at 09:35')
}

// ── NIKKEI: after OR30 finished, US Range still open (09:50 JST) ──
{
  const now = jstDate(Y, M, D, 9, 50)
  const t = buildLeoSessionTiming({ instrument: 'NIKKEI', now })
  assert(t.or30.status === 'finished', 'Nikkei 09:50 OR30 finished')
  assert(/OR30 entry is CLOSED/i.test(t.or30.sentence), 'Nikkei OR30 CLOSED')
  assert(t.mid.status === 'open', 'Nikkei US Range still open 09:50')
  assert(t.late.status === 'not_yet', 'Nikkei Tokyo IB not yet 09:50')
}

// ── NIKKEI: Tokyo IB open (10:05 JST = ~21:05 Montreal) ──
{
  const now = jstDate(Y, M, D, 10, 5)
  const t = buildLeoSessionTiming({ instrument: 'NIKKEI', now })
  assert(t.or30.status === 'finished', 'Nikkei 10:05 OR30 finished')
  assert(t.mid.status === 'open', 'Nikkei US Range still open until 10:45')
  assert(t.late.status === 'open', 'Nikkei Tokyo IB open at 10:05')
  assert(/Tokyo IB is OPEN/i.test(t.late.sentence), 'Tokyo IB open sentence')
}

// ── Prompt pack includes SESSION CLOCK STATUS when timing present ──
{
  const now = etDate(Y, M, D, 11, 0)
  const timing = buildLeoSessionTiming({ instrument: 'NASDAQ', now })
  const mock = {
    voice: {
      enabled: true,
      micAllowed: true,
      clockedIn: true,
      inVoiceWindow: true,
      devBypass: false,
      instrument: 'NASDAQ',
      market: 'NY',
      reason: null,
      disableCode: null,
      window: { start: '09:15', end: '15:15', tz: 'America/Toronto', tzLabel: 'Montreal' },
      localTime: timing.montrealTime,
      tradeDate: '2026-07-15',
    },
    session: {
      phase: 'ENTRY',
      message: 'IB playbook',
      lockedInstrument: 'NASDAQ',
      viewingInstrument: 'NASDAQ',
      canPlaceEntry: true,
      canManagePosition: false,
      attemptsUsed: 0,
      maxAttempts: 3,
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
      attemptLadderLabel: 'Session 0/3',
      openPositionId: null,
      entryWindow: 2,
      rangeStrategy: 'ib',
      playbookMode: 'ib',
      playbookTitle: 'IB playbook',
      tradeDate: '2026-07-15',
      times: {
        analyzeStart: '09:15',
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
      deskRiskPercent: 2,
      manualRiskPercent: 2,
      maxAttempts: 3,
      maxStopHits: 2,
      entryRule: 'cap 3',
    },
    avwap: {
      openLabel: 'NY 9:30',
      lookbackTradingDays: 5,
      timeZone: 'America/New_York',
      cashOpenHour: 9.5,
      bandNote: 'NY 9:30',
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
    market: { livePrice: 18000 },
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

  const packed = formatLiveVoiceContextForLlm(mock)
  assert(packed.includes('SESSION CLOCK STATUS'), 'LLM pack has clock status')
  assert(packed.includes('OR30 status=finished'), 'LLM pack OR30 finished')
  assert(packed.includes('IB status=open'), 'LLM pack IB open')
  assert(packed.includes('Lunch-range status=not_yet'), 'LLM pack lunch not_yet')
  assert(packed.includes('OR30 entry is CLOSED'), 'LLM pack OR30 CLOSED sentence')
}

console.log('leo_session_timing: all passed')
