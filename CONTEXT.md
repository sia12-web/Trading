# Trading Platform - Project Context

**Last Updated:** 2026-07-13
**Current Phase:** Slice 4 Complete (Agent 1 - Level Finder) → Ready to move to Agent 4 (Pre-Market Planner)

---

## 🎯 Project Vision

A sophisticated day trading platform combining real-time market data, institutional-grade technical analysis, and Claude AI for intelligent level identification and trade decision-making. Users trade in structured 9:00-9:45 AM windows with pre-market preparation and strict risk management (one position at a time, stop-loss/take-profit exits only).

**Target:** Professional day traders focused on DOW, NASDAQ, NIKKEI with paper trading validation before live execution.

---

## 🏗️ Architecture Overview

### Tech Stack
- **Frontend:** Next.js 14, React, TailwindCSS, Lightweight Charts
- **Backend:** Next.js API routes, TypeScript strict mode
- **Database:** Supabase PostgreSQL with RLS policies
- **Real-time:** Supabase Realtime for WebSocket subscriptions
- **AI:** Claude 3.5 Sonnet (Anthropic API)
- **Market Data:** OANDA (WebSocket for prices, REST for historical)
- **News:** Finnhub API (sentiment classification)

### Database Schema
- `profiles` - Users with trading_mode preference (paper/live)
- `sessions` - Daily trading sessions with index recommendation (DOW/NASDAQ/NIKKEI)
- `identified_levels` - AI-detected support/resistance/VWAP with conviction
- `positions` - Opened/closed trades with entry/exit prices, P&L
- `monitoring_events` - Audit trail of execution and alerts
- `price_data` - OHLC candles (M5, H1, 4H aggregated from OANDA)
- `news_events` - News with sentiment classification

### Vertical Slice Approach
Each slice is end-to-end (DB → API → Service → UI):
- **Slice 1-3:** Foundation, Paper Trading (✅ COMPLETE)
- **Slice 4:** Agent 1 - Level Finder (✅ COMPLETE)
- **Slice 5+:** Additional agents and features (IN PROGRESS)

---

## 🤖 AI Agents (6 Total)

### Agent 1: Level Finder (Slice 4) ✅ COMPLETE
**Purpose:** Identify key support/resistance levels and VWAP
**Input:** 4H/Daily/H1 candles, symbol, index type, current price
**Output:** 2-5 levels with type (support/resistance/vwap), conviction (1-10), reasoning, timeframe
**Logic:** Analyzes institutional price action, round numbers, swing points, SMA zones
**Tech:** Claude 3.5 Sonnet, 5-minute timeout, 50-pip duplicate detection
**Files:**
- `lib/services/levelFinderAgent/levelFinderAgent.ts` - Main service
- `app/api/agents/find-levels/route.ts` - API endpoint
- `lib/services/levelFinderAgent/types.ts` - TypeScript interfaces

**Key Features Implemented:**
- Comprehensive input validation (volume > 0, OHLC relationships, chronological order)
- Level price validation (level > 0, reasoning non-empty)
- Duplicate detection (50-pip threshold)
- Graceful JSON parsing with fallback to empty array
- Proper error handling with 408 timeout responses
- Refactored into helpers (<50 line functions)

---

### Agent 4: Pre-Market Planner (Slice 5) 📋 PLANNED
**Purpose:** Recommend market entry strategy based on levels and context
**Input:** Identified levels, news sentiment, market conditions
**Output:** Trading strategy (entry setup, recommended timeframe, confidence)
**Status:** Design phase (depends on Agent 1 → waiting for Slice 5 start)

---

### Agent 6: HTF Specialist (Slice 6+) ⏳ DEFERRED
**Purpose:** Validate setups using higher timeframes
**Input:** Identified levels, H4/Daily chart context
**Output:** Validation (go/no-go for trade)
**Status:** Deferred to Phase 2+ (after core agents working)

---

### Agents 2, 3, 5 (Unspecified) ⏳ DEFERRED
**Status:** Backlog - specific purposes TBD in planning sessions

---

## 📊 Current State

### What's Working ✅
- User authentication via Supabase
- Session creation with index selection
- AI Level Finder analysis (Agent 1)
- Level identification with deduplication
- Paper trading mode (safe simulation)
- Position creation and P&L calculation
- Proper RLS security

### What's In Progress 🔄
- Slice 4 audit complete, ready to move to Slice 5
- Next: Agent 4 (Pre-Market Planner) design and implementation

### What's Deferred ⏳
See `PHASES.md` for complete deferred features list

**Most requested deferred features:**
1. Historical Level Memory (Phase 2+) - AI remembers past levels
2. Playground Mode Backtesting (Phase 2+) - Test strategies on historical dates
3. Real-time Price Feed (Phase 2)
4. News/Sentiment Integration (Phase 2+)
5. Live OANDA Execution (Phase 3+)

---

## 🔐 Security & Constraints

### Safety Mechanisms
- **RLS Policies:** Users isolated to own data
- **Paper Trading Default:** Live mode disabled until explicitly enabled
- **One Position Maximum:** Enforces risk discipline (Phase 1)
- **Stop Loss/Take Profit Required:** No floating positions
- **Guard Rails:** Prevents live execution in current phase

### Trade Rules (MVP)
- Trading window: 9:00-9:45 AM only
- One position at a time
- Entry via identified levels only
- Exit via stop-loss or take-profit only
- Paper trading default (safe)

---

## 📁 File Structure

```
Trading/
├── app/
│   ├── api/
│   │   ├── agents/find-levels/route.ts         ← Agent 1 endpoint
│   │   ├── positions/                          ← Position management
│   │   ├── sessions/                           ← Session endpoints
│   │   ├── settings/                           ← User settings
│   │   └── ...
│   ├── page.tsx                                ← Home dashboard
│   └── layout.tsx
├── lib/
│   ├── services/
│   │   ├── levelFinderAgent/                   ← Agent 1 service
│   │   │   ├── levelFinderAgent.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── priceService.ts                     ← OANDA integration
│   │   ├── newsService.ts                      ← Finnhub integration
│   │   ├── positionExecutor.ts                 ← Trade execution
│   │   └── ...
│   ├── supabase/
│   │   ├── server.ts                           ← Server-side client
│   │   └── client.ts                           ← Client-side client
│   └── utils/
├── supabase/
│   ├── migrations/                             ← Database schema
│   └── rls/                                    ← Security policies
├── types/
│   └── database.ts                             ← TypeScript types
├── PHASES.md                                   ← All phases documented
├── CONTEXT.md                                  ← This file
├── README.md                                   ← Setup guide
├── .env.example                                ← Environment template
└── package.json

```

---

## 🚀 How to Use This Context

**When you start a new session:**
1. Read this file first (CONTEXT.md)
2. Check `PHASES.md` for what's completed vs. deferred
3. Look at recent changes in git history
4. Ask Captain/Architect/Builder what slice you're working on

**Key Questions to Ask Claude:**
- "What slice are we working on?" → Check PHASES.md
- "What's the current state?" → See "What's Working" above
- "What should I defer?" → See "What's Deferred" above
- "How do I run this?" → See README.md

---

## 📋 Critical Decisions Made

1. **Vertical Slices:** Build end-to-end features, not horizontal layers
2. **Paper Trading First:** Validate logic before live execution
3. **One Position Rule:** Enforced discipline, simpler logic
4. **Claude API:** Single API call per analysis (no multi-turn)
5. **50-pip Threshold:** Duplicate detection for levels
6. **5-minute Timeout:** Claude API safety limit
7. **9:00-9:45 AM Window:** Focused trading hours only
8. **OANDA Integration:** Primary broker (live phase)

---

## 🎯 Success Metrics

**MVP (Phase 1):**
- ✅ Can identify levels from price action
- ✅ Can trade in paper mode
- ✅ Can manage positions safely

**Phase 2+:**
- Journey completion rate increases by 15%+
- 60%+ users trade during 9:00-9:45 AM window
- Win rate > 55% in paper trading
- Risk/Reward ratio > 1.5:1

---

## 🔗 Quick Links

- **Database:** Supabase console
- **Code:** `app/` and `lib/` directories
- **API Docs:** See README.md
- **Phases:** PHASES.md
- **Environment:** .env.example

---

## 📝 Next Steps

1. ✅ **Slice 4 (Agent 1) Complete** - Level Finder production-ready
2. **→ Slice 5 (Agent 4) Next** - Pre-Market Planner design phase
3. Phase 2+: Historical memory, playground mode, live execution

---

*Generated: 2026-07-13*
*For context-refresh each session, read CONTEXT.md + PHASES.md before starting work.*
