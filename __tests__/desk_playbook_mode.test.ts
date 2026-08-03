/**
 * Desk playbook mode titles / windows.
 * DOW/NASDAQ: Morning OR30 → IB → lunch break → lunch-range
 * NIKKEI:     Morning OR30 → US Range → IB prep → IB
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
  assert(deskPlaybookTitle(mode) === 'Morning playbook (OR30)', 'morning title')
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
  assert(
    deskPlaybookAnalysisMode(mode, 'NIKKEI') === 'ib',
    'Tokyo lunch_break framing uses IB analysis'
  )
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
  assert(mode === 'lunch_range', 'morning fill does not lock lunch-range (Option B)')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({
      morningAttempts: 2,
      ibAttempts: 2,
      lunchAttempts: 2,
    }),
  })
  assert(mode === 'done', 'day probes exhausted → watch / manage-only')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title when done')
  assert(deskPlaybookButtonLabel(mode) === 'Watch', 'Watch button when done')
  assert(deskPlaybookToolbarLabel(mode, { watchOnly: true }) === 'Watch', 'toolbar Watch')
  assert(
    deskPlaybookPanelTitle(mode, 'DOW', { watchOnly: true }) === 'Watch playbook',
    'NY watch panel'
  )
}

// ── Nikkei (Tokyo JST) — OR30 → US Range → IB ────────────────────────────────
{
  // Tokyo cash open — US Range entry (prior NYC already shaped); not OR30-blocked
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(9, 20),
    attemptsUsed: 0,
    rangeStrategy: 'us_range',
  })
  assert(mode === 'us_range', 'Nikkei US Range 09:20 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'us_range' }) === true,
    'Nikkei US Range entry active at open'
  )
}

{
  // Optional OR30 morning slice 09:30–09:45
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(9, 35),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'Nikkei morning OR30 09:35 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, canPlaceEntry: true }) === true,
    'Nikkei morning entry active'
  )
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'Morning playbook (OR30)', 'Nikkei OR30 title')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(10, 30),
    attemptsUsed: 0,
    rangeStrategy: 'us_range',
  })
  assert(mode === 'us_range', 'Nikkei US Range 10:30 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'us_range' }) === true,
    'Nikkei US Range is entry'
  )
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'US Range playbook', 'US Range title')
  assert(deskPlaybookAnalysisMode(mode) === 'us_range', 'US Range analysis mode')
  assert(isDeskWatchOnlyPlaybook(mode) === false, 'US Range not watch-only')
}

{
  // After US Range end, Tokyo IB is the live playbook (no long IB-prep gap to 13:30)
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(12, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'ib', 'Nikkei IB playbook after US Range (from first-hour lock)')
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'IB playbook', 'IB title after US')
  assert(isDeskWatchOnlyPlaybook(mode) === false, 'Tokyo IB is entry after lock')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'ib' }) === true,
    'Nikkei IB is entry'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    rangeStrategy: 'ib',
  })
  assert(mode === 'ib', 'Nikkei IB 14:00 JST (slot 3)')
  assert(
    isDeskEntryWindowActive({
      playbookMode: mode,
      rangeStrategy: 'ib',
      canPlaceEntry: false,
    }) === true,
    'Nikkei IB stays entry even if clocked out'
  )
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'IB playbook', 'Nikkei IB button')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    ladder: attemptLadderFromCounts({
      morningAttempts: 1,
      morningStopHits: 1,
    }),
  })
  assert(mode === 'ib', 'Nikkei morning fill does not lock Tokyo IB (Option B)')
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'IB playbook', 'Nikkei IB button after morning fill')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    ladder: attemptLadderFromCounts({
      morningAttempts: 2,
      ibAttempts: 2,
      lunchAttempts: 2,
    }),
  })
  assert(mode === 'done', 'Nikkei day probes exhausted → watch')
  assert(deskPlaybookButtonLabel(mode) === 'Watch', 'Nikkei Watch button')
  assert(
    deskPlaybookPanelTitle(mode, 'NIKKEI', { watchOnly: true }) === 'Tokyo watch playbook',
    'Tokyo watch panel title'
  )
}

{
  // Explicit null rangeStrategy must still resolve from clock (SessionBanner passes null when clocked out)
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
    rangeStrategy: null,
  })
  assert(mode === 'lunch_range', `null rangeStrategy at 14:00 → lunch_range got ${mode}`)
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
    rangeStrategy: null,
  })
  assert(mode === 'ib', `Nikkei null rangeStrategy at 14:00 → ib got ${mode}`)
}

console.log('desk_playbook_mode: all passed (NY + Nikkei)')
