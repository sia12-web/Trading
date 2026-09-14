# TradePulse — Institutional Day & Swing Trading Workstation

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Lightweight Charts](https://img.shields.io/badge/Lightweight_Charts-v4-emerald?style=flat-square)](https://tradingview.github.io/lightweight-charts/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Web Audio API](https://img.shields.io/badge/Web_Audio_API-Dual_Tone_Chimes-orange?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

> **TradePulse** is a high-performance, real-time trading platform designed for institutional index futures (DOW, NASDAQ, GOLD, CRUDE, NIKKEI) and equity swing traders. It pairs institutional auction market theory (Steidlmayer/Dalton), 5-month anchored VWAP bands, multi-tiered CME market data pipelines, live broker portfolio synchronization (Questrade), prop firm challenge tracking (TopstepX), and an intelligent AI copilot (Leo) with persistent memory zones and procedural audio synthesis.

---

## 📚 Authoritative Documentation Suite

The complete technical and operational documentation is organized under the [`docs/`](docs/) directory:

| Document | Description |
| :--- | :--- |
| **[System Architecture Guide](docs/ARCHITECTURE.md)** | Core system topology, client-server boundaries, event-driven data flows, and state management. |
| **[Market Data Pipelines & CME Basis](docs/MARKET_DATA_AND_FEEDS.md)** | Multi-tier feeds (CME Globex MDP 3.0 via Databento, OANDA 24/7 CFDs, Yahoo Finance Daily), dynamic CME basis calculation, and time shifting (`toChartTime`). |
| **[Trading Desk Operations & Risk Guard](docs/TRADING_DESK_AND_OPERATIONS.md)** | Multi-session framework (Asia, London, NY Cash, Afternoon), attendance clock-in, DLL circuit breakers, attempt ladder, and zero-telemetry policy. |
| **[Chart Engine & Technical Indicators](docs/CHART_AND_INDICATORS.md)** | Lightweight Charts v4, institutional candle styling, 5-Month Anchored VWAP + bands, 5-Day FRVP with candle-bounded POC, Dalton auction overlays, daily tested swing extremes, and CVD sub-pane. |
| **[Leo AI Assistant & Web Audio Alerts](docs/LEO_AI_AND_AUDIO_ALERTS.md)** | Leo multi-tier AI copilot, persistent Long-Term Memory (LTM) zones, real-time proximity scanner, and procedural dual-tone chime synthesizer. |
| **[Broker & Prop Firm Integrations](docs/BROKER_AND_PROP_INTEGRATIONS.md)** | Questrade live OAuth portfolio sync, intelligent delayed TP/SL bracket pairing, and TopstepX $1,500 challenge sync ($183.64 / 66 trades ledger). |
| **[REST API Reference & Data Contracts](docs/API_REFERENCE.md)** | Exhaustive reference for all API endpoints (`/api/trading/*`, `/api/levels/*`, `/api/health`), schemas, and Server-Sent Events (SSE). |

---

## ⚡ Key Platform Capabilities

### 1. Multi-Tiered CME Market Data & Dynamic Basis Alignment
- **Primary Feed**: CME Globex MDP 3.0 raw futures data via Databento (`GLBX.MDP3`).
- **Continuous 24/7 Fallback**: OANDA v20 continuous CFDs adjusted in real time by the **dynamic CME basis offset** ($\text{Price}_{\text{CME Futures}} - \text{Price}_{\text{OANDA Spot}}$), ensuring tick-level accuracy against Tradovate, NinjaTrader, and TopstepX.
- **Macro Daily History**: High-speed consolidation of 2 years of daily macro candles from Yahoo Finance in under 50ms.
- **Forming Bar Engine**: Imperative in-memory candle updates via Server-Sent Events (`/api/trading/quote/stream`) with zero UI lag.

### 2. Institutional Financial Charting (Lightweight Charts v4)
- **Institutional Styling**: Standard TradingView green (`#089981`) and red (`#f23645`) candles desk-wide.
- **5-Month Anchored VWAP**: Macro institutional benchmark with `±1σ`, `±2σ`, and `±3σ` volatility bands on Daily (`1D`) and dynamic session VWAP + 5M benchmark line on intraday charts (`1m`, `5m`, `30m`).
- **5-Day Fixed Range Volume Profile (FRVP)**: Calculates Point of Control (POC), Value Area High (VAH), and Value Area Low (VAL), with the POC line terminating precisely at the current candle.
- **Dalton Auction Theory Overlays**: Initial Balance (IB 60m), Opening Ranges (OR15, OR30), Late-Session Spikes, and Distribution references.
- **Daily & Intraday Tested Extremes**: Structural swing highs/lows with traded volume badges (`(142.5k)`), retest confirmation (`[Retest 0.82x]`), and bounded horizontal shelves.
- **Cumulative Volume Delta (CVD)**: Interactive candlestick sub-pane displaying buy/sell volume imbalances and order absorption divergences.

### 3. Leo AI Copilot & Web Audio API Alert Engine
- **Context-Aware Assistance**: Continuous situational awareness across live chart price action, Higher Timeframe daily structure, and open broker positions.
- **Persistent Long-Term Memory (LTM)**: 1-click conversion of chart Range Boxes into persistent memory zones with trader notes and audible alarms.
- **Procedural Two-Tone Chime Synthesis**: Zero-latency TradingView-style alert chime synthesized in real time via the Web Audio API (880 Hz fundamental $\rightarrow$ 1318.51 Hz harmonic shimmer) without external audio files.

### 4. Questrade Broker & TopstepX Prop Firm Integration
- **Questrade Live Sync**: Real-time portfolio book, cash balance, open multi-day swing equities (SPY, GOOG, SLV, COPX).
- **Intelligent Delayed TP/SL Bracket Pairing**: Proprietary algorithm pairing delayed limit targets and stop orders with open positions based on price relationship sanity (Long TP > Entry > SL) and recency scoring, completely isolating unexecuted entry limits.
- **TopstepX $1,500 Challenge**: Zero-base prop equity engine tracking official challenge `1.5KCHCR-LABS004-V2-675081-67067724`, Max Loss Limit floor (-$500.00), live cushion ($683.64), win rate (56.06%), and the verified 66-trade ledger.

### 5. Strict Desk Risk Controls & Zero-Telemetry Privacy
- **Risk Limits**: Fixed $400 dollar risk per setup, Daily Loss Limit (DLL) circuit breakers, 3-attempt daily ladder, and +$700 Green Day lock.
- **Zero Telemetry**: All Telegram notifications are permanently disabled desk-wide. Telemetry, order execution, and trading signals remain 100% private on the local platform.

---

## 🛠️ Project Structure

```
├── app/
│   ├── api/                     # Next.js Server-Side API Route Handlers
│   │   ├── auth/                # Session Authentication & Logout
│   │   ├── health/              # Diagnostic System Probe
│   │   ├── levels/              # Support/Resistance Level Archive
│   │   ├── notify/              # Desk Notifications Dispatcher
│   │   └── trading/             # Core Trading & Market Data Endpoints
│   │       ├── candles/         # Multi-TF Historical Candles (Databento/OANDA/Yahoo)
│   │       ├── quote/stream/    # Server-Sent Events (SSE) Live Price Stream
│   │       ├── context-55/      # 5M AVWAP Baseline, YDay NYC, ON Inventory
│   │       ├── questrade/book/  # Questrade Live Broker Book & Paired Brackets
│   │       ├── journal/         # TopstepX Prop Firm Ledger & Equity Sync
│   │       ├── team-tape/       # Live Multi-Day Swing Positions
│   │       ├── leo/             # Leo AI Chat, Long-Term Memories & Alerts
│   │       └── ...
│   ├── dashboard/               # Next.js App Router Client Pages
│   │   ├── chart/               # Fullscreen Institutional Trading Chart & CVD
│   │   ├── journal/             # TopstepX Prop Challenge Ledger & Equity Curve
│   │   ├── positions/           # Live Execution Dashboard & Bracket Controls
│   │   ├── swing/               # Questrade Swing Portfolio & Team Tape
│   │   └── page.tsx             # Dashboard Home & Notifications Center
│   ├── layout.tsx               # Root Application Shell
│   └── page.tsx                 # Landing / Redirect Entrypoint
├── lib/
│   ├── ai/                      # Leo AI Assistant & Prompt Engines
│   ├── chart/                   # Charting Engines, AVWAP, Canvas Overlays, Sound
│   │   ├── chartTime.ts         # Montreal Wall Clock toChartTime Converter
│   │   ├── deskChartTheme.ts    # Lightweight Charts Institutional Theme
│   │   ├── excesses.ts          # Daily & Intraday Tested Extremes & Retests
│   │   ├── sessionVwap.ts       # Anchored VWAP & Standard Deviation Bands
│   │   ├── soundEffects.ts      # Web Audio API Dual-Tone Chime Synthesizer
│   │   └── volumeProfile.ts     # 5-Day FRVP & Dalton Auction Profiler
│   ├── databento/               # CME Globex MDP 3.0 Feed Client
│   ├── oanda/                   # OANDA v20 REST & CFD Pricing Service
│   ├── questrade/               # Questrade OAuth & Live Account Service
│   ├── supabase/                # Supabase Database & Mock Client
│   ├── trading/                 # Trading Operations, CME Basis, Bracket Pairing
│   │   ├── cmeBasis.ts          # Spot-Futures Basis Calculation Engine
│   │   ├── deskInstrumentPreference.ts # Viewport Storage per Timeframe
│   │   ├── journalHistory.ts    # Prop Firm Challenge & Equity Calculation
│   │   ├── leoLongTermMemory.ts # Persistent Memory Zones & Proximity Engine
│   │   ├── questradeOrders.ts   # Intelligent Delayed TP/SL Bracket Pairing
│   │   ├── sessionGate.ts       # Multi-Session Desk Trading Windows
│   │   └── teamTape.ts          # Multi-Day Position Persistence
│   └── utils/                   # Shared Formatters, Date Utils, Logger
├── docs/                        # Authoritative System Documentation Suite
├── supabase/                    # PostgreSQL Migrations & RLS Policies
├── types/                       # TypeScript Data Contracts & Interfaces
├── .env.example                 # Environment Variable Template
├── package.json                 # Dependencies & Build Scripts
└── tsconfig.json                # TypeScript Strict Configuration
```

---

## 🚀 Quickstart & Setup

### 1. Prerequisites
- **Node.js**: `v18.17.0` or higher
- **Package Manager**: `npm` (v9+)
- **Accounts / Keys** (Optional / Fallbacks available):
  - Databento API Key (CME Globex live data)
  - OANDA Account ID & Token (CFD pricing)
  - Questrade API Refresh Token (Live broker sync)
  - Supabase Project URL & Anon Key (Database persistence)
  - Anthropic API Key (Leo AI assistant)

### 2. Environment Configuration
Copy `.env.example` to `.env.local` and populate your configuration:

```bash
cp .env.example .env.local
```

Key environment variables:
```env
# Database & Auth
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Market Data
DATABENTO_API_KEY=your-databento-key
OANDA_API_KEY=your-oanda-api-key
OANDA_ACCOUNT_ID=your-oanda-account-id
OANDA_ENVIRONMENT=practice # or 'live'

# Broker Integrations
QUESTRADE_REFRESH_TOKEN=your-questrade-token

# AI Assistant
ANTHROPIC_API_KEY=your-claude-api-key
```

### 3. Installation & Verification
Install dependencies and run the automated type-checking suite:

```bash
# Install dependencies
npm install

# Run TypeScript type check
npm run type-check

# Run Next.js production build
npm run build

# Start development server
npm run dev
```

Navigate to `http://localhost:3000` to open the workstation.
