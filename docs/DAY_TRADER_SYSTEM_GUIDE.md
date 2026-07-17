# TradePulse System Guide — NY Session Desk

How the **NY Session Trading Desk** works: one market (DOW or NASDAQ), chart-first entries, session locks, and review tools.

This guide describes **product behavior** for the desk—not a separate strategy document.

---

## Table of contents

1. [What it is](#1-what-it-is)
2. [Session clock](#2-session-clock)
3. [Chart desk](#3-chart-desk)
4. [Orders and risk](#4-orders-and-risk)
5. [Automation](#5-automation)
6. [APIs](#6-apis)
7. [Related docs](#7-related-docs)

---

## 1. What it is

TradePulse’s live NY desk helps you trade **one index at a time**:

1. ~**9:15 ET** — system analyzes **DOW vs NASDAQ** and locks the day’s instrument  
2. Chart shows levels for that market before the open  
3. **9:30–10:15 ET** — click a highlighted level → place a **deep long/short limit** (paper journal)  
4. After fill — manage with stop hits and AI reverse/pullback exit  
5. **3 stop hits** (or AI reversal / lunch flatten) → session **DONE**

NIKKEI is **not** part of the NY recommendation/entry path on this desk.

---

## 2. Session clock

Implemented in [`lib/trading/sessionGate.ts`](../lib/trading/sessionGate.ts) and exposed via `GET /api/trading/session-gate`.

| Phase | ET window | Trading |
|-------|-----------|---------|
| PREP | Before 9:15 | View prep only |
| RECOMMENDED | 9:15–9:30 | Instrument locked; no entries yet |
| ENTRY | 9:30–10:15 | Click-level limits allowed |
| MANAGE | After fill until exit | No new entries; SL + AI exit |
| FLAT | After 10:15, no fill | Entries closed |
| DONE | 3 SL / AI exit / after lunch | All trading locked |

Outside the cash session, prefer **Simulation** for replay practice.

---

## 3. Chart desk

Primary UI: [`/dashboard/chart`](../app/dashboard/chart/page.tsx)

- Session banner (phase, locked instrument, message)  
- Interactive chart with **Finnhub candles** (`/api/trading/candles`) for DOW/NASDAQ (`^DJI` / `^IXIC`)  
- Levels from `/api/levels/status`  
- Click a level → **LevelOrderTicket** (deep buy / deep short)  
- Side panel for signals / position overlay  

---

## 4. Orders and risk

- Open: `POST /api/trading/positions/open` with `entry_source: 'chart_level'`  
- Gate rejects NIKKEI, wrong instrument, or non-ENTRY phase  
- One NY trade per session (any open/closed DOW/NASDAQ journal row for the day blocks another open)  
- Stops: hits 1–2 keep position; **hit 3** closes and disables the day  
- AI exit: `POST /api/trading/positions/ai-exit` — news + adverse move ⇒ pullback vs reversal; liquidates on reversal  
- Lunch safety: ~11:30 ET flatten helpers remain  

Sizing helpers still use ~5% account risk / ~5% stop geometry where invoked.

---

## 5. Automation

- **Vercel cron** ([`vercel.json`](../vercel.json)): weekdays **13:15 UTC** ≈ 9:15 ET (EDT) → `GET /api/trading/market-open`  
- Chart banner also **POSTs market-open** when phase is RECOMMENDED and no lock yet  
- Market-open analyzes **DOW + NASDAQ only**, stores `regime_cache` + `market_recommendations`, then triggers Level Finder prep for the winner  

---

## 6. APIs

| Route | Role |
|-------|------|
| `GET /api/trading/session-gate` | Phase + permissions |
| `GET/POST /api/trading/market-open` | 9:15 recommend |
| `GET /api/trading/today-recommendation` | Banner / direction hint |
| `GET /api/trading/candles` | Real OHLC |
| `POST /api/trading/positions/open` | Chart limit fill |
| `POST /api/trading/positions/stop-loss-hit` | SL counter / close at 3 |
| `POST /api/trading/positions/ai-exit` | Pullback vs reversal |

---

## 7. Related docs

- [README.md](../README.md) — setup  
- [PAPER_TRADING_MODE.md](PAPER_TRADING_MODE.md) — paper vs live  

Default for this desk path is **paper journal fills** until you enable live broker wiring in Settings.
