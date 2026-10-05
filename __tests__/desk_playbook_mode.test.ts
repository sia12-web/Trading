/**
 * Desk playbook mode titles / windows.
 * DOW/NASDAQ: Morning Open range → OR30 → IB
 * NIKKEI:     Morning Open range → US Range
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
  assert(mode === 'done', 'passed range ib is not a playbook')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title instead of IB')
  assert(deskPlaybookAnalysisMode(mode) === 'afternoon', 'no IB analysis mode')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(11, 30),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
  })
  assert(mode === 'done', '11:30 is watch, not IB')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title at 11:30')
  assert(deskPlaybookAnalysisMode(mode) === 'afternoon', 'afternoon analysis after OR30')
}

{
  // OR30 probes exhausted after 10:30 → IB (no lunch-break gap on NY)
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(11, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0, ibAttempts: 2 }),
  })
  assert(mode === 'done', 'OR30 exhausted → watch')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title after OR30 exhaust')
  assert(deskPlaybookAnalysisMode(mode) === 'afternoon', 'afternoon analysis after OR30 exhaust')
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    rangeStrategy: 'ib',
  })
  assert(mode === 'done', '14:00 is watch, not IB')
  assert(deskPlaybookTitle(mode) === 'Watch playbook', 'watch title at 14:00')
  assert(
    deskPlaybookTitle(mode, 'NIKKEI') === 'Watch playbook',
    'Nikkei does not use a Tokyo IB title'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'DOW',
    now: etDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 1 }),
  })
  assert(mode === 'done', 'morning fill does not open an IB window')
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
  assert(mode === 'done', 'Nikkei after US Range is watch, not Tokyo IB')
  assert(deskPlaybookTitle(mode, 'NIKKEI') === 'Watch playbook', 'no Tokyo IB title')
  assert(isDeskWatchOnlyPlaybook(mode) === true, 'after US Range is watch-only')
  assert(
    isDeskEntryWindowActive({ playbookMode: mode, rangeStrategy: 'ib' }) === false,
    'IB is not an entry window'
  )
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    rangeStrategy: 'ib',
  })
  assert(mode === 'done', 'Nikkei 14:00 JST is watch')
  assert(
    isDeskEntryWindowActive({
      playbookMode: mode,
      rangeStrategy: 'ib',
      canPlaceEntry: false,
    }) === false,
    'IB is not an entry window'
  )
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'Watch', 'Nikkei watch button')
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
  assert(mode === 'done', 'Nikkei morning fill does not open Tokyo IB')
  assert(deskPlaybookButtonLabel(mode, 'NIKKEI') === 'Watch', 'Nikkei watch button after morning fill')
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
  assert(mode === 'done', `null rangeStrategy at 14:00 → watch got ${mode}`)
}

{
  const mode = resolveDeskPlaybookMode({
    instrument: 'NIKKEI',
    now: jstDate(14, 0),
    ladder: attemptLadderFromCounts({ morningAttempts: 0 }),
    rangeStrategy: null,
  })
  assert(mode === 'done', `Nikkei null rangeStrategy at 14:00 → watch got ${mode}`)
}

console.log('desk_playbook_mode: all passed (NY + Nikkei)')
