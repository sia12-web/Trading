/**
 * SENTINEL — Live Voice QA + security guards.
 * Run: npx tsx __tests__/sentinel_live_voice.test.ts
 */

import {
  liveVoiceDevBypassEnabled,
  resolveLiveVoiceStatus,
} from '../lib/trading/liveVoice'
import {
  LIVE_VOICE_MAX_AUDIO_BYTES,
  LIVE_VOICE_MAX_TRANSCRIPT_CHARS,
  LIVE_VOICE_REACT_LIMIT,
  LIVE_VOICE_TURN_LIMIT,
  assertReactVerdictMatchesTip,
  checkLiveVoiceRateLimit,
  parseTranscriptDays,
  resetLiveVoiceRateLimits,
  sanitizeLiveVoiceTranscript,
  validateLiveVoiceAudioSize,
} from '../lib/trading/liveVoiceGuards'
import {
  classifyLevelReaction,
  dedupeWatchLevels,
  isTipTaggingLevel,
  tagDistance,
} from '../lib/trading/liveVoiceReactionCore'
import { extractPinsFromTranscript } from '../lib/trading/liveVoiceSession'
import { LIVE_VOICE_SYSTEM_PROMPT } from '../lib/trading/liveVoicePrompt'
import {
  DEFAULT_LIVE_VOICE_MODEL,
  voiceLlmModel,
  voiceLlmProvider,
} from '../lib/trading/liveVoiceTurn'
import { canClockInNow, activeClockMarkets } from '../lib/trading/deskAttendance'
import { isLiveDeskInstrument } from '../lib/trading/sessionGate'

const TESTS_PASSED: string[] = []
const TESTS_FAILED: Array<{ name: string; error: string }> = []

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void) {
  try {
    fn()
    TESTS_PASSED.push(name)
    console.log(`✅ PASS: ${name}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    TESTS_FAILED.push({ name, error: errorMsg })
    console.log(`❌ FAIL: ${name}`)
    console.log(`   ${errorMsg}`)
  }
}

function etDate(h: number, m: number): Date {
  // 2026-07-15 Wed EDT (UTC-4)
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, 0))
}

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

// ── Window / gate unit tests ───────────────────────────────────────────────

test('Status: NY prep open when clocked in', () => {
  withEnv('LIVE_VOICE_DEV_BYPASS', undefined, () => {
    const r = resolveLiveVoiceStatus({
      now: etDate(9, 20),
      instrument: 'DOW',
      clockedIn: true,
    })
    assert(r.enabled && r.micAllowed, 'enabled + mic')
    assert(r.devBypass === false, 'no bypass')
  })
})

test('Status: rejects null/empty instrument → DOW default window', () => {
  withEnv('LIVE_VOICE_DEV_BYPASS', undefined, () => {
    const r = resolveLiveVoiceStatus({
      now: etDate(9, 20),
      instrument: null,
      clockedIn: true,
    })
    assert(r.instrument === 'DOW', 'defaults DOW')
  })
})

test('Status: not_clocked_in keeps inVoiceWindow true', () => {
  withEnv('LIVE_VOICE_DEV_BYPASS', undefined, () => {
    const r = resolveLiveVoiceStatus({
      now: etDate(9, 20),
      instrument: 'NASDAQ',
      clockedIn: false,
    })
    assert(!r.enabled && r.inVoiceWindow && r.disableCode === 'not_clocked_in', 'gate')
  })
})

test('SECURITY: LIVE_VOICE_DEV_BYPASS ignored in production', () => {
  const prevNode = process.env.NODE_ENV
  const prevBypass = process.env.LIVE_VOICE_DEV_BYPASS
  process.env.NODE_ENV = 'production'
  process.env.LIVE_VOICE_DEV_BYPASS = 'true'
  try {
    assert(liveVoiceDevBypassEnabled() === false, 'bypass off in production')
    const sat = new Date(Date.UTC(2026, 6, 18, 13, 30, 0))
    const r = resolveLiveVoiceStatus({
      now: sat,
      instrument: 'DOW',
      clockedIn: true,
    })
    assert(r.enabled === false && r.disableCode === 'weekend', 'weekend closed in prod')
  } finally {
    process.env.NODE_ENV = prevNode
    if (prevBypass === undefined) delete process.env.LIVE_VOICE_DEV_BYPASS
    else process.env.LIVE_VOICE_DEV_BYPASS = prevBypass
  }
})

test('Dev bypass unlocks weekend voice + clock-in when not production', () => {
  const prevNode = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  withEnv('LIVE_VOICE_DEV_BYPASS', 'true', () => {
    assert(liveVoiceDevBypassEnabled() === true, 'bypass on')
    const sat = new Date(Date.UTC(2026, 6, 18, 13, 30, 0))
    const r = resolveLiveVoiceStatus({
      now: sat,
      instrument: 'DOW',
      clockedIn: true,
    })
    assert(r.enabled === true && r.devBypass === true, 'weekend voice open')
    assert(canClockInNow('NY', sat).ok === true, 'clock-in open')
    assert(activeClockMarkets(sat).includes('NY'), 'active markets include NY')
  })
  process.env.NODE_ENV = prevNode
})

// ── Reaction classification edges ──────────────────────────────────────────

test('Reaction: tip boundary uses tagDistance', () => {
  const level = 42150
  const d = tagDistance(level)
  assert(isTipTaggingLevel(level + d, level), 'at distance tags')
  assert(!isTipTaggingLevel(level + d + 0.01, level), 'beyond distance no tag')
})

test('Reaction: zero/negative tip never tags', () => {
  assert(!isTipTaggingLevel(0, 42150), 'zero tip')
  assert(!isTipTaggingLevel(-1, 42150), 'neg tip')
  assert(!isTipTaggingLevel(42150, 0), 'zero level')
})

test('Reaction: still at level after tag → null (no spam)', () => {
  assert(
    classifyLevelReaction({
      tip: 42150,
      level: 42150,
      side: 'BUY',
      wasTagged: true,
    }) === null,
    'still tagging'
  )
})

test('Reaction: unknown side after leave → held', () => {
  assert(
    classifyLevelReaction({
      tip: 43000,
      level: 42150,
      side: null,
      wasTagged: true,
    }) === 'held',
    'null side held'
  )
})

test('SECURITY: forged broke rejected when tip still at level', () => {
  const check = assertReactVerdictMatchesTip({
    tip: 42150,
    level: 42150,
    side: 'BUY',
    verdict: 'broke',
  })
  assert(!check.ok, 'reject forged broke')
})

test('SECURITY: forged tagged rejected when tip far away', () => {
  const check = assertReactVerdictMatchesTip({
    tip: 45000,
    level: 42150,
    side: 'BUY',
    verdict: 'tagged',
  })
  assert(!check.ok, 'reject forged tagged')
})

test('SECURITY: valid tagged accepted at tip', () => {
  const check = assertReactVerdictMatchesTip({
    tip: 42148,
    level: 42150,
    side: 'BUY',
    verdict: 'tagged',
  })
  assert(check.ok, 'accept real tag')
})

test('SECURITY: valid BUY broke accepted below band', () => {
  const check = assertReactVerdictMatchesTip({
    tip: 41800,
    level: 42150,
    side: 'BUY',
    verdict: 'broke',
  })
  assert(check.ok, 'accept broke')
})

test('SECURITY: NaN tip rejected', () => {
  const check = assertReactVerdictMatchesTip({
    tip: Number.NaN,
    level: 42150,
    side: 'BUY',
    verdict: 'tagged',
  })
  assert(!check.ok, 'reject NaN')
})

test('Dedupe: pin wins over AI at same price', () => {
  const d = dedupeWatchLevels([
    { price: 42150.001, source: 'ai' as const },
    { price: 42150.004, source: 'pin' as const }, // both round to 42150.00
  ])
  assert(d.length === 1 && d[0]!.source === 'pin', 'pin preferred')
})

// ── Input sanitization / size ──────────────────────────────────────────────

test('Audio: empty ok; oversize rejected', () => {
  assert(validateLiveVoiceAudioSize(null).ok, 'null ok')
  assert(validateLiveVoiceAudioSize(0).ok, 'zero ok')
  assert(validateLiveVoiceAudioSize(LIVE_VOICE_MAX_AUDIO_BYTES).ok, 'at max ok')
  assert(!validateLiveVoiceAudioSize(LIVE_VOICE_MAX_AUDIO_BYTES + 1).ok, 'over reject')
})

test('Transcript: strips control chars and caps length', () => {
  const dirty = `hello\u0000world${'x'.repeat(2000)}`
  const clean = sanitizeLiveVoiceTranscript(dirty)
  assert(!clean.includes('\u0000'), 'no null bytes')
  assert(clean.length <= LIVE_VOICE_MAX_TRANSCRIPT_CHARS, 'capped')
})

test('Transcript: XSS payload stored as plain text (no HTML execute path)', () => {
  const xss = sanitizeLiveVoiceTranscript(`<script>alert('xss')</script> buy 42150`)
  assert(xss.includes('<script>'), 'kept as text — UI must not dangerouslySetInnerHTML')
  assert(xss.includes('42150'), 'price kept')
})

test('Transcript days: clamp 1..90', () => {
  assert(parseTranscriptDays('0') === 1, 'min 1')
  assert(parseTranscriptDays('999') === 90, 'max 90')
  assert(parseTranscriptDays('abc') === 14, 'default 14')
  assert(parseTranscriptDays('7') === 7, 'valid')
})

test('SQL-ish transcript does not invent pins', () => {
  const pins = extractPinsFromTranscript(`' OR 1=1 -- drop table`, [])
  assert(pins.length === 0, 'no pins from injection string')
})

test('Pins: price below 100 ignored', () => {
  const pins = extractPinsFromTranscript('buy support at 99', [])
  assert(pins.length === 0, 'reject tiny prices')
})

test('Pins: caps at 6 levels', () => {
  const pins = extractPinsFromTranscript(
    'watch 41000 41100 41200 41300 41400 41500 41600 41700 buy',
    []
  )
  assert(pins.length === 6, 'max 6')
})

// ── Rate limiting ──────────────────────────────────────────────────────────

test('Rate limit: allows under cap then blocks', () => {
  resetLiveVoiceRateLimits()
  const key = `test-turn-${Date.now()}`
  for (let i = 0; i < LIVE_VOICE_TURN_LIMIT; i++) {
    assert(checkLiveVoiceRateLimit(key, LIVE_VOICE_TURN_LIMIT, 60_000, 1_000 + i), `allow ${i}`)
  }
  assert(
    !checkLiveVoiceRateLimit(key, LIVE_VOICE_TURN_LIMIT, 60_000, 1_000 + LIVE_VOICE_TURN_LIMIT),
    'block over'
  )
})

test('Rate limit: window expiry re-allows', () => {
  resetLiveVoiceRateLimits()
  const key = 'test-window'
  const windowMs = 1000
  assert(checkLiveVoiceRateLimit(key, 2, windowMs, 100), '1')
  assert(checkLiveVoiceRateLimit(key, 2, windowMs, 200), '2')
  assert(!checkLiveVoiceRateLimit(key, 2, windowMs, 300), 'blocked')
  assert(checkLiveVoiceRateLimit(key, 2, windowMs, 100 + windowMs + 1), 'after window')
})

test('Rate limit: react bucket independent of turn', () => {
  resetLiveVoiceRateLimits()
  assert(LIVE_VOICE_REACT_LIMIT >= 1 && LIVE_VOICE_TURN_LIMIT >= 1, 'limits set')
  assert(checkLiveVoiceRateLimit('turn:u1', 1, 60_000, 1), 'turn ok')
  assert(!checkLiveVoiceRateLimit('turn:u1', 1, 60_000, 2), 'turn blocked')
  assert(checkLiveVoiceRateLimit('react:u1', 1, 60_000, 2), 'react still ok')
})

// ── Prompt / no-order security ─────────────────────────────────────────────

test('Prompt: hard bans on order placement', () => {
  const p = LIVE_VOICE_SYSTEM_PROMPT.toLowerCase()
  assert(p.includes('never place'), 'never place')
  assert(p.includes('never invent'), 'never invent')
  assert(!p.includes('i will place your order'), 'no place-order offer')
})

test('LLM: defaults to Anthropic Sonnet (not Opus/Haiku sim)', () => {
  withEnv('LIVE_VOICE_MODEL', undefined, () => {
    withEnv('LIVE_VOICE_PROVIDER', undefined, () => {
      assert(voiceLlmProvider() === 'anthropic', 'anthropic provider')
      assert(voiceLlmModel() === DEFAULT_LIVE_VOICE_MODEL, 'default model')
      assert(DEFAULT_LIVE_VOICE_MODEL.includes('sonnet'), 'sonnet tier')
      assert(!DEFAULT_LIVE_VOICE_MODEL.includes('opus'), 'not opus')
      assert(!DEFAULT_LIVE_VOICE_MODEL.includes('haiku'), 'not haiku')
    })
  })
})

test('API validation: instruments whitelist', () => {
  assert(isLiveDeskInstrument('DOW'), 'DOW')
  assert(isLiveDeskInstrument('NASDAQ'), 'NASDAQ')
  assert(isLiveDeskInstrument('NIKKEI'), 'NIKKEI')
  assert(!isLiveDeskInstrument('SPX'), 'SPX rejected')
  assert(!isLiveDeskInstrument(''), 'empty rejected')
  assert(!isLiveDeskInstrument(`DOW'; DROP TABLE--`), 'injection rejected')
})

test('API validation: react verdict enum', () => {
  const ok = new Set(['tagged', 'held', 'broke'])
  assert(ok.has('tagged') && ok.has('held') && ok.has('broke'), 'allowed')
  assert(!ok.has('smash') && !ok.has('') && !ok.has('TAGGED'), 'reject bad')
})

// ── Summary ────────────────────────────────────────────────────────────────

console.log('')
console.log(`sentinel_live_voice: ${TESTS_PASSED.length} passed, ${TESTS_FAILED.length} failed`)
if (TESTS_FAILED.length) {
  for (const f of TESTS_FAILED) console.error(`  - ${f.name}: ${f.error}`)
  process.exit(1)
}
console.log('sentinel_live_voice: all passed')
