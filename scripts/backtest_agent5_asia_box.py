import os
import pandas as pd
import numpy as np

def run_agent5_asia_box():
    """
    Agent 5: The Institutional Asia Box Compression & London Liquidity Expansion.
    (The core TradePulse locked Pine recipe).
    Asia Range: 20:00 - 02:00 ET.
    Order placement: 02:00 ET.
    Buy Stop = Asia High + buffer
    Sell Stop = Asia Low - buffer
    SL = Asia Midpoint
    TP = 1.5R
    Cutoff = 03:30 ET.
    Flatten = 10:25 ET.
    """
    instruments = [
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'comm': 1.20, 'buffer': 10.0, 'max_range': 60.0}, # Gold: buffer $10, max range $60
        {'name': 'DOW', 'file': 'data/databento_6m/dow_1m.parquet', 'tick': 1.0, 'pt_val': 0.50, 'comm': 1.20, 'buffer': 20.0, 'max_range': 80.0}, # Dow: buffer 20, max range 80
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'comm': 1.20, 'buffer': 0.30, 'max_range': 1.50}, # Oil: buffer $0.30, max range $1.50
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'comm': 1.20, 'buffer': 25.0, 'max_range': 150.0}, # NQ: buffer 25, max range 150
    ]

    for inst in instruments:
        df = pd.read_parquet(inst['file'])
        df['ts_et'] = pd.to_datetime(df['ts_et'])
        df.set_index('ts_et', inplace=True)
        df.sort_index(inplace=True)

        df['session_date'] = (df.index + pd.Timedelta(hours=6)).date
        unique_sessions = sorted(list(df['session_date'].unique()))
        trades = []
        qualified_sessions = 0
        total_sessions = len(unique_sessions) - 1

        for i in range(1, len(unique_sessions)):
            curr_sess = unique_sessions[i]
            curr_bars = df[df['session_date'] == curr_sess]
            if curr_bars.empty:
                continue

            # Asia Box: 20:00 ET (evening) to 01:59 ET (morning)
            box_bars = curr_bars[(curr_bars.index.hour >= 20) | (curr_bars.index.hour < 2)]
            if len(box_bars) < 180: # Need at least 3 hours of the box
                continue

            asia_high = box_bars['high'].max()
            asia_low = box_bars['low'].min()
            asia_range = asia_high - asia_low
            asia_mid = (asia_high + asia_low) / 2.0

            # Check range filter
            if asia_range > inst['max_range'] or asia_range <= 0:
                continue

            qualified_sessions += 1

            buy_stop = asia_high + inst['buffer']
            sell_stop = asia_low - inst['buffer']

            long_risk = buy_stop - asia_mid
            short_risk = asia_mid - sell_stop

            long_tp = buy_stop + 1.5 * long_risk
            short_tp = sell_stop - 1.5 * short_risk

            # Forward bars from 02:00 ET to 10:25 ET
            # In curr_bars, this corresponds to morning hours 2 through 10
            exec_bars = curr_bars[(curr_bars.index.hour >= 2) & (curr_bars.index.hour <= 10)]
            if exec_bars.empty:
                continue

            # Trim to 10:25 ET
            exec_bars = exec_bars[~((exec_bars.index.hour == 10) & (exec_bars.index.minute > 25))]

            # Simulation state
            position = None # 'LONG' or 'SHORT'
            entry_px = None
            stop_px = None
            target_px = None
            entry_time = None
            exit_px = None
            exit_reason = None
            exit_time = None

            for t, bar in exec_bars.iterrows():
                h, l = bar['high'], bar['low']
                mins = t.hour * 60 + t.minute

                # If not in position, check for fills between 02:00 and 03:30 (mins <= 210)
                if position is None:
                    if mins > (3 * 60 + 30):
                        # Cutoff reached, cancel orders
                        break

                    # Check for buy stop fill
                    buy_hit = h >= buy_stop
                    sell_hit = l <= sell_stop

                    if buy_hit and sell_hit:
                        # Two-way breakout bar: skip / ambiguous
                        break
                    elif buy_hit:
                        position = 'LONG'
                        entry_px = buy_stop + inst['tick'] # slippage
                        stop_px = asia_mid
                        target_px = long_tp
                        entry_time = t
                    elif sell_hit:
                        position = 'SHORT'
                        entry_px = sell_stop - inst['tick']
                        stop_px = asia_mid
                        target_px = short_tp
                        entry_time = t

                else:
                    # In position, check TP / SL / Flatten
                    if position == 'LONG':
                        if l <= stop_px:
                            exit_px = stop_px - inst['tick']
                            exit_reason = 'STOP'
                            exit_time = t
                            break
                        elif h >= target_px:
                            exit_px = target_px - inst['tick']
                            exit_reason = 'TARGET'
                            exit_time = t
                            break
                    elif position == 'SHORT':
                        if h >= stop_px:
                            exit_px = stop_px + inst['tick']
                            exit_reason = 'STOP'
                            exit_time = t
                            break
                        elif l <= target_px:
                            exit_px = target_px + inst['tick']
                            exit_reason = 'TARGET'
                            exit_time = t
                            break

            # If still in position at end of window, flatten at 10:25
            if position is not None and exit_px is None:
                final_bar = exec_bars.iloc[-1]
                exit_time = exec_bars.index[-1]
                if position == 'LONG':
                    exit_px = final_bar['close'] - inst['tick']
                else:
                    exit_px = final_bar['close'] + inst['tick']
                exit_reason = 'FLATTEN_1025'

            if position is not None and exit_px is not None:
                pnl_pts = (exit_px - entry_px) if position == 'LONG' else (entry_px - exit_px)
                pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
                risk_pts = long_risk if position == 'LONG' else short_risk
                r_mult = pnl_pts / risk_pts if risk_pts > 0 else 0

                trades.append({
                    'date': str(curr_sess),
                    'side': position,
                    'entry_time': str(entry_time),
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
        print(f"AGENT 5 (ASIA BOX BREAKOUT): {inst['name']}")
        print(f"Total Sessions: {total_sessions} | Qualified Sessions: {qualified_sessions}")
        if tdf.empty:
            print("No trades triggered.")
            continue

        wins = tdf[tdf['pnl_dollars'] > 0]
        losses = tdf[tdf['pnl_dollars'] <= 0]
        targets = tdf[tdf['exit_reason'] == 'TARGET']
        stops = tdf[tdf['exit_reason'] == 'STOP']
        flats = tdf[tdf['exit_reason'] == 'FLATTEN_1025']

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
        print(f"Exit Breakdown: Target={len(targets)}, Stop={len(stops)}, Flatten 10:25={len(flats)}")
        print(f"Profit Factor: {profit_factor:.2f}")
        print(f"Gross Profit: +${gross_profit:.2f} | Gross Loss: -${gross_loss:.2f}")
        print(f"Net PnL: ${net_pnl:+.2f} | Total R: {total_r:+.2f}R")
        print(f"Max Drawdown: -${max_dd:.2f}")
        print(f"Avg Trade PnL: ${tdf['pnl_dollars'].mean():+.2f}")

if __name__ == '__main__':
    run_agent5_asia_box()
