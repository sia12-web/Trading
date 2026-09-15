import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNycSessionExpired, isArmedRuleExpired, isNycSessionActive } from '../lib/trading/sessionGate.ts'
import { parseLeoDirectives } from '../lib/ai/leoAssistant.ts'
import { evaluatePriceAgainstMemories } from '../lib/trading/leoLongTermMemory.ts'

test('isNycSessionActive - identifies active vs off-session hours', () => {
  // Monday 10:30 AM EDT (14:30 UTC) -> Active (NYC session ON)
  const mon1030 = new Date('2026-09-14T14:30:00Z')
  assert.equal(isNycSessionActive(mon1030), true, 'Active during Monday RTH')

  // Monday 21:04 EDT (Tuesday 01:04 UTC - Asian session) -> Inactive (NYC session FINISHED)
  const monAsia = new Date('2026-09-15T01:04:00Z')
  assert.equal(isNycSessionActive(monAsia), false, 'Inactive during Asian session')

  // Tuesday 04:00 EDT (08:00 UTC - London session) -> Inactive (NYC session FINISHED)
  const tueLondon = new Date('2026-09-15T08:00:00Z')
  assert.equal(isNycSessionActive(tueLondon), false, 'Inactive during London session')

  // Tuesday 16:05 EDT (20:05 UTC - Post-close) -> Inactive
  const tuePostClose = new Date('2026-09-15T20:05:00Z')
  assert.equal(isNycSessionActive(tuePostClose), false, 'Inactive after 16:00 ET close')

  // Saturday 12:00 EDT -> Inactive
  const saturday = new Date('2026-09-19T16:00:00Z')
  assert.equal(isNycSessionActive(saturday), false, 'Inactive on weekend')
})

test('Leo Alarm & Rule Session Expiry Logic', async (t) => {
  await t.test('isNycSessionExpired - rules created during NYC session expire at 16:00 ET', () => {
    // Mon Sep 14, 2026 11:30 AM EDT = 15:30 UTC
    const createdAtMonRth = new Date('2026-09-14T15:30:00Z').getTime()

    // 1. Same day 14:00 EDT (2:00 PM) -> Not expired (NYC session still open)
    const now1400 = new Date('2026-09-14T18:00:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, now1400), false, 'Should be active during NYC session')

    // 2. Same day 15:59 EDT -> Not expired
    const now1559 = new Date('2026-09-14T19:59:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, now1559), false, 'Should be active right before cash close')

    // 3. Same day 16:05 EDT (cash market closed) -> Expired!
    const now1605 = new Date('2026-09-14T20:05:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, now1605), true, 'Should expire once NYC session closes at 16:00 ET')

    // 4. Same day 20:00 EDT (Asia session) -> Expired!
    const nowAsia = new Date('2026-09-15T00:00:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, nowAsia), true, 'Should be expired during Asia session')

    // 5. Next day 04:00 EDT (London session) -> Expired!
    const nowLondon = new Date('2026-09-15T08:00:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, nowLondon), true, 'Should be expired during London session')

    // 6. Next day 10:00 EDT (Tuesday NYC) -> Expired!
    const nowTueRth = new Date('2026-09-15T14:00:00Z')
    assert.equal(isNycSessionExpired(createdAtMonRth, nowTueRth), true, 'Prior day NYC alarm must not leak into next day')
  })

  await t.test('isArmedRuleExpired - respects isLongTerm flag', () => {
    const createdAt = new Date('2026-09-14T15:30:00Z').getTime() // Mon 11:30 EDT
    const nowAsia = new Date('2026-09-15T00:00:00Z') // Mon 20:00 EDT (Asia session)

    // Alarm without long-term memory -> Expired in Asia session!
    const sessionAlarm = {
      createdAt,
      isLongTerm: false,
      status: 'ARMED',
      session: 'NYC',
    }
    assert.equal(isArmedRuleExpired(sessionAlarm, nowAsia), true, 'Session alarm must expire in Asia session')

    // Alarm WITH long-term memory -> Active! Never expires at session close
    const ltmAlarm = {
      createdAt,
      isLongTerm: true,
      status: 'ARMED',
      session: 'NYC',
    }
    assert.equal(isArmedRuleExpired(ltmAlarm, nowAsia), false, 'Long-term memory alarm must persist in Asia session')

    // Evaluated next day in London session -> Long-term alarm still active
    const nowLondon = new Date('2026-09-15T08:00:00Z')
    assert.equal(isArmedRuleExpired(ltmAlarm, nowLondon), false, 'Long-term memory alarm must persist across days')
  })

  await t.test('parseLeoDirectives - handles isLongTerm and SAVE_LONG_TERM_MEMORY', () => {
    // 1. Default ARM_DESK_ALERT (session-scoped)
    const textSession = `
Confirming alert parameters:
<execute>
{
  "action": "ARM_DESK_ALERT",
  "targetReference": "5D POC",
  "targetPrice": 29140.0,
  "session": "NYC",
  "isLongTerm": false
}
</execute>
`
    const d1 = parseLeoDirectives(textSession)
    assert.equal(d1.length, 1)
    assert.equal(d1[0].action, 'ARM_DESK_ALERT')
    assert.equal((d1[0] as any).isLongTerm, false)

    // 2. Explicit Long-Term Memory Alert
    const textLtm = `
Saving to permanent memory:
<execute>
{
  "action": "ARM_DESK_ALERT",
  "targetReference": "Daily Resistance Level",
  "targetPrice": 29500.0,
  "isLongTerm": true
}
</execute>
`
    const d2 = parseLeoDirectives(textLtm)
    assert.equal(d2.length, 1)
    assert.equal((d2[0] as any).isLongTerm, true)

    // 3. SAVE_LONG_TERM_MEMORY directive
    const textSaveLtm = `
<execute>
{
  "action": "SAVE_LONG_TERM_MEMORY",
  "instrument": "NASDAQ",
  "priceLow": 29100.0,
  "priceHigh": 29150.0,
  "purpose": "HTF Daily Acceptance Area"
}
</execute>
`
    const d3 = parseLeoDirectives(textSaveLtm)
    assert.equal(d3.length, 1)
    assert.equal(d3[0].action, 'SAVE_LONG_TERM_MEMORY')
    assert.equal((d3[0] as any).priceLow, 29100)
    assert.equal((d3[0] as any).priceHigh, 29150)
  })
})
