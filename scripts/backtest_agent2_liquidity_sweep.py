import os
import pandas as pd
import numpy as np

def run_agent2_liquidity_sweep():
    """
    Agent 2: The Liquidity Pool Sweeper & Spring/Upthrust Agent.
    Hypothesis: In thin Asian hours, market seeks resting liquidity (Yesterday's High / Low stops).
    When it sweeps past Yesterday's High/Low and immediately fails to accept (closes back inside),
    it traps breakout traders and reverts towards Yesterday's POC or Session VWAP.
    """
    instruments = [
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'comm': 1.20, 'buffer_ticks': 4},
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'comm': 1.20, 'buffer_ticks': 3},
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'comm': 1.20, 'buffer_ticks': 3},
    ]

    for inst in instruments:
        df = pd.read_parquet(inst['file'])
        df['ts_et'] = pd.to_datetime(df['ts_et'])
        df.set_index('ts_et', inplace=True)
        df.sort_index(inplace=True)

        # Vectorized session date calculation:
        # Globex day starts at 18:00 ET. Adding 6 hours shifts 18:00 ET to 00:00 of next calendar date.
        df['session_date'] = (df.index + pd.Timedelta(hours=6)).date

        unique_sessions = sorted(list(df['session_date'].unique()))
        trades = []

        for i in range(1, len(unique_sessions)):
            prev_sess = unique_sessions[i-1]
            curr_sess = unique_sessions[i]

            prev_bars = df[df['session_date'] == prev_sess]
            curr_bars = df[df['session_date'] == curr_sess]

            if prev_bars.empty or curr_bars.empty:
                continue

            # Prior day High, Low, and POC (from NY cash 09:30-16:00 ET or full prior session)
            prev_ny = prev_bars.between_time('09:30', '16:00')
            if prev_ny.empty:
                prev_ny = prev_bars

            prev_high = prev_bars['high'].max()
            prev_low = prev_bars['low'].min()

            # Prior POC via tick volume distribution
            prices = np.round(prev_ny['close'] / inst['tick']) * inst['tick']
            vol_dist = prev_ny.groupby(prices)['volume'].sum()
            prev_poc = vol_dist.idxmax() if not vol_dist.empty else (prev_high + prev_low) / 2.0

            # Asian session: 18:00 ET to 02:00 ET
            asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
            if len(asia_bars) < 60:
                continue

            # State machine for sweep detection
            # Once swept and reclaimed, take at most 1 long and 1 short per session
            has_long_trade = False
            has_short_trade = False

            high_penetrated = False
            sweep_high_max = prev_high
            
            low_penetrated = False
            sweep_low_min = prev_low

            # Track developing session VWAP during Asia
            cum_vol = 0.0
            cum_pv = 0.0

            for bar_idx, (t, bar) in enumerate(asia_bars.iterrows()):
                o, h, l, c, v = bar['open'], bar['high'], bar['low'], bar['close'], bar['volume']
                cum_vol += v
                cum_pv += ((h + l + c) / 3.0) * v
                asia_vwap = (cum_pv / cum_vol) if cum_vol > 0 else c

                # Check High Sweep (Upthrust / Bear Trap)
                if not has_short_trade:
                    if h > prev_high:
                        high_penetrated = True
                        sweep_high_max = max(sweep_high_max, h)

                    # Reclaim back below prev_high?
                    if high_penetrated and c < prev_high:
                        # Entry triggered on this candle close!
                        has_short_trade = True
                        entry_px = c - inst['tick'] # sell 1 tick slippage
                        stop_px = sweep_high_max + inst['buffer_ticks'] * inst['tick']
                        # Target: Prior Day POC or Session VWAP (whichever gives at least 1.5R, default to Prior POC)
                        target_px = prev_poc
                        if target_px >= entry_px: # if POC is above entry, target Asian VWAP
                            target_px = min(asia_vwap, entry_px - abs(stop_px - entry_px) * 1.5)

                        risk_pts = abs(stop_px - entry_px)
                        reward_pts = abs(entry_px - target_px)

                        # Simulate trade execution forward
                        exit_px = None
                        exit_reason = None
                        exit_time = None

                        remaining_bars = asia_bars.iloc[bar_idx+1:]
                        for rt, rbar in remaining_bars.iterrows():
                            # Check stop first
                            if rbar['high'] >= stop_px:
                                exit_px = stop_px + inst['tick']
                                exit_reason = 'STOP'
                                exit_time = rt
                                break
                            elif rbar['low'] <= target_px:
                                exit_px = target_px + inst['tick']
                                exit_reason = 'TARGET'
                                exit_time = rt
                                break

                        if exit_px is None and len(remaining_bars) > 0:
                            exit_px = remaining_bars.iloc[-1]['close'] + inst['tick']
                            exit_reason = 'SESSION_CLOSE'
                            exit_time = remaining_bars.index[-1]
                        elif exit_px is None:
                            exit_px = entry_px
                            exit_reason = 'NO_HOLD'
                            exit_time = t

                        pnl_pts = entry_px - exit_px
                        pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
                        r_mult = pnl_pts / risk_pts if risk_pts > 0 else 0

                        trades.append({
                            'date': str(curr_sess),
                            'side': 'SHORT',
                            'setup': 'UPTHRUST_SWEEP_HIGH',
                            'entry_time': str(t),
                            'entry_px': round(entry_px, 2),
                            'stop_px': round(stop_px, 2),
                            'target_px': round(target_px, 2),
                            'exit_time': str(exit_time),
                            'exit_px': round(exit_px, 2),
                            'exit_reason': exit_reason,
                            'pnl_dollars': round(pnl_dollars, 2),
                            'r_multiple': round(r_mult, 2)
                        })

                # Check Low Sweep (Spring / Bull Trap)
                if not has_long_trade:
                    if l < prev_low:
                        low_penetrated = True
                        sweep_low_min = min(sweep_low_min, l)

                    # Reclaim back above prev_low?
                    if low_penetrated and c > prev_low:
                        has_long_trade = True
                        entry_px = c + inst['tick'] # buy 1 tick slippage
                        stop_px = sweep_low_min - inst['buffer_ticks'] * inst['tick']
                        target_px = prev_poc
                        if target_px <= entry_px:
                            target_px = max(asia_vwap, entry_px + abs(entry_px - stop_px) * 1.5)

                        risk_pts = abs(entry_px - stop_px)
                        reward_pts = abs(target_px - entry_px)

                        exit_px = None
                        exit_reason = None
                        exit_time = None

                        remaining_bars = asia_bars.iloc[bar_idx+1:]
                        for rt, rbar in remaining_bars.iterrows():
                            if rbar['low'] <= stop_px:
                                exit_px = stop_px - inst['tick']
                                exit_reason = 'STOP'
                                exit_time = rt
                                break
                            elif rbar['high'] >= target_px:
                                exit_px = target_px - inst['tick']
                                exit_reason = 'TARGET'
                                exit_time = rt
                                break

                        if exit_px is None and len(remaining_bars) > 0:
                            exit_px = remaining_bars.iloc[-1]['close'] - inst['tick']
                            exit_reason = 'SESSION_CLOSE'
                            exit_time = remaining_bars.index[-1]
                        elif exit_px is None:
                            exit_px = entry_px
                            exit_reason = 'NO_HOLD'
                            exit_time = t

                        pnl_pts = exit_px - entry_px
                        pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
                        r_mult = pnl_pts / risk_pts if risk_pts > 0 else 0

                        trades.append({
                            'date': str(curr_sess),
                            'side': 'LONG',
                            'setup': 'SPRING_SWEEP_LOW',
                            'entry_time': str(t),
                            'entry_px': round(entry_px, 2),
                            'stop_px': round(stop_px, 2),
                            'target_px': round(target_px, 2),
                            'exit_time': str(exit_time),
                            'exit_px': round(exit_px, 2),
                            'exit_reason': exit_reason,
                            'pnl_dollars': round(pnl_dollars, 2),
                            'r_multiple': round(r_mult, 2)
                        })

        tdf = pd.DataFrame(trades)
        print(f"\n=======================================================")
        print(f"AGENT 2 (LIQUIDITY SWEEP & SPRING/UPTHRUST): {inst['name']}")
        print(f"Total Sessions: {len(unique_sessions)-1}")
        if tdf.empty:
            print("No trades triggered.")
            continue

        wins = tdf[tdf['pnl_dollars'] > 0]
        losses = tdf[tdf['pnl_dollars'] <= 0]
        targets = tdf[tdf['exit_reason'] == 'TARGET']
        stops = tdf[tdf['exit_reason'] == 'STOP']
        flats = tdf[tdf['exit_reason'] == 'SESSION_CLOSE']

        win_rate = len(wins) / len(tdf) * 100
        gross_profit = wins['pnl_dollars'].sum()
        gross_loss = abs(losses['pnl_dollars'].sum())
        profit_factor = gross_profit / (gross_loss + 1e-9)
        net_pnl = tdf['pnl_dollars'].sum()
        total_r = tdf['r_multiple'].sum()

        cum_pnl = tdf['pnl_dollars'].cumsum()
        max_dd = (cum_pnl.cummax() - cum_pnl).max()

        print(f"Total Trades: {len(tdf)}")
        print(f"Win Rate: {win_rate:.1f}% ({len(wins)} W / {len(losses)} L)")
        print(f"Exit Breakdown: Target={len(targets)}, Stop={len(stops)}, Session Close={len(flats)}")
        print(f"Profit Factor: {profit_factor:.2f}")
        print(f"Gross Profit: +${gross_profit:.2f} | Gross Loss: -${gross_loss:.2f}")
        print(f"Net PnL: ${net_pnl:+.2f} | Total R: {total_r:+.2f}R")
        print(f"Max Drawdown: -${max_dd:.2f}")
        print(f"Avg Trade PnL: ${tdf['pnl_dollars'].mean():+.2f}")

        # Breakdown by setup
        for setup_name, sub in tdf.groupby('setup'):
            sw = sub[sub['pnl_dollars'] > 0]
            spnl = sub['pnl_dollars'].sum()
            print(f"  -> {setup_name}: {len(sub)} trades, {len(sw)/len(sub)*100:.1f}% WR, PnL: ${spnl:+.2f}")

if __name__ == '__main__':
    run_agent2_liquidity_sweep()
