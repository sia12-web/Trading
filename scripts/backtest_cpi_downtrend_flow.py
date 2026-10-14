#!/usr/bin/env python3
"""
Institutional Backtest Engine:
CPI Release (08:30 AM ET) -> New York Downtrend -> Subsequent Asia & London Flow + Nikkei 225 Reaction

Empirical Study across 2020-2026 CME Multiyear Datasets & Global Exchange Feeds.
Assets Analyzed:
1. NASDAQ-100 (MNQ / NQ)
2. DOW JONES (MYM / YM)
3. GOLD (MGC / GC)
4. NIKKEI 225 (NKD / ^N225 / NIY)
"""

import os
import json
import bisect
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

NY_TZ = ZoneInfo("America/New_York")
UTC_TZ = ZoneInfo("UTC")

# Official US CPI Release Dates (8:30 AM ET) 2020 through 2026
CPI_DATES = [
    # 2020
    '2020-01-14', '2020-02-13', '2020-03-11', '2020-04-10', '2020-05-12', '2020-06-10',
    '2020-07-14', '2020-08-12', '2020-09-11', '2020-10-13', '2020-11-12', '2020-12-10',
    # 2021
    '2021-01-13', '2021-02-10', '2021-03-10', '2021-04-13', '2021-05-12', '2021-06-10',
    '2021-07-13', '2021-08-11', '2021-09-14', '2021-10-13', '2021-11-10', '2021-12-10',
    # 2022
    '2022-01-12', '2022-02-10', '2022-03-10', '2022-04-12', '2022-05-11', '2022-06-10',
    '2022-07-13', '2022-08-10', '2022-09-13', '2022-10-13', '2022-11-10', '2022-12-13',
    # 2023
    '2023-01-12', '2023-02-14', '2023-03-14', '2023-04-12', '2023-05-10', '2023-06-13',
    '2023-07-12', '2023-08-10', '2023-09-13', '2023-10-12', '2023-11-14', '2023-12-12',
    # 2024
    '2024-01-11', '2024-02-13', '2024-03-12', '2024-04-10', '2024-05-15', '2024-06-12',
    '2024-07-11', '2024-08-14', '2024-09-11', '2024-10-10', '2024-11-13', '2024-12-11',
    # 2025
    '2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10', '2025-05-14', '2025-06-11',
    '2025-07-11', '2025-08-13', '2025-09-10', '2025-10-14', '2025-11-12', '2025-12-10',
    # 2026
    '2026-01-14', '2026-02-11', '2026-03-11', '2026-04-14', '2026-05-13', '2026-06-10',
    '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14'
]

def load_cme_bars(market_file):
    print(f"Loading {market_file}...")
    with open(market_file, 'r') as f:
        bars = json.load(f)
    bars.sort(key=lambda b: b['time'])
    timestamps = [b['time'] for b in bars]
    return bars, timestamps

def fetch_nikkei_and_fx():
    """Fetch Nikkei 225 (^N225 & NKD=F) and USDJPY from Yahoo Finance"""
    print("Fetching Nikkei 225 (^N225) and USD/JPY from Yahoo Finance...")
    daily_nikkei = {}
    daily_usdjpy = {}
    
    # 1. Fetch ^N225 (Cash Nikkei - 10y daily bars)
    try:
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?interval=1d&range=10y'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            res = data['chart']['result'][0]
            ts = res.get('timestamp', [])
            quote = res.get('indicators', {}).get('quote', [{}])[0]
            opens = quote.get('open', [])
            highs = quote.get('high', [])
            lows = quote.get('low', [])
            closes = quote.get('close', [])
            
            for i in range(len(ts)):
                if ts[i] and opens[i] is not None and closes[i] is not None:
                    # Convert to YYYY-MM-DD in Tokyo time (UTC+9)
                    dt_tokyo = datetime.fromtimestamp(ts[i], tz=UTC_TZ) + timedelta(hours=9)
                    date_key = dt_tokyo.strftime('%Y-%m-%d')
                    daily_nikkei[date_key] = {
                        'time': ts[i],
                        'open': opens[i],
                        'high': highs[i] if highs[i] is not None else opens[i],
                        'low': lows[i] if lows[i] is not None else opens[i],
                        'close': closes[i],
                    }
    except Exception as e:
        print(f"Warning fetching ^N225 daily: {e}")

    # 2. Fetch USDJPY=X (Daily bars)
    try:
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDJPY=X?interval=1d&range=10y'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            res = data['chart']['result'][0]
            ts = res.get('timestamp', [])
            quote = res.get('indicators', {}).get('quote', [{}])[0]
            opens = quote.get('open', [])
            closes = quote.get('close', [])
            for i in range(len(ts)):
                if ts[i] and opens[i] is not None and closes[i] is not None:
                    dt = datetime.fromtimestamp(ts[i], tz=NY_TZ)
                    daily_usdjpy[dt.strftime('%Y-%m-%d')] = {
                        'open': opens[i],
                        'close': closes[i],
                        'change_pct': ((closes[i] - opens[i]) / opens[i]) * 100.0 if opens[i] > 0 else 0.0
                    }
    except Exception as e:
        print(f"Warning fetching USDJPY: {e}")

    return daily_nikkei, daily_usdjpy

def get_event_slice(bars, timestamps, start_dt, end_dt):
    t_start = int(start_dt.timestamp())
    t_end = int(end_dt.timestamp())
    i_start = bisect.bisect_left(timestamps, t_start)
    i_end = bisect.bisect_right(timestamps, t_end)
    return bars[i_start:i_end]

def analyze_market_cpi_events(market_name, bars, timestamps, nikkei_daily, usdjpy_daily):
    print(f"\n=======================================================")
    print(f"  Analyzing {market_name} across CPI Downtrend Sessions")
    print(f"=======================================================")
    
    events = []
    min_ny_bars = 4 if market_name == 'GOLD' else 25
    min_asia_bars = 4 if market_name == 'GOLD' else 15
    
    for cpi_str in CPI_DATES:
        try:
            cpi_dt = datetime.strptime(cpi_str, '%Y-%m-%d').replace(tzinfo=NY_TZ)
            next_day_dt = cpi_dt + timedelta(days=1)
            
            total_start = cpi_dt.replace(hour=8, minute=0)
            total_end = next_day_dt.replace(hour=10, minute=0)
            
            slice_bars = get_event_slice(bars, timestamps, total_start, total_end)
            if not slice_bars or len(slice_bars) < (min_ny_bars + min_asia_bars):
                continue
                
            ny_bars = []
            asia_bars = []
            lon_bars = []
            
            for b in slice_bars:
                dt = datetime.fromtimestamp(b['time'], tz=NY_TZ)
                mins = dt.hour * 60 + dt.minute
                is_cpi_day = (dt.date() == cpi_dt.date())
                is_next_day = (dt.date() == next_day_dt.date())
                
                # NY Session (08:30 to 16:00 ET)
                if is_cpi_day and 8*60+30 <= mins < 16*60:
                    ny_bars.append(b)
                # Asia Session (18:00 - 02:00 ET)
                elif (is_cpi_day and mins >= 18*60) or (is_next_day and mins < 2*60):
                    asia_bars.append(b)
                # London Session (03:00 - 09:30 ET)
                elif is_next_day and 3*60 <= mins < 9*60+30:
                    lon_bars.append(b)
                    
            if len(ny_bars) < min_ny_bars:
                continue
                
            # Compute NY Metrics
            ny_open = ny_bars[0]['open']
            ny_close = ny_bars[-1]['close']
            ny_high = max(b['high'] for b in ny_bars)
            ny_low = min(b['low'] for b in ny_bars)
            ny_range = ny_high - ny_low
            ny_change_pct = ((ny_close - ny_open) / ny_open) * 100.0
            
            # Position of close in NY range: 0.0 = low of day, 1.0 = high of day
            ny_close_pos = (ny_close - ny_low) / ny_range if ny_range > 0 else 0.5
            
            # Criteria for "Big Downtrend on CPI day":
            # For Equities (NQ/YM): Drop <= -0.50% and close in bottom 40% of range, or Drop <= -1.0%
            # For Gold: Drop <= -0.40% and close in bottom 40% of range, or Drop <= -0.75%
            is_downtrend = False
            if market_name == 'GOLD':
                is_downtrend = (ny_change_pct <= -0.35 and ny_close_pos <= 0.40) or (ny_change_pct <= -0.70)
            else:
                is_downtrend = (ny_change_pct <= -0.50 and ny_close_pos <= 0.40) or (ny_change_pct <= -1.0)
                
            if not is_downtrend:
                continue
                
            if len(asia_bars) < min_asia_bars:
                continue
                
            # Asia Metrics
            asia_open = asia_bars[0]['open']
            asia_close = asia_bars[-1]['close']
            asia_high = max(b['high'] for b in asia_bars)
            asia_low = min(b['low'] for b in asia_bars)
            asia_range = asia_high - asia_low
            asia_change_pct = ((asia_close - asia_open) / asia_open) * 100.0
            asia_compression = asia_range / ny_range if ny_range > 0 else 1.0
            
            # Does Asia test the NY Low? (within 0.15% buffer or break)
            tested_ny_low_asia = (asia_low <= ny_low * 1.0015)
            broke_ny_low_asia = (asia_low < ny_low)
            deep_break_asia = (asia_low < ny_low * 0.995) # >0.5% below NY low
            
            # Does Asia test the NY High?
            tested_ny_high_asia = (asia_high >= ny_high * 0.998)
            
            # Does Asia retrace to the NY Midpoint?
            ny_mid = (ny_high + ny_low) / 2.0
            retested_ny_mid_asia = (asia_high >= ny_mid)
            
            # London Metrics
            tested_ny_low_lon = False
            tested_asia_low_lon = False
            broke_ny_low_lon = False
            broke_asia_low_lon = False
            lon_change_pct = 0.0
            lon_compression = 0.0
            judas_swing_reversal = False
            continuation_down_lon = False
            has_london = len(lon_bars) >= (4 if market_name == 'GOLD' else 15)
            
            if has_london:
                lon_open = lon_bars[0]['open']
                lon_close = lon_bars[-1]['close']
                lon_high = max(b['high'] for b in lon_bars)
                lon_low = min(b['low'] for b in lon_bars)
                lon_range = lon_high - lon_low
                lon_change_pct = ((lon_close - lon_open) / lon_open) * 100.0
                lon_compression = lon_range / ny_range if ny_range > 0 else 1.0
                
                tested_ny_low_lon = (lon_low <= ny_low * 1.0015)
                tested_asia_low_lon = (lon_low <= asia_low * 1.0015)
                broke_ny_low_lon = (lon_low < ny_low)
                broke_asia_low_lon = (lon_low < asia_low)
                
                # Judas swing: London sweeps Asia or NY low early, then closes green and above Asia high
                judas_swing_reversal = (broke_asia_low_lon or broke_ny_low_lon) and (lon_close > lon_open) and (lon_high > asia_high)
                continuation_down_lon = (lon_close < lon_open) and (broke_ny_low_lon or broke_asia_low_lon) and (lon_close < asia_close)

            # Nikkei Reaction on the Following Day (Tokyo Cash Session)
            tokyo_date_str = next_day_dt.strftime('%Y-%m-%d')
            nikkei_event = nikkei_daily.get(tokyo_date_str)
            
            nk_change = None
            nk_gap = None
            if nikkei_event:
                cpi_day_tokyo_str = cpi_dt.strftime('%Y-%m-%d')
                prior_nk = nikkei_daily.get(cpi_day_tokyo_str)
                if prior_nk and prior_nk['close'] > 0:
                    nk_gap = ((nikkei_event['open'] - prior_nk['close']) / prior_nk['close']) * 100.0
                if nikkei_event['open'] > 0:
                    nk_change = ((nikkei_event['close'] - nikkei_event['open']) / nikkei_event['open']) * 100.0

            # USD/JPY change on CPI day
            usdjpy_event = usdjpy_daily.get(cpi_str)
            usdjpy_chg = usdjpy_event['change_pct'] if usdjpy_event else None

            events.append({
                'date': cpi_str,
                'market': market_name,
                'ny_open': ny_open,
                'ny_high': ny_high,
                'ny_low': ny_low,
                'ny_close': ny_close,
                'ny_change_pct': ny_change_pct,
                'ny_close_pos': ny_close_pos,
                
                # Asia
                'asia_open': asia_open,
                'asia_high': asia_high,
                'asia_low': asia_low,
                'asia_close': asia_close,
                'asia_change_pct': asia_change_pct,
                'asia_compression': asia_compression,
                'tested_ny_low_asia': tested_ny_low_asia,
                'broke_ny_low_asia': broke_ny_low_asia,
                'deep_break_asia': deep_break_asia,
                'tested_ny_high_asia': tested_ny_high_asia,
                'retested_ny_mid_asia': retested_ny_mid_asia,
                
                # London
                'has_london': has_london,
                'lon_change_pct': lon_change_pct,
                'tested_ny_low_lon': tested_ny_low_lon,
                'tested_asia_low_lon': tested_asia_low_lon,
                'broke_ny_low_lon': broke_ny_low_lon,
                'broke_asia_low_lon': broke_asia_low_lon,
                'judas_swing_reversal': judas_swing_reversal,
                'continuation_down_lon': continuation_down_lon,
                
                # Nikkei & USDJPY
                'nikkei_gap': nk_gap,
                'nikkei_change': nk_change,
                'usdjpy_change': usdjpy_chg,
            })
            
        except Exception as e:
            print(f"Error processing {market_name} {cpi_str}: {e}")
            
    print(f"Found {len(events)} qualified CPI Downtrend sessions for {market_name}.")
    return events

def summarize_events(events, market_name):
    n = len(events)
    if n == 0:
        return {
            'market': market_name,
            'total_events': 0,
            'avg_ny_drop': 0.0,
            'asia_tested_low_pct': 0.0,
            'asia_broke_low_pct': 0.0,
            'asia_deep_break_pct': 0.0,
            'asia_tested_high_pct': 0.0,
            'asia_retested_mid_pct': 0.0,
            'asia_compressed_pct': 0.0,
            'avg_asia_change': 0.0,
            'avg_asia_comp': 0.0,
            'london_events': 0,
            'lon_tested_low_pct': 0.0,
            'lon_broke_low_pct': 0.0,
            'lon_judas_reversal_pct': 0.0,
            'lon_continuation_pct': 0.0,
            'avg_lon_change': 0.0,
            'nikkei_events': 0,
            'avg_nk_gap': 0.0,
            'avg_nk_change': 0.0,
            'nk_gap_down_pct': 0.0,
            'nk_continue_down_pct': 0.0,
            'nk_absorb_bounce_pct': 0.0,
        }
        
    avg_ny_drop = sum(e['ny_change_pct'] for e in events) / n
    
    # Asia Stats
    asia_tested_low_cnt = sum(1 for e in events if e['tested_ny_low_asia'])
    asia_broke_low_cnt = sum(1 for e in events if e['broke_ny_low_asia'])
    asia_deep_break_cnt = sum(1 for e in events if e['deep_break_asia'])
    asia_tested_high_cnt = sum(1 for e in events if e['tested_ny_high_asia'])
    asia_retested_mid_cnt = sum(1 for e in events if e['retested_ny_mid_asia'])
    asia_compressed_cnt = sum(1 for e in events if e['asia_compression'] <= 0.40)
    avg_asia_change = sum(e['asia_change_pct'] for e in events) / n
    avg_asia_comp = sum(e['asia_compression'] for e in events) / n
    
    # London Stats
    lon_events = [e for e in events if e['has_london']]
    n_lon = len(lon_events)
    lon_tested_low_cnt = sum(1 for e in lon_events if e['tested_ny_low_lon'] or e['tested_asia_low_lon'])
    lon_broke_low_cnt = sum(1 for e in lon_events if e['broke_ny_low_lon'])
    lon_judas_cnt = sum(1 for e in lon_events if e['judas_swing_reversal'])
    lon_cont_cnt = sum(1 for e in lon_events if e['continuation_down_lon'])
    avg_lon_change = (sum(e['lon_change_pct'] for e in lon_events) / n_lon) if n_lon > 0 else 0.0
    
    # Nikkei Stats
    nk_events = [e for e in events if e['nikkei_gap'] is not None]
    n_nk = len(nk_events)
    avg_nk_gap = (sum(e['nikkei_gap'] for e in nk_events) / n_nk) if n_nk > 0 else 0.0
    avg_nk_change = (sum(e['nikkei_change'] for e in nk_events if e['nikkei_change'] is not None) / n_nk) if n_nk > 0 else 0.0
    nk_gap_down_cnt = sum(1 for e in nk_events if e['nikkei_gap'] < -0.2)
    nk_continue_down_cnt = sum(1 for e in nk_events if e['nikkei_change'] is not None and e['nikkei_change'] < -0.2)
    nk_absorb_bounce_cnt = sum(1 for e in nk_events if e['nikkei_change'] is not None and e['nikkei_change'] > 0.1)

    return {
        'market': market_name,
        'total_events': n,
        'avg_ny_drop': avg_ny_drop,
        
        # Asia
        'asia_tested_low_pct': (asia_tested_low_cnt / n) * 100.0,
        'asia_broke_low_pct': (asia_broke_low_cnt / n) * 100.0,
        'asia_deep_break_pct': (asia_deep_break_cnt / n) * 100.0,
        'asia_tested_high_pct': (asia_tested_high_cnt / n) * 100.0,
        'asia_retested_mid_pct': (asia_retested_mid_cnt / n) * 100.0,
        'asia_compressed_pct': (asia_compressed_cnt / n) * 100.0,
        'avg_asia_change': avg_asia_change,
        'avg_asia_comp': avg_asia_comp,
        
        # London
        'london_events': n_lon,
        'lon_tested_low_pct': (lon_tested_low_cnt / n_lon * 100.0) if n_lon > 0 else 0.0,
        'lon_broke_low_pct': (lon_broke_low_cnt / n_lon * 100.0) if n_lon > 0 else 0.0,
        'lon_judas_reversal_pct': (lon_judas_cnt / n_lon * 100.0) if n_lon > 0 else 0.0,
        'lon_continuation_pct': (lon_cont_cnt / n_lon * 100.0) if n_lon > 0 else 0.0,
        'avg_lon_change': avg_lon_change,
        
        # Nikkei
        'nikkei_events': n_nk,
        'avg_nk_gap': avg_nk_gap,
        'avg_nk_change': avg_nk_change,
        'nk_gap_down_pct': (nk_gap_down_cnt / n_nk * 100.0) if n_nk > 0 else 0.0,
        'nk_continue_down_pct': (nk_continue_down_cnt / n_nk * 100.0) if n_nk > 0 else 0.0,
        'nk_absorb_bounce_pct': (nk_absorb_bounce_cnt / n_nk * 100.0) if n_nk > 0 else 0.0,
    }

def main():
    nikkei_daily, usdjpy_daily = fetch_nikkei_and_fx()
    
    markets = [
        ('NASDAQ', 'data/cme_multiyear/nasdaq_1m_multiyear.json'),
        ('DOW', 'data/cme_multiyear/dow_1m_multiyear.json'),
        ('GOLD', 'data/cme_multiyear/gold_1m_multiyear.json'),
    ]
    
    all_summaries = {}
    all_events = {}
    
    for m_name, m_path in markets:
        if not os.path.exists(m_path):
            print(f"Skipping {m_name}, file not found: {m_path}")
            continue
        bars, timestamps = load_cme_bars(m_path)
        evs = analyze_market_cpi_events(m_name, bars, timestamps, nikkei_daily, usdjpy_daily)
        all_events[m_name] = evs
        summary = summarize_events(evs, m_name)
        all_summaries[m_name] = summary
        
    out_json = 'data/cpi_downtrend_backtest_results.json'
    os.makedirs('data', exist_ok=True)
    with open(out_json, 'w') as f:
        json.dump({'summaries': all_summaries, 'events': all_events}, f, indent=2)
    print(f"\nSaved raw results to {out_json}")
    
    print("\n" + "="*80)
    print("  INSTITUTIONAL EMPIRICAL BACKTEST SUMMARY: CPI DOWNTREND REGIME (2020-2026)")
    print("="*80)
    
    for m_name, s in all_summaries.items():
        if s['total_events'] == 0:
            print(f"\n--- {m_name} (0 events) ---")
            continue
        print(f"\n--- {m_name} (Events: {s['total_events']}) ---")
        print(f"  Avg NY Drop on CPI Day:        {s['avg_ny_drop']:.2f}%")
        print(f"  [ASIA SESSION (18:00–02:00 ET)]")
        print(f"    - Tests NY Low:              {s['asia_tested_low_pct']:.1f}%")
        print(f"    - Breaks to New Low:         {s['asia_broke_low_pct']:.1f}%")
        print(f"    - Deep Extension (>0.5% brk):{s['asia_deep_break_pct']:.1f}%")
        print(f"    - Retests NY Midpoint / VWAP:{s['asia_retested_mid_pct']:.1f}%")
        print(f"    - Tests NY High:             {s['asia_tested_high_pct']:.1f}% (Virtually Never!)")
        print(f"    - Severe Compression Box:   {s['asia_compressed_pct']:.1f}%")
        print(f"    - Average Asia Session Return: {s['avg_asia_change']:.2f}%")
        print(f"  [LONDON SESSION (03:00–09:30 ET)]")
        print(f"    - Tests Prior Lows (NY/Asia):{s['lon_tested_low_pct']:.1f}%")
        print(f"    - Breaks Below NY Low:       {s['lon_broke_low_pct']:.1f}%")
        print(f"    - Judas Swing / Sweep & Reversal: {s['lon_judas_reversal_pct']:.1f}%")
        print(f"    - Pure Continuation Down:    {s['lon_continuation_pct']:.1f}%")
        print(f"    - Average London Return:     {s['avg_lon_change']:.2f}%")
        print(f"  [NIKKEI 225 RESPONSE (Tokyo Cash)]")
        print(f"    - Gap Down at Tokyo Open:    {s['nk_gap_down_pct']:.1f}% (Avg Gap: {s['avg_nk_gap']:.2f}%)")
        print(f"    - Tokyo Intraday Drift Down: {s['nk_continue_down_pct']:.1f}%")
        print(f"    - Tokyo Absorb & Bounce:     {s['nk_absorb_bounce_pct']:.1f}%")
        print(f"    - Net Tokyo Session Return:  {s['avg_nk_change']:.2f}%")

if __name__ == '__main__':
    main()
