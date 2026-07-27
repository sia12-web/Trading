/**
 * Desk playbook mode titles / windows (morning → IB → lunch break → lunch-range).
 * Run: npx tsx __tests__/desk_playbook_mode.test.ts
 */

import {
  deskPlaybookAnalysisMode,
  deskPlaybookTitle,
  deskPlaybookUsesAfternoonLevels,
  resolveDeskPlaybookMode,
} from '../lib/trading/deskPlaybookMode'
import { attemptLadderFromCounts } from '../lib/trading/attemptLadder'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

/** Wed 2026-07-15 EDT */
function etDate(h: number, m: number, s = 0): Date {
  return new Date(Date.UTC(2026, 6, 15, h + 4, m, s))
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(9, 45),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'morning open window')
  assert(deskPlaybookTitle(mode) === 'Morning playbook', 'morning title')
  assert(deskPlaybookUsesAfternoonLevels(mode) === false, 'morning uses morning levels')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(10, 30),
    attemptsUsed: 0,
    rangeStrategy: 'ib',
  })
  assert(mode === 'ib', 'IB strategy window')
  assert(deskPlaybookTitle(mode) === 'IB playbook', 'IB title')
  assert(deskPlaybookUsesAfternoonLevels(mode) === true, 'IB paints afternoon merge')
  assert(deskPlaybookAnalysisMode(mode) === 'ib', 'IB analysis mode')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(11, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'lunch_break', 'after IB → lunch break playbook')
  assert(deskPlaybookTitle(mode) === 'Lunch break playbook', 'lunch break title')
  assert(deskPlaybookAnalysisMode(mode) === 'lunch_range', 'lunch break prep uses lunch_range analysis')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    rangeStrategy: 'lunch_range',
  })
  assert(mode === 'lunch_range', 'lunch-range entry')
  assert(deskPlaybookTitle(mode) === 'Lunch-range playbook', 'lunch-range title')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 1 }),
  })
  assert(mode === 'done' || mode === 'lunch_break' || mode === 'lunch_range', 'post-morning framing')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({
      morningAttempts: 2,
      morningStopHits: 2,
    }),
  })
  assert(mode === 'done', 'revenge → session locked (no PM watch)')
  assert(deskPlaybookTitle(mode) === 'Session locked', 'locked title')
}

console.log('desk_playbook_mode: all passed')
