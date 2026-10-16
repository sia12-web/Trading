import os
import sys
import json
import numpy as np
import pandas as pd

# Add repo root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from scripts.backtest_gold_accumulation_distribution import load_data, compute_indicators, backtest_wyckoff_ranges

def run_full_analysis():
    print("=== RUNNING H1 MACRO WYCKOFF BACKTEST ===")
    df_h1 = load_data('data/xau_usd_h1_2026.json')
    df_h1 = compute_indicators(df_h1)
    h1_ranges = backtest_wyckoff_ranges(df_h1, 'H1', min_bars=12, max_bars=60)
    print(f"H1 ranges found: {len(h1_ranges)}")
    with open('data/gold_wyckoff_backtest_h1.json', 'w') as f:
        json.dump(h1_ranges, f, indent=2)

    with open('data/gold_wyckoff_backtest_m15.json', 'r') as f:
        m15_ranges = json.load(f)

    print("\n=== AGGREGATING QUANTITATIVE RESULTS FOR GOLD (JAN 26 - OCT 16 2026) ===")
    
    for tf_label, r_list in [('M15 (Intraday & Session)', m15_ranges), ('H1 (Macro Multi-Day)', h1_ranges)]:
        df_r = pd.DataFrame(r_list)
        total = len(df_r)
        accum = df_r[df_r['type'] == 'ACCUMULATION']
        distrib = df_r[df_r['type'] == 'DISTRIBUTION']
        
        n_accum = len(accum)
        n_dist = len(distrib)
        
        # Accumulation Subtypes: Lower Lows (Spring / Sweep) vs Higher Lows vs Flat
        accum_spring = accum[accum['had_spring'] == True]
        accum_ll = accum[accum['low_progression'] == 'LOWER_LOWS']
        accum_hl = accum[accum['low_progression'] == 'HIGHER_LOWS']
        accum_el = accum[accum['low_progression'] == 'EQUAL_LOWS']
        accum_cvd = accum[accum['spring_cvd_div'] == True]
        
        # Distribution Subtypes: Higher Highs (UTAD / Sweep) vs Lower Highs vs Flat
        dist_utad = distrib[distrib['had_utad'] == True]
        dist_hh = distrib[distrib['high_progression'] == 'HIGHER_HIGHS']
        dist_lh = distrib[distrib['high_progression'] == 'LOWER_HIGHS']
        dist_eh = distrib[distrib['high_progression'] == 'EQUAL_HIGHS']
        dist_cvd = distrib[distrib['utad_cvd_div'] == True]
        
        print(f"\n==================== {tf_label} ====================")
        print(f"Total Ranges Analyzed: {total}")
        print(f"Accumulation Ranges: {n_accum} ({n_accum/total*100:.1f}%) | Distribution Ranges: {n_dist} ({n_dist/total*100:.1f}%)")
        print(f"Avg Duration: {df_r['duration_hours'].mean():.1f} hours (Median: {df_r['duration_hours'].median():.1f}h)")
        print(f"Avg Range Span: ${df_r['range_span_pts'].mean():.2f} ({df_r['range_span_atr'].mean():.2f} ATR)")
        
        print(f"\n--- ACCUMULATION BEHAVIOR: LOWER LOWS vs HIGHER HIGHS ---")
        print(f"1. Lower Low Sweeps (Springs / Flushes): {len(accum_spring)} ({len(accum_spring)/n_accum*100:.1f}% of accumulation)")
        print(f"   - Avg Spring Flush Depth: ${accum_spring['spring_depth_pts'].mean():.2f} ({accum_spring['spring_depth_atr'].mean():.2f} ATR)")
        print(f"   - Max Spring Flush Depth: ${accum_spring['spring_depth_pts'].max():.2f}")
        print(f"   - Bullish CVD Absorption Divergence at Spring: {len(accum_cvd)} ({len(accum_cvd)/n_accum*100:.1f}%)")
        print(f"2. Low Progression Breakdown inside Range:")
        print(f"   - Formed Lower Lows (LL) in Phase B/C: {len(accum_ll)} ({len(accum_ll)/n_accum*100:.1f}%)")
        print(f"   - Formed Higher Lows (HL - Ascending Absorption): {len(accum_hl)} ({len(accum_hl)/n_accum*100:.1f}%)")
        print(f"   - Formed Equal Lows (Flat Creek Support): {len(accum_el)} ({len(accum_el)/n_accum*100:.1f}%)")
        print(f"3. High Progression before Mark-Up:")
        print(f"   - Formed Higher Highs pressure on Ice (SOS): {len(accum[accum['high_progression']=='HIGHER_HIGHS'])} ({len(accum[accum['high_progression']=='HIGHER_HIGHS'])/n_accum*100:.1f}%)")
        print(f"   - Formed Equal Highs: {len(accum[accum['high_progression']=='EQUAL_HIGHS'])} ({len(accum[accum['high_progression']=='EQUAL_HIGHS'])/n_accum*100:.1f}%)")
        print(f"4. Post-Accumulation Mark-Up Expansion:")
        print(f"   - Avg MFE: ${accum['mfe_pts'].mean():.2f} (Win 1R: {accum['win_1r'].mean()*100:.1f}%, Win 2R: {accum['win_2r'].mean()*100:.1f}%)")
        
        print(f"\n--- DISTRIBUTION BEHAVIOR: HIGHER HIGHS vs LOWER HIGHS ---")
        print(f"1. Higher High Sweeps (Upthrusts / UTADs): {len(dist_utad)} ({len(dist_utad)/n_dist*100:.1f}% of distribution)")
        print(f"   - Avg UTAD Sweep Depth: ${dist_utad['utad_depth_pts'].mean():.2f} ({dist_utad['utad_depth_atr'].mean():.2f} ATR)")
        print(f"   - Bearish CVD Absorption Divergence at UTAD: {len(dist_cvd)} ({len(dist_cvd)/n_dist*100:.1f}%)")
        print(f"2. High Progression Breakdown inside Range:")
        print(f"   - Formed Higher Highs (HH - UTAD Trap): {len(dist_hh)} ({len(dist_hh)/n_dist*100:.1f}%)")
        print(f"   - Formed Lower Highs (LH - Heavy Supply LPSY): {len(dist_lh)} ({len(dist_lh)/n_dist*100:.1f}%)")
        print(f"   - Formed Equal Highs (Flat Ice Resistance): {len(dist_eh)} ({len(dist_eh)/n_dist*100:.1f}%)")
        print(f"3. Post-Distribution Mark-Down Expansion:")
        print(f"   - Avg MFE: ${distrib['mfe_pts'].mean():.2f} (Win 1R: {distrib['win_1r'].mean()*100:.1f}%, Win 2R: {distrib['win_2r'].mean()*100:.1f}%)")
        
        print(f"\n--- SESSION DISTRIBUTION OF BREAKOUTS ---")
        print(df_r['breakout_session'].value_counts(normalize=True).round(3) * 100)

if __name__ == '__main__':
    run_full_analysis()
