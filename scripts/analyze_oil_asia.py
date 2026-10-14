import os
import pandas as pd
import numpy as np

def analyze_oil_asia():
    df = pd.read_parquet('data/databento_6m/oil_1m.parquet')
    df['ts_et'] = pd.to_datetime(df['ts_et'])
    df.set_index('ts_et', inplace=True)
    df.sort_index(inplace=True)

    df['session_date'] = (df.index + pd.Timedelta(hours=6)).date
    unique_sessions = sorted(list(df['session_date'].unique()))

    print(f"Total Oil Sessions: {len(unique_sessions)}")
    
    # Let's inspect what happens to Oil between 18:00 and 02:00 ET:
    # 1. Asian range distribution
    ranges = []
    vols = []
    poc_distances = []
    
    for i in range(1, len(unique_sessions)):
        prev_s = unique_sessions[i-1]
        curr_s = unique_sessions[i]
        
        prev_bars = df[df['session_date'] == prev_s]
        curr_bars = df[df['session_date'] == curr_s]
        
        asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
        if len(asia_bars) < 60:
            continue
            
        a_high = asia_bars['high'].max()
        a_low = asia_bars['low'].min()
        a_range = a_high - a_low
        a_vol = asia_bars['volume'].sum()
        
        ranges.append(a_range)
        vols.append(a_vol)
        
    s_ranges = pd.Series(ranges)
    s_vols = pd.Series(vols)
    print(f"Oil Asian Range Mean: ${s_ranges.mean():.2f}, Median: ${s_ranges.median():.2f}, 25th: ${s_ranges.quantile(0.25):.2f}, 75th: ${s_ranges.quantile(0.75):.2f}")
    print(f"Oil Asian Vol Mean: {s_vols.mean():.0f}, Median: {s_vols.median():.0f}")

    # Now let's test a specialized Oil Asian Auction Strategy:
    # Oil Auction Test A: Asian Range Breakout at London Open (03:00 ET) with Asia Range < $1.20
    # Oil Auction Test B: Fade of Asian Opening Range (18:00-20:00) extremes if Range > $0.80
    # Oil Auction Test C: Prior Day Value Area (VAH/VAL) Rejection
    
    # Test A: London Open expansion from Asia Box (02:00-03:00 breakout)
    trades_a = []
    for i in range(1, len(unique_sessions)):
        curr_s = unique_sessions[i]
        curr_bars = df[df['session_date'] == curr_s]
        
        # Asia box 20:00 to 02:00
        box = curr_bars[(curr_bars.index.hour >= 20) | (curr_bars.index.hour < 2)]
        if len(box) < 180: continue
        
        b_high = box['high'].max()
        b_low = box['low'].min()
        b_range = b_high - b_low
        b_mid = (b_high + b_low) / 2.0
        
        if b_range > 1.20 or b_range < 0.20: continue
        
        # Test London open move (03:00 to 05:00 ET)
        london_bars = curr_bars[(curr_bars.index.hour >= 3) & (curr_bars.index.hour < 6)]
        if london_bars.empty: continue
        
        # Entry on break of box high/low
        pos = None
        entry_px = None
        stop_px = None
        target_px = None
        
        for t, bar in london_bars.iterrows():
            if pos is None:
                if bar['high'] > b_high + 0.05:
                    pos = 'LONG'
                    entry_px = b_high + 0.06
                    stop_px = b_mid
                    target_px = entry_px + 1.5 * (entry_px - stop_px)
                elif bar['low'] < b_low - 0.05:
                    pos = 'SHORT'
                    entry_px = b_low - 0.06
                    stop_px = b_mid
                    target_px = entry_px - 1.5 * (stop_px - entry_px)
            else:
                if pos == 'LONG':
                    if bar['low'] <= stop_px:
                        trades_a.append({'pnl': (stop_px - 0.01 - entry_px)*100 - 1.20, 'win': False})
                        pos = 'DONE'
                        break
                    elif bar['high'] >= target_px:
                        trades_a.append({'pnl': (target_px - 0.01 - entry_px)*100 - 1.20, 'win': True})
                        pos = 'DONE'
                        break
                elif pos == 'SHORT':
                    if bar['high'] >= stop_px:
                        trades_a.append({'pnl': (entry_px - stop_px - 0.01)*100 - 1.20, 'win': False})
                        pos = 'DONE'
                        break
                    elif bar['low'] <= target_px:
                        trades_a.append({'pnl': (entry_px - target_px - 0.01)*100 - 1.20, 'win': True})
                        pos = 'DONE'
                        break
                        
        if pos in ['LONG', 'SHORT']:
            # Exit at 06:00
            c = london_bars.iloc[-1]['close']
            pnl = (c - entry_px)*100 - 1.20 if pos == 'LONG' else (entry_px - c)*100 - 1.20
            trades_a.append({'pnl': pnl, 'win': pnl > 0})
            
    df_a = pd.DataFrame(trades_a)
    print(f"\n--- OIL TEST A (London Open Breakout from Asia Box) ---")
    if not df_a.empty:
        w = df_a[df_a['win'] == True]
        l = df_a[df_a['win'] == False]
        gp = w['pnl'].sum()
        gl = abs(l['pnl'].sum())
        print(f"Trades: {len(df_a)}, Win Rate: {len(w)/len(df_a)*100:.1f}%, PF: {gp/(gl+1e-9):.2f}, Net PnL: ${df_a['pnl'].sum():+.2f}")

    # Test B: Oil Asian VWAP Mean-Reversion with wider buffer (only when Asia Range > $1.50)
    # Testing Prior Day POC Reversion for Oil ONLY when dist > $1.00 and volume is below average (exhaustion)
    trades_b = []
    for i in range(1, len(unique_sessions)):
        prev_s = unique_sessions[i-1]
        curr_s = unique_sessions[i]
        
        prev_bars = df[df['session_date'] == prev_s]
        curr_bars = df[df['session_date'] == curr_s]
        
        prev_ny = prev_bars.between_time('09:30', '16:00')
        if prev_ny.empty: prev_ny = prev_bars
        
        prices = np.round(prev_ny['close'] / 0.01) * 0.01
        prev_poc = prev_ny.groupby(prices)['volume'].sum().idxmax()
        
        asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
        if len(asia_bars) < 60: continue
        
        open_px = asia_bars.iloc[0]['open']
        dist = open_px - prev_poc
        
        # Only when dist is large (> $0.80) AND first 30m volume is quiet
        first_30m_vol = asia_bars.iloc[:30]['volume'].sum()
        if abs(dist) >= 0.80 and first_30m_vol < 15000:
            side = 'SHORT' if dist > 0 else 'LONG'
            entry_px = open_px - 0.01 if side == 'SHORT' else open_px + 0.01
            target_px = prev_poc
            stop_px = entry_px + abs(dist)*0.75 if side == 'SHORT' else entry_px - abs(dist)*0.75
            
            exit_px = None
            for t, bar in asia_bars.iloc[1:].iterrows():
                if side == 'SHORT':
                    if bar['high'] >= stop_px:
                        exit_px = stop_px + 0.01
                        break
                    elif bar['low'] <= target_px:
                        exit_px = target_px + 0.01
                        break
                else:
                    if bar['low'] <= stop_px:
                        exit_px = stop_px - 0.01
                        break
                    elif bar['high'] >= target_px:
                        exit_px = target_px - 0.01
                        break
            if exit_px is None:
                exit_px = asia_bars.iloc[-1]['close']
                
            pnl = (entry_px - exit_px)*100 - 1.20 if side == 'SHORT' else (exit_px - entry_px)*100 - 1.20
            trades_b.append({'pnl': pnl, 'win': pnl > 0})
            
    df_b = pd.DataFrame(trades_b)
    print(f"\n--- OIL TEST B (Oil Quiet Imbalance POC Magnet) ---")
    if not df_b.empty:
        w = df_b[df_b['win'] == True]
        l = df_b[df_b['win'] == False]
        gp = w['pnl'].sum()
        gl = abs(l['pnl'].sum())
        print(f"Trades: {len(df_b)}, Win Rate: {len(w)/len(df_b)*100:.1f}%, PF: {gp/(gl+1e-9):.2f}, Net PnL: ${df_b['pnl'].sum():+.2f}")

if __name__ == '__main__':
    analyze_oil_asia()
