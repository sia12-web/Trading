import os
import pandas as pd
import numpy as np

def run_agent4_vwap_mean_reversion():
    """
    Agent 4: Asian Session VWAP Extreme Bands Mean-Reversion with Price Action & Volume Filter.
    Hypothesis: Asian session is a low-volatility liquidity vacuum. 
    When price reaches +/- 2.0 sigma of the developing Asian VWAP with low volume (exhaustion),
    it is statistically overstretched and reverts to the Asian VWAP mean.
    If volume is high (expanding), fading is forbidden (avoid trend runs).
    """
    instruments = [
        {'name': 'NASDAQ', 'file': 'data/databento_6m/nasdaq_1m.parquet', 'tick': 0.25, 'pt_val': 2.0, 'comm': 1.20, 'min_std': 10.0},
        {'name': 'OIL', 'file': 'data/databento_6m/oil_1m.parquet', 'tick': 0.01, 'pt_val': 100.0, 'comm': 1.20, 'min_std': 0.15},
        {'name': 'GOLD', 'file': 'data/databento_6m/gold_1m.parquet', 'tick': 0.10, 'pt_val': 10.0, 'comm': 1.20, 'min_std': 1.5},
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
            curr_sess = unique_sessions[i]
            curr_bars = df[df['session_date'] == curr_sess]
            if curr_bars.empty:
                continue

            # Asian session: 18:00 ET to 02:00 ET
            asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)].copy()
            if len(asia_bars) < 120: # At least 2 hours of data
                continue

            # Compute developing Asian VWAP and Standard Deviation
            asia_bars['tp'] = (asia_bars['high'] + asia_bars['low'] + asia_bars['close']) / 3.0
            asia_bars['pv'] = asia_bars['tp'] * asia_bars['volume']
            cum_pv = asia_bars['pv'].cumsum()
            cum_v = asia_bars['volume'].cumsum()
            asia_bars['vwap'] = cum_pv / (cum_v + 1e-9)

            # Rolling / cumulative standard deviation from VWAP
            asia_bars['dev_sq'] = (asia_bars['tp'] - asia_bars['vwap'])**2 * asia_bars['volume']
            asia_bars['cum_dev_sq'] = asia_bars['dev_sq'].cumsum()
            asia_bars['std'] = np.sqrt(asia_bars['cum_dev_sq'] / (cum_v + 1e-9))
            asia_bars['upper_2s'] = asia_bars['vwap'] + 2.0 * asia_bars['std']
            asia_bars['lower_2s'] = asia_bars['vwap'] - 2.0 * asia_bars['std']

            # Volume baseline: 20-bar moving average volume
            asia_bars['vol_ma'] = asia_bars['volume'].rolling(20, min_periods=5).mean()

            # We evaluate trades between 20:00 ET and 01:30 ET (mature Asian session)
            # Avoid the first 2 hours (18:00-20:00) so VWAP is established
            eval_window = asia_bars[(asia_bars.index.hour >= 20) | (asia_bars.index.hour < 2)]

            in_position = False
            for bar_idx, (t, bar) in enumerate(eval_window.iterrows()):
                if in_position:
                    continue

                # Don't take new entries past 01:15 ET
                if t.hour == 1 and t.minute > 15:
                    break

                std_val = bar['std']
                if std_val < inst['min_std']:
                    continue

                o, h, l, c, v = bar['open'], bar['high'], bar['low'], bar['close'], bar['volume']
                v_ma = bar['vol_ma']
                vwap = bar['vwap']
                upper_2 = bar['upper_2s']
                lower_2 = bar['lower_2s']

                # Price Action Check:
                # Bearish Rejection at Upper Band (+2 sigma):
                # Candle touched upper_2s, close < open (red) or upper wick is prominent, and volume is not explosive (< 2x vol_ma)
                if h >= upper_2 and c < o and v < 2.0 * v_ma and c > vwap:
                    side = 'SHORT'
                    entry_px = c - inst['tick']
                    stop_px = h + 4 * inst['tick']
                    target_px = vwap
                    risk_pts = abs(stop_px - entry_px)
                    reward_pts = abs(entry_px - target_px)

                    if risk_pts <= 0 or reward_pts < 1.0 * risk_pts:
                        continue

                    in_position = True
                    # Simulate trade
                    exit_px = None
                    exit_reason = None
                    exit_time = None

                    rem_bars = eval_window.iloc[bar_idx+1:]
                    for rt, rbar in rem_bars.iterrows():
                        # Developing VWAP target
                        curr_vwap = rbar['vwap']
                        if rbar['high'] >= stop_px:
                            exit_px = stop_px + inst['tick']
                            exit_reason = 'STOP'
                            exit_time = rt
                            break
                        elif rbar['low'] <= curr_vwap:
                            exit_px = curr_vwap + inst['tick']
                            exit_reason = 'TARGET'
                            exit_time = rt
                            break

                    if exit_px is None and len(rem_bars) > 0:
                        exit_px = rem_bars.iloc[-1]['close'] + inst['tick']
                        exit_reason = 'SESSION_CLOSE'
                        exit_time = rem_bars.index[-1]
                    elif exit_px is None:
                        exit_px = entry_px
                        exit_reason = 'NO_HOLD'
                        exit_time = t

                    pnl_pts = entry_px - exit_px
                    pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
                    r_mult = pnl_pts / risk_pts

                    trades.append({
                        'date': str(curr_sess),
                        'side': 'SHORT',
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

                # Bullish Rejection at Lower Band (-2 sigma):
                elif l <= lower_2 and c > o and v < 2.0 * v_ma and c < vwap:
                    side = 'LONG'
                    entry_px = c + inst['tick']
                    stop_px = l - 4 * inst['tick']
                    target_px = vwap
                    risk_pts = abs(entry_px - stop_px)
                    reward_pts = abs(target_px - entry_px)

                    if risk_pts <= 0 or reward_pts < 1.0 * risk_pts:
                        continue

                    in_position = True
                    exit_px = None
                    exit_reason = None
                    exit_time = None

                    rem_bars = eval_window.iloc[bar_idx+1:]
                    for rt, rbar in rem_bars.iterrows():
                        curr_vwap = rbar['vwap']
                        if rbar['low'] <= stop_px:
                            exit_px = stop_px - inst['tick']
                            exit_reason = 'STOP'
                            exit_time = rt
                            break
                        elif rbar['high'] >= curr_vwap:
                            exit_px = curr_vwap - inst['tick']
                            exit_reason = 'TARGET'
                            exit_time = rt
                            break

                    if exit_px is None and len(rem_bars) > 0:
                        exit_px = rem_bars.iloc[-1]['close'] - inst['tick']
                        exit_reason = 'SESSION_CLOSE'
                        exit_time = rem_bars.index[-1]
                    elif exit_px is None:
                        exit_px = entry_px
                        exit_reason = 'NO_HOLD'
                        exit_time = t

                    pnl_pts = exit_px - entry_px
                    pnl_dollars = pnl_pts * inst['pt_val'] - inst['comm']
                    r_mult = pnl_pts / risk_pts

                    trades.append({
                        'date': str(curr_sess),
                        'side': 'LONG',
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
        print(f"AGENT 4 (ASIAN VWAP +/-2 SIGMA PA FADE): {inst['name']}")
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
    run_agent4_vwap_mean_reversion()
