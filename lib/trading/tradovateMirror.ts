/**
 * TradePulse → Tradovate transfer ticket.
 * Same side, entry, SL, TP, and dollar risk — one legal Tradeify contract.
 * Growth eval has no API; the trader pastes this into Tradovate.
 */

export const TRADOVATE_TRADER_URL = 'https://trader.tradovate.com'

export type DeskIndex = 'DOW' | 'NASDAQ' | 'NIKKEI'

export type TradovateContract = {
  symbol: string
  /** Null when Tradeify does not list a micro (Nikkei = NKD only). */
  microSymbol: string | null
  name: string
  pointValue: number
  microPointValue: number | null
  tick: number
  maxMinis: number
  maxMicros: number
}

/** Tradeify instrument list: minis ES/NQ/YM/RTY/NKD · micros MYM/MES/MNQ/M2K (no MNK). */
export const TRADOVATE_CONTRACTS: Record<DeskIndex, TradovateContract> = {
  DOW: {
    symbol: 'YM',
    microSymbol: 'MYM',
    name: 'E-mini Dow',
    pointValue: 5,
    microPointValue: 0.5,
    tick: 1,
    maxMinis: 4,
    maxMicros: 40,
  },
  NASDAQ: {
    symbol: 'NQ',
    microSymbol: 'MNQ',
    name: 'E-mini Nasdaq',
    pointValue: 20,
    microPointValue: 2,
    tick: 0.25,
    maxMinis: 4,
    maxMicros: 40,
  },
  NIKKEI: {
    symbol: 'NKD',
    microSymbol: null,
    name: 'Nikkei USD',
    pointValue: 5,
    microPointValue: null,
    tick: 5,
    maxMinis: 4,
    maxMicros: 0,
  },
}

export type TradovateMirrorTicket = {
  instrument: DeskIndex
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: 'LIMIT'
  tif: 'DAY'
  qty: number
  entry: number
  stop: number
  target: number
  stopPts: number
  pulseRiskDollars: number
  tradovateRiskDollars: number
  riskDeltaDollars: number
  snapped: boolean
  overCap: boolean
  sizeLabel: string
  copyText: string
}

function snapToTick(price: number, tick: number): number {
  if (!(tick > 0) || !Number.isFinite(price)) return price
  return Math.round(price / tick) * tick
}

function fmt(n: number, tick: number): string {
  const dec = tick < 1 ? 2 : tick >= 5 ? 0 : 2
  return n.toFixed(dec)
}

function pickQty(args: {
  risk: number
  stopPts: number
  contract: TradovateContract
}): { symbol: string; qty: number; pointValue: number; overCap: boolean } {
  const { risk, stopPts, contract } = args
  type Opt = { symbol: string; qty: number; pointValue: number; overCap: boolean; err: number }
  const opts: Opt[] = []

  const consider = (
    symbol: string,
    pointValue: number,
    maxQty: number
  ) => {
    const raw = risk / (stopPts * pointValue)
    if (!(raw > 0) || !Number.isFinite(raw)) return
    let qty = Math.round(raw)
    if (qty <= 0 && raw >= 0.45) qty = 1
    if (qty <= 0) return
    const overCap = maxQty > 0 && qty > maxQty
    if (overCap) qty = maxQty
    const actual = qty * stopPts * pointValue
    opts.push({
      symbol,
      qty,
      pointValue,
      overCap,
      err: Math.abs(actual - risk),
    })
  }

  if (contract.microSymbol && contract.microPointValue && contract.maxMicros > 0) {
    consider(contract.microSymbol, contract.microPointValue, contract.maxMicros)
  }
  consider(contract.symbol, contract.pointValue, contract.maxMinis)

  opts.sort((a, b) => {
    if (Math.abs(a.err - b.err) > 0.01) return a.err - b.err
    const aMicro = a.symbol === contract.microSymbol ? 0 : 1
    const bMicro = b.symbol === contract.microSymbol ? 0 : 1
    return aMicro - bMicro || a.qty - b.qty
  })
  const best = opts[0]
  if (!best) {
    return { symbol: contract.symbol, qty: 0, pointValue: contract.pointValue, overCap: false }
  }
  return {
    symbol: best.symbol,
    qty: best.qty,
    pointValue: best.pointValue,
    overCap: best.overCap,
  }
}

export function buildTradovateMirrorTicket(args: {
  instrument: DeskIndex
  direction: 'LONG' | 'SHORT' | 'long' | 'short'
  entry: number
  stop: number
  target: number
  riskDollars: number
  accountName?: string | null
}): TradovateMirrorTicket | null {
  const contract = TRADOVATE_CONTRACTS[args.instrument]
  if (!contract) return null
  const pulseEntry = Number(args.entry)
  const pulseStop = Number(args.stop)
  const pulseTarget = Number(args.target)
  const risk = Number(args.riskDollars)
  if (!(pulseEntry > 0) || !(pulseStop > 0) || !(pulseTarget > 0)) return null

  const isShort = String(args.direction).toUpperCase() === 'SHORT'
  if (isShort ? !(pulseStop > pulseEntry && pulseTarget < pulseEntry) : !(pulseStop < pulseEntry && pulseTarget > pulseEntry)) {
    return null
  }

  const tick = contract.tick
  const entry = snapToTick(pulseEntry, tick)
  const stop = snapToTick(pulseStop, tick)
  const target = snapToTick(pulseTarget, tick)
  if (isShort ? !(stop > entry && target < entry) : !(stop < entry && target > entry)) {
    return null
  }

  const stopPts = Math.abs(entry - stop)
  if (!(stopPts > 0)) return null

  const pulseRisk = risk > 0 ? risk : 0
  const picked =
    pulseRisk > 0
      ? pickQty({ risk: pulseRisk, stopPts, contract })
      : { symbol: contract.microSymbol ?? contract.symbol, qty: 0, pointValue: contract.microPointValue ?? contract.pointValue, overCap: false }

  const tradovateRisk = picked.qty > 0 ? picked.qty * stopPts * picked.pointValue : 0
  const side: 'BUY' | 'SELL' = isShort ? 'SELL' : 'BUY'
  const snapped =
    entry !== pulseEntry || stop !== pulseStop || target !== pulseTarget
  const acct = args.accountName?.trim() || 'Tradeify Growth'
  const sizeLabel = picked.qty > 0 ? `${picked.qty} ${picked.symbol}` : `set qty to risk $${Math.round(pulseRisk) || '—'}`

  const copyText = [
    `ACCOUNT  ${acct}`,
    `SYMBOL   ${picked.symbol}`,
    `SIDE     ${side}`,
    `TYPE     LIMIT`,
    `TIF      DAY`,
    `QTY      ${picked.qty > 0 ? picked.qty : '—'}`,
    `ENTRY    ${fmt(entry, tick)}`,
    `SL       ${fmt(stop, tick)}`,
    `TP       ${fmt(target, tick)}`,
    `RISK     $${tradovateRisk > 0 ? tradovateRisk.toFixed(2) : '—'}  (${stopPts} pts × ${picked.qty || 0} × $${picked.pointValue})`,
    pulseRisk > 0 && Math.abs(tradovateRisk - pulseRisk) > 1
      ? `NOTE     TradePulse risk was $${pulseRisk.toFixed(2)} — qty chosen to stay closest`
      : `NOTE     Same book as TradePulse ${args.instrument} ${isShort ? 'SHORT' : 'LONG'}`,
    snapped
      ? `NOTE     Prices snapped to ${picked.symbol} tick ${tick} (TradePulse ${fmt(pulseEntry, tick)} / ${fmt(pulseStop, tick)} / ${fmt(pulseTarget, tick)})`
      : null,
    picked.overCap ? `NOTE     Capped at Tradeify 50k max for ${picked.symbol}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    instrument: args.instrument,
    symbol: picked.symbol,
    side,
    orderType: 'LIMIT',
    tif: 'DAY',
    qty: picked.qty,
    entry,
    stop,
    target,
    stopPts,
    pulseRiskDollars: pulseRisk,
    tradovateRiskDollars: tradovateRisk,
    riskDeltaDollars: tradovateRisk - pulseRisk,
    snapped,
    overCap: picked.overCap,
    sizeLabel,
    copyText,
  }
}

export function tradovateMirrorStorageKey(id: string): string {
  return `tradepulse.tradovate.mirrored.${id}`
}
