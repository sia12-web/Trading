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
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    import databento as db
except ImportError:
    print("[ERROR] databento package not found. Run: pip install databento", file=sys.stderr)
    sys.exit(1)

# Default configuration
PORT = int(os.environ.get("DATABENTO_SIDECAR_PORT", "8765"))
HOST = "127.0.0.1"

DESK_SYMBOLS = {
    "MNQ.c.0": "NASDAQ",
    "MYM.c.0": "DOW",
    "MGC.c.0": "GOLD",
    "CL.c.0": "CRUDE",
    "NKD.c.0": "NIKKEI",
}

# State store (thread-safe)
lock = threading.Lock()
id_to_desk = {}
latest_quotes = {}
forming_candles = {}
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
            except Exception:
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
            client_q = queue.Queue(maxsize=1000)

            with lock:
                subscribers.add(client_q)
                if filter_inst and filter_inst in latest_quotes:
                    seed = latest_quotes[filter_inst]
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
    server = HTTPServer((HOST, PORT), SidecarHTTPHandler)
    print(f"[Sidecar] Local HTTP/SSE server listening on http://{HOST}:{PORT}")
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
            print("[Sidecar] Connecting to Databento Live TCP gateway (GLBX.MDP3)...")
            live = db.Live(key=api_key)
            live.subscribe(
                dataset="GLBX.MDP3",
                schema="trades",
                symbols=list(DESK_SYMBOLS.keys()),
                stype_in="continuous",
            )
            connected = True
            print("[Sidecar] Connected! Streaming real-time CME Globex trades...")

            for record in live:
                if isinstance(record, db.SymbolMappingMsg):
                    in_sym = record.stype_in_symbol
                    desk = DESK_SYMBOLS.get(in_sym, in_sym)
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
            print(f"[Sidecar] Stream error: {e}. Reconnecting in 3s...", file=sys.stderr)
            time.sleep(3)

def main():
    api_key = load_api_key()
    if not api_key:
        print("[ERROR] DATABENTO_API_KEY not found in environment or .env.local", file=sys.stderr)
        sys.exit(1)

    print(f"[Sidecar] Starting Databento Live Gateway Sidecar on port {PORT}...")
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    run_databento_stream(api_key)

if __name__ == "__main__":
    main()
