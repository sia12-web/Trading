import os
import pandas as pd
import numpy as np

def compute_daily_and_asia_stats(inst_name, parquet_file, tick_size, point_value):
    df = pd.read_parquet(parquet_file)
    df['ts_et'] = pd.to_datetime(df['ts_et'])
    df.set_index('ts_et', inplace=True)
    df.sort_index(inplace=True)

    # Label each bar with a trade date.
    # CME Globex session for trade date D begins at 18:00 ET on D-1 and ends at 17:00 ET on D.
    # If hour >= 18, it belongs to the next calendar trade date (if Friday, Monday).
    # Let's group by Globex trade date:
    trade_dates = []
    for ts in df.index:
        date = ts.date()
        if ts.hour >= 18:
            # Advance to next day
            next_d = date + pd.Timedelta(days=1)
            # If next_d is Saturday, Sunday handles it
            if next_d.weekday() == 5: # Saturday
                next_d = next_d + pd.Timedelta(days=2)
            elif next_d.weekday() == 6: # Sunday
                next_d = next_d + pd.Timedelta(days=1)
            trade_dates.append(next_d)
        else:
            trade_dates.append(date)

    df['trade_date'] = trade_dates

    # Now let's analyze each trade date:
    # Prior session: The bars from trade_date - 1 (or specifically NY cash 09:30-16:00 ET of prior day)
    # Asian session of trade_date: 18:00 ET (of calendar day D-1) to 02:00 ET (of calendar day D)
    
    unique_dates = sorted(list(set(df['trade_date'])))
    print(f"[{inst_name.upper()}] Unique trade dates: {len(unique_dates)}")

    days_data = []

    for i in range(1, len(unique_dates)):
        prev_date = unique_dates[i-1]
        curr_date = unique_dates[i]

        prev_bars = df[df['trade_date'] == prev_date]
        curr_bars = df[df['trade_date'] == curr_date]

        if prev_bars.empty or curr_bars.empty:
            continue

        # Prior day stats:
        # Full prior session:
        prev_high = prev_bars['high'].max()
        prev_low = prev_bars['low'].min()
        prev_close = prev_bars['close'].iloc[-1]
        
        # Prior NY cash session (09:30 - 16:00 ET):
        prev_ny = prev_bars.between_time('09:30', '16:00')
        if not prev_ny.empty:
            prev_ny_high = prev_ny['high'].max()
            prev_ny_low = prev_ny['low'].min()
            prev_ny_close = prev_ny['close'].iloc[-1]
            
            # Prior NY POC (volume-weighted price binning)
            # Bin prices by tick_size
            prices = np.round(prev_ny['close'] / tick_size) * tick_size
            vol_series = prev_ny.groupby(prices)['volume'].sum()
            prev_poc = vol_series.idxmax() if not vol_series.empty else prev_ny['close'].median()
            
            # Value Area (70% of volume)
            tot_vol = vol_series.sum()
            sorted_vols = vol_series.sort_values(ascending=False)
            cumsum = sorted_vols.cumsum()
            va_prices = sorted_vols[cumsum <= 0.70 * tot_vol].index
            prev_vah = va_prices.max() if len(va_prices) > 0 else prev_ny_high
            prev_val = va_prices.min() if len(va_prices) > 0 else prev_ny_low
        else:
            prev_ny_high, prev_ny_low, prev_ny_close = prev_high, prev_low, prev_close
            prev_poc = (prev_high + prev_low) / 2
            prev_vah, prev_val = prev_high, prev_low

        # Asian session bars:
        # From 18:00 ET on previous calendar evening to 02:00 ET on curr_date morning
        # In curr_bars, this corresponds to:
        # hour >= 18 (previous evening) OR hour < 2 (current morning)
        asia_bars = curr_bars[(curr_bars.index.hour >= 18) | (curr_bars.index.hour < 2)]
        
        if len(asia_bars) < 60: # Need at least 1 hour of bars
            continue

        asia_open = asia_bars['open'].iloc[0]
        asia_high = asia_bars['high'].max()
        asia_low = asia_bars['low'].min()
        asia_close = asia_bars['close'].iloc[-1]
        asia_range = asia_high - asia_low
        asia_vol = asia_bars['volume'].sum()

        # Did Asia touch / sweep Prior Day High?
        touched_prev_high = asia_high >= prev_high
        swept_prev_high = (asia_high > prev_high) and (asia_close < prev_high) # closed back below

        # Did Asia touch / sweep Prior Day Low?
        touched_prev_low = asia_low <= prev_low
        swept_prev_low = (asia_low < prev_low) and (asia_close > prev_low) # closed back above

        # Did Asia touch Prior POC?
        # Check if prev_poc is between asia_low and asia_high
        touched_prev_poc = (asia_low <= prev_poc <= asia_high)
        
        # Distance of Asia open to Prior POC
        dist_open_to_poc = abs(asia_open - prev_poc)

        days_data.append({
            'trade_date': curr_date,
            'prev_high': prev_high,
            'prev_low': prev_low,
            'prev_poc': prev_poc,
            'prev_vah': prev_vah,
            'prev_val': prev_val,
            'asia_open': asia_open,
            'asia_high': asia_high,
            'asia_low': asia_low,
            'asia_close': asia_close,
            'asia_range': asia_range,
            'asia_vol': asia_vol,
            'touched_prev_high': touched_prev_high,
            'swept_prev_high': swept_prev_high,
            'touched_prev_low': touched_prev_low,
            'swept_prev_low': swept_prev_low,
            'touched_prev_poc': touched_prev_poc,
            'dist_open_to_poc': dist_open_to_poc
        })

    res_df = pd.DataFrame(days_data)
    print(f"\n=================== STATS FOR {inst_name.upper()} ({len(res_df)} trading days) ===================")
    print(f"Mean Asia Range: {res_df['asia_range'].mean():.2f} (Median: {res_df['asia_range'].median():.2f})")
    print(f"Touched Prev Day High during Asia: {res_df['touched_prev_high'].mean()*100:.1f}%")
    print(f"  - Swept and Closed back inside Prev High: {res_df['swept_prev_high'].sum()} / {res_df['touched_prev_high'].sum()} ({res_df['swept_prev_high'].sum()/(res_df['touched_prev_high'].sum()+1e-9)*100:.1f}%)")
    print(f"Touched Prev Day Low during Asia: {res_df['touched_prev_low'].mean()*100:.1f}%")
    print(f"  - Swept and Closed back inside Prev Low: {res_df['swept_prev_low'].sum()} / {res_df['touched_prev_low'].sum()} ({res_df['swept_prev_low'].sum()/(res_df['touched_prev_low'].sum()+1e-9)*100:.1f}%)")
    print(f"Touched Prev Day POC during Asia: {res_df['touched_prev_poc'].mean()*100:.1f}%")
    print(f"Mean distance from Asia Open to Prev POC: {res_df['dist_open_to_poc'].mean():.2f}")
    
    return res_df

if __name__ == '__main__':
    # MNQ tick: 0.25, point: $2
    compute_daily_and_asia_stats('nasdaq', 'data/databento_6m/nasdaq_1m.parquet', 0.25, 2.0)
    # MCL tick: 0.01, point: $100
    compute_daily_and_asia_stats('oil', 'data/databento_6m/oil_1m.parquet', 0.01, 100.0)
    # MGC tick: 0.10, point: $10
    compute_daily_and_asia_stats('gold', 'data/databento_6m/gold_1m.parquet', 0.10, 10.0)
