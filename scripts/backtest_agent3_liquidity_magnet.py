import os
import pandas as pd
import numpy as np

def run_agent3_liquidity_magnet():
    """
    Agent 3: Liquidity Magnet Momentum Agent.
    Hypothesis: In Asia, price 'goes towards the liquidity' that the regular session didn't have time to complete.
    If price establishes momentum in the direction of Yesterday's High/Low (aligned with Asian VWAP),
    it targets that liquidity pool.
    """
    instruments = [
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'comm': 1.20, 'min_room_pts': 40.0},
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'comm': 1.20, 'min_room_pts': 0.40},
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'comm': 1.20, 'min_room_pts': 5.0},
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

            prev_high = prev_bars['high'].max()
            prev_low = prev_bars['low'].min()

            # Asian session: 18:00 ET to 02:00 ET
            asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
            if len(asia_bars) < 60:
                continue

            # Compute Asian VWAP up to evaluation time (say, 20:00 ET, after 2 hours of Tokyo/Sydney open)
            # Evaluate at 20:00 ET (8:00 PM ET)
            eval_bars = asia_bars[asia_bars.index.hour >= 18] # from 18:00 to 20:00
            if eval_bars.empty:
                continue

            cum_v = eval_bars['volume'].sum()
            if cum_v == 0:
                continue
            vwap_20 = (eval_bars['volume'] * (eval_bars['high'] + eval_bars['low'] + eval_bars['close']) / 3.0).sum() / cum_v

            # Find the bar at 20:00 ET (or the first bar after 20:00 ET)
            post_20_bars = asia_bars[(asia_bars.index.hour >= 20) | (asia_bars.index.hour < 2)]
            if post_20_bars.empty:
                continue

            entry_bar = post_20_bars.iloc[0]
            entry_px = entry_bar['open']
            entry_time = post_20_bars.index[0]

            side = None
            target_px = None
            stop_px = None

            # Bullish case: Price > VWAP and there is room to Yesterday's High
            dist_to_high = prev_high - entry_px
            dist_to_low = entry_px - prev_low

            if entry_px > vwap_20 and dist_to_high >= inst['min_room_pts']:
                side = 'LONG'
                target_px = prev_high
                stop_px = vwap_20 - 5 * inst['tick'] # Stop below Asian VWAP
            elif entry_px < vwap_20 and dist_to_low >= inst['min_room_pts']:
                side = 'SHORT'
                target_px = prev_low
                stop_px = vwap_20 + 5 * inst['tick'] # Stop above Asian VWAP

            if side is None:
                continue

            # Add slippage
            if side == 'LONG':
                entry_px += inst['tick']
            else:
                entry_px -= inst['tick']

            risk_pts = abs(entry_px - stop_px)
            reward_pts = abs(target_px - entry_px)

            if risk_pts <= 0:
                continue

            exit_px = None
            exit_reason = None
            exit_time = None

            sim_bars = post_20_bars.iloc[1:]
            for t, bar in sim_bars.iterrows():
                h, l = bar['high'], bar['low']
                if side == 'LONG':
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
                else:
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

            if exit_px is None and len(sim_bars) > 0:
                exit_px = sim_bars.iloc[-1]['close'] + (inst['tick'] if side == 'SHORT' else -inst['tick'])
                exit_reason = 'SESSION_CLOSE'
                exit_time = sim_bars.index[-1]
            elif exit_px is None:
                exit_px = entry_px
                exit_reason = 'NO_HOLD'
                exit_time = entry_time

            pnl_pts = (exit_px - entry_px) if side == 'LONG' else (entry_px - exit_px)
            pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
            r_mult = pnl_pts / risk_pts

            trades.append({
                'date': str(curr_sess),
                'side': side,
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
        print(f"AGENT 3 (LIQUIDITY MAGNET MOMENTUM): {inst['name']}")
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
    run_agent3_liquidity_magnet()
