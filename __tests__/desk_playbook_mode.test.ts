/**
 * Desk playbook mode titles / windows (morning → IB → lunch break → lunch-range).
 * Covers NY (DOW/NASDAQ) and Tokyo (NIKKEI) with the same ladder.
 * Run: npx tsx __tests__/desk_playbook_mode.test.ts
 */

import {
  deskPlaybookAnalysisMode,
  deskPlaybookButtonLabel,
  deskPlaybookPanelTitle,
  deskPlaybookTitle,
  deskPlaybookToolbarLabel,
  deskPlaybookUsesAfternoonLevels,
  isDeskEntryWindowActive,
  isDeskWatchOnlyPlaybook,
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

/** Wed 2026-07-15 JST (UTC+9) */
function jstDate(h: number, m: number, s = 0): Date {
  return new Date(Date.UTC(2026, 6, 15, h - 9, m, s))
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
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title when done')
  assert(deskPlaybookButtonLabel(mode) === 'Watch', 'Watch button when done')
  assert(deskPlaybookToolbarLabel(mode, { watchOnly: true }) === 'Watch', 'toolbar Watch')
  assert(
    deskPlaybookPanelTitle(mode, 'DOW', { watchOnly: true }) === 'Watch playbook',
    'NY watch panel'
  )
}

// ── Nikkei (Tokyo JST) — same ladder, local clocks ───────────────────────────
{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(9, 20),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'Nikkei morning 09:20 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, canPlaceEntry: true }) === true,
    'Nikkei morning entry active'
  )
}

{
  // After Tokyo morning entryClose 09:45, before IB 10:15 — not an entry window
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(10, 0),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'Nikkei gap still morning framing')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, canPlaceEntry: false }) === false,
    'Nikkei post-entryClose gap is not entry'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(10, 30),
    attemptsUsed: 0,
    rangeStrategy: 'ib',
  })
  assert(mode === 'ib', 'Nikkei IB 10:30 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'ib' }) === true,
    'Nikkei IB is entry'
  )
  assert(isDeskWatchOnlyPlaybook(mode) === false, 'IB not watch-only')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(12, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'lunch_break', 'Nikkei lunch break after IB')
  assert(isDeskWatchOnlyPlaybook(mode) === true, 'lunch break is watch-only framing')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode }) === false,
    'Nikkei lunch break not entry'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    rangeStrategy: 'lunch_range',
  })
  assert(mode === 'lunch_range', 'Nikkei lunch-range 14:00 JST')
  assert(
    isDeskEntryWindowActive({
      playbookMode: mode,
      rangeStrategy: 'lunch_range',
      canPlaceEntry: false,
    }) === true,
    'Nikkei lunch-range stays entry even if clocked out'
  )
  assert(deskPlaybookButtonLabel(mode) === 'Lunch-range', 'Nikkei lunch-range button')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    ladder: attemptLadderFromCounts({
      morningAttempts: 2,
      morningStopHits: 2,
    }),
  })
  assert(mode === 'done', 'Nikkei revenge → done')
  assert(deskPlaybookButtonLabel(mode) === 'Watch', 'Nikkei Watch button')
  assert(
    deskPlaybookPanelTitle(mode, 'NIKKEI', { watchOnly: true }) === 'Tokyo watch playbook',
    'Tokyo watch panel title'
  )
}

console.log('desk_playbook_mode: all passed (NY + Nikkei)')
