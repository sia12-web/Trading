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
import math
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

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

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

NYMEX_MONTH_CODES = "FGHJKMNQUVXZ"


def _prev_business_day(d: datetime.date) -> datetime.date:
    d = d - datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d


def _business_days_before(d: datetime.date, n: int) -> datetime.date:
    for _ in range(n):
        d = _prev_business_day(d)
    return d


def _cl_last_trade(contract_year: int, contract_month: int) -> datetime.date:
    """CME WTI: 3 business days prior to the 25th of the month before delivery."""
    if contract_month == 1:
        y, m = contract_year - 1, 12
    else:
        y, m = contract_year, contract_month - 1
    origin = datetime.date(y, m, 25)
    if origin.weekday() >= 5:
        origin = _prev_business_day(origin)
    return _business_days_before(origin, 3)


def get_active_cl_contract(now=None) -> str:
    """Volume-lead WTI month (Yahoo CL=F / Tradovate), not calendar CL.c.0."""
    if now is None:
        now = (
            datetime.datetime.now(ZoneInfo("America/New_York"))
            if ZoneInfo is not None
            else datetime.datetime.now()
        )
    today = now.date() if hasattr(now, "date") else now
    roll_lead_bd = 5
    y, m = today.year, today.month
    for i in range(14):
        mm = m + i
        cy = y + (mm - 1) // 12
        cm = (mm - 1) % 12 + 1
        last = _cl_last_trade(cy, cm)
        roll = _business_days_before(last, roll_lead_bd)
        if today <= roll:
            return f"CL{NYMEX_MONTH_CODES[cm - 1]}{str(cy)[-1]}"
    return f"CL{NYMEX_MONTH_CODES[m - 1]}{str(y)[-1]}"


GOLD_MONTH_CODES = {2: "G", 4: "J", 6: "M", 8: "Q", 10: "V", 12: "Z"}


def _last_business_day_of_month(y: int, m: int) -> datetime.date:
    if m == 12:
        last = datetime.date(y, 12, 31)
    else:
        last = datetime.date(y, m + 1, 1) - datetime.timedelta(days=1)
    while last.weekday() >= 5:
        last -= datetime.timedelta(days=1)
    return last


def _gold_first_notice(contract_year: int, contract_month: int) -> datetime.date:
    if contract_month == 1:
        y, m = contract_year - 1, 12
    else:
        y, m = contract_year, contract_month - 1
    return _last_business_day_of_month(y, m)


def get_active_gold_contract(now=None) -> str:
    """Volume-lead Micro Gold month (Yahoo MGC=F / Tradovate), not calendar MGC.c.0."""
    if now is None:
        now = (
            datetime.datetime.now(ZoneInfo("America/New_York"))
            if ZoneInfo is not None
            else datetime.datetime.now()
        )
    today = now.date() if hasattr(now, "date") else now
    roll_lead_bd = 10
    y, m = today.year, today.month
    for i in range(18):
        mm = m + i
        cy = y + (mm - 1) // 12
        cm = (mm - 1) % 12 + 1
        code = GOLD_MONTH_CODES.get(cm)
        if not code:
            continue
        fnd = _gold_first_notice(cy, cm)
        roll = _business_days_before(fnd, roll_lead_bd)
        if today <= roll:
            return f"MGC{code}{str(cy)[-1]}"
    return f"MGCZ{str(y)[-1]}"


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
# The local consumer only needs the newest print. A huge queue turns a brief
# Node/browser stall into seconds of stale replay during volatility.
SSE_TICK_QUEUE_MAX = 128

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
    # A reconnect replay can overlap prints already seen from the live head.
    # Never roll the forming candle backward.
    if cur and bucket < cur["time"]:
        return
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


def _bar_px(record, pretty_attr, raw_attr):
    pretty = getattr(record, pretty_attr, None)
    try:
        if pretty is not None and pretty == pretty and float(pretty) > 0:
            return float(pretty)
    except (TypeError, ValueError):
        pass
    raw = getattr(record, raw_attr, None)
    try:
        if raw is not None:
            return float(raw) / 1e9
    except (TypeError, ValueError):
        pass
    return None


def upsert_completed_bars(desk: str, bars: list):
    """Merge closed 1m bars by timestamp. Never overwrite the forming minute."""
    if not bars:
        return
    with lock:
        forming = forming_candles.get(desk)
        forming_t = forming["time"] if forming else None
        now_bucket = (int(time.time()) // 60) * 60
        existing = {b["time"]: b for b in completed_bars.get(desk, ())}
        for bar in bars:
            t = bar.get("time")
            if not t or not bar.get("close"):
                continue
            if forming_t is not None and t >= forming_t:
                continue
            if t >= now_bucket:
                if desk not in forming_candles:
                    forming_candles[desk] = dict(bar)
                continue
            existing[t] = bar
        merged = [existing[t] for t in sorted(existing)]
        completed_bars[desk] = collections.deque(
            merged[-BAR_HISTORY_MINUTES:], maxlen=BAR_HISTORY_MINUTES
        )


def ingest_ohlcv_record(record, raw_symbols):
    with lock:
        desk = id_to_desk.get(record.instrument_id)
        if not desk:
            in_sym = getattr(record, "stype_in_symbol", None)
            desk = raw_symbols.get(in_sym) or DESK_SYMBOLS.get(in_sym)
        if not desk:
            return
    open_px = _bar_px(record, "pretty_open", "open")
    high_px = _bar_px(record, "pretty_high", "high")
    low_px = _bar_px(record, "pretty_low", "low")
    close_px = _bar_px(record, "pretty_close", "close")
    if not close_px or close_px <= 0:
        return
    ts_sec = int(record.ts_event / 1e9)
    volume = int(getattr(record, "volume", 0) or 0)
    upsert_completed_bars(
        desk,
        [
            {
                "time": ts_sec,
                "open": open_px or close_px,
                "high": high_px or close_px,
                "low": low_px or close_px,
                "close": close_px,
                "volume": volume,
            }
        ],
    )


def _parse_hist_end(err):
    import re

    m = re.search(r"and\s+([0-9T:\-\.]+Z)", str(err))
    if not m:
        return None
    return m.group(1)[:19]


def _hist_ohlcv(client, symbols, stype_in, start, end):
    kwargs = dict(
        dataset="GLBX.MDP3",
        schema="ohlcv-1m",
        symbols=symbols,
        stype_in=stype_in,
        start=start,
    )
    if end is not None:
        kwargs["end"] = end
    try:
        return list(client.timeseries.get_range(**kwargs))
    except Exception as e:
        valid_end = _parse_hist_end(e)
        if not valid_end:
            print(f"[Sidecar] Historical 1m failed for {symbols}: {e}", flush=True)
            return []
        kwargs["end"] = valid_end
        try:
            return list(client.timeseries.get_range(**kwargs))
        except Exception as e2:
            print(f"[Sidecar] Historical 1m retry failed for {symbols}: {e2}", flush=True)
            return []


def seed_from_historical(api_key: str):
    """Fill completed_bars with official CME 1m so Yahoo's ~10m lag is real prints, not flats."""
    try:
        client = db.Historical(key=api_key)
        end = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=20)
        start = end - datetime.timedelta(minutes=45)
        raw_symbols = desk_raw_symbols()
        print(f"[Sidecar] Seeding 45m of ohlcv-1m from Historical ({start.isoformat()}Z)...", flush=True)
        for raw, desk in raw_symbols.items():
            records = _hist_ohlcv(client, raw, "raw_symbol", start, end)
            bars = []
            for rec in records:
                close_px = _bar_px(rec, "pretty_close", "close")
                if not close_px:
                    continue
                bars.append(
                    {
                        "time": int(rec.ts_event / 1e9),
                        "open": _bar_px(rec, "pretty_open", "open") or close_px,
                        "high": _bar_px(rec, "pretty_high", "high") or close_px,
                        "low": _bar_px(rec, "pretty_low", "low") or close_px,
                        "close": close_px,
                        "volume": int(getattr(rec, "volume", 0) or 0),
                    }
                )
            upsert_completed_bars(desk, bars)
            print(f"[Sidecar] Seeded {len(bars)} 1m bars for {desk} ({raw})", flush=True)
    except Exception as e:
        print(f"[Sidecar] Historical seed failed: {e}", file=sys.stderr, flush=True)


def desk_raw_symbols():
    return {
        get_active_quarterly_contract("MYM"): "DOW",
        get_active_quarterly_contract("MNQ"): "NASDAQ",
        get_active_quarterly_contract("NKD"): "NIKKEI",
        get_active_cl_contract(): "CRUDE",
        get_active_gold_contract(): "GOLD",
    }


def subscribe_live(live, raw_symbols):
    raw_list = list(raw_symbols.keys())
    replay_start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=45)
    trade_start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2)
    try:
        live.subscribe(
            dataset="GLBX.MDP3",
            schema="ohlcv-1m",
            symbols=raw_list,
            stype_in="raw_symbol",
            start=replay_start,
        )
        print(f"[Sidecar] ohlcv-1m replay from {replay_start.isoformat()}", flush=True)
    except Exception as e:
        print(f"[Sidecar] ohlcv-1m replay unavailable ({e}); hist seed + trades only", flush=True)
    try:
        live.subscribe(
            dataset="GLBX.MDP3",
            schema="trades",
            symbols=raw_list,
            stype_in="raw_symbol",
            start=trade_start,
        )
        print(f"[Sidecar] trades replay from {trade_start.isoformat()}", flush=True)
    except Exception as e:
        print(f"[Sidecar] trade replay start rejected ({e}); subscribing live-only", flush=True)
        live.subscribe(
            dataset="GLBX.MDP3",
            schema="trades",
            symbols=raw_list,
            stype_in="raw_symbol",
        )

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
                        # Do not replay a stale volatility burst after a slow
                        # consumer recovers. The newest payload carries exact
                        # forming-bar OHLCV, so dropping queued prints loses no
                        # candle extremes and restores real-time immediately.
                        while True:
                            q.get_nowait()
                    except queue.Empty:
                        try:
                            q.put_nowait(payload)
                        except Exception:
                            dead.append(q)
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
            client_q = queue.Queue(maxsize=SSE_TICK_QUEUE_MAX)

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
    reconnect_delay = 0.25
    while True:
        try:
            print("[Sidecar] Connecting to Databento Live TCP gateway (GLBX.MDP3)...", flush=True)
            live = db.Live(key=api_key)
            raw_symbols = desk_raw_symbols()
            print(
                f"[Sidecar] Subscribing raw contracts: {list(raw_symbols.keys())} (WTI {get_active_cl_contract()} MGC {get_active_gold_contract()})",
                flush=True,
            )
            # Instrument ids are only valid for one gateway session, and they change
            # across a contract roll. Stale entries would map prints of an expired
            # contract onto a live desk book.
            with lock:
                id_to_desk.clear()
            subscribe_live(live, raw_symbols)
            connected = True
            reconnect_delay = 0.25
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
                        try:
                            price = float(record.pretty_price)
                        except (TypeError, ValueError):
                            continue
                        if not math.isfinite(price) or price <= 0:
                            continue
                        size = max(0, int(record.size or 0))
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
                        # Carry exact exchange OHLCV with every quote. Downstream
                        # may coalesce stale prints under backpressure without
                        # losing the burst high/low that shapes the candle.
                        payload["bar"] = dict(forming_candles[desk])

                    broadcast_trade(payload)
                elif hasattr(record, "pretty_open") and hasattr(record, "pretty_close"):
                    ingest_ohlcv_record(record, raw_symbols)

        except Exception as e:
            connected = False
            print(
                f"[Sidecar] Stream error: {e}. Reconnecting in {reconnect_delay:.2f}s...",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 3.0)


def main():
    api_key = load_api_key()
    if not api_key:
        print("[ERROR] DATABENTO_API_KEY not found in environment or .env.local", file=sys.stderr, flush=True)
        sys.exit(1)

    print(f"[Sidecar] Starting Databento Live Gateway Sidecar on port {PORT}...", flush=True)
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    # Seed closed 1m bars from Historical immediately so /bars is not empty
    # for the Yahoo lag window while Live reconnects after a deploy.
    seed_thread = threading.Thread(target=seed_from_historical, args=(api_key,), daemon=True)
    seed_thread.start()
    run_databento_stream(api_key)

if __name__ == "__main__":
    main()
