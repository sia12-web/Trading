# TradePulse — NYC live futures desk

Live day-trading desk for **DOW (MYM) · NASDAQ (MNQ) · GOLD (MGC) · CRUDE (CL)**. Databento CME book, Context 5-5 overlays, Tradeify execution. **Live charts only** — simulation/replay is removed.

## How it works

Read **[docs/HOW_THE_DESK_WORKS.md](docs/HOW_THE_DESK_WORKS.md)** — the daily clock, 16:00 cooldown reprint, overnight inventory until 09:30, FRVP/POC, and 5-month VWAP.

## Stack

- Next.js 14 + React 18 (App Router)
- Lightweight Charts
- Databento CME Globex + Yahoo stitch
- Supabase Postgres
- Railway production: project **Day Trading**, service **Trading**

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Required secrets are listed in `.env.example` (`DATABENTO_API_KEY`, `DESK_GATE_PASSWORD`, Tradeify/OANDA, Supabase, `CRON_SECRET`).

## Scripts

```bash
npm run dev
npm run build
npm run start
npx tsx __tests__/context55.test.ts
npx tsx __tests__/deskClockPhase.test.ts
npx tsx __tests__/chart_visual_quality.test.ts
```
