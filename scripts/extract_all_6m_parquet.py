import os
import time
import zipfile
import databento as db
import pandas as pd
import numpy as np

def extract_all():
    zip_path = r"GLBX-20260908-B8NKHSUC8L.zip"
    out_dir = r"data/databento_6m"
    os.makedirs(out_dir, exist_ok=True)

    prefix_map = {
        'MNQ': 'nasdaq',
        'MCL': 'oil',
        'MGC': 'gold',
        'MYM': 'dow'
    }

    t0 = time.time()
    print(f"Opening zip: {zip_path}")
    dfs_by_inst = {inst: [] for inst in prefix_map.values()}

    with zipfile.ZipFile(zip_path, 'r') as z:
        files = sorted([f for f in z.namelist() if f.endswith('.dbn.zst')])
        print(f"Total DBN files to process: {len(files)}")

        for i, fname in enumerate(files):
            try:
                raw = z.read(fname)
                store = db.DBNStore.from_bytes(raw)
                df = store.to_df()
                if df.empty:
                    continue

                # Filter out spreads
                df = df[~df['symbol'].str.contains('-')]

                for prefix, inst in prefix_map.items():
                    sub = df[df['symbol'].str.startswith(prefix)]
                    if sub.empty:
                        continue

                    # Select front contract by volume
                    vol_by_sym = sub.groupby('symbol')['volume'].sum()
                    if vol_by_sym.empty:
                        continue
                    front_sym = vol_by_sym.idxmax()
                    front_df = sub[sub['symbol'] == front_sym].copy()

                    if front_df.empty:
                        continue

                    # Keep only essential columns
                    front_df = front_df[['open', 'high', 'low', 'close', 'volume', 'symbol']]
                    dfs_by_inst[inst].append(front_df)

            except Exception as e:
                print(f"Error reading {fname}: {e}")

            if (i + 1) % 25 == 0 or (i + 1) == len(files):
                print(f"Processed {i + 1}/{len(files)} files in {time.time() - t0:.2f}s...")

    print("Concatenating and saving Parquet files...")
    for inst, dflist in dfs_by_inst.items():
        if not dflist:
            print(f"No data for {inst}")
            continue
        full_df = pd.concat(dflist)
        # Deduplicate on index
        full_df = full_df[~full_df.index.duplicated(keep='first')]
        full_df.sort_index(inplace=True)

        # Convert index to UTC and ET
        full_df['ts_utc'] = full_df.index
        # Convert index to Eastern Time for session alignment
        full_df['ts_et'] = full_df.index.tz_convert('America/New_York')

        out_path = os.path.join(out_dir, f"{inst}_1m.parquet")
        full_df.to_parquet(out_path, engine='pyarrow')
        print(f"Saved {inst.upper()}: {len(full_df)} bars, {full_df['ts_utc'].iloc[0]} to {full_df['ts_utc'].iloc[-1]} -> {out_path}")

    print(f"All done in {time.time() - t0:.2f}s!")

if __name__ == '__main__':
    extract_all()
