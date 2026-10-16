import urllib.request
import json
import time
import os
import math
from datetime import datetime, timezone

def fetch_oanda_candles(granularity="M15", start_date="2026-01-26T00:00:00Z"):
    token = 'a71aa7a75f97def0d971f1657d8e5c05-182ccb08f3df0906d32ac7d942afeb13'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    all_candles = []
    cur_from = start_date
    batch_idx = 0
    
    print(f"Fetching {granularity} Gold (XAU_USD) candles from OANDA starting {start_date}...")
    while True:
        url = f"https://api-fxtrade.oanda.com/v3/instruments/XAU_USD/candles?granularity={granularity}&from={cur_from}&count=5000"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                candles = data.get('candles', [])
                if not candles or len(candles) <= 1:
                    break
                
                # Deduplicate overlap
                if all_candles and candles[0]['time'] == all_candles[-1]['time']:
                    candles = candles[1:]
                if not candles:
                    break
                    
                all_candles.extend(candles)
                batch_idx += 1
                cur_from = candles[-1]['time']
                print(f"  Batch {batch_idx}: retrieved {len(candles)} candles. Latest: {cur_from}")
                
                if len(candles) < 4500:
                    break
                time.sleep(0.3)
        except Exception as e:
            print(f"Error fetching candles: {e}")
            break
            
    print(f"Total retrieved: {len(all_candles)} {granularity} candles.")
    return all_candles

if __name__ == "__main__":
    candles = fetch_oanda_candles("M15", "2026-01-26T00:00:00Z")
    if candles:
        with open("data/xau_usd_m15_2026.json", "w") as f:
            json.dump(candles, f)
        print("Saved to data/xau_usd_m15_2026.json")
