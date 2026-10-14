import os
import pandas as pd
import numpy as np

def run_agent1_poc_backtest():
    """
    Agent 1: The Dalton Prior Day POC Magnet Reversion Agent.
    Hypothesis: In thin Asian sessions, price gravitates toward Prior Day POC (the highest volume consensus)
    when opening at an imbalance.
    """
    instruments = [
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'min_dist': 50.0, 'comm': 1.20},
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'min_dist': 0.50, 'comm': 1.20},
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'min_dist': 8.0, 'comm': 1.20},
    ]

    for inst in instruments:
        df = pd.read_parquet(inst['file'])
        df['ts_et'] = pd.to_datetime(df['ts_et'])
        df.set_index('ts_et', inplace=True)
        df.sort_index(inplace=True)

        # Assign Globex trade date
        # Session begins at 18:00 ET previous day
        trade_dates = []
        for ts in df.index:
            d = ts.date()
            if ts.hour >= 18:
                next_d = d + pd.Timedelta(days=1)
                if next_d.weekday() == 5:
                    next_d += pd.Timedelta(days=2)
                elif next_d.weekday() == 6:
                    next_d += pd.Timedelta(days=1)
                trade_dates.append(next_d)
            else:
                trade_dates.append(d)
        df['trade_date'] = trade_dates

        unique_dates = sorted(list(set(df['trade_date'])))
        trades = []

        for i in range(1, len(unique_dates)):
            prev_d = unique_dates[i-1]
            curr_d = unique_dates[i]

            prev_bars = df[df['trade_date'] == prev_d]
            curr_bars = df[df['trade_date'] == curr_d]

            if prev_bars.empty or curr_bars.empty:
                continue

            # Prior day NY cash bars (09:30 - 16:00 ET) for canonical POC
            prev_ny = prev_bars.between_time('09:30', '16:00')
            if prev_ny.empty:
                prev_ny = prev_bars

            # Compute Prior POC via tick volume distribution
            prices = np.round(prev_ny['close'] / inst['tick']) * inst['tick']
            vol_dist = prev_ny.groupby(prices)['volume'].sum()
            if vol_dist.empty:
                continue
            prev_poc = vol_dist.idxmax()
            prev_high = prev_bars['high'].max()
            prev_low = prev_bars['low'].min()

            # Asian session bars: 18:00 ET (evening) to 02:00 ET (morning)
            asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
            if len(asia_bars) < 60:
                continue

            # Check open of Asian session (at 18:00 or first available bar)
            open_bar = asia_bars.iloc[0]
            open_px = open_bar['open']
            open_time = asia_bars.index[0]

            dist_to_poc = open_px - prev_poc

            # Check if distance exceeds minimum threshold
            if abs(dist_to_poc) < inst['min_dist']:
                continue

            # Direction:
            # If open_px > prev_poc + min_dist: SHORT towards POC
            # If open_px < prev_poc - min_dist: LONG towards POC
            side = 'SHORT' if dist_to_poc > 0 else 'LONG'
            entry_px = open_px + (inst['tick'] if side == 'LONG' else -inst['tick']) # add 1 tick slippage

            if side == 'SHORT':
                target_px = prev_poc
                stop_px = max(prev_high + 5 * inst['tick'], entry_px + abs(dist_to_poc) * 1.0)
            else:
                target_px = prev_poc
                stop_px = min(prev_low - 5 * inst['tick'], entry_px - abs(dist_to_poc) * 1.0)

            risk_pts = abs(entry_px - stop_px)
            reward_pts = abs(entry_px - target_px)

            # Walk through Asian bars to simulate execution
            exit_px = None
            exit_reason = None
            exit_time = None

            for t, bar in asia_bars.iloc[1:].iterrows():
                h, l = bar['high'], bar['low']

                if side == 'LONG':
                    # Stop hit?
                    if l <= stop_px:
                        exit_px = stop_px - inst['tick'] # slippage
                        exit_reason = 'STOP'
                        exit_time = t
                        break
                    # Target hit?
                    elif h >= target_px:
                        exit_px = target_px - inst['tick'] # slippage
                        exit_reason = 'TARGET'
                        exit_time = t
                        break
                else: # SHORT
                    # Stop hit?
                    if h >= stop_px:
                        exit_px = stop_px + inst['tick'] # slippage
                        exit_reason = 'STOP'
                        exit_time = t
                        break
                    # Target hit?
                    elif l <= target_px:
                        exit_px = target_px + inst['tick'] # slippage
                        exit_reason = 'TARGET'
                        exit_time = t
                        break

            # If neither hit by 02:00 ET, exit at market at end of Asia
            if exit_px is None:
                final_bar = asia_bars.iloc[-1]
                exit_time = asia_bars.index[-1]
                if side == 'LONG':
                    exit_px = final_bar['close'] - inst['tick']
                else:
                    exit_px = final_bar['close'] + inst['tick']
                exit_reason = 'SESSION_CLOSE'

            # Calculate PnL
            if side == 'LONG':
                pnl_pts = exit_px - entry_px
            else:
                pnl_pts = entry_px - exit_px

            pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
            r_multiple = pnl_pts / risk_pts if risk_pts > 0 else 0

            trades.append({
                'date': str(curr_d),
                'side': side,
                'entry_time': str(open_time),
                'entry_px': round(entry_px, 2),
                'stop_px': round(stop_px, 2),
                'target_px': round(target_px, 2),
                'exit_time': str(exit_time),
                'exit_px': round(exit_px, 2),
                'exit_reason': exit_reason,
                'pnl_dollars': round(pnl_dollars, 2),
                'r_multiple': round(r_multiple, 2)
            })

        # Summary statistics
        tdf = pd.DataFrame(trades)
        print(f"\n=======================================================")
        print(f"AGENT 1 (DALTON POC REVERSION): {inst['name']}")
        print(f"Total Trade Days Analyzed: {len(unique_dates) - 1}")
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

if __name__ == '__main__':
    run_agent1_poc_backtest()
