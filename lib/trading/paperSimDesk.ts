/**
 * $1,500 paper desk — one wallet per NYC market (DOW / NASDAQ / GOLD / CRUDE).
 * Client-side ledger for Leo + chart practice. Never touches the live Tradeify book.
 */

export const PAPER_SIM_STARTING_BALANCE = 1500
export const PAPER_SIM_MARKETS = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE'] as const
export type PaperSimMarket = (typeof PAPER_SIM_MARKETS)[number]

export type PaperSimSide = 'LONG' | 'SHORT'

export type PaperSimPosition = {
  id: string
  market: PaperSimMarket
  side: PaperSimSide
  qty: number
  entry: number
  stop: number
  target: number
  riskUsd: number
  openedAt: number
  reason: string
}

export type PaperSimWorking = {
  id: string
  market: PaperSimMarket
  side: PaperSimSide
  orderType: 'LIMIT' | 'STOP'
  trigger: number
  stop: number
  target: number
  qty: number
  riskUsd: number
  createdAt: number
  reason: string
}

export type PaperSimLedger = {
  market: PaperSimMarket
  equity: number
  position: PaperSimPosition | null
  working: PaperSimWorking | null
  closedPnl: number
}

const STORAGE_KEY = 'tradepulse.paperSim.v1'

function emptyLedger(market: PaperSimMarket): PaperSimLedger {
  return {
    market,
    equity: PAPER_SIM_STARTING_BALANCE,
    position: null,
    working: null,
    closedPnl: 0,
  }
}

/** In-memory store so Node tests / SSR keep state without localStorage. */
const memoryLedgers: Record<PaperSimMarket, PaperSimLedger> = {
  DOW: emptyLedger('DOW'),
  NASDAQ: emptyLedger('NASDAQ'),
  GOLD: emptyLedger('GOLD'),
  CRUDE: emptyLedger('CRUDE'),
}

export function isPaperSimMarket(v: string): v is PaperSimMarket {
  return (PAPER_SIM_MARKETS as readonly string[]).includes(v)
}

/** Point value used only for paper P&L display (not broker contract specs). */
export function paperPointValueUsd(market: PaperSimMarket): number {
  switch (market) {
    case 'DOW':
      return 0.5 // MYM-ish
    case 'NASDAQ':
      return 0.5 // MNQ-ish
    case 'GOLD':
      return 1.0 // MGC-ish
    case 'CRUDE':
      return 1.0
    default:
      return 1
  }
}

export function loadAllPaperLedgers(): Record<PaperSimMarket, PaperSimLedger> {
  const base = {
    DOW: { ...memoryLedgers.DOW },
    NASDAQ: { ...memoryLedgers.NASDAQ },
    GOLD: { ...memoryLedgers.GOLD },
    CRUDE: { ...memoryLedgers.CRUDE },
  }
  if (typeof window === 'undefined') return base
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Record<PaperSimMarket, PaperSimLedger>>
    for (const m of PAPER_SIM_MARKETS) {
      const row = parsed[m]
      if (row && typeof row.equity === 'number') {
        base[m] = { ...emptyLedger(m), ...row, market: m }
        memoryLedgers[m] = base[m]
      }
    }
  } catch {
    /* ignore */
  }
  return base
}

export function loadPaperLedger(market: PaperSimMarket): PaperSimLedger {
  return loadAllPaperLedgers()[market]
}

export function savePaperLedger(ledger: PaperSimLedger): void {
  memoryLedgers[ledger.market] = { ...ledger }
  if (typeof window === 'undefined') return
  const all = loadAllPaperLedgers()
  all[ledger.market] = ledger
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* private mode */
  }
}

export function resetPaperLedger(market: PaperSimMarket): PaperSimLedger {
  const next = emptyLedger(market)
  savePaperLedger(next)
  return next
}

/** Size contracts so stop distance risks ~riskPct of equity (default 1%). */
export function sizePaperContracts(args: {
  market: PaperSimMarket
  equity: number
  entry: number
  stop: number
  riskPct?: number
}): { qty: number; riskUsd: number } {
  const riskPct = args.riskPct ?? 0.01
  const riskUsd = Math.max(5, args.equity * riskPct)
  const stopPts = Math.abs(args.entry - args.stop)
  const pv = paperPointValueUsd(args.market)
  if (!(stopPts > 0) || !(pv > 0)) return { qty: 1, riskUsd }
  const qty = Math.max(1, Math.floor(riskUsd / (stopPts * pv)))
  return { qty, riskUsd: qty * stopPts * pv }
}

export function openPaperMarket(args: {
  market: PaperSimMarket
  side: PaperSimSide
  entry: number
  stop: number
  target: number
  reason: string
  riskPct?: number
}): { ok: true; ledger: PaperSimLedger } | { ok: false; error: string } {
  const ledger = loadPaperLedger(args.market)
  if (ledger.position) return { ok: false, error: `${args.market} paper already in a trade` }
  if (ledger.working) return { ok: false, error: `${args.market} paper already has a working order` }
  const { qty, riskUsd } = sizePaperContracts({
    market: args.market,
    equity: ledger.equity,
    entry: args.entry,
    stop: args.stop,
    riskPct: args.riskPct,
  })
  const position: PaperSimPosition = {
    id: `paper-${args.market}-${Date.now()}`,
    market: args.market,
    side: args.side,
    qty,
    entry: args.entry,
    stop: args.stop,
    target: args.target,
    riskUsd,
    openedAt: Date.now(),
    reason: args.reason,
  }
  const next: PaperSimLedger = { ...ledger, position, working: null }
  savePaperLedger(next)
  return { ok: true, ledger: next }
}

export function placePaperWorking(args: {
  market: PaperSimMarket
  side: PaperSimSide
  orderType: 'LIMIT' | 'STOP'
  trigger: number
  stop: number
  target: number
  reason: string
  riskPct?: number
}): { ok: true; ledger: PaperSimLedger } | { ok: false; error: string } {
  const ledger = loadPaperLedger(args.market)
  if (ledger.position) return { ok: false, error: `${args.market} paper already in a trade` }
  if (ledger.working) return { ok: false, error: `${args.market} paper already has a working order` }
  const { qty, riskUsd } = sizePaperContracts({
    market: args.market,
    equity: ledger.equity,
    entry: args.trigger,
    stop: args.stop,
    riskPct: args.riskPct,
  })
  const working: PaperSimWorking = {
    id: `paper-work-${args.market}-${Date.now()}`,
    market: args.market,
    side: args.side,
    orderType: args.orderType,
    trigger: args.trigger,
    stop: args.stop,
    target: args.target,
    qty,
    riskUsd,
    createdAt: Date.now(),
    reason: args.reason,
  }
  const next: PaperSimLedger = { ...ledger, working }
  savePaperLedger(next)
  return { ok: true, ledger: next }
}

export function cancelPaperWorking(market: PaperSimMarket): PaperSimLedger {
  const ledger = loadPaperLedger(market)
  const next = { ...ledger, working: null }
  savePaperLedger(next)
  return next
}

/** Fill working when price trades through trigger. */
export function tryFillPaperWorking(
  market: PaperSimMarket,
  lastPrice: number
): PaperSimLedger {
  const ledger = loadPaperLedger(market)
  const w = ledger.working
  if (!w || ledger.position) return ledger
  const hit =
    w.orderType === 'LIMIT'
      ? w.side === 'LONG'
        ? lastPrice <= w.trigger
        : lastPrice >= w.trigger
      : w.side === 'LONG'
        ? lastPrice >= w.trigger
        : lastPrice <= w.trigger
  if (!hit) return ledger
  const position: PaperSimPosition = {
    id: `paper-${market}-${Date.now()}`,
    market,
    side: w.side,
    qty: w.qty,
    entry: w.trigger,
    stop: w.stop,
    target: w.target,
    riskUsd: w.riskUsd,
    openedAt: Date.now(),
    reason: w.reason,
  }
  const next: PaperSimLedger = { ...ledger, position, working: null }
  savePaperLedger(next)
  return next
}

export function updatePaperBrackets(
  market: PaperSimMarket,
  patch: { stop?: number; target?: number }
): { ok: true; ledger: PaperSimLedger } | { ok: false; error: string } {
  const ledger = loadPaperLedger(market)
  if (!ledger.position) return { ok: false, error: 'No paper position' }
  const position = {
    ...ledger.position,
    stop: patch.stop ?? ledger.position.stop,
    target: patch.target ?? ledger.position.target,
  }
  const next = { ...ledger, position }
  savePaperLedger(next)
  return { ok: true, ledger: next }
}

export function closePaperPosition(
  market: PaperSimMarket,
  exitPrice: number,
  reason: string
): { ok: true; ledger: PaperSimLedger; pnlUsd: number } | { ok: false; error: string } {
  const ledger = loadPaperLedger(market)
  const pos = ledger.position
  if (!pos) return { ok: false, error: 'No paper position' }
  const pts =
    pos.side === 'LONG' ? exitPrice - pos.entry : pos.entry - exitPrice
  const pnlUsd = pts * pos.qty * paperPointValueUsd(market)
  const next: PaperSimLedger = {
    ...ledger,
    position: null,
    equity: Math.max(0, ledger.equity + pnlUsd),
    closedPnl: ledger.closedPnl + pnlUsd,
  }
  savePaperLedger(next)
  void reason
  return { ok: true, ledger: next, pnlUsd }
}

/** Stop / target hits while a paper position is open. */
export function markPaperPosition(
  market: PaperSimMarket,
  lastPrice: number
): PaperSimLedger {
  const ledger = loadPaperLedger(market)
  const pos = ledger.position
  if (!pos) return ledger
  const stopHit =
    pos.side === 'LONG' ? lastPrice <= pos.stop : lastPrice >= pos.stop
  const tgtHit =
    pos.side === 'LONG' ? lastPrice >= pos.target : lastPrice <= pos.target
  if (stopHit) {
    const r = closePaperPosition(market, pos.stop, 'stop_hit')
    return r.ok ? r.ledger : ledger
  }
  if (tgtHit) {
    const r = closePaperPosition(market, pos.target, 'take_profit')
    return r.ok ? r.ledger : ledger
  }
  return ledger
}
