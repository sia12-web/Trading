/**
 * Live Voice window: prep → entry close, clock-in required.
 * Run: npx tsx __tests__/live_voice_status.test.ts
 */

import { resolveLiveVoiceStatus } from '../lib/trading/liveVoice'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** Wed 2026-07-15 — known weekday */
function etDate(h: number, m: number, s = 0): Date {
  // Construct via UTC so America/New_York civil time is stable in tests
  // 2026-07-15 is EDT (UTC-4)
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, s))
}

function jstDate(h: number, m: number, s = 0): Date {
  // JST = UTC+9
  return new Date(Date.UTC(2026, 6, 15, h - 9, m, s))
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(9, 10),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === false, 'before NY prep disabled')
  assert(r.disableCode === 'before_prep', 'before_prep code')
  assert(r.micAllowed === false, 'no mic before prep')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(9, 15),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === true, 'NY 9:15 clocked in enabled')
  assert(r.inVoiceWindow === true, 'in window')
  assert(r.window.start === '09:15' && r.window.end === '15:15', 'NY window through lunch-range end')
  assert(r.micAllowed === true, 'mic allowed when voice enabled')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(9, 45),
    instrument: 'NASDAQ',
    clockedIn: false,
  })
  assert(r.enabled === false, 'in window but not clocked in')
  assert(r.inVoiceWindow === true, 'window open')
  assert(r.disableCode === 'not_clocked_in', 'not_clocked_in')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(10, 30),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === true, 'IB window still in voice')
  assert(r.inVoiceWindow === true, 'IB inside voice window')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(14, 0),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === true, 'lunch-range still in voice')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(15, 15),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === false, 'at lunch-range end disabled')
  assert(r.disableCode === 'after_entry', 'after_entry')
}

{
  const r = resolveLiveVoiceStatus({
    now: etDate(16, 0),
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === false, 'after lunch-range still off')
}

{
  const r = resolveLiveVoiceStatus({
    now: jstDate(8, 45),
    instrument: 'NIKKEI',
    clockedIn: true,
  })
  assert(r.enabled === true, 'Tokyo prep start enabled')
  assert(r.window.start === '19:45' && r.window.end === '02:00', 'Tokyo window in Montreal ET')
  assert(r.window.tzLabel === 'ET', 'Leo shows ET')
  assert(r.market === 'TOKYO', 'TOKYO market')
}

{
  const r = resolveLiveVoiceStatus({
    now: jstDate(14, 0),
    instrument: 'NIKKEI',
    clockedIn: true,
  })
  assert(r.enabled === true, 'Tokyo lunch-range still in voice')
}

{
  const r = resolveLiveVoiceStatus({
    now: jstDate(15, 0),
    instrument: 'NIKKEI',
    clockedIn: true,
  })
  assert(r.enabled === false, 'Tokyo lunch-range end disabled')
}

{
  // Saturday 2026-07-18
  const sat = new Date(Date.UTC(2026, 6, 18, 13, 30, 0)) // ~9:30 ET
  const r = resolveLiveVoiceStatus({
    now: sat,
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === false, 'weekend off')
  assert(r.disableCode === 'weekend', 'weekend code')
  assert(r.devBypass === false, 'bypass off by default')
}

{
  const prevNode = process.env.NODE_ENV
  const prev = process.env.LIVE_VOICE_DEV_BYPASS
  ;(process.env as any).NODE_ENV = 'development'
  process.env.LIVE_VOICE_DEV_BYPASS = 'true'
  const sat = new Date(Date.UTC(2026, 6, 18, 13, 30, 0))
  const r = resolveLiveVoiceStatus({
    now: sat,
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(r.enabled === true, 'bypass opens weekend')
  assert(r.devBypass === true, 'devBypass flag')
  ;(process.env as any).NODE_ENV = 'production'
  const rProd = resolveLiveVoiceStatus({
    now: sat,
    instrument: 'DOW',
    clockedIn: true,
  })
  assert(rProd.enabled === false, 'production ignores bypass')
  ;(process.env as any).NODE_ENV = prevNode
  if (prev === undefined) delete process.env.LIVE_VOICE_DEV_BYPASS
  else process.env.LIVE_VOICE_DEV_BYPASS = prev
}

console.log('live_voice_status: all passed')
