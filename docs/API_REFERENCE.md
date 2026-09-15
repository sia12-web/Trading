# REST API Reference & Data Contracts

> **TradePulse API Gateway**  
> **Protocol**: HTTP/1.1 REST (JSON) + HTTP Server-Sent Events (SSE)  
> **Authentication**: Cookie-Based Session Auth & Development Auth Fallback  
> **Base URL**: `http://localhost:3000` / Production Domain  

---

## 1. Market Data & Streaming Endpoints

### 1.1 `GET /api/trading/candles`
Fetches normalized historical OHLCV candlestick data for a specified instrument and timeframe.

- **Query Parameters**:
  - `instrument` (string, required): `DOW` | `NASDAQ` | `GOLD` | `CRUDE`
  - `timeframe` (string, optional): `1m` | `5m` | `15m` | `30m` | `1H` | `4H` | `1D` (Default: `5m`)
  - `days` (integer, optional): Calendar lookback window (Default: `730` for `1D`, `5` for intraday)
  - `quote` (string, optional): `0` to omit the quote snapshot, `1` to include (Default: `1`)
  - `date` / `end_date` (string, optional): `YYYY-MM-DD` for historical replay mode
- **Response Format (`200 OK`)**:
  ```json
  {
    "instrument": "DOW",
    "timeframe": "1D",
    "candles": [
      {
        "time": 1726272000,
        "open": 40350.5,
        "high": 40580.0,
        "low": 40290.0,
        "close": 40520.0,
        "volume": 142500
      }
    ],
    "source": "yahoo",
    "quote": {
      "price": 40520.0,
      "change": 170.0,
      "change_pct": 0.42
    }
  }
  ```

---

### 1.2 `GET /api/trading/quote/stream`
Server-Sent Events (SSE) stream delivering real-time price updates and forming-bar tick data.

- **Query Parameters**:
  - `instrument` (string, optional): Default `DOW`
- **Stream Headers**:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
- **Event Payload**:
  ```
  data: {"instrument":"DOW","price":40525.0,"change":175.0,"change_pct":0.43,"high":40585.0,"low":40290.0,"volume":142800,"timestamp":1726312500}
  ```

---

### 1.3 `GET /api/trading/context-55`
Provides comprehensive Higher Timeframe market context, 5-month AVWAP baselines, and auction references.

- **Query Parameters**:
  - `instrument` (string, required): `DOW` | `NASDAQ` | `GOLD` | `CRUDE`
- **Response Format (`200 OK`)**:
  ```json
  {
    "instrument": "DOW",
    "avwap5mBaseline": {
      "anchorUnix": 1715693400,
      "sumPV": 429583000,
      "sumP2V": 17402800000000,
      "sumV": 10580,
      "lastBarTime": 1726272000,
      "vwap": 40603.3
    },
    "yesterdayNyc": {
      "date": "2026-09-11",
      "openUnix": 1726061400,
      "closeUnix": 1726084800,
      "poc": 40480.0,
      "vah": 40560.0,
      "val": 40390.0
    },
    "overnightInventory": {
      "netInventoryPct": 42.5,
      "status": "LONG_IMBALANCE"
    }
  }
  ```

---

## 2. Broker & Portfolio Endpoints

### 2.1 `GET /api/trading/questrade/book`
Returns live Questrade portfolio balance, open swing positions, and paired TP/SL orders.

- **Response Format (`200 OK`)**:
  ```json
  {
    "ok": true,
    "equity": 48250.60,
    "cash": 12450.20,
    "positions": [
      {
        "symbol": "SPY",
        "shares": 10,
        "entry": 765.00,
        "mark": 769.50,
        "pnl": 45.00,
        "target": 772.00,
        "stop": null,
        "unlinkedBracket": false
      }
    ],
    "workingOrders": []
  }
  ```

---

### 2.2 `GET /api/trading/journal`
Returns the verified order ledger, equity curve, and TopstepX challenge progress.

- **Response Format (`200 OK`)**:
  ```json
  {
    "account": "1.5KCHCR-LABS004-V2-675081-67067724",
    "starting_account": 0,
    "ending_equity": 183.64,
    "equity_change": 183.64,
    "max_loss_limit": -500.00,
    "cushion": 683.64,
    "total_trades": 66,
    "win_rate": 56.06,
    "profit_factor": 1.23,
    "trades": [
      {
        "id": "trade-66",
        "date": "2026-09-11",
        "symbol": "MNQ",
        "side": "LONG",
        "entry_price": 19850.25,
        "exit_price": 19866.00,
        "net_pnl": 31.68
      }
    ]
  }
  ```

---

### 2.3 `GET /api/trading/team-tape`
Retrieves live team signals and open multi-day swing positions.

- **Response Format (`200 OK`)**:
  ```json
  {
    "open": [
      {
        "id": "team-spy-1",
        "symbol": "SPY",
        "entry": 765.00,
        "target": 772.00,
        "stop": null,
        "qty": 10,
        "mark": 769.50,
        "pnl": 45.00
      }
    ],
    "closed": [],
    "advice": "Their share count is their own book. Follow your desk risk."
  }
  ```

---

## 3. Leo AI & Long-Term Memory Endpoints

### 3.1 `POST /api/trading/leo/chat`
Submits a conversational message to Leo with active chart and market context.

- **Request Body**:
  ```json
  {
    "message": "Is Dow 40,600 a valid short entry right now?",
    "instrument": "DOW",
    "currentPrice": 40580.0
  }
  ```
- **Response Format (`200 OK`)**:
  ```json
  {
    "response": "40,600 represents the 5-Month Anchored VWAP. Look for seller absorption and a rejection candle on the 5m before entering short. Place stop loss above 40,625.",
    "suggestedAction": "WAIT_FOR_CONFIRMATION"
  }
  ```

---

### 3.2 `GET /api/trading/leo/memories` & `POST /api/trading/leo/memories`
Fetches or stores persistent Higher Timeframe memory zones.

- **POST Request Body**:
  ```json
  {
    "instrument": "DOW",
    "priceHigh": 40650.0,
    "priceLow": 40580.0,
    "purpose": "5M AVWAP Inflection Zone",
    "notes": "Look for heavy volume absorption; break targets Day POC.",
    "alarmEnabled": true
  }
  ```
- **Response Format (`201 Created`)**:
  ```json
  {
    "id": "mem-1726312800",
    "created": true
  }
  ```

---

### 3.3 `POST /api/trading/ai-team`
Runs the multi-agent AI Stacked consensus engine combining the Macro Strategist, Order Flow Specialist, and Institutional Hedging Model.

- **Request Body**:
  ```json
  {
    "instrument": "NASDAQ",
    "livePrice": 29012.5,
    "chartContext": {
      "instrument": "NASDAQ",
      "currentPrice": 29012.5,
      "recentCandles": [...]
    }
  }
  ```
- **Response Format (`200 OK`)**:
  ```json
  {
    "success": true,
    "report": {
      "consensus": "CAUTIOUS_BULLISH",
      "confidence": 85,
      "summary": "Dealer gamma flip at 29,012 provides upside acceleration potential.",
      "tacticalLevels": [
        { "name": "Dealer Put Wall", "price": 28886.34, "role": "SUPPORT" },
        { "name": "Zero Gamma Flip", "price": 29012.07, "role": "INFLECTION" }
      ]
    },
    "telemetry": {
      "gammaRegime": "POSITIVE_GAMMA",
      "putCallRatio": 0.82,
      "dealerFlip": 29012.07
    }
  }
  ```

---

## 4. Desk Operational & Attendance Endpoints

### 4.1 `POST /api/trading/clock-in`
Records trader attendance before the market open.

- **Response Format (`200 OK`)**:
  ```json
  {
    "ok": true,
    "clockInTime": "2026-09-14T08:45:00-04:00",
    "disciplineStreak": 14
  }
  ```

---

### 4.2 `GET /api/trading/session-gate`
Validates whether current time is within authorized trading windows.

- **Query Parameters**:
  - `instrument` (string, required): `DOW` | `NASDAQ` | `GOLD`
- **Response Format (`200 OK`)**:
  ```json
  {
    "isSessionOpen": true,
    "activeSession": "New York Cash",
    "minutesToClose": 105
  }
  ```

---

### 4.3 `GET /api/health`
System diagnostic probe checking database, pricing feed, and broker connectivity.

- **Response Format (`200 OK`)**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-09-14T13:12:00.000Z",
    "services": {
      "database": "connected",
      "marketData": "active",
      "questrade": "authorized"
    }
  }
  ```

---

## 5. Databento Live CME Gateway Daemon Endpoints (`http://127.0.0.1:8765`)

The standalone Python background sidecar (`scripts/databento_live_sidecar.py`) streams live Globex trades and exposes a local micro-server for the Next.js workstation:

### 5.1 `GET /health`
Returns live daemon connectivity status, uptime, and trade counters.
- **Response Format (`200 OK`)**:
  ```json
  {
    "status": "ok",
    "connected": true,
    "uptime_sec": 1358.4,
    "total_trades": 43427,
    "symbols": ["MNQ.FUT", "MYM.FUT", "MCL.FUT", "NKD.FUT", "MGC.FUT"]
  }
  ```

### 5.2 `GET /snapshot?symbol=MNQ.FUT`
Returns the latest trade tick, bid/ask spread, and forming bar for an instrument without establishing a persistent socket.
- **Response Format (`200 OK`)**:
  ```json
  {
    "symbol": "MNQ.FUT",
    "price": 29014.25,
    "size": 4,
    "side": "A",
    "ts_event": 1726325400123456789
  }
  ```

### 5.3 `GET /stream`
Continuous Server-Sent Events (SSE) feed of incoming CME tick executions for ultra-low latency sub-second chart rendering.

