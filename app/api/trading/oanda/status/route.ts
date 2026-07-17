/**
 * GET /api/trading/oanda/status
 * Verify OANDA credentials + account (no secrets returned).
 */
import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/utils/devAuth'
import {
  isOandaConfigured,
  oandaAccountId,
  oandaBaseUrl,
  shouldExecuteOandaOrders,
} from '@/lib/oanda/config'
import { getOandaAccountSummary, getOandaInstrumentDetails } from '@/lib/oanda/orders'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getOrCreateUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isOandaConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        executeOrders: false,
        error: 'OANDA_API_KEY / OANDA_ACCOUNT_ID missing',
      },
      { status: 503 }
    )
  }

  const summary = await getOandaAccountSummary()
  const us30 = await getOandaInstrumentDetails('US30_USD')
  const nas100 = await getOandaInstrumentDetails('NAS100_USD')

  logger.info('oanda.status', {
    accountId: oandaAccountId(),
    ok: summary.ok,
    balance: summary.ok ? summary.account.balance : null,
  })

  if (!summary.ok) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        executeOrders: shouldExecuteOandaOrders(),
        accountId: oandaAccountId(),
        baseUrl: oandaBaseUrl(),
        error: summary.error,
        status: summary.status ?? null,
      },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    executeOrders: shouldExecuteOandaOrders(),
    accountId: summary.account.id,
    baseUrl: oandaBaseUrl(),
    currency: summary.account.currency,
    balance: summary.account.balance,
    NAV: summary.account.NAV,
    unrealizedPL: summary.account.unrealizedPL,
    openTradeCount: summary.account.openTradeCount,
    marginAvailable: summary.account.marginAvailable,
    instruments: {
      US30_USD: us30,
      NAS100_USD: nas100,
    },
  })
}
