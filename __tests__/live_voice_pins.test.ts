/**
 * Pin extraction from spoken levels.
 * Run: npx tsx __tests__/live_voice_pins.test.ts
 */

import { extractPinsFromTranscript } from '../lib/trading/liveVoiceSession'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const pins = extractPinsFromTranscript(
    'I am watching 42,150 as buy liquidity under yesterday',
    [{ price: 42150, side: 'BUY' }]
  )
  assert(pins.length === 1, 'one pin')
  assert(pins[0]!.price === 42150, 'snaps to AI level')
  assert(pins[0]!.side === 'BUY', 'side from AI / speech')
}

{
  const pins = extractPinsFromTranscript('Short 44800 if we reject', [])
  assert(pins.length === 1, 'manual pin without AI')
  assert(pins[0]!.price === 44800, 'price parsed')
  assert(pins[0]!.side === 'SHORT', 'short from speech')
}

{
  const pins = extractPinsFromTranscript('good morning coach', [])
  assert(pins.length === 0, 'no phantom pins')
}

{
  const pins = extractPinsFromTranscript('', [])
  assert(pins.length === 0, 'empty transcript')
}

{
  const pins = extractPinsFromTranscript(
    'Looking at 42100 near AI',
    [{ price: 42150, side: 'BUY' }]
  )
  // 42100 within 0.25% of 42150? |50|/42150 ≈ 0.00118 → snap
  assert(pins.length === 1, 'near AI snaps')
  assert(pins[0]!.price === 42150, 'snapped price')
}

{
  const pins = extractPinsFromTranscript('<img src=x onerror=alert(1)> 44800 short', [])
  assert(pins.length === 1 && pins[0]!.price === 44800, 'xss string still parses price only')
  assert(pins[0]!.side === 'SHORT', 'side from short')
}

console.log('live_voice_pins: all passed')
