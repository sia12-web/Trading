/**
 * Live Voice context — desk-only fields, no invented levels.
 * Run: npx tsx __tests__/live_voice_context.test.ts
 */

import {
  AI_LEVELS_QUERY,
  buildDeskPlaybook,
  mapAiLevels,
} from '../lib/trading/deskLevels'
import {
  AVWAP_LOOKBACK_TRADING_DAYS,
  deskClockFor,
} from '../lib/chart/sessionVwap'
import {
  DESK_RISK_PERCENT,
  MANUAL_RISK_PERCENT,
} from '../lib/trading/positionSizing'
import { MAX_SESSION_ATTEMPTS, MAX_STOP_HITS, sessionFor } from '../lib/trading/sessionGate'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(AI_LEVELS_QUERY.days === 1, 'AI levels query days=1')
assert(AI_LEVELS_QUERY.minConviction === 7, 'min conviction 7')
assert(AVWAP_LOOKBACK_TRADING_DAYS === 5, 'AVWAP lookback 5')
assert(DESK_RISK_PERCENT === 5 && MANUAL_RISK_PERCENT === 1, 'risk percents')
assert(MAX_SESSION_ATTEMPTS === 2 && MAX_STOP_HITS === 2, 'attempt caps')

{
  const ny = deskClockFor('DOW')
  assert(ny.openLabel.includes('9:30') || ny.openLabel.includes('NY'), 'NY open label')
  const tk = deskClockFor('NIKKEI')
  assert(tk.timeZone === 'Asia/Tokyo', 'Tokyo TZ')
  assert(sessionFor('DOW').entryClose.startsWith('10:15'), 'NY entry close')
  assert(sessionFor('NIKKEI').analyzeStart.startsWith('08:45'), 'Tokyo prep')
}

{
  const empty = buildDeskPlaybook(mapAiLevels([]), 'none')
  assert(empty.levels.length === 0, 'empty AI → empty playbook (no invented structure)')
  assert(empty.focusSide === 'BOTH', 'default focus BOTH')
}

{
  const rows = [
    {
      level: 42000,
      type: 'support',
      conviction: 8,
      reasoning: 'Buy liquidity below prior day',
    },
    {
      level: 42500,
      type: 'resistance',
      conviction: 9,
      reasoning: 'Short liquidity above London high',
    },
  ]
  const playbook = buildDeskPlaybook(mapAiLevels(rows), 'bullish')
  assert(playbook.levels.length >= 2, 'mapped AI levels in playbook')
  assert(playbook.primaryBuy?.level === 42000, 'primary buy from support')
  assert(playbook.primaryShort?.level === 42500, 'primary short from resistance')
  for (const l of playbook.levels) {
    assert(l.source === 'ai', 'source stays ai — no hallucinated structure')
    assert(Number.isFinite(l.level) && l.level > 0, 'price from row')
  }
}

console.log('live_voice_context: all passed')
