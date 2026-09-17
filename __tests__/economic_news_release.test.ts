/**
 * Economic News Release & Instant Wire Resolver Tests
 *
 * Verifies:
 * 1. Target range normalization into decimals (fraction to percent) and top rate extraction.
 * 2. Instant parsing of Federal Reserve FOMC statements: rate hike (+25bps), cut (-50bps), hold (0bps).
 * 3. BLS Consumer Price Index (CPI) and Nonfarm Payrolls (NFP) Atom feed parsing.
 * 4. Calendar event live enrichment with FOMC / CPI / NFP actual numbers and outcome badges.
 * 5. Hazard classification into 'released' status and top priority in banner hazard selector.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFomcStatementText,
  parseBlsCpiEntry,
  parseBlsNfpEntry,
  normalizeTargetRange,
  enrichCalendarEventWithLiveResult,
  type LiveEconomicData,
} from '../lib/trading/liveEconomicResults'
import {
  classifyNewsHazardLevel,
  buildDeskNewsHazards,
  pickBannerHazard,
} from '../lib/trading/deskNewsHazard'
import type { DeskCalendarEvent } from '../lib/trading/deskNews'

test('Economic Wire - normalizeTargetRange converts fractions and extracts top rate', () => {
  const res1 = normalizeTargetRange('3-3/4 to 4 percent')
  assert.equal(res1.normalized, '3.75% - 4.00%')
  assert.equal(res1.topRate, '4.00%')

  const res2 = normalizeTargetRange('3-1/2 to 3-3/4 percent')
  assert.equal(res2.normalized, '3.50% - 3.75%')
  assert.equal(res2.topRate, '3.75%')

  const res3 = normalizeTargetRange('5.25% - 5.50%')
  assert.equal(res3.normalized, '5.25% - 5.50%')
  assert.equal(res3.topRate, '5.50%')
})

test('Economic Wire - parseFomcStatementText extracts FOMC rate hike (+25bps)', () => {
  const html = `
    <div id="article">
      <p>The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent, in support of the Federal Reserve's dual mandate.</p>
    </div>
  `
  const parsed = parseFomcStatementText(html, {
    url: 'https://www.federalreserve.gov/statement.htm',
    pubDate: '2026-09-16T18:00:00Z',
  })

  assert.ok(parsed != null)
  assert.equal(parsed.action, 'HIKE')
  assert.equal(parsed.changeBps, 25)
  assert.equal(parsed.topRate, '4.00%')
  assert.equal(parsed.targetRangeNormalized, '3.75% - 4.00%')
  assert.ok(parsed.headline.includes('Fed raises target range by 25bps to 3.75% - 4.00%'))
})

test('Economic Wire - parseFomcStatementText extracts FOMC rate hold', () => {
  const html = `
    <p>The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent.</p>
  `
  const parsed = parseFomcStatementText(html)

  assert.ok(parsed != null)
  assert.equal(parsed.action, 'HOLD')
  assert.equal(parsed.changeBps, 0)
  assert.equal(parsed.topRate, '3.75%')
  assert.equal(parsed.targetRangeNormalized, '3.50% - 3.75%')
  assert.ok(parsed.headline.includes('Fed maintains target range at 3.50% - 3.75%'))
})

test('Economic Wire - parseFomcStatementText extracts FOMC rate cut (-50bps)', () => {
  const html = `
    <p>The Committee decided to lower the target range for the federal funds rate by 1/2 percentage point to 4-1/4 to 4-1/2 percent.</p>
  `
  const parsed = parseFomcStatementText(html)

  assert.ok(parsed != null)
  assert.equal(parsed.action, 'CUT')
  assert.equal(parsed.changeBps, -50)
  assert.equal(parsed.topRate, '4.50%')
  assert.equal(parsed.targetRangeNormalized, '4.25% - 4.50%')
  assert.ok(parsed.headline.includes('Fed cuts target range by 50bps to 4.25% - 4.50%'))
})

test('Economic Wire - parseBlsCpiEntry extracts monthly and annual inflation', () => {
  const xml = `
    <entry>
      <title>CPI for all items increases 0.4% in August; gasoline rises</title>
      <link href="https://www.bls.gov/news.release/archives/cpi_09112026.htm"/>
      <published>2026-09-11T07:50:40.968-04:00</published>
      <content>In August, the Consumer Price Index for All Urban Consumers rose 0.4 percent, seasonally adjusted (SA), and rose 3.4 percent over the last 12 months, not seasonally adjusted (NSA). The index for all items less food and energy rose 0.3 percent in August.</content>
    </entry>
  `
  const parsed = parseBlsCpiEntry(xml)
  assert.ok(parsed != null)
  assert.equal(parsed.headline, 'CPI for all items increases 0.4% in August; gasoline rises')
  assert.equal(parsed.monthlyRate, '0.4%')
  assert.equal(parsed.annualRate, '3.4%')
  assert.equal(parsed.coreMonthlyRate, '0.3%')
})

test('Economic Wire - parseBlsNfpEntry extracts payrolls and unemployment rate', () => {
  const xml = `
    <entry>
      <title>Payroll employment increases by 162,000 in August; unemployment rate unchanged at 4.1%</title>
      <link href="https://www.bls.gov/news.release/archives/empsit_09042026.htm"/>
      <published>2026-09-04T07:51:08.695-04:00</published>
      <content>Total nonfarm payroll employment increased by 162,000 in August, and the unemployment rate was unchanged at 4.1 percent.</content>
    </entry>
  `
  const parsed = parseBlsNfpEntry(xml)
  assert.ok(parsed != null)
  assert.equal(parsed.headline, 'Payroll employment increases by 162,000 in August; unemployment rate unchanged at 4.1%')
  assert.equal(parsed.payrollChange, '+162K')
  assert.equal(parsed.unemploymentRate, '4.1%')
})

test('Economic Wire - enrichCalendarEventWithLiveResult enriches scheduled events with live results', () => {
  const mockLiveData: LiveEconomicData = {
    fomc: {
      action: 'HIKE',
      changeBps: 25,
      targetRangeRaw: '3-3/4 to 4 percent',
      targetRangeNormalized: '3.75% - 4.00%',
      topRate: '4.00%',
      headline: 'Fed raises target range by 25bps to 3.75% - 4.00%',
      url: 'https://www.federalreserve.gov/statement.htm',
      pubDate: '2026-09-16T14:00:00-04:00',
      pubMs: Date.parse('2026-09-16T14:00:00-04:00'),
    },
    cpi: {
      headline: 'CPI for all items increases 0.4% in August; gasoline rises',
      monthlyRate: '0.4%',
      annualRate: '3.4%',
      coreMonthlyRate: '0.3%',
      pubDate: '2026-09-11T08:30:00-04:00',
      pubMs: Date.parse('2026-09-11T08:30:00-04:00'),
      url: 'https://www.bls.gov/cpi/',
    },
    nfp: {
      headline: 'Payroll employment increases by 162,000 in August; unemployment rate unchanged at 4.1%',
      payrollChange: '+162K',
      unemploymentRate: '4.1%',
      pubDate: '2026-09-04T08:30:00-04:00',
      pubMs: Date.parse('2026-09-04T08:30:00-04:00'),
      url: 'https://www.bls.gov/ces/',
    },
    fetchedAt: Date.now(),
  }

  const scheduledEvent: DeskCalendarEvent = {
    id: 'cal-fomc-1',
    time: '2026-09-16T14:00:00-04:00',
    country: 'US',
    event: 'Federal Funds Rate',
    impact: 'High',
    instruments: ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'],
    deskNote: 'Scheduled event',
    estimate: '4.00%',
    prev: '3.75%',
  }

  // Check 5 minutes after release
  const nowMs = Date.parse('2026-09-16T14:05:00-04:00')
  const enriched = enrichCalendarEventWithLiveResult(scheduledEvent, mockLiveData, nowMs)

  assert.equal(enriched.isReleased, true)
  assert.equal(enriched.actual, '4.00%')
  assert.equal(enriched.outcome, 'HIKE')
  assert.equal(enriched.changeBps, 25)
  assert.equal(enriched.targetRange, '3.75% - 4.00%')
  assert.equal(enriched.resultHeadline, 'Fed raises target range by 25bps to 3.75% - 4.00%')
  assert.ok(enriched.deskNote.includes('🎯 FOMC RESULT'))
  assert.ok(enriched.deskNote.includes('+25bps HIKE'))
})

test('Economic Wire - Hazard classification and banner selection prioritizes released print', () => {
  const eventTimeMs = Date.parse('2026-09-16T14:00:00-04:00')
  const nowMs = eventTimeMs + 10 * 60 * 1000 // 10 minutes post-release

  const level = classifyNewsHazardLevel(eventTimeMs, nowMs, true)
  assert.equal(level, 'released')

  const calendar: DeskCalendarEvent[] = [
    {
      id: '1',
      event: 'Pending Stand Aside Event',
      country: 'US',
      impact: 'High',
      instruments: ['DOW'],
      time: '2026-09-16T14:15:00-04:00',
      deskNote: 'Stand aside',
      isReleased: false,
    },
    {
      id: '2',
      event: 'Federal Funds Rate',
      country: 'US',
      impact: 'High',
      instruments: ['DOW'],
      time: '2026-09-16T14:00:00-04:00',
      deskNote: 'Fed Rate',
      actual: '4.00%',
      estimate: '4.00%',
      outcome: 'HIKE',
      changeBps: 25,
      resultHeadline: 'Fed raises target range by 25bps to 3.75-4.00%',
      isReleased: true,
    },
  ]

  const hazards = buildDeskNewsHazards({
    calendar,
    instrument: 'DOW',
    nowMs,
  })

  assert.equal(hazards.length, 2)
  assert.equal(hazards[0].level, 'released')
  assert.ok(hazards[0].chip.includes('🎯'))

  const bannerPick = pickBannerHazard(hazards)
  assert.ok(bannerPick != null)
  assert.equal(bannerPick.level, 'released')
  assert.equal(bannerPick.event, 'Federal Funds Rate')
  assert.ok(bannerPick.chip.includes('Fed raises target range'))
})

test('Economic Wire - Live FinnhubClient getEconomicCalendar enriches FOMC from live wire', async () => {
  const { getFinnhubClient } = await import('../lib/services/finnhubClient')
  const client = getFinnhubClient()
  const rows = await client.getEconomicCalendar('2026-09-13', '2026-09-20')

  assert.ok(Array.isArray(rows), 'Rows must be an array')
  assert.ok(rows.length > 0, 'Should return economic calendar rows')

  const fomcRow = rows.find((r) => /federal funds rate|fomc statement/i.test(r.event))
  if (fomcRow) {
    // If today is Sept 16, FOMC row will have the actual rate and hike outcome populated
    assert.ok(fomcRow.actual != null || fomcRow.estimate != null, 'FOMC row must have estimate or actual')
    if (fomcRow.isReleased) {
      assert.ok(fomcRow.actual != null, 'Released FOMC must have actual rate')
      assert.ok(fomcRow.resultHeadline != null, 'Released FOMC must have result headline')
    }
  }
})
