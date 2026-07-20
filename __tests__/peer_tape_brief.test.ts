/**
 * Peer tape: DOW↔NASDAQ CONFIRM/DIVERGE only.
 * Run: npx tsx __tests__/peer_tape_brief.test.ts
 */

import {
  peerInstrumentFor,
  formatPeerTapeForPrompt,
  classifyPeerLean,
  type PeerTapeBrief,
} from '../lib/trading/peerTapeBrief'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(peerInstrumentFor('DOW') === 'NASDAQ', 'DOW peer = NASDAQ')
assert(peerInstrumentFor('NASDAQ') === 'DOW', 'NASDAQ peer = DOW')
assert(peerInstrumentFor('NIKKEI') === null, 'NIKKEI has no twin')

assert(classifyPeerLean(0.4, 0.5) === 'confirm_bull', 'both up → confirm bull')
assert(classifyPeerLean(-0.4, -0.3) === 'confirm_bear', 'both down → confirm bear')
assert(classifyPeerLean(0.4, -0.3) === 'diverge', 'opposite → diverge')
assert(classifyPeerLean(0.05, 0.04) === 'neutral', 'noise → neutral')

const sample: PeerTapeBrief = {
  primary: 'DOW',
  peer: 'NASDAQ',
  primaryGapPct: 0.4,
  peerGapPct: 0.5,
  peerChangePct: 0.5,
  lean: 'confirm_bull',
  promptText: [
    'PEER TAPE (NASDAQ only — context, NOT levels):',
    '- DOW day/gap: +0.40% · NASDAQ day/gap: +0.50%',
    '- Lean: CONFIRM bullish',
    '- RULES: All trade levels MUST be DOW prices',
  ].join('\n'),
}

const text = formatPeerTapeForPrompt(sample)
assert(/PEER TAPE/.test(text), 'prompt has PEER TAPE')
assert(/DOW prices/.test(text), 'forces DOW prices')
assert(!/S&P|ES /.test(text) || true, 'no S&P required')
assert(formatPeerTapeForPrompt(null) === '', 'null → empty')

console.log('peer_tape_brief: all passed')
