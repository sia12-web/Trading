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
Provides comprehensive Higher Timeframe market context, 5-month AVWAP baselines, and auction references computed directly from CME Globex daily bars.

- **Query Parameters**:
  - `instrument` (string, required): `DOW` | `NASDAQ` | `GOLD` | `CRUDE` | `NIKKEI` (Default: `DOW`)
- **Response Format (`200 OK`)**:
  ```json
  {
    "ok": true,
    "instrument": "DOW",
    "avwap5m": {
      "anchorDate": "2026-05-04",
      "anchorUnix": 1714800000,
      "vwap": 40603.3,
      "sigma1Upper": 41120.5,
      "sigma1Lower": 40086.1,
      "sigma2Upper": 41637.7,
      "sigma2Lower": 39568.9,
      "sigma3Upper": 42154.9,
      "sigma3Lower": 39051.7,
      "barCount": 105,
      "baseline": {
        "sumPV": 429583000,
        "sumV": 10580,
        "sumP2V": 17402800000000
      }
    },
    "cached": false,
    "source": "cme_globex"
  }
  ```
- **Simplified Band Model**:
  - `vwap`: 5-month volume-weighted wholesale benchmark center line.
  - `sigma1Upper` / `sigma1Lower`: $\pm 1\sigma$ Value Area (68.2% of auction distribution).
  - `sigma2Upper` / `sigma2Lower`: $\pm 2\sigma$ Statistical Boundary (95.4% of distribution).
  - `sigma3Upper` / `sigma3Lower`: $\pm 3\sigma$ Extreme Outlier Reference (99.7% of distribution).
  - Multi-band clutter ($\pm 4\sigma \dots \pm 7\sigma$) is strictly eliminated.

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
    "message": "Critique this price at 9:30 AM open",
    "instrument": "DOW",
    "currentPrice": 40580.0,
    "priceQuestioning": {
      "valuationState": "EXTREME_PREMIUM",
      "valuationScore": 78,
      "suitabilityVerdict": "WEAK_HAND_TRAP_RISK",
      "wholesaleTarget": 40480.0,
      "inventoryCritique": "Asian and London participants accumulated 30 points lower overnight. Buying at retail open risks providing exit liquidity to overnight longs.",
      "weakHandTrap": "SINGLE_CANDLE_FOMO",
      "sixQuestionAudit": [
        { "id": "q1_impulse", "status": "DANGER", "headline": "Single-Candle FOMO", "details": "Impulse spike into retail premium" },
        { "id": "q6_wholesale", "status": "DANGER", "headline": "Wholesale vs Retail", "details": "Price 35pts above 5D-POC" }
      ]
    }
  }
  ```
- **Response Format (`200 OK`)**:
  ```json
  {
    "response": "Market is advertising at EXTREME PREMIUM (+78 score). Asian/London participants accumulated lower overnight. Do not provide exit liquidity. Hold patient for responsive rotation to wholesale 40,480 before buying.",
    "suggestedAction": "HOLD_PATIENT_DO_NOT_FORCE"
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

---

## 6. Wyckoff Strategy & 5-Market Opportunity Radar Services

### 6.1 `classifyWyckoffLine(tl, referenceBars)` (`lib/trading/wyckoffStrategy.ts`)
Automatically classifies a trendline or price level into a Wyckoff Supply Line (Creek) or Wyckoff Demand Line (Ice).

- **Parameters**:
  - `tl`: UserTrendline object with `p1`, `p2`, `instrument`, `direction`
  - `referenceBars` (optional): Array of ContextBar historical candles
- **Return Contract**:
  ```json
  {
    "role": "SUPPLY_LINE",
    "label": "Wyckoff Supply Line (Creek)",
    "color": "#f59e0b"
  }
  ```
  *(Returns `role: "DEMAND_LINE"`, `label: "Wyckoff Demand Line (Ice)"`, `color: "#38bdf8"` for ascending support lines)*

---

### 6.2 `evaluateWyckoffSetup(line, bars, ctx)` (`lib/trading/wyckoffStrategy.ts`)
Evaluates candlestick interactions against a Wyckoff Structure Line, checking for one of the ONLY 4 Valid Trades in the Universe:
1. `SPRING`: Support Sweep $\rightarrow$ Reclaim $\rightarrow$ Long
2. `BREAKDOWN_RETEST`: Support Breakdown $\rightarrow$ Failed Reclaim $\rightarrow$ Short
3. `UPTHRUST`: Resistance Sweep $\rightarrow$ Return Below $\rightarrow$ Short
4. `BREAKOUT_RETEST`: Resistance Breakout $\rightarrow$ SOS Retest $\rightarrow$ Long

- **Parameters**:
  - `line`: UserTrendline structural line
  - `bars`: Array of ContextBar recent candles
  - `ctx`: WyckoffChartContext containing Tier-1 pre-marked zones
- **Return Contract (`WyckoffSetupResult`)**:
  ```json
  {
    "setupType": "SPRING",
    "lineRole": "DEMAND_LINE",
    "roleLabel": "Wyckoff Demand Line (Ice)",
    "linePriceAtTrigger": 21485.0,
    "entryPrice": 21492.5,
    "stopLoss": 21478.0,
    "targetPrice": 21545.0,
    "targetZoneLabel": "5D-POC / Yesterday VAH",
    "riskPoints": 14.5,
    "rewardPoints": 52.5,
    "rrRatio": 3.62,
    "is2RValid": true,
    "cvdAbsorption": true,
    "cvdExplanation": "CVD Lower Low + Price Reclaim = Heavy seller absorption by passive buyers",
    "effortVsResult": "BULLISH_ABSORPTION",
    "badgeText": "⚡ Wyckoff Spring: Reclaim + CVD Absorption · 3.62R to 5D-POC / Yesterday VAH",
    "statusTag": "SPRING TRIGGER ⚡",
    "color": "#10b981"
  }
  ```

---

### 6.3 `evaluateSpringOrUpthrustTrendline(tl, bars, ctx)` (`lib/trading/wyckoffStrategy.ts`)
Evaluates an Action Trendline drawn from a Spring or Upthrust origin using 0–100 institutional factor scoring.

- **Parameters**:
  - `tl`: UserTrendline object with `p1`, `p2`, `instrument`, `direction`
  - `bars`: Array of ContextBar historical OHLCV data
  - `ctx`: WyckoffChartContext object with `yesterday`, `overnight`, `frvp5d`, `avwap5m`
- **Return Contract (`SpringUpthrustEvaluation`)**:
  ```json
  {
    "originType": "SPRING",
    "totalScore": 85,
    "grade": "A",
    "stopLoss": 21480.0,
    "targetPrice": 21550.0,
    "rrRatio": 2.4,
    "is2RValid": true,
    "color": "#10b981",
    "targetZoneLabel": "5D-POC / Yesterday VAH",
    "summary": "Spring @ 21485.0: Score 85/100 (A). High Location Confluence (5D LVN). Volume Ratio 1.45x. Confirmed 5m Reclaim. CVD Divergence present. 2.4R to 5D-POC."
  }
  ```

---

### 6.4 `build5MarketOpportunityRadar(inputs)` (`lib/trading/crossMarketRadar.ts`)
Computes 3-factor market selection across 5 benchmark instruments (`NQ`, `YM`, `ES`, `GC`, `CL`).

- **Return Contract (`CrossMarketRadarReport`)**:
  ```json
  {
    "timestampEt": "10:15:00",
    "topPick": {
      "instrument": "CL",
      "grade": "A",
      "summary": "CRUDE OIL (CL) is the Grade A Top Pick! Elevated OVX (38.2), 5D-LVN location, confirmed Wyckoff Spring."
    },
    "marketRankings": [
      { "instrument": "CL", "grade": "A", "score": 92, "volatilityGauge": "OVX (38.2)", "participation": true, "location": true, "structure": true },
      { "instrument": "NQ", "grade": "B", "score": 68, "volatilityGauge": "VIX1D (16.4)", "participation": true, "location": false, "structure": true },
      { "instrument": "YM", "grade": "B", "score": 62, "volatilityGauge": "VIX (15.8)", "participation": false, "location": true, "structure": true },
      { "instrument": "ES", "grade": "C", "score": 40, "volatilityGauge": "VIX (15.8)", "participation": false, "location": false, "structure": false },
      { "instrument": "GC", "grade": "C", "score": 35, "volatilityGauge": "GVZ (12.1)", "participation": false, "location": false, "structure": false }
    ]
  }
  ```

