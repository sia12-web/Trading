/**
 * OANDA order / account client (practice or live via OANDA_ENVIRONMENT).
 */

import { logger } from '@/lib/utils/logger'
import type { Instrument } from '@/types/price-feed'
import {
  isOandaConfigured,
  oandaAccountId,
  oandaBaseUrl,
  oandaHeaders,
  toOandaInstrument,
} from '@/lib/oanda/config'

export type OandaAccountSummary = {
  id: string
  currency: string
  balance: number
  unrealizedPL: number
  NAV: number
  openTradeCount: number
  marginAvailable: number
}

export type PlaceMarketOrderInput = {
  instrument: Instrument
  direction: 'LONG' | 'SHORT'
  /** Desk position size (contracts); converted to OANDA integer units */
  units: number
  stopLossPrice?: number | null
  takeProfitPrice?: number | null
}

export type PlaceMarketOrderResult =
  | {
      ok: true
      orderId: string
      tradeId: string
      fillPrice: number
      units: number
      instrument: string
      raw: unknown
    }
  | {
      ok: false
      error: string
      status?: number
      raw?: unknown
    }

export type CloseTradeResult =
  | { ok: true; tradeId: string; fillPrice: number | null; raw: unknown }
  | { ok: false; error: string; status?: number; raw?: unknown }

async function oandaFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${oandaBaseUrl()}${path}`
  return fetch(url, {
    ...init,
    headers: {
      ...oandaHeaders(),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
}

function toUnits(direction: 'LONG' | 'SHORT', size: number): number {
  const abs = Math.max(1, Math.round(Math.abs(size)))
  return direction === 'LONG' ? abs : -abs
}

function priceString(price: number, decimals = 1): string {
  return price.toFixed(decimals)
}

export async function getOandaAccountSummary(): Promise<
  | { ok: true; account: OandaAccountSummary }
  | { ok: false; error: string; status?: number }
> {
  if (!isOandaConfigured()) {
    return { ok: false, error: 'OANDA_API_KEY / OANDA_ACCOUNT_ID not configured' }
  }

  const accountId = oandaAccountId()
  const res = await oandaFetch(`/v3/accounts/${accountId}/summary`)
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const err =
      json?.errorMessage || json?.errorCode || text.slice(0, 300) || `HTTP ${res.status}`
    logger.error('oanda.account_summary_failed', { status: res.status, err, accountId })
    return { ok: false, error: String(err), status: res.status }
  }

  const a = json?.account
  if (!a) return { ok: false, error: 'Missing account in OANDA response', status: res.status }

  return {
    ok: true,
    account: {
      id: String(a.id),
      currency: String(a.currency || 'USD'),
      balance: Number(a.balance),
      unrealizedPL: Number(a.unrealizedPL),
      NAV: Number(a.NAV),
      openTradeCount: Number(a.openTradeCount || 0),
      marginAvailable: Number(a.marginAvailable),
    },
  }
}

const instrumentMetaCache = new Map<
  string,
  { displayPrecision: number; tradeUnitsPrecision: number; at: number }
>()
const INSTRUMENT_META_TTL_MS = 60 * 60 * 1000 // 1h

export async function getOandaInstrumentDetails(oandaInstrument: string): Promise<{
  displayPrecision: number
  tradeUnitsPrecision: number
} | null> {
  const cached = instrumentMetaCache.get(oandaInstrument)
  if (cached && Date.now() - cached.at < INSTRUMENT_META_TTL_MS) {
    return {
      displayPrecision: cached.displayPrecision,
      tradeUnitsPrecision: cached.tradeUnitsPrecision,
    }
  }

  const accountId = oandaAccountId()
  const res = await oandaFetch(
    `/v3/accounts/${accountId}/instruments?instruments=${encodeURIComponent(oandaInstrument)}`
  )
  if (!res.ok) return cached
    ? {
        displayPrecision: cached.displayPrecision,
        tradeUnitsPrecision: cached.tradeUnitsPrecision,
      }
    : null
  const json = await res.json()
  const inst = json?.instruments?.[0]
  if (!inst) return null
  const meta = {
    displayPrecision: Number(inst.displayPrecision ?? 1),
    tradeUnitsPrecision: Number(inst.tradeUnitsPrecision ?? 0),
  }
  instrumentMetaCache.set(oandaInstrument, { ...meta, at: Date.now() })
  return meta
}

/**
 * Place a market order with optional SL/TP on fill.
 */
export async function placeOandaMarketOrder(
  input: PlaceMarketOrderInput
): Promise<PlaceMarketOrderResult> {
  if (!isOandaConfigured()) {
    return { ok: false, error: 'OANDA not configured' }
  }

  const symbol = toOandaInstrument(input.instrument)
  if (!symbol) {
    return { ok: false, error: `No OANDA instrument mapping for ${input.instrument}` }
  }

  const meta = await getOandaInstrumentDetails(symbol)
  const priceDecimals = meta?.displayPrecision ?? 1
  const unitsPrecision = meta?.tradeUnitsPrecision ?? 0

  let absUnits = Math.abs(input.units)
  if (unitsPrecision <= 0) absUnits = Math.max(1, Math.round(absUnits))
  else absUnits = Math.max(Math.pow(10, -unitsPrecision), Number(absUnits.toFixed(unitsPrecision)))

  const signed = input.direction === 'LONG' ? absUnits : -absUnits
  const unitsStr =
    unitsPrecision <= 0 ? String(Math.trunc(signed)) : signed.toFixed(unitsPrecision)

  const order: Record<string, unknown> = {
    type: 'MARKET',
    instrument: symbol,
    units: unitsStr,
    timeInForce: 'FOK',
    positionFill: 'DEFAULT',
  }

  if (input.stopLossPrice != null && input.stopLossPrice > 0) {
    order.stopLossOnFill = {
      price: priceString(input.stopLossPrice, priceDecimals),
      timeInForce: 'GTC',
    }
  }

  if (input.takeProfitPrice != null && input.takeProfitPrice > 0) {
    order.takeProfitOnFill = {
      price: priceString(input.takeProfitPrice, priceDecimals),
      timeInForce: 'GTC',
    }
  }

  const accountId = oandaAccountId()
  logger.info('oanda.order_place', {
    accountId,
    instrument: symbol,
    units: unitsStr,
    direction: input.direction,
    stopLoss: input.stopLossPrice ?? null,
    takeProfit: input.takeProfitPrice ?? null,
  })

  const res = await oandaFetch(`/v3/accounts/${accountId}/orders`, {
    method: 'POST',
    body: JSON.stringify({ order }),
  })

  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const err =
      json?.errorMessage ||
      json?.errorCode ||
      json?.lastTransactionID ||
      text.slice(0, 400) ||
      `HTTP ${res.status}`
    logger.error('oanda.order_failed', { status: res.status, err, body: text.slice(0, 500) })
    return { ok: false, error: String(err), status: res.status, raw: json }
  }

  const tradeOpened = json?.orderFillTransaction?.tradeOpened
  const tradeId = String(
    tradeOpened?.tradeID ||
      json?.orderFillTransaction?.id ||
      json?.lastTransactionID ||
      ''
  )
  const orderId = String(
    json?.orderCreateTransaction?.id || json?.orderFillTransaction?.id || tradeId
  )
  const fillPrice = Number(
    json?.orderFillTransaction?.price || tradeOpened?.price || 0
  )

  if (!tradeId) {
    logger.error('oanda.order_no_trade_id', { raw: json })
    return {
      ok: false,
      error: 'OANDA accepted order but returned no trade id',
      status: res.status,
      raw: json,
    }
  }

  logger.info('oanda.order_filled', {
    accountId,
    instrument: symbol,
    orderId,
    tradeId,
    fillPrice,
    units: signed,
  })

  return {
    ok: true,
    orderId,
    tradeId,
    fillPrice: Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : 0,
    units: signed,
    instrument: symbol,
    raw: json,
  }
}

export async function closeOandaTrade(tradeId: string): Promise<CloseTradeResult> {
  if (!isOandaConfigured()) {
    return { ok: false, error: 'OANDA not configured' }
  }
  if (!tradeId) {
    return { ok: false, error: 'Missing OANDA trade id' }
  }

  const accountId = oandaAccountId()
  logger.info('oanda.trade_close', { accountId, tradeId })

  const res = await oandaFetch(`/v3/accounts/${accountId}/trades/${tradeId}/close`, {
    method: 'PUT',
    body: JSON.stringify({}),
  })

  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    // Already closed is OK for idempotent desk close
    const msg = String(json?.errorMessage || text || '')
    if (/does not exist|already|CLOSED/i.test(msg)) {
      logger.warn('oanda.trade_already_closed', { tradeId, msg })
      return { ok: true, tradeId, fillPrice: null, raw: json }
    }
    logger.error('oanda.trade_close_failed', { status: res.status, msg, tradeId })
    return { ok: false, error: msg || `HTTP ${res.status}`, status: res.status, raw: json }
  }

  const fillPrice = Number(
    json?.orderFillTransaction?.price || json?.longOrderFillTransaction?.price || 0
  )

  logger.info('oanda.trade_closed', {
    tradeId,
    fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
  })

  return {
    ok: true,
    tradeId,
    fillPrice: Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : null,
    raw: json,
  }
}

/** Close by instrument if we lost the trade id (fallback). */
export async function closeOandaInstrumentPosition(
  instrument: Instrument
): Promise<CloseTradeResult> {
  const symbol = toOandaInstrument(instrument)
  if (!symbol) return { ok: false, error: `No OANDA mapping for ${instrument}` }

  const accountId = oandaAccountId()
  const res = await oandaFetch(`/v3/accounts/${accountId}/positions/${symbol}/close`, {
    method: 'PUT',
    body: JSON.stringify({ longUnits: 'ALL', shortUnits: 'ALL' }),
  })

  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const msg = String(json?.errorMessage || text || `HTTP ${res.status}`)
    if (/does not exist|CLOSEOUT|no position/i.test(msg)) {
      return { ok: true, tradeId: symbol, fillPrice: null, raw: json }
    }
    return { ok: false, error: msg, status: res.status, raw: json }
  }

  return { ok: true, tradeId: symbol, fillPrice: null, raw: json }
}

export { toUnits }
