import { AUTHENTIC_CMC_TRADES } from './cmcMarketsTrades'

export function getCmcJournalEntries() {
  const chrono = [...AUTHENTIC_CMC_TRADES].sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  )

  let runningEquity = 2000.0 // Starting capital in CAD

  const mapped = chrono.map((t) => {
    const equityBefore = runningEquity
    const pnl = t.pnl ?? 0
    runningEquity = Math.round((runningEquity + pnl) * 100) / 100
    const equityAfter = runningEquity

    // Instrument mapping to live desk instruments
    let instrument = 'NASDAQ'
    let market = 'NY'
    if (t.symbol === 'MYM') {
      instrument = 'DOW'
    } else if (t.symbol === 'NK225') {
      instrument = 'NIKKEI'
      market = 'TOKYO'
    } else if (t.symbol === 'MGC') {
      instrument = 'GOLD'
    } else if (t.symbol === 'SIL') {
      instrument = 'SILVER'
    } else if (t.symbol === 'MCL' || t.symbol === 'BRENT') {
      instrument = 'CRUDE'
    }

    const tradeDate = (t.entryTime || '').slice(0, 10)
    const isWin = pnl > 0
    const isStop = t.exitType === 'Stop Loss'
    const isTp = t.exitType === 'Take Profit'

    return {
      id: t.id,
      instrument,
      market,
      trade_date: tradeDate,
      entry_window: 'REGULAR',
      direction: t.direction,
      status: 'closed',
      fill: {
        time: t.entryTime,
        price: t.entry,
        level: null,
        reason: `CMC Markets CFD fill (${t.product || t.symbol})`,
        source: 'cmc_broker',
      },
      risk: {
        stop_loss: t.stop,
        take_profit: t.target,
        position_size: t.quantity,
        risk_amount: Math.abs(t.stop ? (t.entry - t.stop) * t.quantity : 40),
        account_size: 2000,
      },
      equity: {
        before: equityBefore,
        after: equityAfter,
      },
      exit: {
        time: t.exitTime || t.entryTime,
        price: t.exit ?? null,
        reason_code: isStop ? 'stop_hit' : (isTp ? 'take_profit' : 'manual'),
        notes: t.exitType || 'closed',
        early_exit: !isStop && !isTp,
        tp_hit: isTp,
      },
      stops: {
        hit_count: isStop ? 1 : 0,
        hit_at: isStop ? t.exitTime : null,
      },
      pnl: {
        dollars: pnl,
        percent: pnl ? Math.round((pnl / 2000) * 10000) / 100 : 0,
      },
      regime: {
        type: 'intraday_cfd',
        confidence: 0.9,
      },
      decisions: [],
      raw_product: t.product,
      balance_after: t.balanceAfter,
    }
  })

  // Sort descending by fill/exit time for journal display
  mapped.sort((a, b) => new Date(b.fill.time).getTime() - new Date(a.fill.time).getTime())

  const closed = mapped.length
  const wins = mapped.filter((t) => (t.pnl?.dollars ?? 0) > 0).length
  const losses = mapped.filter((t) => (t.pnl?.dollars ?? 0) < 0).length
  const stops = mapped.filter((t) => t.stops.hit_count > 0).length
  const tps = mapped.filter((t) => t.exit?.tp_hit).length
  const totalPnl = Math.round(mapped.reduce((s, t) => s + (t.pnl?.dollars ?? 0), 0) * 100) / 100

  const summary = {
    trades: mapped.length,
    open: 0,
    closed,
    wins,
    losses,
    stop_outs: stops,
    take_profits: tps,
    manuals: closed - stops - tps,
    win_rate: closed ? Math.round((wins / closed) * 1000) / 10 : null,
    total_pnl: totalPnl,
    starting_account: 2000,
    ending_equity: 1929.69,
    equity_change: 129.37,
    withdrawn: 200.0,
    holding_costs: -1.9,
    price_adjustments: -0.86,
    equity_source: 'cmc_broker' as const,
    days: 30,
  }

  return {
    entries: mapped,
    summary,
  }
}
