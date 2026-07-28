/**
 * Desk news tagging / ranking unit tests.
 * Run: npx tsx __tests__/desk_news.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildDeskNewsCards,
  filterCardsForDesk,
  instrumentsForHeadline,
  tagDeskNews,
} from '../lib/trading/deskNews'

{
  assert.equal(tagDeskNews('Fed signals rate cut path'), 'MACRO')
  assert.equal(tagDeskNews('Apple beats quarterly earnings'), 'EARNINGS')
  assert.equal(tagDeskNews('Tariff threat hits risk assets'), 'GEO')
}

{
  const nik = instrumentsForHeadline('BoJ intervenes as yen slides', null, null, 'EWJ')
  assert.ok(nik.includes('NIKKEI'), 'Nikkei from BoJ/EWJ')
  const ndx = instrumentsForHeadline('Nasdaq futures jump on NVDA', null, null, 'QQQ')
  assert.ok(ndx.includes('NASDAQ'), 'Nasdaq from NVDA/QQQ')
}

{
  const now = Math.floor(Date.now() / 1000)
  const cards = buildDeskNewsCards(
    [
      {
        headline: 'CPI cools, stocks rally',
        source: 'Reuters',
        datetime: now - 600,
        url: 'https://example.com/a',
        origin: 'market:general',
      },
      {
        headline: 'CPI cools, stocks rally',
        source: 'Yahoo',
        datetime: now - 500,
        origin: 'DIA',
      },
      {
        headline: 'Toyota lifts outlook',
        source: 'Nikkei',
        datetime: now - 1200,
        origin: 'EWJ',
      },
      {
        headline: 'Ancient headline',
        source: 'CNBC',
        datetime: now - 48 * 3600,
        origin: 'QQQ',
      },
    ],
    { windowHours: 12, nowUnix: now, limitPerDesk: 10, sessionFilter: false }
  )
  assert.equal(cards.filter((c) => /CPI cools/i.test(c.headline)).length, 1, 'deduped')
  assert.ok(cards.every((c) => c.datetime >= now - 12 * 3600), 'window')
  const nikkei = filterCardsForDesk(cards, 'NIKKEI', 10)
  assert.ok(nikkei.some((c) => /Toyota/i.test(c.headline)), 'nikkei filter')
}

console.log('desk_news: all passed')
