/**
 * TradePulse → TradingView transfer ticket (Tradeify / CME front month).
 * Same side, entry, SL, TP, and dollar risk — one legal Tradeify contract.
 * Growth eval has no API; paste Price / Units / SL / TP into TradingView.
 */

export const TRADOVATE_TRADER_URL = 'https://trader.tradovate.com'
export const TRADINGVIEW_CHART_URL = 'https://www.tradingview.com/chart/'

export type DeskIndex = 'DOW' | 'NASDAQ' | 'NIKKEI'

export type TradovateContract = {
  symbol: string
  /** Null when Tradeify does not list a micro (Nikkei = NKD only). */
  microSymbol: string | null
  name: string
  microName: string | null
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
}

/** Short chart-tab label: E-mini Dow, E-mini Nasdaq, Nikkei USD. */
export function deskFuturesTitle(instrument: DeskIndex): string {
  return TRADOVATE_CONTRACTS[instrument].name
}

/** YM / MYM · NQ / MNQ · NKD */
export function deskFuturesSymbols(instrument: DeskIndex): string {
  const c = TRADOVATE_CONTRACTS[instrument]
  return c.microSymbol ? `${c.symbol} / ${c.microSymbol}` : c.symbol
}

export function deskFuturesTabLabel(instrument: DeskIndex): string {
  return `${deskFuturesTitle(instrument)} (${deskFuturesSymbols(instrument)})`
}

export function contractDisplayName(symbol: string, instrument: DeskIndex): string {
  const c = TRADOVATE_CONTRACTS[instrument]
  if (c.microSymbol && symbol === c.microSymbol) return c.microName || c.name
  return c.name
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

  // Live $50k book is micro-only (MYM / MNQ). Never fall back to YM / NQ
  // even when 1 mini is a closer dollar match. Nikkei has no micro → NKD (sim).
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
    pulseRisk > 0 && Math.abs(tradovateRisk - pulseRisk) > 1
      ? `NOTE     TradePulse risk was $${pulseRisk.toFixed(2)} — qty chosen to stay closest`
      : `NOTE     Same book as TradePulse ${args.instrument} ${isShort ? 'SHORT' : 'LONG'}`,
    `NOTE     Paste into TradingView Limit: Price = ENTRY, Units = QTY. Turn on SL/TP and paste those prices.`,
    contract.microSymbol
      ? `NOTE     Micro only — do not use the E-mini (${contract.symbol}).`
      : null,
    snapped
      ? `NOTE     Prices snapped to ${picked.symbol} tick ${tick} (TradePulse ${fmt(pulseEntry, tick)} / ${fmt(pulseStop, tick)} / ${fmt(pulseTarget, tick)})`
      : null,
    picked.overCap ? `NOTE     Capped at Tradeify 50k max for ${picked.symbol}` : null,
    `NOTE     Front month only — do not mix a mini and a micro at the same time`,
    `NOTE     Flatten: cancel leftover working orders by 16:59 ET (12:59 ET holiday)`,
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
    contractLabel,
    copyText,
  }
}

export function tradovateMirrorStorageKey(id: string): string {
  return `tradepulse.tradovate.mirrored.${id}`
}

/** Chart lines + chips use the same Entry / SL / TP / size as the TradingView paste card. */
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
  const inst = args.instrument
  if (inst !== 'DOW' && inst !== 'NASDAQ' && inst !== 'NIKKEI') return pulse
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

/** TradingView continuous root for the sized Tradeify contract. */
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
    default:
      return symbol
  }
}

export function tradingViewChartUrl(symbol: string): string {
  return `${TRADINGVIEW_CHART_URL}?symbol=${encodeURIComponent(tradingViewSymbol(symbol))}`
}
