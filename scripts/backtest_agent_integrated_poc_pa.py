import os
import pandas as pd
import numpy as np

def run_integrated_poc_pa_backtest():
    """
    Integrated Agent: Dalton POC Reversion + Price Action & Asian VWAP Confirmation.
    Rules:
    1. Measure distance from Asian open (18:00 ET) to Yesterday's POC.
    2. If Price > Yesterday POC by at least threshold:
       - Wait for price to reject overhead liquidity (e.g. print a bearish candle or cross below Asian VWAP).
       - Enter SHORT targeting Yesterday's POC.
       - Stop Loss: Local swing high + buffer.
    3. If Price < Yesterday POC by at least threshold:
       - Wait for price to reject lower liquidity (print a bullish candle or reclaim above Asian VWAP).
       - Enter LONG targeting Yesterday's POC.
       - Stop Loss: Local swing low - buffer.
    """
    instruments = [
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'min_dist': 50.0, 'comm': 1.20},
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'min_dist': 8.0, 'comm': 1.20},
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'min_dist': 0.60, 'comm': 1.20},
    ]

    for inst in instruments:
        df = pd.read_parquet(inst['file'])
        df['ts_et'] = pd.to_datetime(df['ts_et'])
        df.set_index('ts_et', inplace=True)
        df.sort_index(inplace=True)

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

            prev_ny = prev_bars.between_time('09:30', '16:00')
            if prev_ny.empty:
                prev_ny = prev_bars

            prices = np.round(prev_ny['close'] / inst['tick']) * inst['tick']
            vol_dist = prev_ny.groupby(prices)['volume'].sum()
            if vol_dist.empty:
                continue
            prev_poc = vol_dist.idxmax()
            prev_high = prev_bars['high'].max()
            prev_low = prev_bars['low'].min()

            # Asian session: 18:00 ET to 02:00 ET
            asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)].copy()
            if len(asia_bars) < 60:
                continue

            # Compute Asian VWAP
            asia_bars['tp'] = (asia_bars['high'] + asia_bars['low'] + asia_bars['close']) / 3.0
            asia_bars['pv'] = asia_bars['tp'] * asia_bars['volume']
            asia_bars['vwap'] = asia_bars['pv'].cumsum() / (asia_bars['volume'].cumsum() + 1e-9)

            open_px = asia_bars.iloc[0]['open']
            dist_to_poc = open_px - prev_poc

            if abs(dist_to_poc) < inst['min_dist']:
                continue

            bias = 'SHORT' if dist_to_poc > 0 else 'LONG'
            target_px = prev_poc

            # Price action trigger:
            # For SHORT: Wait between 18:30 and 22:00 for close < vwap AND close < open (bearish confirmation)
            # For LONG: Wait between 18:30 and 22:00 for close > vwap AND close > open (bullish confirmation)
            entry_px = None
            stop_px = None
            entry_time = None
            trigger_idx = None

            search_window = asia_bars.iloc[30:] # Give 30 mins to establish initial structure
            for b_idx, (t, bar) in enumerate(search_window.iterrows()):
                # Only enter before midnight (23:30 ET)
                if t.hour == 23 and t.minute > 30:
                    break

                o, h, l, c = bar['open'], bar['high'], bar['low'], bar['close']
                vw = bar['vwap']

                if bias == 'SHORT':
                    # Confirmed rejection: was above VWAP or near high, now closed below VWAP with red candle
                    if c < vw and c < o and c > target_px:
                        entry_px = c - inst['tick']
                        # Stop above recent high of Asian session
                        recent_high = asia_bars.loc[:t, 'high'].max()
                        stop_px = recent_high + 4 * inst['tick']
                        entry_time = t
                        trigger_idx = b_idx + 30
                        break
                else: # LONG
                    if c > vw and c > o and c < target_px:
                        entry_px = c + inst['tick']
                        recent_low = asia_bars.loc[:t, 'low'].min()
                        stop_px = recent_low - 4 * inst['tick']
                        entry_time = t
                        trigger_idx = b_idx + 30
                        break

            if entry_px is None or stop_px is None:
                continue

            risk_pts = abs(entry_px - stop_px)
            reward_pts = abs(target_px - entry_px)

            if risk_pts <= 0 or reward_pts < 0.5 * risk_pts:
                continue

            # Simulate execution forward
            exit_px = None
            exit_reason = None
            exit_time = None

            rem_bars = asia_bars.iloc[trigger_idx+1:]
            for rt, rbar in rem_bars.iterrows():
                h, l = rbar['high'], rbar['low']
                if bias == 'SHORT':
                    if h >= stop_px:
                        exit_px = stop_px + inst['tick']
                        exit_reason = 'STOP'
                        exit_time = rt
                        break
                    elif l <= target_px:
                        exit_px = target_px + inst['tick']
                        exit_reason = 'TARGET'
                        exit_time = rt
                        break
                else:
                    if l <= stop_px:
                        exit_px = stop_px - inst['tick']
                        exit_reason = 'STOP'
                        exit_time = rt
                        break
                    elif h >= target_px:
                        exit_px = target_px - inst['tick']
                        exit_reason = 'TARGET'
                        exit_time = rt
                        break

            if exit_px is None and len(rem_bars) > 0:
                exit_px = rem_bars.iloc[-1]['close'] + (inst['tick'] if bias == 'SHORT' else -inst['tick'])
                exit_reason = 'SESSION_CLOSE'
                exit_time = rem_bars.index[-1]
            elif exit_px is None:
                exit_px = entry_px
                exit_reason = 'NO_HOLD'
                exit_time = entry_time

            pnl_pts = (entry_px - exit_px) if bias == 'SHORT' else (exit_px - entry_px)
            pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
            r_mult = pnl_pts / risk_pts

            trades.append({
                'date': str(curr_sess),
                'side': bias,
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
        print(f"INTEGRATED AGENT (POC TARGET + VWAP/PA TRIGGER): {inst['name']}")
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

if __name__ == '__main__':
    run_integrated_poc_pa_backtest()
