/**
 * Afternoon desk brief — IB / morning volume / reactions from existing tools.
 * Run: npx tsx __tests__/afternoon_desk_brief.test.ts
 */

import {
  buildAfternoonDeskBrief,
  formatAfternoonDeskBriefForPrompt,
} from '../lib/trading/afternoonDeskBrief'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** 9:30 ET Jul 15 2026 */
const OPEN = Math.floor(Date.UTC(2026, 6, 15, 9 + 4, 30, 0) / 1000)
const TIP_TIME = OPEN + 4 * 3600 // ~afternoon

const bars = []
for (let i = 0; i < 180; i++) {
  const t = OPEN + i * 60
  bars.push({
    time: t,
    open: 52000,
    high: i === 20 ? 52150 : 52020,
    low: i === 35 ? 51900 : 51980,
    close: 52010,
    volume: i < 60 ? 200 : 50,
  })
}

const brief = buildAfternoonDeskBrief({
  instrument: 'DOW',
  candlesH1: bars,
  tip: 52180,
  nowUnix: TIP_TIME,
  afternoonCandidates: [
    { level: 52150, play: 'FLIP', candidate_type: 'resistance', note: 'broke AM' },
    { level: 51900, play: 'RETEST', candidate_type: 'support' },
  ],
})

assert(brief != null, 'brief built')
assert(brief!.ib != null, 'IB shaped')
assert(brief!.ibState === 'above', `ibState ${brief!.ibState}`)
assert(brief!.morning != null && brief!.morning.volume > 0, 'morning volume')
assert(brief!.reactions.length === 2, 'reactions')
assert(brief!.reactions[0]!.play === 'FLIP', 'FLIP')

const text = formatAfternoonDeskBriefForPrompt(brief!)
assert(/Initial Balance/i.test(text), 'IB in prompt')
assert(/Morning session/i.test(text), 'morning range in prompt')
assert(/FLIP/i.test(text), 'FLIP in prompt')
assert(/Pro afternoon checklist/i.test(text), 'checklist')
assert(/Yahoo H1/i.test(text), 'tools disclaimer')

console.log('afternoon_desk_brief: all passed')
