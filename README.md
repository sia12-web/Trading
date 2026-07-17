# Trading Platform - Day Trading with AI Analysis

A sophisticated day trading platform combining real-time market data, institutional-grade technical analysis, and Claude AI for intelligent level identification and trade decision-making.

## Features

- **Real-time Price Feeds**: OANDA WebSocket integration for live DOW/NASDAQ/NIKKEI data
- **News Sentiment Analysis**: Finnhub API with keyword-based sentiment classification
- **AI-Powered Level Finder**: Claude API identifies key support/resistance levels
- **Paper Trading Mode**: Safe simulation environment before live trading
- **Session-Based Trading**: Structured 9:00-9:45 AM trading windows with pre-market prep
- **Forced Discipline**: One position at a time, stop-loss/take-profit exits only

## Documentation

- **[TradePulse System Guide](docs/DAY_TRADER_SYSTEM_GUIDE.md)** — how the platform works and how its tools help day traders (not a trading strategy)
- [Paper Trading Mode](docs/PAPER_TRADING_MODE.md) — paper vs live schema and API flow

## Project Structure

```
├── app/
│   ├── api/                    # API routes
│   │   ├── sessions/           # Trading session endpoints
│   │   ├── positions/          # Position management
│   │   ├── agents/             # AI agent endpoints
│   │   ├── settings/           # User settings
│   │   └── ...
│   ├── page.tsx               # Home page
│   └── layout.tsx             # Root layout
├── lib/
│   ├── services/              # Business logic services
│   │   ├── priceService.ts    # OANDA price feed
│   │   ├── newsService.ts     # Finnhub news feed
│   │   ├── levelFinderAgent.ts # Claude AI analysis
│   │   └── positionExecutor.ts # Position execution
│   ├── supabase/              # Supabase clients
│   │   ├── server.ts          # Server-side client
│   │   └── client.ts          # Client-side client
│   └── utils/                 # Helper functions
├── types/
│   └── database.ts            # TypeScript types for database
├── supabase/
│   ├── migrations/            # Database migrations
│   └── rls/                   # RLS policy definitions
├── docs/                      # Documentation
├── .env.example               # Example environment variables
├── .env.local                 # Local environment (DO NOT COMMIT)
├── tsconfig.json              # TypeScript configuration
├── next.config.js             # Next.js configuration
└── package.json               # Dependencies
```

## Setup Instructions

### 1. Prerequisites

- Node.js 18+
- npm or yarn
- OANDA account (demo or live)
- Supabase project
- Claude API key

### 2. Environment Setup

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

Required environment variables:
```
OANDA_API_KEY=your_key
OANDA_ACCOUNT_ID=your_account_id
OANDA_ENVIRONMENT=practice  # or 'live'

NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

ANTHROPIC_API_KEY=your_claude_api_key
```

### 3. Install Dependencies

```bash
npm install
# or
yarn install
```

### 4. Database Setup

Run migrations to set up database schema:

```bash
npm run migrate
```

Or apply migrations directly via Supabase dashboard.

### 5. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` to access the application.

## Architecture

### Vertical Slice Implementation

The project is built in vertical slices, each implementing a complete feature end-to-end:

- **Slice 1**: Database Schema + Core API
- **Slice 2**: OANDA Real-time Price Feed
- **Slice 3**: Finnhub News Feed Service
- **Slice 4**: Claude AI - Level Finder Agent
- **Slice 5**: Claude AI - Pre-Market Planner
- **Slice 6**: Claude AI - HTF Specialist
- **Slice 7+**: UI Components, Dashboard, Position Management

### Key Services

#### Price Feed Service (lib/services/priceService.ts)
- Real-time WebSocket connection to OANDA
- Tick-to-candle aggregation (M5, H1, H4)
- RVOL calculation with 20-period rolling average
- Pub/Sub pattern for subscribers

#### News Feed Service (lib/services/newsService.ts)
- 60-second polling interval from Finnhub API
- Keyword-based sentiment classification
- Relevance mapping (DOW, NASDAQ, NIKKEI, MACRO)
- In-memory cache (max 100 articles)

#### Level Finder Agent (lib/services/levelFinderAgent.ts)
- Claude API integration for price action analysis
- Support/resistance/VWAP identification
- Conviction scoring (1-10)
- Deduplication (50-pip threshold)

#### Position Executor (lib/services/positionExecutor.ts)
- Paper trading mode (simulated execution)
- Live mode guard (prevents real execution until OANDA integrated)
- Audit trail via monitoring_events table

## Database Schema

### Core Tables

- **sessions**: Daily trading sessions with index recommendations
- **identified_levels**: Support/resistance levels identified by AI
- **positions**: Opened/closed trading positions
- **monitoring_events**: Trade execution events and alerts
- **price_data**: OHLC candles for analysis
- **news_events**: News with sentiment classification
- **profiles**: User configuration including trading mode preference

All tables include:
- UUID primary keys
- Timestamps (created_at, updated_at)
- Row Level Security (RLS) policies
- Foreign key constraints with CASCADE deletes

## Trading Workflow

### Morning Preparation (7:00-9:00 AM)

1. User creates session with index recommendation (DOW or NASDAQ)
2. Agent 1 (Level Finder) analyzes 4H/Daily/H1 candles
3. Identifies 2-5 key support/resistance levels
4. Agent 4 (Pre-Market Planner) prepares entry strategy
5. Levels stored in database, ready for trading window

### Trading Window (9:00-9:45 AM)

1. Monitoring service watches for price at identified levels
2. Agent 6 (HTF Specialist) validates setup with higher timeframes
3. User approves entry, position created with stop loss/take profit
4. Monitoring continues until position reaches SL or TP
5. Position auto-closes when target hit

### After Trading

1. Position closed with P&L recorded
2. Execution audit trail in monitoring_events
3. Results tracked for trading log and analytics

## Paper vs Live Trading

**Paper Trading Mode** (Default - Safe):
- Positions simulated without real money
- All entry/exit logic validated
- Perfect for learning and testing
- Recommended for first 2+ weeks

**Live Trading Mode**:
- Real OANDA orders placed
- Real money at risk
- Requires explicit mode switch
- Audit trail tracks all live positions

Switch modes via:
```bash
PATCH /api/settings/trading-mode
{ "mode": "live" }  # or "paper"
```

## API Documentation

### Sessions
- `POST /api/sessions/create` - Create trading session
- `GET /api/sessions/today` - Get today's session

### Positions
- `POST /api/positions/create` - Create position
- `GET /api/positions/open` - Get open positions
- `PATCH /api/positions/[id]/close` - Close position

### Levels
- `POST /api/agents/find-levels` - Analyze and identify levels
- `GET /api/identified-levels/session/[id]` - Get session levels

### News & Prices
- `GET /api/news-events/recent` - Get recent market news
- `GET /api/price-data/latest` - Get latest candles

### Settings
- `GET /api/settings/trading-mode` - Get trading mode
- `PATCH /api/settings/trading-mode` - Set trading mode

## Performance Metrics

**Target KPIs**:
- Win rate: >55%
- Risk/Reward ratio: >1.5:1
- Trade completion rate: >80%
- Average response time: <100ms

## Security

- **RLS Policies**: Users isolated to own data
- **API Auth**: All endpoints require valid session
- **Secrets**: .env.local never committed to git
- **Headers**: Security headers on all responses

## Development Guidelines

### TypeScript
- Strict mode enabled
- No `any` types
- Full type definitions for database and API

### Code Quality
- Functions under 50 lines
- Descriptive variable names
- Error handling with try/catch
- Console logs for errors only

### Git Workflow
- Create feature branch from main
- Commit with clear messages
- PR review before merge
- Never commit .env.local or credentials

## Troubleshooting

### "Cannot read property of undefined"
Usually missing environment variable. Check `.env.local` has all required keys.

### "RLS policy blocking query"
Check Supabase RLS policies allow current user's operations.

### "Claude API timeout"
Increase timeout or check API key validity.

### "OANDA connection failed"
Verify API key, account ID, and environment (practice vs live) are correct.

## Future Roadmap

- Phase 2: Email/SMS notifications, push alerts
- Phase 3: Advanced analytics dashboard, trade statistics
- Phase 4: OANDA account integration (live execution)
- Phase 5: Multi-position management, portfolio analytics
- Phase 6: Mobile app, real-time alerts on-the-go

## License

Proprietary - Trading Platform

## Support

For issues or questions:
1. Check documentation in /docs
2. Review recent migration for schema changes
3. Check .env.local for missing credentials
4. Review Supabase logs for database errors
