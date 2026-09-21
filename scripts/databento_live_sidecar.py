"""
TradePulse - Databento Live CME Globex Gateway Sidecar
Connects directly to Databento Live TCP gateway (GLBX.MDP3), streams tick-by-tick
CME trades for NASDAQ (MNQ), DOW (MYM), GOLD (MGC), CRUDE (CL), and NIKKEI (NKD),
and serves a high-performance local SSE and REST snapshot server on 127.0.0.1:8765.
"""

import sys
import os
import time
import json
import collections
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    import databento as db
except ImportError:
    print("[ERROR] databento package not found. Run: pip install databento", file=sys.stderr)
    sys.exit(1)

# Default configuration
PORT = int(os.environ.get("DATABENTO_SIDECAR_PORT", "8765"))
HOST = "127.0.0.1"

import datetime

def get_active_quarterly_contract(root: str, now=None) -> str:
    if now is None:
        now = datetime.datetime.now()
    year = now.year
    month = now.month
    day = now.day
    year_digit = str(year)[-1]

    def get_third_friday(y, m):
        fridays = 0
        for d in range(1, 32):
            try:
                dt = datetime.date(y, m, d)
                if dt.weekday() == 4:
                    fridays += 1
                    if fridays == 3:
                        return d
            except ValueError:
                break
        return 21

    def get_roll_thursday(y, m):
        return get_third_friday(y, m) - 8

    if month < 3 or (month == 3 and day < get_roll_thursday(year, 3)):
        return f"{root}H{year_digit}"
    elif month < 6 or (month == 6 and day < get_roll_thursday(year, 6)):
        return f"{root}M{year_digit}"
    elif month < 9 or (month == 9 and day < get_roll_thursday(year, 9)):
        return f"{root}U{year_digit}"
    elif month < 12 or (month == 12 and day < get_roll_thursday(year, 12)):
        return f"{root}Z{year_digit}"
    else:
        next_year_digit = str(year + 1)[-1]
        return f"{root}H{next_year_digit}"

DESK_SYMBOLS = {
    "MNQ.c.0": "NASDAQ",
    "MYM.c.0": "DOW",
    "MGC.c.0": "GOLD",
    "CL.c.0": "CRUDE",
    "NKD.c.0": "NIKKEI",
}

# Completed 1m bars retained per desk. The historical bar vendors run several minutes
# behind the tape, so these are the only real prints available for the recent gap.
BAR_HISTORY_MINUTES = 480

# State store (thread-safe)
lock = threading.Lock()
id_to_desk = {}
latest_quotes = {}
forming_candles = {}
completed_bars = {}  # desk -> deque of finished 1m bars, oldest first
subscribers = set()  # Set of client Queue objects
total_trades = 0
connected = False
start_time = time.time()

def load_api_key():
    key = os.environ.get("DATABENTO_API_KEY", "").strip()
    if key:
        return key
    paths = [".env.local", "../.env.local", "../../.env.local"]
    for p in paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("DATABENTO_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
    return None

def update_forming_candle(desk: str, price: float, size: int, ts_sec: int):
    bucket = (ts_sec // 60) * 60
    cur = forming_candles.get(desk)
    if not cur or cur["time"] != bucket:
        # Retain the bar that just closed; it is real exchange data that no
        # historical vendor will serve for another several minutes.
        if cur and cur["time"] < bucket:
            history = completed_bars.get(desk)
            if history is None:
                history = collections.deque(maxlen=BAR_HISTORY_MINUTES)
                completed_bars[desk] = history
            history.append(cur)
        forming_candles[desk] = {
            "time": bucket,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": size,
        }
    else:
        cur["high"] = max(cur["high"], price)
        cur["low"] = min(cur["low"], price)
        cur["close"] = price
        cur["volume"] += size

def broadcast_trade(payload: dict):
    with lock:
        dead = []
        for q in list(subscribers):
            try:
                q.put_nowait(payload)
            except Exception as e:
                import queue
                if isinstance(e, queue.Full):
                    try:
                        q.get_nowait()
                        q.put_nowait(payload)
                    except Exception:
                        dead.append(q)
                else:
                    dead.append(q)
        for d in dead:
            subscribers.discard(d)

class SidecarHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence routine access logs
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            with lock:
                res = {
                    "status": "ok",
                    "source": "databento_live",
                    "connected": connected,
                    "total_trades": total_trades,
                    "uptime_sec": int(time.time() - start_time),
                    "instruments": list(latest_quotes.keys()),
                }
            body = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        elif path == "/snapshot":
            with lock:
                res = {
                    "quotes": {k: dict(v) for k, v in latest_quotes.items()},
                    "forming": {k: dict(v) for k, v in forming_candles.items()},
                    "timestamp": int(time.time()),
                }
            body = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        elif path == "/bars":
            # Completed 1m bars built from live CME prints, plus the forming bar.
            # ?instrument=NASDAQ&since=<unix> keeps the payload to just the recent gap.
            qs = parse_qs(parsed.query)
            want = (qs.get("instrument", [None])[0] or "").upper() or None
            try:
                since = int(qs.get("since", ["0"])[0])
            except ValueError:
                since = 0

            with lock:
                desks = [want] if want else list(completed_bars.keys())
                out = {}
                for desk in desks:
                    bars = [dict(b) for b in completed_bars.get(desk, ()) if b["time"] >= since]
                    forming = forming_candles.get(desk)
                    if forming and forming["time"] >= since:
                        bars.append(dict(forming))
                    if bars:
                        out[desk] = bars
                res = {"bars": out, "timestamp": int(time.time())}

            body = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        elif path == "/stream":
            qs = parse_qs(parsed.query)
            filter_inst = qs.get("instrument", [None])[0]
            if filter_inst:
                filter_inst = filter_inst.upper()

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            import queue
            client_q = queue.Queue(maxsize=10000)

            with lock:
                subscribers.add(client_q)
                seed = latest_quotes.get(filter_inst) if filter_inst else None

            # Written outside the lock — a slow client must never stall trade ingestion.
            if seed:
                try:
                    self.wfile.write(f"data: {json.dumps(seed)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass

            try:
                while True:
                    try:
                        trade = client_q.get(timeout=10.0)
                        if not filter_inst or trade.get("instrument") == filter_inst:
                            msg = f"data: {json.dumps(trade)}\n\n"
                            self.wfile.write(msg.encode("utf-8"))
                            self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(f": hb {int(time.time()*1000)}\n\n".encode("utf-8"))
                        self.wfile.flush()
            except (ConnectionResetError, BrokenPipeError):
                pass
            finally:
                with lock:
                    subscribers.discard(client_q)
        else:
            self.send_response(404)
            self.end_headers()

def run_http_server():
    # Threaded: /stream is a long-lived SSE response. On a single-threaded server it
    # would block /health and /snapshot for its entire lifetime, which makes the Node
    # hub time out, mark the feed inactive and fall back to a slower quote source.
    server = ThreadingHTTPServer((HOST, PORT), SidecarHTTPHandler)
    server.daemon_threads = True
    print(f"[Sidecar] Local HTTP/SSE server listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

def run_databento_stream(api_key: str):
    global connected, total_trades
    while True:
        try:
            print("[Sidecar] Connecting to Databento Live TCP gateway (GLBX.MDP3)...", flush=True)
            live = db.Live(key=api_key)
            active_mym = get_active_quarterly_contract("MYM")
            active_mnq = get_active_quarterly_contract("MNQ")
            active_nkd = get_active_quarterly_contract("NKD")
            raw_symbols = {
                active_mym: "DOW",
                active_mnq: "NASDAQ",
                active_nkd: "NIKKEI",
            }
            print(f"[Sidecar] Subscribing active quarterly contracts: {list(raw_symbols.keys())}", flush=True)
            # Instrument ids are only valid for one gateway session, and they change
            # across a contract roll. Stale entries would map prints of an expired
            # contract onto a live desk book.
            with lock:
                id_to_desk.clear()
            live.subscribe(
                dataset="GLBX.MDP3",
                schema="trades",
                symbols=list(raw_symbols.keys()),
                stype_in="raw_symbol",
            )
            live.subscribe(
                dataset="GLBX.MDP3",
                schema="trades",
                symbols=["MGC.c.0", "CL.c.0"],
                stype_in="continuous",
            )
            connected = True
            print("[Sidecar] Connected! Streaming real-time CME Globex trades...", flush=True)

            for record in live:
                if isinstance(record, db.SymbolMappingMsg):
                    in_sym = record.stype_in_symbol
                    desk = raw_symbols.get(in_sym) or DESK_SYMBOLS.get(in_sym, in_sym)
                    with lock:
                        id_to_desk[record.instrument_id] = desk
                elif isinstance(record, db.TradeMsg):
                    with lock:
                        desk = id_to_desk.get(record.instrument_id)
                        if not desk:
                            continue
                        price = record.pretty_price
                        size = record.size
                        ts_sec = int(record.ts_event / 1e9)
                        total_trades += 1

                        payload = {
                            "instrument": desk,
                            "price": price,
                            "bid": price,
                            "ask": price,
                            "size": size,
                            "side": str(record.side),
                            "timestamp": ts_sec,
                            "source": "cme_globex",
                        }
                        latest_quotes[desk] = payload
                        update_forming_candle(desk, price, size, ts_sec)

                    broadcast_trade(payload)

        except Exception as e:
            connected = False
            print(f"[Sidecar] Stream error: {e}. Reconnecting in 3s...", file=sys.stderr, flush=True)
            time.sleep(3)

def main():
    api_key = load_api_key()
    if not api_key:
        print("[ERROR] DATABENTO_API_KEY not found in environment or .env.local", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"[Sidecar] Starting Databento Live Gateway Sidecar on port {PORT}...", flush=True)
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    run_databento_stream(api_key)

if __name__ == "__main__":
    main()
