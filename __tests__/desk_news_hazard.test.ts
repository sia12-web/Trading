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
import type { DeskCalendarEvent } from '../lib/trading/deskNews'

{
  assert.equal(isHighImpact('high'), true)
  assert.equal(isHighImpact('High Impact'), true)
  assert.equal(isHighImpact('3'), true)
  assert.equal(isHighImpact('medium'), false)
  assert.equal(isHighImpact('low'), false)
}

{
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)
  const ms = parseCalendarEventMs('2026-07-29 12:30:00', now)
  assert.equal(ms, Date.UTC(2026, 6, 29, 12, 30, 0), 'UTC calendar parse')
  assert.equal(parseCalendarEventMs('not-a-time', now), null)
  assert.equal(parseCalendarEventMs('', now), null)
}

{
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)
  assert.equal(classifyNewsHazardLevel(now + 5 * 60 * 1000, now), 'stand_aside')
  assert.equal(classifyNewsHazardLevel(now - 5 * 60 * 1000, now), 'stand_aside')
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_STAND_ASIDE_MS + 60_000, now),
    'careful'
  )
  assert.equal(
    classifyNewsHazardLevel(now + NEWS_CAREFUL_MS + 60_000, now),
    'none'
  )
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

  const nik = buildDeskNewsHazards({
    calendar: cal,
    instrument: 'NIKKEI',
    nowMs: now,
    includeUpcomingDay: true,
  })
  assert.ok(nik.some((h) => h.event === 'CPI'), 'Nikkei sees US CPI')
  assert.ok(nik.some((h) => h.event === 'BoJ Rate Decision'), 'Nikkei sees BoJ')

  const banner = pickBannerHazard(ndx)
  assert.ok(banner && banner.event === 'CPI', 'banner picks nearest active')

  const digest = formatDayNewsDigest(nik, 'NIKKEI', now)
  assert.ok(digest && /NIKKEI desk news/.test(digest.title))
  assert.ok(formatMontrealHms(now).length >= 4)
}

console.log('desk_news_hazard: all passed')
