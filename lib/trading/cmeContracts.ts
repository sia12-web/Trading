/**
 * CME Globex Futures Contract Specifications.
 * Point values, tick sizes, mini/micro symbols for DOW, NASDAQ, NIKKEI, GOLD, CRUDE.
 */

export const TRADINGVIEW_CHART_URL = 'https://www.tradingview.com/chart/'

export type DeskIndex = 'DOW' | 'NASDAQ' | 'NIKKEI' | 'GOLD' | 'CRUDE'

export type CmeContract = {
  symbol: string
  microSymbol: string | null
  name: string
  microName: string | null
  pointValue: number
  microPointValue: number | null
  tick: number
  maxMinis: number
  maxMicros: number
}

export const CME_CONTRACTS: Record<DeskIndex, CmeContract> = {
  DOW: {
    symbol: 'YM',
    microSymbol: 'MYM',
    name: 'E-mini Dow',
    microName: 'Micro E-mini Dow',
    pointValue: 5,
    microPointValue: 0.5,
    tick: 1,
    maxMinis: 4,
    maxMicros: 40,
  },
  NASDAQ: {
    symbol: 'NQ',
    microSymbol: 'MNQ',
    name: 'E-mini Nasdaq-100',
    microName: 'Micro E-mini Nasdaq-100',
    pointValue: 20,
    microPointValue: 2,
    tick: 0.25,
    maxMinis: 4,
    maxMicros: 40,
  },
  NIKKEI: {
    symbol: 'NKD',
    microSymbol: null,
    name: 'Nikkei 225 USD',
    microName: null,
    pointValue: 5,
    microPointValue: null,
    tick: 5,
    maxMinis: 4,
    maxMicros: 0,
  },
  GOLD: {
    symbol: 'GC',
    microSymbol: 'MGC',
    name: 'Gold Futures',
    microName: 'Micro Gold',
    pointValue: 100,
    microPointValue: 10,
    tick: 0.1,
    maxMinis: 4,
    maxMicros: 40,
  },
  CRUDE: {
    symbol: 'CL',
    microSymbol: 'MCL',
    name: 'Crude Oil',
    microName: 'Micro WTI Crude',
    pointValue: 1000,
    microPointValue: 100,
    tick: 0.01,
    maxMinis: 4,
    maxMicros: 40,
  },
}

export function deskFuturesTitle(instrument: string): string {
  switch (instrument) {
    case 'DOW':
      return 'Dow'
    case 'NASDAQ':
      return 'Nasdaq'
    case 'NIKKEI':
      return 'Nikkei'
    case 'GOLD':
      return 'Gold'
    case 'CRUDE':
      return 'Crude'
    default:
      return instrument
  }
}

export function deskFuturesSymbols(instrument: DeskIndex): string {
  const c = CME_CONTRACTS[instrument]
  return c.microSymbol ? `${c.symbol} / ${c.microSymbol}` : c.symbol
}

export function contractDisplayName(symbol: string, instrument: DeskIndex): string {
  const c = CME_CONTRACTS[instrument]
  if (c.microSymbol && symbol === c.microSymbol) return c.microName || c.name
  return c.name
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
  contract: CmeContract
}): { symbol: string; qty: number; pointValue: number; overCap: boolean } {
  const { risk, stopPts, contract } = args
  type Opt = { symbol: string; qty: number; pointValue: number; overCap: boolean; err: number }
  const opts: Opt[] = []

  const consider = (symbol: string, pointValue: number, maxQty: number) => {
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
  } else {
    consider(contract.symbol, contract.pointValue, contract.maxMinis)
  }

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
  contractLabel: string
  copyText: string
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
  const contract = CME_CONTRACTS[args.instrument]
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
  const snapped = entry !== pulseEntry || stop !== pulseStop || target !== pulseTarget
  const acct = args.accountName?.trim() || 'Personal Futures'
  const contractLabel = contractDisplayName(picked.symbol, args.instrument)
  const sizeLabel =
    picked.qty > 0
      ? `${picked.qty} ${picked.symbol} · ${contractLabel}`
      : `set qty to risk $${Math.round(pulseRisk) || '—'}`

  const copyText = [
    `ACCOUNT  ${acct}`,
    `CONTRACT ${contractLabel}`,
    `SYMBOL   ${picked.symbol}`,
    `SIDE     ${side}`,
    `TYPE     LIMIT`,
    `TIF      DAY`,
    `QTY      ${picked.qty > 0 ? picked.qty : '—'}`,
    `ENTRY    ${fmt(entry, tick)}`,
    `SL       ${fmt(stop, tick)}`,
    `TP       ${fmt(target, tick)}`,
    `RISK     $${tradovateRisk > 0 ? tradovateRisk.toFixed(2) : '—'}  (${stopPts} pts × ${picked.qty || 0} × $${picked.pointValue})`,
    contract.microSymbol ? `NOTE     Micro only — do not use the E-mini (${contract.symbol}).` : null,
  ].filter(Boolean).join('\n')

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
    contractLabel,
    copyText,
  }
}

export function tradovateMirrorStorageKey(id: string): string {
  return `personal.ticket.${id}`
}

export function deskBookLines(args: {
  instrument: string
  direction: string
  entry: number
  stop: number
  target: number
  riskDollars?: number
}): {
  entry: number
  stop: number
  target: number
  qty: number
  symbol: string | null
  sizeNote: string
} {
  const pulse = {
    entry: Number(args.entry),
    stop: Number(args.stop),
    target: Number(args.target),
    qty: 0,
    symbol: null as string | null,
    sizeNote: '',
  }
  const inst = args.instrument as DeskIndex
  if (inst !== 'DOW' && inst !== 'NASDAQ' && inst !== 'NIKKEI' && inst !== 'GOLD' && inst !== 'CRUDE') return pulse
  const ticket = buildTradovateMirrorTicket({
    instrument: inst,
    direction: args.direction as 'LONG' | 'SHORT',
    entry: args.entry,
    stop: args.stop,
    target: args.target,
    riskDollars: args.riskDollars ?? 0,
  })
  if (!ticket) return pulse
  return {
    entry: ticket.entry,
    stop: ticket.stop,
    target: ticket.target,
    qty: ticket.qty,
    symbol: ticket.symbol,
    sizeNote: ticket.qty > 0 ? `${ticket.qty} ${ticket.symbol}` : ticket.symbol,
  }
}

export function tradingViewSymbol(symbol: string): string {
  switch (symbol) {
    case 'MNQ':
      return 'CME_MINI:MNQ1!'
    case 'NQ':
      return 'CME_MINI:NQ1!'
    case 'MYM':
      return 'CBOT_MINI:MYM1!'
    case 'YM':
      return 'CBOT_MINI:YM1!'
    case 'NKD':
      return 'CME:NKD1!'
    case 'MGC':
      return 'COMEX:MGC1!'
    case 'GC':
      return 'COMEX:GC1!'
    case 'CL':
      return 'NYMEX:CL1!'
    case 'MCL':
      return 'NYMEX:MCL1!'
    default:
      return symbol
  }
}

export function tradingViewChartUrl(symbol: string): string {
  return `${TRADINGVIEW_CHART_URL}?symbol=${encodeURIComponent(tradingViewSymbol(symbol))}`
}

export type TradovateContract = CmeContract
export const TRADOVATE_CONTRACTS = CME_CONTRACTS
