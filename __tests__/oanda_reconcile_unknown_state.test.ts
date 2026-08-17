/**
 * CRITICAL regression: broker reconcile must never false-close an open position
 * on a transient/inconclusive OANDA read (network blip, 429, 5xx, auth hiccup).
 * Only a confirmed "trade id no longer exists" (missing) or explicit CLOSED
 * state may flatten the journal row.
 *
 * Run: npx tsx __tests__/oanda_reconcile_unknown_state.test.ts
 */

process.env.OANDA_API_KEY = 'test-key'
process.env.OANDA_ACCOUNT_ID = 'test-account'
process.env.OANDA_ENVIRONMENT = 'practice'
process.env.OANDA_EXECUTE_ORDERS = 'true'

import assert from 'node:assert/strict'
import { getOandaTradeSnapshot } from '../lib/oanda/orders'
import { reconcileBrokerClosedPosition } from '../lib/trading/brokerPositionReconcile'

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>

function installFetch(mock: FetchMock) {
  ;(globalThis as unknown as { fetch: FetchMock }).fetch = mock
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function textResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => {
      throw new Error('not json')
    },
  } as unknown as Response
}

async function main() {
  // 1. Transient 5xx error → 'unknown', not 'missing' (never assume broker-closed)
  installFetch(async () => textResponse(500, 'Internal Server Error'))
  const snap500 = await getOandaTradeSnapshot('trade-1')
  assert.equal(snap500.state, 'unknown', '5xx must be unknown, not missing/closed')

  // 2. Rate limit (429) → 'unknown'
  installFetch(async () => textResponse(429, 'Rate limit exceeded'))
  const snap429 = await getOandaTradeSnapshot('trade-1')
  assert.equal(snap429.state, 'unknown', '429 must be unknown, not missing/closed')

  // 3. Network exception (fetch throws) → 'unknown'
  installFetch(async () => {
    throw new Error('ECONNRESET')
  })
  const snapThrow = await getOandaTradeSnapshot('trade-1')
  assert.equal(snapThrow.state, 'unknown', 'network error must be unknown, not missing/closed')

  // 4. Confirmed "does not exist" (trade id gone — genuinely closed on broker) → 'missing'
  installFetch(async () => textResponse(404, 'Trade does not exist'))
  const snapMissing = await getOandaTradeSnapshot('trade-1')
  assert.equal(snapMissing.state, 'missing', 'confirmed does-not-exist must be missing')

  // 5. Trade still open on broker → 'open'
  installFetch(async () =>
    jsonResponse(200, { trade: { state: 'OPEN', currentUnits: 5 } })
  )
  const snapOpen = await getOandaTradeSnapshot('trade-1')
  assert.equal(snapOpen.state, 'open', 'live open trade must be open')

  // 6. Trade explicitly CLOSED on broker → 'closed'
  installFetch(async () =>
    jsonResponse(200, {
      trade: { state: 'CLOSED', currentUnits: 0, averageClosePrice: 42123.4, realizedPL: 12.5 },
    })
  )
  const snapClosed = await getOandaTradeSnapshot('trade-1')
  assert.equal(snapClosed.state, 'closed', 'explicit CLOSED must be closed')
  assert.equal(snapClosed.fillPrice, 42123.4)

  console.log('oanda_reconcile_unknown_state: getOandaTradeSnapshot classification passed')

  // ── reconcileBrokerClosedPosition must never flatten on 'unknown' ──────────
  const baseRow = {
    id: 'pos-1',
    user_id: 'user-1',
    instrument: 'DOW',
    trade_date: '2026-07-31',
    entry_price: 42000,
    entry_direction: 'LONG',
    position_size: 1,
    risk_amount: 100,
    stop_loss_price: 41900,
    profit_target_price: 42200,
    stop_loss_hit_count: 0,
    oanda_trade_id: 'trade-1',
  }

  let updateCalled = false
  const chainableSupabase = {
    from() {
      return {
        update() {
          updateCalled = true
          return this
        },
        eq() {
          return this
        },
        is() {
          return this
        },
        select() {
          return this
        },
        async maybeSingle() {
          return { data: { id: baseRow.id }, error: null }
        },
      }
    },
  } as unknown as Parameters<typeof reconcileBrokerClosedPosition>[0]

  // Transient error while SL amend is in flight — must NOT close the journal row
  installFetch(async () => textResponse(503, 'Service Unavailable'))
  const resultUnknown = await reconcileBrokerClosedPosition(chainableSupabase, baseRow)
  assert.equal(resultUnknown.changed, false, 'must not force-close on inconclusive broker read')
  assert.equal(updateCalled, false, 'must not write journal update on inconclusive broker read')

  // Trade still open — must NOT close
  installFetch(async () => jsonResponse(200, { trade: { state: 'OPEN', currentUnits: 5 } }))
  const resultOpen = await reconcileBrokerClosedPosition(chainableSupabase, baseRow)
  assert.equal(resultOpen.changed, false, 'must not close while broker reports open')
  assert.equal(updateCalled, false, 'no journal write while broker reports open')

  // Tradeify desk never executes OANDA — even a CLOSED broker trade must not
  // flatten the journal (that path ate live session slots on false NAS100 fills).
  installFetch(async () =>
    jsonResponse(200, {
      trade: { state: 'CLOSED', currentUnits: 0, averageClosePrice: 41895, realizedPL: -105 },
    })
  )
  const resultClosed = await reconcileBrokerClosedPosition(chainableSupabase, baseRow)
  assert.equal(resultClosed.changed, false, 'Tradeify desk must not flatten from OANDA CLOSED')
  assert.equal(updateCalled, false, 'no journal write when OANDA execute is locked off')

  console.log('oanda_reconcile_unknown_state: reconcileBrokerClosedPosition guard passed')
}

main()
  .then(() => console.log('oanda_reconcile_unknown_state: all passed'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
