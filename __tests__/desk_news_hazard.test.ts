/**
 * Desk news hazard classification tests.
 * Run: npx tsx __tests__/desk_news_hazard.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildDeskNewsHazards,
  classifyNewsHazardLevel,
  formatDayNewsDigest,
  formatMontrealHms,
  isHighImpact,
  parseCalendarEventMs,
  pickBannerHazard,
  NEWS_CAREFUL_MS,
  NEWS_STAND_ASIDE_MS,
} from '../lib/trading/deskNewsHazard'
import { instrumentsForCalendarEvent } from '../lib/trading/deskNews'
import type { DeskCalendarEvent } from '../lib/trading/deskNews'

{
  assert.equal(isHighImpact('high'), true)
  assert.equal(isHighImpact('High Impact'), true)
  assert.equal(isHighImpact('HIGH'), true)
  assert.equal(isHighImpact('3'), true)
  assert.equal(isHighImpact('red'), true)
  assert.equal(isHighImpact('medium'), false)
  assert.equal(isHighImpact('low'), false)
  assert.equal(isHighImpact('13'), false, 'must not match digit 3 inside other numbers')
  assert.equal(isHighImpact(''), false)
}

{
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)
  const ms = parseCalendarEventMs('2026-07-29 12:30:00', now)
  assert.equal(ms, Date.UTC(2026, 6, 29, 12, 30, 0), 'UTC calendar parse')
  assert.equal(parseCalendarEventMs('2026-07-29T12:30:00', now), Date.UTC(2026, 6, 29, 12, 30, 0))
  assert.equal(parseCalendarEventMs('not-a-time', now), null)
  assert.equal(parseCalendarEventMs('', now), null)
  assert.equal(parseCalendarEventMs(String(Math.floor(now / 1000)), now), now, 'unix sec string')
}

{
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)
  assert.equal(classifyNewsHazardLevel(now + 5 * 60 * 1000, now), 'stand_aside')
  assert.equal(classifyNewsHazardLevel(now - 5 * 60 * 1000, now), 'stand_aside')
  assert.equal(classifyNewsHazardLevel(now, now), 'stand_aside', 'exact print = stand aside')
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_STAND_ASIDE_MS, now),
    'stand_aside',
    'boundary ±15m inclusive'
  )
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_STAND_ASIDE_MS + 60_000, now),
    'careful'
  )
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_CAREFUL_MS, now),
    'careful',
    'boundary 60m inclusive'
  )
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_CAREFUL_MS + 60_000, now),
    'none'
  )
  assert.equal(
    classifyNewsHazardLevel(now - NEWS_STAND_ASIDE_MS - 60_000, now),
    'none',
    'past print outside ±15m clears'
  )
  assert.equal(classifyNewsHazardLevel(null, now), 'none')
}

{
  assert.deepEqual(instrumentsForCalendarEvent('US', 'CPI'), [
    'DOW',
    'NASDAQ',
    'NIKKEI',
  ])
  assert.deepEqual(instrumentsForCalendarEvent('JP', 'BoJ Rate Decision'), ['NIKKEI'])
}

{
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)
  const cal: DeskCalendarEvent[] = [
    {
      id: 'cpi',
      time: '2026-07-29 12:45:00',
      country: 'US',
      event: 'CPI',
      impact: 'high',
      instruments: ['DOW', 'NASDAQ', 'NIKKEI'],
      deskNote: 'x',
    },
    {
      id: 'low',
      time: '2026-07-29 13:00:00',
      country: 'US',
      event: 'Speeches',
      impact: 'low',
      instruments: ['DOW', 'NASDAQ'],
      deskNote: 'x',
    },
    {
      id: 'boj',
      time: '2026-07-29 18:00:00',
      country: 'JP',
      event: 'BoJ Rate Decision',
      impact: 'high',
      instruments: ['NIKKEI'],
      deskNote: 'x',
    },
    {
      id: 'notime',
      time: 'TBD',
      country: 'US',
      event: 'Mystery Print',
      impact: 'high',
      instruments: ['DOW', 'NASDAQ', 'NIKKEI'],
      deskNote: 'x',
    },
  ]

  const ndx = buildDeskNewsHazards({
    calendar: cal,
    instrument: 'NASDAQ',
    nowMs: now,
    includeUpcomingDay: true,
  })
  assert.ok(ndx.some((h) => h.event === 'CPI'), 'NASDAQ sees US CPI')
  assert.ok(!ndx.some((h) => h.event === 'Speeches'), 'skip low impact')
  assert.equal(ndx.find((h) => h.event === 'CPI')?.level, 'careful')
  assert.ok(
    ndx.some((h) => h.event === 'Mystery Print' && h.level === 'none' && h.atMs == null),
    'unparseable high still in digest'
  )

  const nik = buildDeskNewsHazards({
    calendar: cal,
    instrument: 'NIKKEI',
    nowMs: now,
    includeUpcomingDay: true,
  })
  assert.ok(nik.some((h) => h.event === 'CPI'), 'Nikkei sees US CPI')
  assert.ok(nik.some((h) => h.event === 'BoJ Rate Decision'), 'Nikkei sees BoJ')
  assert.ok(!nik.some((h) => h.event === 'Speeches'))

  const banner = pickBannerHazard(ndx)
  assert.ok(banner && banner.event === 'CPI', 'banner picks active careful over idle')

  // Stand-aside wins over careful when both present
  const dual = buildDeskNewsHazards({
    calendar: [
      {
        id: 'near',
        time: '2026-07-29 12:05:00',
        country: 'US',
        event: 'NFP',
        impact: 'high',
        instruments: ['DOW', 'NASDAQ', 'NIKKEI'],
        deskNote: 'x',
      },
      {
        id: 'later',
        time: '2026-07-29 12:45:00',
        country: 'US',
        event: 'CPI',
        impact: 'high',
        instruments: ['DOW', 'NASDAQ', 'NIKKEI'],
        deskNote: 'x',
      },
    ],
    instrument: 'DOW',
    nowMs: now,
    includeUpcomingDay: true,
  })
  assert.equal(pickBannerHazard(dual)?.event, 'NFP', 'stand_aside beats careful')

  const digest = formatDayNewsDigest(nik, 'NIKKEI', now)
  assert.ok(digest && /NIKKEI desk news/.test(digest.title))
  assert.ok(formatMontrealHms(now).length >= 4)

  // Without includeUpcomingDay, only active windows
  const activeOnly = buildDeskNewsHazards({
    calendar: cal,
    instrument: 'NIKKEI',
    nowMs: now,
    includeUpcomingDay: false,
  })
  assert.ok(activeOnly.every((h) => h.level !== 'none' || h.atMs == null))
  assert.ok(
    !activeOnly.some((h) => h.event === 'BoJ Rate Decision'),
    'BoJ 6h out excluded without includeUpcomingDay'
  )
}

console.log('desk_news_hazard: all passed')
