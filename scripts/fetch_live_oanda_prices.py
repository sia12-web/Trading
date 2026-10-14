import os
import re
import urllib.request
import json
from pathlib import Path

def get_env_var(key: str, default: str = "") -> str:
    val = os.environ.get(key)
    if val:
        return val
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                m = re.match(rf"^{key}\s*=\s*[\"']?([^\"'\r\n]+)[\"']?", line.strip())
                if m:
                    return m.group(1)
    return default

api_key = get_env_var("OANDA_API_KEY")
account_id = get_env_var("OANDA_ACCOUNT_ID")

if not api_key or not account_id:
    print("OANDA credentials missing from environment or .env.local")
    exit(1)

url = f"https://api-fxtrade.oanda.com/v3/accounts/{account_id}/pricing?instruments=XAU_USD,US30_USD,NAS100_USD,WTICO_USD"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})

try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode("utf-8"))
        for p in data.get("prices", []):
            inst = p.get("instrument")
            bids = p.get("bids", [])
            asks = p.get("asks", [])
            if bids and asks:
                bid = float(bids[0]["price"])
                ask = float(asks[0]["price"])
                mid = (bid + ask) / 2.0
                print(f"{inst}: Bid={bid} Ask={ask} Mid={mid:.2f}")
            else:
                print(f"{inst}: No quote (market may be in daily maintenance/closed)")
except Exception as e:
    print("Error fetching OANDA pricing:", e)
