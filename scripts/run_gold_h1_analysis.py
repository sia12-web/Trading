import json
from scripts.backtest_gold_accumulation_distribution import load_data, compute_indicators, backtest_wyckoff_ranges

def run_h1():
    print('Loading Gold H1 dataset...')
    df_h1 = load_data('data/xau_usd_h1_2026.json')
    df_h1 = compute_indicators(df_h1)
    print(f"Loaded {len(df_h1)} H1 bars from {df_h1['datetime'].iloc[0]} to {df_h1['datetime'].iloc[-1]}")

    print('Executing Wyckoff Range Backtest on Gold H1 (Macro ranges)...')
    h1_ranges = backtest_wyckoff_ranges(df_h1, 'H1', min_bars=12, max_bars=60)
    print(f"Identified {len(h1_ranges)} macro Wyckoff ranges on H1.")

    with open('data/gold_wyckoff_backtest_h1.json', 'w') as f:
        json.dump(h1_ranges, f, indent=2)
    print('Saved to data/gold_wyckoff_backtest_h1.json')

if __name__ == '__main__':
    run_h1()
