import json
import math
import numpy as np
import pandas as pd
from datetime import datetime, timezone

def load_data(filepath):
    with open(filepath, 'r') as f:
        raw_candles = json.load(f)
    
    rows = []
    for c in raw_candles:
        if not c.get('complete', True):
            continue
        t_str = c['time']
        # parse ISO datetime
        dt = datetime.fromisoformat(t_str.replace('Z', '+00:00'))
        epoch = int(dt.timestamp())
        vol = float(c.get('volume', 0))
        mid = c['mid']
        o = float(mid['o'])
        h = float(mid['h'])
        l = float(mid['l'])
        cl = float(mid['c'])
        rows.append({
            'time': epoch,
            'datetime': dt,
            'open': o,
            'high': h,
            'low': l,
            'close': cl,
            'volume': vol
        })
    df = pd.DataFrame(rows)
    df.sort_values('time', inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df

def compute_indicators(df):
    # ATR 14
    high = df['high']
    low = df['low']
    close = df['close']
    prev_close = close.shift(1).fillna(close)
    
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['tr'] = tr
    df['atr14'] = tr.ewm(alpha=1/14, adjust=False).mean()
    
    # Tick Delta proxy: Close Location Value (CLV) * Volume
    # CLV in [-1, 1]
    denom = high - low
    denom = denom.replace(0, 0.0001)
    clv = ((close - low) - (high - close)) / denom
    df['delta'] = (clv * df['volume']).round()
    
    # Continuous CVD and Session CVD
    df['cvd'] = df['delta'].cumsum()
    
    # Session identification (ET clock)
    # UTC to ET: ET is UTC-4 (EDT) or UTC-5 (EST)
    # Simple ET hour calculation:
    et_hours = [(dt.hour - 4) % 24 for dt in df['datetime']]
    df['hour_et'] = et_hours
    
    # Identify session
    def get_session(h):
        if h >= 18 or h < 2:
            return 'ASIA'
        elif 2 <= h < 8:
            return 'LONDON'
        elif 8 <= h < 12:
            return 'NY_AM'
        elif 12 <= h < 16:
            return 'NY_PM'
        else:
            return 'POST_SETTLE'
    df['session'] = [get_session(h) for h in et_hours]
    
    # Session CVD (resets at 18:00 ET)
    is_session_start = (df['hour_et'] == 18) & (df['hour_et'].shift(1) != 18)
    df['session_id'] = is_session_start.cumsum()
    df['session_cvd'] = df.groupby('session_id')['delta'].cumsum()
    
    return df

def backtest_wyckoff_ranges(df, timeframe_label="M15", min_bars=16, max_bars=80):
    """
    Scans for trading ranges (consolidations) and evaluates:
    1. Structure: Accumulation vs Distribution
    2. Lower Lows vs Higher Highs behavior inside the range
    3. Phase C: Springs (Lower Low flush/sweeps) vs UTADs (Higher High sweeps)
    4. CVD Absorption Divergence
    5. Phase D/E: Markup expansion vs Markdown expansion
    """
    ranges = []
    i = 30
    n = len(df)
    
    while i < n - 40:
        # Check window [i - min_bars, i]
        slice_init = df.iloc[i - min_bars : i]
        avg_atr = slice_init['atr14'].mean()
        
        range_high = slice_init['high'].max()
        range_low = slice_init['low'].min()
        span = range_high - range_low
        span_atr = span / (avg_atr if avg_atr > 0 else 1.0)
        
        # Consolidation definition: span between 1.5 and 5.0 ATR
        if not (1.5 <= span_atr <= 5.5):
            i += 2
            continue
            
        # We have a candidate consolidation range!
        # Trace forward to find the duration, sweeps, and breakout
        had_spring = False
        spring_depth = 0.0
        spring_bars = 0
        spring_cvd_div = False
        spring_idx = -1
        
        had_utad = False
        utad_depth = 0.0
        utad_bars = 0
        utad_cvd_div = False
        utad_idx = -1
        
        # Track swing highs and swing lows within the range to determine if
        # accumulation happens in Higher Lows or Lower Lows
        lows_in_range = []
        highs_in_range = []
        
        resolved = False
        res_type = None
        breakout_idx = -1
        
        max_search = min(i + max_bars, n - 20)
        
        for j in range(i, max_search):
            bar = df.iloc[j]
            prev_bar = df.iloc[j - 1]
            
            # Check for Spring / Flush below Range Low (Creek)
            if bar['low'] < range_low:
                depth = range_low - bar['low']
                if depth > spring_depth:
                    spring_depth = depth
                    spring_idx = j
                    # Check CVD divergence:
                    # Bullish absorption: Price makes LL below range_low, but session CVD or bar delta is positive / absorbed
                    # Or bar closed strongly above its low (hammer / absorption pin bar)
                    clv = ((bar['close'] - bar['low']) - (bar['high'] - bar['close'])) / (bar['high'] - bar['low'] + 0.0001)
                    if bar['delta'] > 0 or clv > 0.3 or bar['session_cvd'] > df.iloc[i - min_bars : j]['session_cvd'].min():
                        spring_cvd_div = True
                
                # Check if it was a quick reclaim (within 1 to 4 bars)
                # This defines a Spring / Flush trap vs a genuine breakdown
                future_reclaim = df.iloc[j : min(j + 4, n)]
                if (future_reclaim['close'] > range_low).any():
                    had_spring = True
            
            # Check for Upthrust / UTAD above Range High (Ice)
            if bar['high'] > range_high:
                depth = bar['high'] - range_high
                if depth > utad_depth:
                    utad_depth = depth
                    utad_idx = j
                    # Bearish absorption: Price makes HH above range_high, but delta is negative or CVD fails to confirm
                    clv = ((bar['close'] - bar['low']) - (bar['high'] - bar['close'])) / (bar['high'] - bar['low'] + 0.0001)
                    if bar['delta'] < 0 or clv < -0.3 or bar['session_cvd'] < df.iloc[i - min_bars : j]['session_cvd'].max():
                        utad_cvd_div = True
                        
                future_rejection = df.iloc[j : min(j + 4, n)]
                if (future_rejection['close'] < range_high).any():
                    had_utad = True
                    
            # Check for decisive Phase D Breakout (Mark-Up vs Mark-Down)
            # Breakout requires closing >= 0.4 ATR outside range and following bar also outside
            if bar['close'] > range_high + 0.35 * avg_atr and j + 1 < n and df.iloc[j + 1]['close'] > range_high:
                resolved = True
                res_type = 'ACCUMULATION'
                breakout_idx = j
                break
                
            if bar['close'] < range_low - 0.35 * avg_atr and j + 1 < n and df.iloc[j + 1]['close'] < range_low:
                resolved = True
                res_type = 'DISTRIBUTION'
                breakout_idx = j
                break
                
        if resolved and breakout_idx > 0:
            start_bar = df.iloc[i - min_bars]
            b_bar = df.iloc[breakout_idx]
            duration_bars = breakout_idx - (i - min_bars)
            duration_hours = (b_bar['time'] - start_bar['time']) / 3600.0
            
            # Post-breakout expansion (MFE over next 16 bars)
            post_bars = df.iloc[breakout_idx : min(breakout_idx + 24, n)]
            if res_type == 'ACCUMULATION':
                mfe_pts = post_bars['high'].max() - range_high
                mae_pts = range_high - post_bars['low'].min()
            else:
                mfe_pts = range_low - post_bars['low'].min()
                mae_pts = post_bars['high'].max() - range_low
                
            # Classify Higher Highs / Lower Lows progression within the range:
            # Let's inspect sub-swings inside [start_idx : breakout_idx]
            range_sub = df.iloc[i - min_bars : breakout_idx]
            first_half = range_sub.iloc[: len(range_sub)//2]
            second_half = range_sub.iloc[len(range_sub)//2 :]
            
            first_half_low = first_half['low'].min()
            second_half_low = second_half['low'].min()
            first_half_high = first_half['high'].max()
            second_half_high = second_half['high'].max()
            
            # Low progression:
            # Did accumulation happen in Lower Lows (Spring / Sweep) or Higher Lows (Ascending Base)?
            if second_half_low < first_half_low:
                low_progression = 'LOWER_LOWS' # Classic Wyckoff Spring / Liquidity Flush
            elif second_half_low > first_half_low + 0.2 * avg_atr:
                low_progression = 'HIGHER_LOWS' # Ascending / Absorption without Flush
            else:
                low_progression = 'EQUAL_LOWS' # Flat Creek Support
                
            # High progression:
            if second_half_high > first_half_high:
                high_progression = 'HIGHER_HIGHS' # Upthrust / Pressure on Ice
            elif second_half_high < first_half_high - 0.2 * avg_atr:
                high_progression = 'LOWER_HIGHS' # Descending supply
            else:
                high_progression = 'EQUAL_HIGHS'
                
            # Accumulation subtype:
            if res_type == 'ACCUMULATION':
                if had_spring:
                    accum_subtype = 'SPRING_LOWER_LOW_FLUSH'
                elif low_progression == 'HIGHER_LOWS':
                    accum_subtype = 'HIGHER_LOWS_ASCENDING_ABSORPTION'
                else:
                    accum_subtype = 'FLAT_SUPPORT_RETEST'
            else:
                if had_utad:
                    accum_subtype = 'UTAD_HIGHER_HIGH_SWEEP'
                elif high_progression == 'LOWER_HIGHS':
                    accum_subtype = 'LOWER_HIGHS_HEAVY_SUPPLY'
                else:
                    accum_subtype = 'FLAT_ICE_BREAKDOWN'
                    
            ranges.append({
                'type': res_type,
                'subtype': accum_subtype,
                'start_time': start_bar['datetime'].isoformat(),
                'breakout_time': b_bar['datetime'].isoformat(),
                'duration_hours': round(duration_hours, 1),
                'duration_bars': duration_bars,
                'range_low': round(range_low, 2),
                'range_high': round(range_high, 2),
                'range_span_pts': round(span, 2),
                'range_span_atr': round(span_atr, 2),
                'avg_atr': round(avg_atr, 2),
                'had_spring': had_spring,
                'spring_depth_pts': round(spring_depth, 2),
                'spring_depth_atr': round(spring_depth / avg_atr, 2) if avg_atr > 0 else 0,
                'spring_cvd_div': spring_cvd_div,
                'had_utad': had_utad,
                'utad_depth_pts': round(utad_depth, 2),
                'utad_depth_atr': round(utad_depth / avg_atr, 2) if avg_atr > 0 else 0,
                'utad_cvd_div': utad_cvd_div,
                'low_progression': low_progression,
                'high_progression': high_progression,
                'breakout_session': b_bar['session'],
                'mfe_pts': round(max(0, mfe_pts), 2),
                'mae_pts': round(max(0, mae_pts), 2),
                'win_2r': (mfe_pts >= 2.0 * span),
                'win_1r': (mfe_pts >= 1.0 * span)
            })
            
            # Step past this breakout to avoid overlap
            i = breakout_idx + 8
        else:
            i += 3
            
    return ranges

if __name__ == '__main__':
    print("Loading Gold M15 dataset...")
    df_m15 = load_data('data/xau_usd_m15_2026.json')
    df_m15 = compute_indicators(df_m15)
    print(f"Loaded {len(df_m15)} M15 bars from {df_m15['datetime'].iloc[0]} to {df_m15['datetime'].iloc[-1]}")
    print(f"Price range: Low ${df_m15['low'].min():.2f} to High ${df_m15['high'].max():.2f}")
    
    print("\nExecuting Wyckoff Range & Order Flow Backtest on Gold M15...")
    m15_ranges = backtest_wyckoff_ranges(df_m15, "M15", min_bars=16, max_bars=80)
    print(f"Identified {len(m15_ranges)} qualified Wyckoff ranges on M15.")
    
    # Save results
    with open('data/gold_wyckoff_backtest_m15.json', 'w') as f:
        json.dump(m15_ranges, f, indent=2)
    print("Saved to data/gold_wyckoff_backtest_m15.json")
