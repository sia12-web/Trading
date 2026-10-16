import json
import pandas as pd

with open('data/gold_wyckoff_backtest_m15.json') as f:
    m15 = json.load(f)

df = pd.DataFrame(m15)

print("=== TOP 3 SPRING (LOWER LOW SWEEP) ACCUMULATIONS ===")
springs = df[(df['type']=='ACCUMULATION') & (df['had_spring']==True) & (df['spring_depth_pts'] > 8)].sort_values('mfe_pts', ascending=False)
for idx, row in springs.head(3).iterrows():
    print(f"Dates: {row['start_time'][:16]} to {row['breakout_time'][:16]}")
    print(f"  Range: ${row['range_low']:.2f} - ${row['range_high']:.2f} (Span: ${row['range_span_pts']:.2f})")
    print(f"  Spring Flush Depth: ${row['spring_depth_pts']:.2f} ({row['spring_depth_atr']:.2f} ATR)")
    print(f"  Post-Breakout Markup: +${row['mfe_pts']:.2f} | Session: {row['breakout_session']}")
    print(f"  CVD Bullish Absorption: {row['spring_cvd_div']}\n")

print("=== TOP 3 HIGHER-LOW ASCENDING ACCUMULATIONS (SPRINGLESS) ===")
hl_accum = df[(df['type']=='ACCUMULATION') & (df['low_progression']=='HIGHER_LOWS') & (df['had_spring']==False)].sort_values('mfe_pts', ascending=False)
for idx, row in hl_accum.head(3).iterrows():
    print(f"Dates: {row['start_time'][:16]} to {row['breakout_time'][:16]}")
    print(f"  Range: ${row['range_low']:.2f} - ${row['range_high']:.2f} (Span: ${row['range_span_pts']:.2f})")
    print(f"  Low Progression: Higher Lows (Ascending Demand Base)")
    print(f"  Post-Breakout Markup: +${row['mfe_pts']:.2f} | Session: {row['breakout_session']}\n")

print("=== TOP 3 UTAD (HIGHER HIGH SWEEP) DISTRIBUTIONS ===")
utads = df[(df['type']=='DISTRIBUTION') & (df['had_utad']==True) & (df['utad_depth_pts'] > 5)].sort_values('mfe_pts', ascending=False)
for idx, row in utads.head(3).iterrows():
    print(f"Dates: {row['start_time'][:16]} to {row['breakout_time'][:16]}")
    print(f"  Range: ${row['range_low']:.2f} - ${row['range_high']:.2f} (Span: ${row['range_span_pts']:.2f})")
    print(f"  UTAD Sweep Depth: ${row['utad_depth_pts']:.2f} ({row['utad_depth_atr']:.2f} ATR)")
    print(f"  Post-Breakout Markdown: -${row['mfe_pts']:.2f} | Session: {row['breakout_session']}")
    print(f"  CVD Bearish Absorption: {row['utad_cvd_div']}\n")
