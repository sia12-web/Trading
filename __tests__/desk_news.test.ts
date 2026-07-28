/**
 * Desk news tagging / ranking unit tests.
 * Run: npx tsx __tests__/desk_news.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildDeskNewsCards,
  filterCardsForDesk,
  instrumentsForHeadline,
  normalizeNewsDatetime,
  safeHttpUrl,
  tagDeskNews,
} from '../lib/trading/deskNews'

{
  assert.equal(tagDeskNews('Fed signals rate cut path'), 'MACRO')
  assert.equal(tagDeskNews('Apple beats quarterly earnings'), 'EARNINGS')
  assert.equal(tagDeskNews('Tariff threat hits risk assets'), 'GEO')
  assert.equal(tagDeskNews('ETF inflows hit record'), 'FLOW')
  assert.equal(tagDeskNews('Company announces rebrand'), 'OTHER')
}

{
  const nik = instrumentsForHeadline('BoJ intervenes as yen slides', null, null, 'EWJ')
  assert.ok(nik.includes('NIKKEI'), 'Nikkei from BoJ/EWJ')
  const ndx = instrumentsForHeadline('Nasdaq futures jump on NVDA', null, null, 'QQQ')
  assert.ok(ndx.includes('NASDAQ'), 'Nasdaq from NVDA/QQQ')
  const dia = instrumentsForHeadline('Quiet tape', null, null, 'DIA')
  assert.deepEqual(dia, ['DOW'], 'DIA origin alone → DOW')
}

{
  const now = Math.floor(Date.now() / 1000)
  assert.equal(normalizeNewsDatetime(now * 1000, now), now, 'ms → sec')
  assert.equal(normalizeNewsDatetime(0, now), null)
  assert.equal(normalizeNewsDatetime(now + 7200, now), null, 'reject far future')
  assert.equal(normalizeNewsDatetime(100, now), null, 'reject ancient')
}

{
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('data:text/html,hi'), null)
  assert.equal(safeHttpUrl(null), null)
  assert.equal(safeHttpUrl('not-a-url'), null)
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
      {
        headline: 'Evil link',
        source: 'Bad',
        datetime: now - 100,
        url: 'javascript:alert(1)',
        origin: 'QQQ',
      },
      {
        headline: 'Bad clock',
        source: 'X',
        datetime: now * 1000 + 999,
        origin: 'QQQ',
      },
    ],
    { windowHours: 12, nowUnix: now, limitPerDesk: 10 }
  )
  assert.equal(cards.filter((c) => /CPI cools/i.test(c.headline)).length, 1, 'deduped')
  assert.ok(cards.every((c) => c.datetime >= now - 12 * 3600), 'window')
  assert.ok(
    cards.every((c) => !c.url || c.url.startsWith('http')),
    'safe urls only'
  )
  const evil = cards.find((c) => /Evil link/i.test(c.headline))
  assert.ok(evil && evil.url === null, 'javascript url stripped')

  const nikkei = filterCardsForDesk(cards, 'NIKKEI', 10)
  assert.ok(nikkei.some((c) => /Toyota/i.test(c.headline)), 'nikkei filter')

  // Session filter must NOT empty a desk tab during the other session
  const allNy = filterCardsForDesk(cards, 'ALL', 12, {
    sessionFilter: true,
    focusMarket: 'NY',
  })
  assert.ok(
    allNy.every((c) => c.instruments.includes('DOW') || c.instruments.includes('NASDAQ')),
    'ALL+NY session prefers US desks'
  )
  const nikkeiDuringNy = filterCardsForDesk(cards, 'NIKKEI', 10, {
    sessionFilter: true,
    focusMarket: 'NY',
  })
  assert.ok(
    nikkeiDuringNy.some((c) => /Toyota/i.test(c.headline)),
    'NIKKEI tab still has Japan news when session=NY'
  )
}

console.log('desk_news: all passed')
