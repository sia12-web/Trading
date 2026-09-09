# How the live desk works

This is the operating manual for the **TradePulse NYC futures desk**. Live charts only (DOW · NASDAQ · GOLD · CRUDE). There is no simulation product.

## Daily clock (America/New_York)

| Time | Phase | What happens |
|---|---|---|
| **09:00–09:30** | Prep | Charts are back. Overnight inventory FRVP **keeps updating** until cash open. |
| **09:30–16:00** | Live | Cash session. Overnight inventory **freezes** at the 09:30 profile. 5-day FRVP, 5-month VWAP, and yesterday FRVP paint on the live 5m chart. |
| **16:00** | Cool down | NYC cash is done. **Today becomes yesterday.** The desk reprints the last **5 trading days** of 5m bars (Databento + Yahoo stitch) to fill latency/gap holes, then recomputes **5-month anchored VWAP**, then **yesterday FRVP** from the session that just closed. Live tick stream stops. |
| **16:00–18:00** | Dead zone | No Asia overnight yet. Reprint settles. |
| **18:00 → next 09:30** | Overnight inventory | Globex overnight FRVP (ON-POC) **keeps updating** even if you never open the chart. Friday 16:00 → Sunday 18:00 is quiet (Globex closed). Sunday 18:00 starts Monday’s inventory. |
| **Until 09:00 next session** | Charts away | You do not need the chart. At 09:00 prep the book is already reprinted. |

At **16:00 ET** the last 5m candle is still 15:55. The desk uses **wall-clock time**, not that bar’s timestamp, so today is already yesterday for FRVP.

Server path: `lib/trading/deskCooldownWatch.ts` (Railway boot) + `GET/POST /api/trading/desk-cooldown` (cron + chart POST at 16:00). The live chart also recomputes yesterday / overnight from the 5m book using wall clock, so opening at 09:00 already shows the reprinted session.

## Context 5-5 overlays

Computed in `lib/chart/context55.ts`, painted in `TradingChart` + `lib/chart/context55Paint.ts`.

1. **5-day FRVP** — volume profile from the cash open five trading days ago through the live tip. Thin histogram at the **range open**. **POC line runs from that open to the range end** (not just the histogram width).
2. **Yesterday NYC FRVP** — prior completed RTH 09:30–16:00. After 16:00 today, that is **today’s closed session**. Histogram at yesterday’s cash open; **Y-POC spans 09:30–16:00**.
3. **Overnight inventory FRVP** — 18:00 ET before the next cash open, updating until 09:30. Histogram at 18:00; **ON-POC spans 18:00 → now (or 09:30)**.
4. **5-month anchored VWAP** — typical price `(H+L+C)/3`. Blue VWAP center is the 5-month running mean; ±1/±2/±3σ (green / olive / teal, fill between ±1σ) are sized from **recent 5m volatility** (~last 36 hours) so they stay around price. Session candles own the Y-axis — VWAP ±σ last-value labels and 5-month daily variance must not flatten the bars. The HUD still prints the VWAP level.

POC lines are canvas (not Lightweight Charts price lines) so they cannot stretch the scale.

## Market data

- Live book: **Databento CME Globex** (MYM / MNQ / MGC / CL), not OANDA CFDs mixed onto those candles.
- Databento hist is delayed → **Yahoo CME 5m stitch** fills holes and the live tail (needed for yesterday RTH and overnight FRVP).
- 5-month VWAP daily series: CME archive + Yahoo daily merge on the 16:00 reprint so today’s completed session is included.

## What was removed

- Simulation / replay charts (`/dashboard/simulation` redirects to the live chart).
- Stale docs that described OANDA-only, Nikkei live, paper sim, and Live Voice as the product.

## Key files

- Chart: `app/dashboard/chart/components/TradingChart.tsx`
- Session + AVWAP colors: `lib/chart/sessionVwap.ts`
- Overlays: `lib/chart/context55.ts`, `lib/chart/context55Paint.ts`
- Close reprint: `lib/trading/deskReprint.ts`, `lib/trading/deskClockPhase.ts`
- Candles API: `app/api/trading/candles/route.ts`
- 5M VWAP API: `app/api/trading/context-55/route.ts`
