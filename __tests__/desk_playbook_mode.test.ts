/**
 * Desk playbook mode titles / windows.
 * DOW/NASDAQ: Morning Open range → OR30 → IB
 * NIKKEI:     Morning Open range → US Range → IB prep → Tokyo IB
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
    now: etDate(9, 50),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'morning Open-range window')
  assert(deskPlaybookTitle(mode) === 'Morning playbook (Open range)', 'morning title')
  assert(deskPlaybookUsesAfternoonLevels(mode) === false, 'morning uses morning levels')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(10, 10),
    attemptsUsed: 0,
    rangeStrategy: 'or30',
  })
  assert(mode === 'or30', 'OR30 strategy window')
  assert(deskPlaybookTitle(mode) === 'OR30 playbook', 'OR30 title')
  assert(deskPlaybookUsesAfternoonLevels(mode) === true, 'OR30 paints afternoon merge')
  assert(deskPlaybookAnalysisMode(mode) === 'or30', 'OR30 analysis mode')
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
    now: etDate(11, 30),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'ib', '11:30 still IB')
  assert(deskPlaybookTitle(mode) === 'IB playbook', 'IB title at 11:30')
  assert(deskPlaybookAnalysisMode(mode) === 'ib', 'IB analysis while IB window open')
}

{
  // OR30 probes exhausted after 10:30 → IB (no lunch-break gap on NY)
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(11, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0, ibAttempts: 2 }),
  })
  assert(mode === 'ib', 'OR30 exhausted → IB')
  assert(deskPlaybookTitle(mode) === 'IB playbook', 'IB title after OR30 exhaust')
  assert(deskPlaybookAnalysisMode(mode) === 'ib', 'IB analysis after OR30 exhaust')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    rangeStrategy: 'ib',
  })
  assert(mode === 'ib', 'IB entry at 14:00')
  assert(deskPlaybookTitle(mode) === 'IB playbook', 'IB title at 14:00')
  assert(
    deskPlaybookTitle(mode, 'NIKKEI') === 'Tokyo IB playbook',
    'Nikkei IB framing uses Tokyo IB title'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 1 }),
  })
  assert(mode === 'ib', 'morning fill does not lock IB (Option B)')
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

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(9, 20),
    attemptsUsed: 0,
  })
  assert(mode === 'morning', 'Nikkei morning Open range 09:20 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, canPlaceEntry: true }) === true,
    'Nikkei morning entry active'
  )
  assert(
    deskPlaybookTitle(mode, 'NIKKEI') === 'Morning playbook (Open range)',
    'Nikkei Open-range title'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(9, 40),
    attemptsUsed: 0,
    rangeStrategy: 'us_range',
  })
  assert(mode === 'us_range', 'Nikkei US Range 09:40 JST')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'us_range' }) === true,
    'Nikkei US Range is entry'
  )
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'US Range playbook', 'US Range title')
  assert(deskPlaybookAnalysisMode(mode) === 'us_range', 'US Range analysis mode')
  assert(isDeskWatchOnlyPlaybook(mode) === false, 'US Range not watch-only')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(12, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'ib', 'Nikkei IB playbook after US Range (from first-hour lock)')
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'Tokyo IB playbook', 'Tokyo IB title after US')
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
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'Tokyo IB', 'Nikkei IB button')
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
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'Tokyo IB', 'Nikkei IB button after morning fill')
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
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
    rangeStrategy: null,
  })
  assert(mode === 'ib', `null rangeStrategy at 14:00 → ib got ${mode}`)
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
