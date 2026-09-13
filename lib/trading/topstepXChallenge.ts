/**
 * TopstepX Prop Firm $1,500 Challenge Engine & Order History
 *
 * Rules:
 * - Challenge: TopstepX $1,500 Challenge
 * - Profit Target: +$1,500.00 (Pass & keep $1,500)
 * - Maximum Loss Floor: -$500.00 (MUST NOT hit negative $500)
 * - Account for copy-trading: User executes on desk and copies to TopstepX.
 */

export interface TopstepXTrade {
  ticketId: string
  contract: string
  instrument: 'NASDAQ' | 'DOW' | 'GOLD' | 'CRUDE' | 'RUSSELL'
  quantity: number
  entryTime: string
  exitTime: string
  duration: string
  entryPrice: number
  exitPrice: number
  grossPnl: number
  feeCommission: number
  feeExchange: number
  totalFees: number
  netPnl: number
  direction: 'LONG' | 'SHORT'
}

export const TOPSTEPX_RULES = {
  challengeName: 'TopstepX $1,500 Challenge',
  profitTarget: 1500,
  maxLossLimit: 500,
  breachFloor: -500,
  payoutReward: 1500,
  recommendedMaxRiskPerTrade: 50, // $50 max risk allows 4-5 attempts within remaining room
} as const

export interface TopstepXOcoBracket {
  name: string
  ratio: '1:1' | '1:2' | '1:3' | '1:5'
  stopLossDollars: number
  takeProfitDollars: number
}

/**
 * TopstepX Auto OCO Bracket Presets ($50 Fixed Risk Base)
 */
export const TOPSTEPX_OCO_BRACKETS: Record<'1:1' | '1:2' | '1:3' | '1:5', TopstepXOcoBracket> = {
  '1:1': { name: '1:1 (50-50)', ratio: '1:1', stopLossDollars: 50, takeProfitDollars: 50 },
  '1:2': { name: '(1:2) (50-100)', ratio: '1:2', stopLossDollars: 50, takeProfitDollars: 100 },
  '1:3': { name: '(1:3) (50-150)', ratio: '1:3', stopLossDollars: 50, takeProfitDollars: 150 },
  '1:5': { name: '(1:5) (50-250)', ratio: '1:5', stopLossDollars: 50, takeProfitDollars: 250 },
}

/**
 * Normalizes user spoken or typed bracket strings (e.g. "1 to 2", "1:2", "50-100", "1 to 3", "1:3").
 */
export function normalizeBracketRatio(raw?: string | null): '1:1' | '1:2' | '1:3' | '1:5' | null {
  if (!raw) return null
  const s = raw.toLowerCase().trim()
  if (/1[:\s\-_to]+1|50[-_\s]*50/.test(s)) return '1:1'
  if (/1[:\s\-_to]+2|50[-_\s]*100/.test(s)) return '1:2'
  if (/1[:\s\-_to]+3|50[-_\s]*150/.test(s)) return '1:3'
  if (/1[:\s\-_to]+5|50[-_\s]*250/.test(s)) return '1:5'
  return null
}

/**
 * Point values per CME contract point
 */
export const INSTRUMENT_POINT_VALUES: Record<string, number> = {
  NASDAQ: 2.0,
  MNQ: 2.0,
  NQ: 2.0,
  DOW: 0.5,
  MYM: 0.5,
  YM: 0.5,
  GOLD: 10.0,
  MGC: 10.0,
  GC: 10.0,
  CRUDE: 100.0,
  MCL: 100.0,
  CL: 100.0,
  RUSSELL: 5.0,
  M2K: 5.0,
  RTY: 5.0,
}

/**
 * Calculates exact Stop Loss and Take Profit prices for a specified TopstepX OCO bracket ratio.
 */
export function calculateBracketPrices(args: {
  instrument: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  bracketRatio: '1:1' | '1:2' | '1:3' | '1:5'
  quantity?: number
}): {
  stopLossPrice: number
  takeProfitPrice: number
  dollarRisk: number
  dollarReward: number
  stopLossPts: number
  takeProfitPts: number
  bracketName: string
} {
  const { instrument, direction, entryPrice, bracketRatio, quantity = 1 } = args
  const bracket = TOPSTEPX_OCO_BRACKETS[bracketRatio] || TOPSTEPX_OCO_BRACKETS['1:2']
  const norm = instrument.toUpperCase()
  const pv = INSTRUMENT_POINT_VALUES[norm] || 2.0

  const slPts = Math.round((bracket.stopLossDollars / (pv * quantity)) * 100) / 100
  const tpPts = Math.round((bracket.takeProfitDollars / (pv * quantity)) * 100) / 100

  const stopLossPrice =
    direction === 'LONG'
      ? Math.round((entryPrice - slPts) * 100) / 100
      : Math.round((entryPrice + slPts) * 100) / 100

  const takeProfitPrice =
    direction === 'LONG'
      ? Math.round((entryPrice + tpPts) * 100) / 100
      : Math.round((entryPrice - tpPts) * 100) / 100

  return {
    stopLossPrice,
    takeProfitPrice,
    dollarRisk: bracket.stopLossDollars,
    dollarReward: bracket.takeProfitDollars,
    stopLossPts: slPts,
    takeProfitPts: tpPts,
    bracketName: bracket.name,
  }
}

/**
 * The 18 verified TopstepX executed orders provided by the trader.
 */
export const TOPSTEPX_ORDER_HISTORY: TopstepXTrade[] = [
  {
    ticketId: '3086461113',
    contract: 'MNQU26',
    instrument: 'NASDAQ',
    quantity: 1,
    entryTime: '2026-09-10T21:03:58.000Z',
    exitTime: '2026-09-10T21:15:21.000Z',
    duration: '00:11:23',
    entryPrice: 29168.0,
    exitPrice: 29144.75,
    grossPnl: -46.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -47.72,
    direction: 'LONG',
  },
  {
    ticketId: '3075014407',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T14:21:30.000Z',
    exitTime: '2026-09-08T14:21:49.000Z',
    duration: '00:00:19',
    entryPrice: 52921.0,
    exitPrice: 52918.0,
    grossPnl: -1.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -2.72,
    direction: 'LONG',
  },
  {
    ticketId: '3075014406',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T13:52:15.000Z',
    exitTime: '2026-09-08T14:21:49.000Z',
    duration: '00:29:34',
    entryPrice: 52939.0,
    exitPrice: 52918.0,
    grossPnl: -10.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -11.72,
    direction: 'LONG',
  },
  {
    ticketId: '3074902361',
    contract: 'MGCZ26',
    instrument: 'GOLD',
    quantity: 1,
    entryTime: '2026-09-08T13:36:27.000Z',
    exitTime: '2026-09-08T13:40:08.000Z',
    duration: '00:03:41',
    entryPrice: 4435.4,
    exitPrice: 4433.7,
    grossPnl: 17.0,
    feeCommission: 0.5,
    feeExchange: 1.42,
    totalFees: 1.92,
    netPnl: 15.08,
    direction: 'SHORT',
  },
  {
    ticketId: '3074773191',
    contract: 'MGCZ26',
    instrument: 'GOLD',
    quantity: 1,
    entryTime: '2026-09-08T13:00:25.000Z',
    exitTime: '2026-09-08T13:00:57.000Z',
    duration: '00:00:32',
    entryPrice: 4440.0,
    exitPrice: 4440.4,
    grossPnl: 4.0,
    feeCommission: 0.5,
    feeExchange: 1.42,
    totalFees: 1.92,
    netPnl: 2.08,
    direction: 'LONG',
  },
  {
    ticketId: '3074755182',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T12:56:42.000Z',
    exitTime: '2026-09-08T12:58:49.000Z',
    duration: '00:02:06',
    entryPrice: 52862.0,
    exitPrice: 52862.0,
    grossPnl: 0.0,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -1.22,
    direction: 'LONG',
  },
  {
    ticketId: '3074744903',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T12:44:15.000Z',
    exitTime: '2026-09-08T12:56:18.000Z',
    duration: '00:12:02',
    entryPrice: 52841.0,
    exitPrice: 52840.0,
    grossPnl: -0.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -1.72,
    direction: 'LONG',
  },
  {
    ticketId: '3074685801',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T12:41:35.000Z',
    exitTime: '2026-09-08T12:42:14.000Z',
    duration: '00:00:38',
    entryPrice: 52838.0,
    exitPrice: 52841.0,
    grossPnl: 1.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: 0.28,
    direction: 'LONG',
  },
  {
    ticketId: '3074581741',
    contract: 'MGCZ26',
    instrument: 'GOLD',
    quantity: 1,
    entryTime: '2026-09-08T12:14:24.000Z',
    exitTime: '2026-09-08T12:18:39.000Z',
    duration: '00:04:15',
    entryPrice: 4430.5,
    exitPrice: 4430.6,
    grossPnl: 1.0,
    feeCommission: 0.5,
    feeExchange: 1.42,
    totalFees: 1.92,
    netPnl: -0.92,
    direction: 'LONG',
  },
  {
    ticketId: '3074554914',
    contract: 'MGCZ26',
    instrument: 'GOLD',
    quantity: 1,
    entryTime: '2026-09-08T12:12:47.000Z',
    exitTime: '2026-09-08T12:13:36.000Z',
    duration: '00:00:48',
    entryPrice: 4428.5,
    exitPrice: 4427.1,
    grossPnl: -14.0,
    feeCommission: 0.5,
    feeExchange: 1.42,
    totalFees: 1.92,
    netPnl: -15.92,
    direction: 'LONG',
  },
  {
    ticketId: '3074544696',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T12:02:36.000Z',
    exitTime: '2026-09-08T12:11:25.000Z',
    duration: '00:08:49',
    entryPrice: 52863.0,
    exitPrice: 52835.0,
    grossPnl: -14.0,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -15.22,
    direction: 'LONG',
  },
  {
    ticketId: '3074336524',
    contract: 'MCLV26',
    instrument: 'CRUDE',
    quantity: 1,
    entryTime: '2026-09-08T11:23:11.000Z',
    exitTime: '2026-09-08T11:32:15.000Z',
    duration: '00:09:04',
    entryPrice: 93.14,
    exitPrice: 92.64,
    grossPnl: -50.0,
    feeCommission: 0.5,
    feeExchange: 1.02,
    totalFees: 1.52,
    netPnl: -51.52,
    direction: 'LONG',
  },
  {
    ticketId: '3074253712',
    contract: 'MGCZ26',
    instrument: 'GOLD',
    quantity: 1,
    entryTime: '2026-09-08T11:11:55.000Z',
    exitTime: '2026-09-08T11:21:26.000Z',
    duration: '00:09:30',
    entryPrice: 4452.2,
    exitPrice: 4447.1,
    grossPnl: -51.0,
    feeCommission: 0.5,
    feeExchange: 1.42,
    totalFees: 1.92,
    netPnl: -52.92,
    direction: 'LONG',
  },
  {
    ticketId: '3074129219',
    contract: 'MNQU26',
    instrument: 'NASDAQ',
    quantity: 1,
    entryTime: '2026-09-08T11:04:53.000Z',
    exitTime: '2026-09-08T11:05:35.000Z',
    duration: '00:00:42',
    entryPrice: 29560.75,
    exitPrice: 29566.25,
    grossPnl: -11.0,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -12.22,
    direction: 'SHORT',
  },
  {
    ticketId: '3073984817',
    contract: 'MNQU26',
    instrument: 'NASDAQ',
    quantity: 1,
    entryTime: '2026-09-08T10:41:30.000Z',
    exitTime: '2026-09-08T10:47:00.000Z',
    duration: '00:05:29',
    entryPrice: 29521.75,
    exitPrice: 29525.0,
    grossPnl: 6.5,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: 5.28,
    direction: 'LONG',
  },
  {
    ticketId: '3073889124',
    contract: 'MCLV26',
    instrument: 'CRUDE',
    quantity: 1,
    entryTime: '2026-09-08T10:15:00.000Z',
    exitTime: '2026-09-08T10:34:59.000Z',
    duration: '00:19:58',
    entryPrice: 93.49,
    exitPrice: 92.99,
    grossPnl: -50.0,
    feeCommission: 0.5,
    feeExchange: 1.02,
    totalFees: 1.52,
    netPnl: -51.52,
    direction: 'LONG',
  },
  {
    ticketId: '3073617474',
    contract: 'MNQU26',
    instrument: 'NASDAQ',
    quantity: 1,
    entryTime: '2026-09-08T10:10:33.000Z',
    exitTime: '2026-09-08T10:11:01.000Z',
    duration: '00:00:28',
    entryPrice: 29446.75,
    exitPrice: 29445.25,
    grossPnl: 3.0,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: 1.78,
    direction: 'SHORT',
  },
  {
    ticketId: '3073466436',
    contract: 'MYMU26',
    instrument: 'DOW',
    quantity: 1,
    entryTime: '2026-09-08T09:40:48.000Z',
    exitTime: '2026-09-08T10:01:46.000Z',
    duration: '00:20:57',
    entryPrice: 52946.0,
    exitPrice: 52896.0,
    grossPnl: -25.0,
    feeCommission: 0.5,
    feeExchange: 0.72,
    totalFees: 1.22,
    netPnl: -26.22,
    direction: 'LONG',
  },
]

export interface TopstepXChallengeState {
  challengeName: string
  profitTarget: number
  maxLossFloor: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  totalGrossPnl: number
  totalFees: number
  totalNetPnl: number
  remainingRoomToBreach: number
  breachCushionPercent: number
  distanceToTarget: number
  targetProgressPercent: number
  status: 'ACTIVE_WARNING' | 'ACTIVE_NORMAL' | 'PASSED' | 'BREACHED'
  riskRecommendation: string
}

/**
 * Computes live metrics for the TopstepX $1,500 challenge.
 */
export function computeTopstepXChallengeState(
  trades: TopstepXTrade[] = TOPSTEPX_ORDER_HISTORY
): TopstepXChallengeState {
  const totalTrades = trades.length
  let wins = 0
  let losses = 0
  let totalGross = 0
  let totalFees = 0
  let totalNet = 0

  for (const t of trades) {
    totalGross += t.grossPnl
    totalFees += t.totalFees
    totalNet += t.netPnl
    if (t.netPnl > 0) wins++
    else if (t.netPnl < 0) losses++
  }

  totalGross = Math.round(totalGross * 100) / 100
  totalFees = Math.round(totalFees * 100) / 100
  totalNet = Math.round(totalNet * 100) / 100

  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0
  const remainingRoomToBreach = Math.max(0, Math.round((TOPSTEPX_RULES.maxLossLimit + totalNet) * 100) / 100)
  const breachCushionPercent = Math.round((remainingRoomToBreach / TOPSTEPX_RULES.maxLossLimit) * 1000) / 10
  const distanceToTarget = Math.max(0, Math.round((TOPSTEPX_RULES.profitTarget - totalNet) * 100) / 100)
  const targetProgressPercent = totalNet > 0 ? Math.min(100, Math.round((totalNet / TOPSTEPX_RULES.profitTarget) * 1000) / 10) : 0

  let status: TopstepXChallengeState['status'] = 'ACTIVE_NORMAL'
  if (totalNet <= TOPSTEPX_RULES.breachFloor) {
    status = 'BREACHED'
  } else if (totalNet >= TOPSTEPX_RULES.profitTarget) {
    status = 'PASSED'
  } else if (remainingRoomToBreach < 300) {
    status = 'ACTIVE_WARNING'
  }

  let riskRecommendation = ''
  if (remainingRoomToBreach < 250) {
    riskRecommendation = `CAUTION: Only $${remainingRoomToBreach.toFixed(2)} remaining before -$500 breach floor! Limit stop loss risk to $40–$50 per trade (e.g. 20–25 pts on MNQ).`
  } else {
    riskRecommendation = `Pacing: Target +$${TOPSTEPX_RULES.profitTarget}. Keep stop loss risk within $50–$75 per trade.`
  }

  return {
    challengeName: TOPSTEPX_RULES.challengeName,
    profitTarget: TOPSTEPX_RULES.profitTarget,
    maxLossFloor: TOPSTEPX_RULES.breachFloor,
    totalTrades,
    winningTrades: wins,
    losingTrades: losses,
    winRate,
    totalGrossPnl: totalGross,
    totalFees,
    totalNetPnl: totalNet,
    remainingRoomToBreach,
    breachCushionPercent,
    distanceToTarget,
    targetProgressPercent,
    status,
    riskRecommendation,
  }
}

/**
 * Validates a proposed order against the TopstepX -$500 loss limit before execution / copy.
 */
export function validateTopstepXOrderRisk(args: {
  instrument: string
  entryPrice: number
  stopLossPrice: number
  quantity?: number
  currentState?: TopstepXChallengeState
}): {
  allowed: boolean
  dollarRisk: number
  remainingRoomAfterLoss: number
  warning?: string
  copyCommand: string
} {
  const { instrument, entryPrice, stopLossPrice, quantity = 1 } = args
  const state = args.currentState || computeTopstepXChallengeState()

  // Point value per full point
  const pointValues: Record<string, number> = {
    NASDAQ: 2.0, // MNQ $2/pt
    MNQ: 2.0,
    DOW: 0.5, // MYM $0.50/pt
    MYM: 0.5,
    GOLD: 10.0, // MGC $10/pt ($1/0.1)
    MGC: 10.0,
    CRUDE: 100.0, // MCL $100/pt ($1/0.01)
    MCL: 100.0,
    RUSSELL: 5.0, // M2K $5/pt
    M2K: 5.0,
  }

  const norm = instrument.toUpperCase()
  const pv = pointValues[norm] || 2.0
  const priceDistance = Math.abs(entryPrice - stopLossPrice)
  const estFees = 1.5 * quantity
  const dollarRisk = Math.round((priceDistance * pv * quantity + estFees) * 100) / 100
  const remainingRoomAfterLoss = Math.round((state.remainingRoomToBreach - dollarRisk) * 100) / 100

  const isLong = entryPrice >= stopLossPrice
  const side = isLong ? 'BUY' : 'SELL'
  const contract =
    norm === 'NASDAQ' || norm === 'MNQ' || norm === 'NQ'
      ? 'MNQU26'
      : norm === 'DOW' || norm === 'MYM' || norm === 'YM'
        ? 'MYMU26'
        : norm === 'GOLD' || norm === 'MGC' || norm === 'GC'
          ? 'MGCZ26'
          : norm === 'CRUDE' || norm === 'MCL' || norm === 'CL'
            ? 'MCLV26'
            : norm === 'RUSSELL' || norm === 'M2K' || norm === 'RTY'
              ? 'M2KU26'
              : norm

  const copyCommand = `${side} ${quantity} ${contract} @ ${entryPrice.toFixed(2)} | SL: ${stopLossPrice.toFixed(2)} (-$${dollarRisk.toFixed(2)})`

  if (dollarRisk >= state.remainingRoomToBreach) {
    return {
      allowed: false,
      dollarRisk,
      remainingRoomAfterLoss,
      warning: `REJECTED: Proposed stop loss risk of -$${dollarRisk.toFixed(2)} exceeds remaining TopstepX buffer ($${state.remainingRoomToBreach.toFixed(2)}) to -$500 breach floor!`,
      copyCommand,
    }
  }

  if (dollarRisk > TOPSTEPX_RULES.recommendedMaxRiskPerTrade * 1.5) {
    return {
      allowed: true,
      dollarRisk,
      remainingRoomAfterLoss,
      warning: `HIGH RISK: Dollar risk ($${dollarRisk.toFixed(2)}) consumes over 30% of your remaining $${state.remainingRoomToBreach.toFixed(2)} cushion. Consider shrinking size or tightening stop.`,
      copyCommand,
    }
  }

  return {
    allowed: true,
    dollarRisk,
    remainingRoomAfterLoss,
    copyCommand,
  }
}

/**
 * Maps TopstepX order history into standard journal entry format for `/dashboard/journal`.
 */
export function getTopstepXJournalRows(): Array<Record<string, any>> {
  return TOPSTEPX_ORDER_HISTORY.map((t) => {
    const tradeDate = t.entryTime.slice(0, 10)
    return {
      id: `topstepx-${t.ticketId}`,
      ticket_id: t.ticketId,
      contract: t.contract,
      instrument: t.instrument,
      market: 'NY',
      trade_date: tradeDate,
      entry_window: 1,
      direction: t.direction,
      status: 'closed',
      fill: {
        time: t.entryTime,
        price: t.entryPrice,
        level: t.entryPrice,
        reason: `TopstepX #${t.ticketId} ${t.contract}`,
        source: 'topstepx_broker',
      },
      risk: {
        stop_loss: t.direction === 'LONG' ? t.entryPrice * 0.998 : t.entryPrice * 1.002,
        take_profit: null,
        position_size: t.quantity,
        risk_amount: Math.abs(t.grossPnl) || 50,
        account_size: 50000,
      },
      exit: {
        time: t.exitTime,
        price: t.exitPrice,
        reason_code: t.netPnl >= 0 ? 'take_profit' : 'manual',
        notes: `Duration: ${t.duration} · Gross: $${t.grossPnl.toFixed(2)} · Fees: -$${t.totalFees.toFixed(2)} · Net: $${t.netPnl.toFixed(2)}`,
        early_exit: false,
        tp_hit: t.netPnl > 0,
      },
      stops: {
        hit_count: t.netPnl < 0 ? 1 : 0,
        hit_at: t.netPnl < 0 ? t.exitTime : null,
      },
      pnl: {
        dollars: t.netPnl,
        gross_dollars: t.grossPnl,
        fees: t.totalFees,
        percent: null,
      },
      duration: t.duration,
      regime: {
        type: 'topstepx_live',
        confidence: 100,
      },
      decisions: [],
    }
  })
}
