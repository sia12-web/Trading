import databento as db
import zipfile
import json
import os
import time

zip_path = r"C:\Users\shahb\myApplications\Trading\GLBX-20260908-B8NKHSUC8L.zip"
out_dir = r"C:\Users\shahb\myApplications\Trading\data\cme-history"

os.makedirs(out_dir, exist_ok=True)

PREFIX_MAP = {
    'MNQ': 'NASDAQ',
    'MYM': 'DOW',
    'MGC': 'GOLD',
    'MCL': 'CRUDE',
}

daily_bars = { 'NASDAQ': [], 'DOW': [], 'GOLD': [], 'CRUDE': [] }
recent_5m_bars = { 'NASDAQ': [], 'DOW': [], 'GOLD': [], 'CRUDE': [] }

t0 = time.time()
with zipfile.ZipFile(zip_path, 'r') as z:
    file_list = sorted([f for f in z.namelist() if f.endswith('.dbn.zst')])
    print(f"[CME Extraction] Processing {len(file_list)} files from zip...")

    # Process all files for daily bars, and the last 30 files for 5m bars
    last_30_set = set(file_list[-30:])

    for i, fname in enumerate(file_list):
        try:
            data_bytes = z.read(fname)
            store = db.DBNStore.from_bytes(data_bytes)
            df = store.to_df()

            if df.empty:
                continue

            # Exclude calendar spreads (contain '-')
            df = df[~df['symbol'].str.contains('-')]

            for prefix, inst in PREFIX_MAP.items():
                sub = df[df['symbol'].str.startswith(prefix)]
                if sub.empty:
                    continue

                # Front month contract by volume
                vol_by_sym = sub.groupby('symbol')['volume'].sum()
                if vol_by_sym.empty:
                    continue
                front_sym = vol_by_sym.idxmax()
                front_df = sub[sub['symbol'] == front_sym]

                if front_df.empty:
                    continue

                # Daily bar accumulation
                day_open = float(front_df['open'].iloc[0])
                day_high = float(front_df['high'].max())
                day_low = float(front_df['low'].min())
                day_close = float(front_df['close'].iloc[-1])
                day_vol = int(front_df['volume'].sum())
                day_time = int(front_df.index[0].timestamp())

                daily_bars[inst].append({
                    'time': day_time,
                    'open': round(day_open, 2),
                    'high': round(day_high, 2),
                    'low': round(day_low, 2),
                    'close': round(day_close, 2),
                    'volume': day_vol,
                    'contract': front_sym
                })

                # 5-minute bars for recent 30 trading days
                if fname in last_30_set:
                    # Resample 1m to 5m
                    front_df_res = front_df.resample('5min').agg({
                        'open': 'first',
                        'high': 'max',
                        'low': 'min',
                        'close': 'last',
                        'volume': 'sum'
                    }).dropna()

                    for idx, row in front_df_res.iterrows():
                        t_sec = int(idx.timestamp())
                        recent_5m_bars[inst].append({
                            'time': t_sec,
                            'open': round(float(row['open']), 2),
                            'high': round(float(row['high']), 2),
                            'low': round(float(row['low']), 2),
                            'close': round(float(row['close']), 2),
                            'volume': int(row['volume']),
                        })
        except Exception as e:
            print(f"Error processing {fname}: {e}")

print(f"[CME Extraction] Complete in {time.time() - t0:.2f}s")

# Sort and deduplicate 5m bars
for inst in recent_5m_bars:
    seen = set()
    dedup = []
    recent_5m_bars[inst].sort(key=lambda b: b['time'])
    for b in recent_5m_bars[inst]:
        if b['time'] not in seen:
            seen.add(b['time'])
            dedup.append(b)
    recent_5m_bars[inst] = dedup

daily_out = os.path.join(out_dir, "daily_bars.json")
with open(daily_out, "w") as f:
    json.dump(daily_bars, f, indent=2)
print(f"Wrote daily bars to {daily_out}")

m5_out = os.path.join(out_dir, "recent_5m_bars.json")
with open(m5_out, "w") as f:
    json.dump(recent_5m_bars, f)
print(f"Wrote 5m bars to {m5_out}")

for inst in daily_bars:
    print(f"  {inst}: {len(daily_bars[inst])} daily bars, {len(recent_5m_bars[inst])} 5m bars")
