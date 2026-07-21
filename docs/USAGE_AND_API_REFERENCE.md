# Usage & Complete API Reference Manual

This manual contains setup instructions, environment configuration, command-line scripts, Python backtesting execution, deployment instructions, and the complete REST API reference for the TradePulse / Trading Platform codebase.

---

## 1. Environment Setup & Configuration

Copy `.env.example` to `.env.local` and configure your credentials:

```bash
cp .env.example .env.local
```

### Environment Variables Glossary

| Variable | Required | Description | Example / Default |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase project REST URL | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Supabase public anonymous API key | `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase admin service role key | `eyJhbGci...` |
| `ANTHROPIC_API_KEY` | **Yes** | Anthropic API key for Claude 3.5 Sonnet / Haiku | `sk-ant-api03-...` |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for anti-hallucination verification | `AIzaSy...` |
| `OPENAI_API_KEY` | Optional | OpenAI API key for Live Voice Speech Synthesis (TTS) | `sk-proj-...` |
| `OANDA_API_KEY` | Optional | OANDA v20 API key for live broker pricing & execution | `123456789...-xxx` |
| `OANDA_ACCOUNT_ID` | Optional | OANDA trading account ID | `101-001-xxxxxxx-001` |
| `OANDA_ENVIRONMENT` | Optional | OANDA broker environment | `practice` or `live` |
| `FINNHUB_API_KEY` | Optional | Finnhub API key for market news and sentiment classification | `cxxxxxx...` |
| `LIVE_VOICE_DEV_BYPASS` | Local Dev Only | Enables Live Voice microphone and bypasses session clock for local testing ([Details](UNRELEASED_LIVE_VOICE_FEATURE.md)) | `true` |

---

## 2. Complete REST API Reference

All API routes are located under [`app/api/`](file:///c:/Users/shahb/myApplications/Trading/app/api). All requests and responses operate in JSON format.

```mermaid
graph TD
    API[App Router API Routes]
    API --> Auth[/api/auth]
    API --> Trading[/api/trading]
    API --> Agents[/api/agents]
    API --> Levels[/api/levels]
    API --> LLM[/api/llm]
    API --> Positions[/api/positions]
    API --> Health[/api/health]
```

### 2.1 Authentication & User Settings

#### `POST /api/auth/login`
- **Description**: Authenticates user via Supabase Auth.
- **Request Body**:
  ```json
  { "email": "user@example.com", "password": "securepassword" }
  ```
- **Response `200 OK`**:
  ```json
  { "user": { "id": "uuid", "email": "user@example.com" }, "session": { "access_token": "jwt..." } }
  ```

#### `POST /api/auth/logout`
- **Description**: Logs out current user session.

#### `GET /api/settings/trading-mode`
- **Description**: Returns current trading mode (`paper` vs `live`).

#### `PATCH /api/settings/trading-mode`
- **Description**: Updates user trading mode.
- **Request Body**: `{ "mode": "paper" }` or `{ "mode": "live" }`

---

### 2.2 Desk Sessions & Market Operations

#### `GET /api/trading/session-gate`
- **Description**: Evaluates desk phase (`PREP`, `RECOMMENDED`, `ENTRY`, `MANAGE`, `FLAT`, `DONE`), locked instrument, and permissions.
- **Response `200 OK`**:
  ```json
  {
    "phase": "ENTRY",
    "lockedInstrument": "DOW",
    "canEnter": true,
    "reason": "Active 9:30-10:15 ET trading window"
  }
  ```

#### `GET /api/trading/market-open` / `POST /api/trading/market-open`
- **Description**: Runs 9:15 AM ET instrument selection analysis between DOW and NASDAQ, caches market regime, and triggers level identification.

#### `GET /api/trading/today-recommendation`
- **Description**: Returns daily index recommendation (`DOW` or `NASDAQ`) with rationale.

#### `POST /api/trading/clock-in`
- **Description**: Registers user desk attendance for today's session.

#### `POST /api/trading/clock-out`
- **Description**: Clock out from trading desk.

#### `GET /api/trading/attendance`
- **Description**: Fetches monthly desk attendance history and discipline metrics.

---

### 2.3 Level Identification & AI Agents

#### `POST /api/agents/find-levels`
- **Description**: Triggers Claude Level Finder Agent (Agent 1) to analyze price action, compute volume profiles, and return high-conviction support/resistance levels.
- **Request Body**:
  ```json
  {
    "symbol": "US30",
    "indexType": "DOW",
    "currentPrice": 39500.5,
    "timeframes": ["D", "4H", "H1"]
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "levels": [
      { "level": 39250.0, "type": "support", "conviction": 9, "reasoning": "AVWAP -1σ + HVN Volume Profile Node", "timeframe": "4H" },
      { "level": 39800.0, "type": "resistance", "conviction": 8, "reasoning": "Daily High + Stop Pool Sweeps", "timeframe": "D" }
    ]
  }
  ```

#### `GET /api/levels/history`
- **Description**: Fetches historical levels and test resolution verdicts (`respected`, `contested`, `broken`).

#### `POST /api/levels/archive`
- **Description**: Archives expired session levels.

---

### 2.4 Positions & Trade Execution

#### `POST /api/trading/positions/open`
- **Description**: Submits a new limit or market order. Enforces single position rule, valid phase, and mandatory stop loss / take profit.
- **Request Body**:
  ```json
  {
    "session_id": "session-uuid",
    "symbol": "US30",
    "side": "BUY",
    "entry_level": 39250.0,
    "stop_loss": 39150.0,
    "take_profit": 39450.0,
    "quantity": 1.0,
    "entry_source": "chart_level"
  }
  ```

#### `GET /api/trading/current-position`
- **Description**: Returns currently open position, entry price, live P&L in pips/dollars, and distance to stop loss.

#### `POST /api/trading/positions/close`
- **Description**: Liquidates active position.

#### `POST /api/trading/positions/stop-loss-hit`
- **Description**: Records a Stop-Loss hit event. Closes position and increments session stop counter. Locks desk if counter reaches 3.

#### `POST /api/trading/positions/ai-exit`
- **Description**: Evaluates news sentiment and adverse price action to trigger intelligent pullback vs reversal liquidations.

---

### 2.5 Live Voice Assistant

#### `GET /api/trading/live-voice/status`
- **Description**: Returns live voice session state, pinned levels, and active audio status.

#### `POST /api/trading/live-voice/react`
- **Description**: Generates assistant spoken reaction based on tick movement or proximity to levels.

#### `POST /api/trading/live-voice/transcript`
- **Description**: Submits user voice transcript for AI conversation processing.

---

### 2.6 Simulation Replays & Journal

#### `GET /api/trading/replays`
- **Description**: Fetches list of historical market simulation sessions.

#### `GET /api/trading/replays/available-dates`
- **Description**: Queries cached date ranges ready for instant replay playback.

#### `GET /api/trading/journal` / `POST /api/trading/eod-journal`
- **Description**: Queries or saves end-of-day trade reviews, execution notes, and ratings.

#### `GET /api/llm/usage`
- **Description**: Returns token consumption metrics and dollar costs breakdown by LLM model.

---

## 3. Development Commands & Maintenance Scripts

### Project Scripts ([`package.json`](file:///c:/Users/shahb/myApplications/Trading/package.json))

```bash
# Start Next.js local development server (http://localhost:3000)
npm run dev

# Run TypeScript type check without emitting files
npm run type-check

# Run Next.js linting checks
npm run lint

# Build production Next.js application
npm run build

# Start production server
npm run start

# Run Supabase database migrations script
npm run db:migrate
```

### Database Migration Scripts ([`scripts/`](file:///c:/Users/shahb/myApplications/Trading/scripts))

- **`node scripts/run-migrations.mjs`**: Runs all unapplied `.sql` files in `supabase/migrations/` in chronological order against the target Supabase database.
- **`node scripts/apply-missing-schema.mjs`**: Verifies and patches missing tables and RLS security policies.
- **`node scripts/verify-oanda.mjs`**: Validates OANDA API key, account ID, and pricing stream connectivity.

---

## 4. Running Python Strategy Bots & Backtests ([`bots/`](file:///c:/Users/shahb/myApplications/Trading/bots))

### Prerequisites
Ensure Python 3.10+ is installed and install required dependencies:

```bash
pip install -r bots/requirements.txt
```

### Execution Commands

```bash
# Run historical index strategy backtest
python bots/run_backtest.py

# Run walkforward optimization on Range Breakout Ladder strategy
python bots/run_rbl_walkforward.py

# Run auction market parameter optimizer
python bots/optimize_auction.py
```

---

## 5. Deployment Guide

### Vercel Deployment
1. Import repository into Vercel Dashboard.
2. Set Environment Variables in Project Settings (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`).
3. Vercel automatically detects Next.js 14 and schedules automated cron tasks from [`vercel.json`](file:///c:/Users/shahb/myApplications/Trading/vercel.json) (`13:15 UTC` weekday market-open trigger).

### Railway Deployment
1. Link repository to Railway.
2. Uses [`nixpacks.toml`](file:///c:/Users/shahb/myApplications/Trading/nixpacks.toml) and [`railway.toml`](file:///c:/Users/shahb/myApplications/Trading/railway.toml).
3. Import environment variables using `node scripts/export-railway-vars.mjs` or `railway-vars.example.json`.

---

## 6. Troubleshooting & Common Issues

1. **`408 Timeout on AI Level Finder`**:
   - Cause: Claude API exceeded 5-minute timeout.
   - Solution: System falls back automatically to deterministic Volume Profile + AVWAP level extraction. Check Anthropic status page or API key limits.
2. **`RLS Violation / Permission Denied`**:
   - Cause: Unauthenticated request or querying another user's session ID.
   - Solution: Ensure Supabase Bearer token is valid and passed in request headers.
3. **`Single Position Rule Violation`**:
   - Cause: Attempting to place an order when a trade is open or pending.
   - Solution: Liquidate active position or wait for Stop-Loss / Take-Profit trigger before entering new positions.
