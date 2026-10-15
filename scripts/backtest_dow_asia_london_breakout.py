"""
Empirical Backtest: Dow Jones Asia Compression & London Breakout Analysis
Evaluates Asia Range thresholds (40 to 160 pts, including <=80 vs <=100)
across 6-month and 1-year continuous CME Globex 1-minute Dow data (MYM / YM).

Answers:
1. What is the optimal Asia Range threshold (<=80 vs <=100 vs other)?
2. How often does London break the Asia range?
3. What is the win rate, profit factor, R-multiple, and drawdown of London breakouts?
4. What is the timing distribution of London breakouts (02:00 - 08:00 ET)?
5. How frequently does London produce a clean expansion vs a Judas fakeout / whipsaw?
"""

import json
import os
import sys
from datetime import datetime, timezone
import zoneinfo
import numpy as np
import pandas as pd

NY_TZ = zoneinfo.ZoneInfo("America/New_York")
UTC_TZ = timezone.utc

POINT_VALUE_MYM = 0.50  # Micro Dow ($0.50 per point)
POINT_VALUE_YM = 5.00   # Mini Dow ($5.00 per point)
BUFFER_PTS = 20         # Locked Pine breakout buffer
TP_MULTIPLIERS = [1.0, 1.5, 2.0]
THRESHOLDS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 9999]

def load_multiyear_bars(filepath: str, max_days: int = 365):
    print(f"Loading Dow 1-minute data from {filepath} (last {max_days} days)...")
    with open(filepath, "r") as f:
        raw = json.load(f)
    
    if not raw:
        return []

    end_time = raw[-1]["time"]
    start_time = end_time - max_days * 86400
    filtered = [b for b in raw if b["time"] >= start_time]
    print(f"Loaded {len(filtered):,} bars ({filtered[0]['time']} to {filtered[-1]['time']})")
    return filtered

def group_bars_by_session(bars):
    """
    Groups 1m bars into Globex trading dates.
    Globex session for trade date D runs from 18:00 ET (D-1) to 17:00 ET (D).
    """
    sessions = {}
    for b in bars:
        t_utc = datetime.fromtimestamp(b["time"], tz=UTC_TZ)
        t_et = t_utc.astimezone(NY_TZ)
        
        # Calculate Globex Trade Date
        date = t_et.date()
        if t_et.hour >= 18:
            trade_date = date + pd.Timedelta(days=1)
            if trade_date.weekday() == 5:  # Saturday
                trade_date += pd.Timedelta(days=2)
            elif trade_date.weekday() == 6:  # Sunday
                trade_date += pd.Timedelta(days=1)
        else:
            trade_date = date
            
        td_key = str(trade_date)
        if td_key not in sessions:
            sessions[td_key] = []
            
        # Store bar with ET time metadata
        mins_et = t_et.hour * 60 + t_et.minute
        sessions[td_key].append({
            "time": b["time"],
            "mins_et": mins_et,
            "hour_et": t_et.hour,
            "min_et": t_et.minute,
            "open": b["open"],
            "high": b["high"],
            "low": b["low"],
            "close": b["close"],
            "volume": b.get("volume", 0)
        })
    return sessions

def analyze_asia_and_london(sessions):
    """
    Extracts Asia Box (20:00 - 02:00 ET) and London session (02:00 - 08:00 / 10:25 ET)
    for each valid Globex trade date.
    """
    records = []
    
    for td_key in sorted(sessions.keys()):
        bars = sessions[td_key]
        if len(bars) < 300: # Need reasonable volume of bars
            continue
            
        # 1. Asia Box bars: 20:00 ET (1200 mins) to 02:00 ET (120 mins)
        # In our session mapping, 20:00-23:59 has mins_et >= 1200, 00:00-01:59 has mins_et < 120
        asia_bars = [b for b in bars if b["mins_et"] >= 1200 or b["mins_et"] < 120]
        if len(asia_bars) < 180: # Need at least 3 hours of Asia bars
            continue
            
        asia_high = max(b["high"] for b in asia_bars)
        asia_low = min(b["low"] for b in asia_bars)
        asia_range = asia_high - asia_low
        asia_mid = (asia_high + asia_low) / 2.0
        
        # 2. London bars: 02:00 ET (120 mins) to 08:00 ET (480 mins)
        # Extended window through 10:25 ET (625 mins) for hard flatten
        london_bars = [b for b in bars if 120 <= b["mins_et"] < 480]
        day_bars_until_flatten = [b for b in bars if 120 <= b["mins_et"] < 625]
        
        if len(london_bars) < 60:
            continue
            
        london_high = max(b["high"] for b in london_bars)
        london_low = min(b["low"] for b in london_bars)
        
        # Did London break Asia High / Low?
        broke_high = london_high > asia_high
        broke_low = london_low < asia_low
        broke_high_buf = london_high >= (asia_high + BUFFER_PTS)
        broke_low_buf = london_low <= (asia_low - BUFFER_PTS)
        
        # Timing of first break
        break_high_time = None
        break_low_time = None
        first_break_type = "NONE"
        first_break_min = None
        
        for b in day_bars_until_flatten:
            if break_high_time is None and b["high"] >= (asia_high + BUFFER_PTS):
                break_high_time = b["mins_et"]
            if break_low_time is None and b["low"] <= (asia_low - BUFFER_PTS):
                break_low_time = b["mins_et"]
                
        if break_high_time and break_low_time:
            if break_high_time < break_low_time:
                first_break_type = "LONG_FIRST"
                first_break_min = break_high_time
            else:
                first_break_type = "SHORT_FIRST"
                first_break_min = break_low_time
        elif break_high_time:
            first_break_type = "LONG_ONLY"
            first_break_min = break_high_time
        elif break_low_time:
            first_break_type = "SHORT_ONLY"
            first_break_min = break_low_time
            
        records.append({
            "trade_date": td_key,
            "asia_high": asia_high,
            "asia_low": asia_low,
            "asia_range": asia_range,
            "asia_mid": asia_mid,
            "london_high": london_high,
            "london_low": london_low,
            "broke_high": broke_high,
            "broke_low": broke_low,
            "broke_high_buf": broke_high_buf,
            "broke_low_buf": broke_low_buf,
            "first_break_type": first_break_type,
            "first_break_min": first_break_min,
            "day_bars": day_bars_until_flatten
        })
        
    return records

def simulate_trades(records, threshold, buffer_pts=20, fill_cutoff_mins=210, tp_r=1.5):
    """
    Simulates OCO Breakout Orders:
    - Lock at 02:00 ET (120 mins).
    - If Asia Range <= threshold, place:
        Buy Stop @ Asia High + buffer_pts, SL @ Asia Mid, TP @ Buy Stop + tp_r * Risk
        Sell Stop @ Asia Low - buffer_pts, SL @ Asia Mid, TP @ Sell Stop - tp_r * Risk
    - If unfilled by fill_cutoff_mins (03:30 ET = 210 mins), cancel unfilled.
    - If filled, hold until TP, SL, or 10:25 ET (625 mins) hard flatten.
    """
    qualified_count = 0
    trades = []
    
    for r in records:
        if r["asia_range"] > threshold:
            continue
            
        qualified_count += 1
        asia_high = r["asia_high"]
        asia_low = r["asia_low"]
        asia_mid = r["asia_mid"]
        
        buy_stop = asia_high + buffer_pts
        sell_stop = asia_low - buffer_pts
        
        long_risk = buy_stop - asia_mid
        short_risk = asia_mid - sell_stop
        
        long_tp = buy_stop + tp_r * long_risk
        short_tp = sell_stop - tp_r * short_risk
        
        # Walk bar by bar starting at 02:00 ET (120 mins)
        active_trade = None # {'side': 'LONG'|'SHORT', 'entry': float, 'sl': float, 'tp': float, 'risk': float, 'fill_min': int}
        unfilled_active = True
        trade_result = None
        
        for b in r["day_bars"]:
            mins = b["mins_et"]
            
            # Check cancel cutoff for unfilled orders
            if unfilled_active and fill_cutoff_mins and mins >= fill_cutoff_mins:
                unfilled_active = False # cancel unfilled
                
            # If no position open yet, check fills if orders are active
            if active_trade is None and unfilled_active:
                # Check for long fill
                if b["high"] >= buy_stop:
                    active_trade = {
                        "side": "LONG",
                        "entry": buy_stop,
                        "sl": asia_mid,
                        "tp": long_tp,
                        "risk": long_risk,
                        "fill_min": mins
                    }
                    unfilled_active = False # OCO: cancel opposite
                # Check for short fill
                elif b["low"] <= sell_stop:
                    active_trade = {
                        "side": "SHORT",
                        "entry": sell_stop,
                        "sl": asia_mid,
                        "tp": short_tp,
                        "risk": short_risk,
                        "fill_min": mins
                    }
                    unfilled_active = False # OCO: cancel opposite
                    
            # If position is open, check for SL, TP, or 10:25 ET hard flatten
            elif active_trade is not None:
                side = active_trade["side"]
                entry = active_trade["entry"]
                sl = active_trade["sl"]
                tp = active_trade["tp"]
                risk = active_trade["risk"]
                
                if side == "LONG":
                    # Check SL first (conservative)
                    if b["low"] <= sl:
                        pnl_pts = sl - entry
                        trade_result = {
                            "date": r["trade_date"],
                            "side": "LONG",
                            "outcome": "LOSS",
                            "entry": entry,
                            "exit": sl,
                            "pnl_pts": pnl_pts,
                            "pnl_usd": pnl_pts * POINT_VALUE_MYM,
                            "r_mult": -1.0,
                            "fill_min": active_trade["fill_min"],
                            "exit_min": mins,
                            "asia_range": r["asia_range"]
                        }
                        break
                    elif b["high"] >= tp:
                        pnl_pts = tp - entry
                        trade_result = {
                            "date": r["trade_date"],
                            "side": "LONG",
                            "outcome": "WIN",
                            "entry": entry,
                            "exit": tp,
                            "pnl_pts": pnl_pts,
                            "pnl_usd": pnl_pts * POINT_VALUE_MYM,
                            "r_mult": tp_r,
                            "fill_min": active_trade["fill_min"],
                            "exit_min": mins,
                            "asia_range": r["asia_range"]
                        }
                        break
                elif side == "SHORT":
                    # Check SL first
                    if b["high"] >= sl:
                        pnl_pts = entry - sl
                        trade_result = {
                            "date": r["trade_date"],
                            "side": "SHORT",
                            "outcome": "LOSS",
                            "entry": entry,
                            "exit": sl,
                            "pnl_pts": pnl_pts,
                            "pnl_usd": pnl_pts * POINT_VALUE_MYM,
                            "r_mult": -1.0,
                            "fill_min": active_trade["fill_min"],
                            "exit_min": mins,
                            "asia_range": r["asia_range"]
                        }
                        break
                    elif b["low"] <= tp:
                        pnl_pts = entry - tp
                        trade_result = {
                            "date": r["trade_date"],
                            "side": "SHORT",
                            "outcome": "WIN",
                            "entry": entry,
                            "exit": tp,
                            "pnl_pts": pnl_pts,
                            "pnl_usd": pnl_pts * POINT_VALUE_MYM,
                            "r_mult": tp_r,
                            "fill_min": active_trade["fill_min"],
                            "exit_min": mins,
                            "asia_range": r["asia_range"]
                        }
                        break
                        
                # Hard flatten at 10:25 ET (mins >= 625)
                if mins >= 625:
                    exit_price = b["close"]
                    pnl_pts = (exit_price - entry) if side == "LONG" else (entry - exit_price)
                    r_mult = pnl_pts / (risk + 1e-9)
                    trade_result = {
                        "date": r["trade_date"],
                        "side": side,
                        "outcome": "FLATTEN" if pnl_pts >= 0 else "LOSS_FLATTEN",
                        "entry": entry,
                        "exit": exit_price,
                        "pnl_pts": pnl_pts,
                        "pnl_usd": pnl_pts * POINT_VALUE_MYM,
                        "r_mult": r_mult,
                        "fill_min": active_trade["fill_min"],
                        "exit_min": mins,
                        "asia_range": r["asia_range"]
                    }
                    break
                    
        if trade_result:
            trades.append(trade_result)
            
    return qualified_count, trades

def compute_metrics(qualified_count, total_sessions, trades):
    trade_count = len(trades)
    if trade_count == 0:
        return {
            "qualified_sessions": qualified_count,
            "qualification_rate": qualified_count / (total_sessions + 1e-9),
            "trades": 0,
            "fill_rate": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "net_pnl_pts": 0.0,
            "net_pnl_usd": 0.0,
            "avg_r": 0.0,
            "max_dd_usd": 0.0,
            "wins": 0,
            "losses": 0
        }
        
    wins = [t for t in trades if t["outcome"] == "WIN" or t["r_mult"] > 0]
    losses = [t for t in trades if t["r_mult"] <= 0]
    
    win_rate = len(wins) / trade_count
    gross_profits = sum(t["pnl_usd"] for t in wins)
    gross_losses = abs(sum(t["pnl_usd"] for t in losses))
    
    pf = (gross_profits / gross_losses) if gross_losses > 0 else (99.0 if gross_profits > 0 else 0.0)
    net_pnl_usd = sum(t["pnl_usd"] for t in trades)
    net_pnl_pts = sum(t["pnl_pts"] for t in trades)
    avg_r = sum(t["r_mult"] for t in trades) / trade_count
    
    # Calculate equity curve & max drawdown
    cum_equity = np.cumsum([t["pnl_usd"] for t in trades])
    peak = np.maximum.accumulate(cum_equity)
    drawdowns = peak - cum_equity
    max_dd = np.max(drawdowns) if len(drawdowns) > 0 else 0.0
    
    return {
        "qualified_sessions": qualified_count,
        "qualification_rate": qualified_count / total_sessions,
        "trades": trade_count,
        "fill_rate": trade_count / (qualified_count + 1e-9),
        "win_rate": win_rate,
        "profit_factor": pf,
        "net_pnl_pts": net_pnl_pts,
        "net_pnl_usd": net_pnl_usd,
        "avg_r": avg_r,
        "max_dd_usd": max_dd,
        "wins": len(wins),
        "losses": len(losses)
    }

def run_threshold_study(filepath: str, max_days: int, label: str):
    bars = load_multiyear_bars(filepath, max_days=max_days)
    sessions = group_bars_by_session(bars)
    records = analyze_asia_and_london(sessions)
    total_sessions = len(records)
    
    print(f"\n{'='*70}")
    print(f"DOW ASIA RANGE & LONDON BREAKOUT BACKTEST: {label.upper()} ({total_sessions} Sessions)")
    print(f"{'='*70}")
    
    # Range percentiles
    ranges = [r["asia_range"] for r in records]
    p10, p25, p50, p75, p90 = np.percentile(ranges, [10, 25, 50, 75, 90])
    print(f"Asia Range Percentiles: P10={p10:.1f} | P25={p25:.1f} | Median (P50)={p50:.1f} | P75={p75:.1f} | P90={p90:.1f} pts")
    print(f"Mean Asia Range: {np.mean(ranges):.1f} pts (Min={np.min(ranges):.1f}, Max={np.max(ranges):.1f})\n")
    
    # London Breakout Frequency across all sessions
    broke_either = [r for r in records if r["broke_high_buf"] or r["broke_low_buf"]]
    broke_both = [r for r in records if r["broke_high_buf"] and r["broke_low_buf"]]
    broke_neither = [r for r in records if not r["broke_high_buf"] and not r["broke_low_buf"]]
    
    print(f"Overall London Breakout Frequency (with 20pt buffer):")
    print(f"  - Broke at least one side: {len(broke_either)} / {total_sessions} ({len(broke_either)/total_sessions*100:.1f}%)")
    print(f"  - Broke BOTH sides (Two-way whipsaw): {len(broke_both)} / {total_sessions} ({len(broke_both)/total_sessions*100:.1f}%)")
    print(f"  - Inside Day (Neither side broken): {len(broke_neither)} / {total_sessions} ({len(broke_neither)/total_sessions*100:.1f}%)\n")
    
    # Timing breakdown of London breaks
    morning_breaks = [r["first_break_min"] for r in records if r["first_break_min"] is not None]
    if morning_breaks:
        b_0200_0300 = sum(1 for m in morning_breaks if 120 <= m < 180) # 02:00-03:00 (Frankfurt)
        b_0300_0400 = sum(1 for m in morning_breaks if 180 <= m < 240) # 03:00-04:00 (London Open)
        b_0400_0500 = sum(1 for m in morning_breaks if 240 <= m < 300) # 04:00-05:00 (London Drive)
        b_0500_0800 = sum(1 for m in morning_breaks if 300 <= m < 480) # 05:00-08:00 (Pre-NY)
        tot_b = len(morning_breaks)
        print("Timing Distribution of London Range Breaks:")
        print(f"  - 02:00 – 03:00 ET (Frankfurt Open): {b_0200_0300} ({b_0200_0300/tot_b*100:.1f}%)")
        print(f"  - 03:00 – 04:00 ET (London Cash Open): {b_0300_0400} ({b_0300_0400/tot_b*100:.1f}%)")
        print(f"  - 04:00 – 05:00 ET (London Morning Drive): {b_0400_0500} ({b_0400_0500/tot_b*100:.1f}%)")
        print(f"  - 05:00 – 08:00 ET (London Late / Pre-NY): {b_0500_0800} ({b_0500_0800/tot_b*100:.1f}%)\n")
        
    # Threshold sweep table
    results_by_thresh = {}
    print(f"{'Threshold':<11} | {'Qual%':<7} | {'Trades':<7} | {'Fill%':<7} | {'Win Rate':<9} | {'PF':<6} | {'Net PnL ($)':<12} | {'Avg R':<7} | {'Max DD ($)':<10}")
    print("-" * 95)
    
    for thresh in THRESHOLDS:
        label_t = f"<={thresh} pts" if thresh < 9999 else "Unrestricted"
        q_cnt, trades = simulate_trades(records, thresh, buffer_pts=BUFFER_PTS, fill_cutoff_mins=210, tp_r=1.5)
        m = compute_metrics(q_cnt, total_sessions, trades)
        results_by_thresh[thresh] = m
        
        print(f"{label_t:<11} | {m['qualification_rate']*100:>5.1f}% | {m['trades']:>6} | {m['fill_rate']*100:>5.1f}% | {m['win_rate']*100:>7.1f}% | {m['profit_factor']:>5.2f} | ${m['net_pnl_usd']:>10.2f} | {m['avg_r']:>+5.2f} | ${m['max_dd_usd']:>8.2f}")
        
    # Also evaluate without 03:30 cutoff (open until 08:00 ET) to see if holding longer helps
    print(f"\n{'-'*95}")
    print("COMPARISON: Extended Cutoff (Orders remain active until 06:00 ET instead of 03:30 ET):")
    print(f"{'Threshold':<11} | {'Qual%':<7} | {'Trades':<7} | {'Fill%':<7} | {'Win Rate':<9} | {'PF':<6} | {'Net PnL ($)':<12} | {'Avg R':<7} | {'Max DD ($)':<10}")
    print("-" * 95)
    for thresh in [60, 70, 80, 90, 100, 120]:
        label_t = f"<={thresh} pts"
        q_cnt, trades = simulate_trades(records, thresh, buffer_pts=BUFFER_PTS, fill_cutoff_mins=360, tp_r=1.5)
        m = compute_metrics(q_cnt, total_sessions, trades)
        print(f"{label_t:<11} | {m['qualification_rate']*100:>5.1f}% | {m['trades']:>6} | {m['fill_rate']*100:>5.1f}% | {m['win_rate']*100:>7.1f}% | {m['profit_factor']:>5.2f} | ${m['net_pnl_usd']:>10.2f} | {m['avg_r']:>+5.2f} | ${m['max_dd_usd']:>8.2f}")
        
    return {
        "label": label,
        "total_sessions": total_sessions,
        "results_by_thresh": results_by_thresh
    }

if __name__ == "__main__":
    filepath = "data/cme_multiyear/dow_1m_multiyear.json"
    if not os.path.exists(filepath):
        print(f"Error: {filepath} not found")
        sys.exit(1)
        
    # 1. Run 6-Month Backtest (180 days)
    res_6m = run_threshold_study(filepath, max_days=180, label="6 Months (April 2026 - October 2026)")
    
    # 2. Run 1-Year Backtest (365 days)
    res_1y = run_threshold_study(filepath, max_days=365, label="1 Year (October 2025 - October 2026)")
    
    # Save results to json for report generation
    out_file = "data/dow_asia_london_threshold_backtest.json"
    with open(out_file, "w") as f:
        json.dump({"6m": res_6m, "1y": res_1y}, f, indent=2)
    print(f"\nAll backtest results successfully exported to {out_file}")
