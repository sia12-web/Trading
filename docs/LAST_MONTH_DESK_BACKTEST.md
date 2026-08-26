# Last-month desk backtest (real 5-minute CME bars)

Replay of the **live TradePulse desk**, not the Gemini daily-open audit. Data: Yahoo Finance `MYM=F` (DOW / MYM) and `MNQ=F` (NASDAQ / MNQ), 5-minute Globex bars. Window **2026-07-25 → 2026-08-26** America/New_York.

## Rules actually used

- One NY instrument per cash day: larger overnight range **percent** (18:00–09:15 ET) of MYM vs MNQ.
- CALL from **closed bars only**. LONG limit = range **low**; SHORT limit = range **high**; fill only if that price trades inside ±10.
- Stop beyond the range edge (`strategyEntryRisk`). Target **1.5R**. Risk **$400 → $250 → $150**. Session cap 3 fills. Green lock +$700. Two stop-outs lock the day.
- Dow Asia: **20:00–02:00 ET**, range < 80 pts, buy stop high+20 / sell stop low−20, stop at midpoint, 1.5R. First tagged stop after 02:00; both-in-same-bar skipped.
- If stop and target print in the same 5-minute bar, the replay books a **stop** (conservative).

## Summary

| | |
|---|---|
| Starting equity | $50,000
| Ending equity | $51,624
| Net | +$1,624
| Trades | 13 (6 wins / 7 losses / 0 flat)
| Conservative same-bar stop+target | 0
| 5m bars | MYM 7709 · MNQ 7686

## Trades

| # | Cash day | ET time | Inst | Setup | Side | Entry | Stop | TP | Exit | Reason | Qty | Risk | P&L | OR H/L |
|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|
| 1 | 2026-08-11 | 2026-08-11, 02:30 | DOW | ASIA | SHORT | 53989 | 54047 | 53902 | 54047 | stop | 14 | $400 | -406.00 | 54085 / 54009 |
| 2 | 2026-08-12 | 2026-08-12, 05:20 | DOW | ASIA | LONG | 53932 | 53882 | 54007 | 53882 | stop | 16 | $400 | -400.00 | 53912 / 53852 |
| 3 | 2026-08-13 | 2026-08-13, 10:05 | DOW | OR30 | SHORT | 54084 | 54255 | 53800 | 53800 | target | 5 | $400 | +710.00 | 54084 / 53931 |
| 4 | 2026-08-14 | 2026-08-14, 02:50 | DOW | ASIA | SHORT | 53903 | 53962 | 53815 | 53815 | target | 14 | $400 | +616.00 | 54000 / 53923 |
| 5 | 2026-08-14 | 2026-08-14, 10:15 | NASDAQ | OR30 | LONG | 30170 | 30098 | 30300 | 30098 | stop | 2 | $250 | -288.00 | 30280.75 / 30170 |
| 6 | 2026-08-17 | 2026-08-17, 11:00 | NASDAQ | IB | SHORT | 30266 | 30352 | 30100 | 30100 | target | 2 | $400 | +664.00 | 30265.75 / 30156.5 |
| 7 | 2026-08-18 | 2026-08-18, 09:55 | NASDAQ | OR15 | LONG | 29631 | 29549 | 29800 | 29549 | stop | 2 | $400 | -328.00 | 29770 / 29631 |
| 8 | 2026-08-19 | 2026-08-19, 02:50 | DOW | ASIA | LONG | 53428 | 53373 | 53511 | 53373 | stop | 14 | $400 | -385.00 | 53408 / 53337 |
| 9 | 2026-08-20 | 2026-08-20, 03:20 | DOW | ASIA | SHORT | 53496 | 53544 | 53424 | 53424 | target | 17 | $400 | +612.00 | 53572 / 53516 |
| 10 | 2026-08-20 | 2026-08-20, 09:50 | NASDAQ | OR15 | LONG | 29339 | 29245 | 29500 | 29245 | stop | 1 | $250 | -188.00 | 29470.25 / 29338.5 |
| 11 | 2026-08-21 | 2026-08-21, 02:35 | DOW | ASIA | LONG | 52921 | 52869 | 52999 | 52999 | target | 15 | $400 | +585.00 | 52901 / 52837 |
| 12 | 2026-08-25 | 2026-08-25, 10:05 | NASDAQ | OR30 | LONG | 29279 | 29198 | 29450 | 29198 | stop | 2 | $400 | -324.00 | 29416 / 29279.25 |
| 13 | 2026-08-26 | 2026-08-26, 10:25 | NASDAQ | OR30 | LONG | 29174 | 29098 | 29300 | 29300 | target | 3 | $400 | +756.00 | 29333.25 / 29173.75 |

## Skips / stand-asides

- **2026-07-27** — ASIA stand aside — range 194 pts ≥ 80 (H 52532 / L 52338)
- **2026-07-28** — ASIA stand aside — range 134 pts ≥ 80 (H 52423 / L 52289)
- **2026-07-29** — ASIA stand aside — range 227 pts ≥ 80 (H 53035 / L 52808)
- **2026-07-30** — ASIA stand aside — range 176 pts ≥ 80 (H 51952 / L 51776)
- **2026-07-31** — ASIA stand aside — range 179 pts ≥ 80 (H 52639 / L 52460)
- **2026-08-03** — ASIA stand aside — range 163 pts ≥ 80 (H 52941 / L 52778)
- **2026-08-04** — ASIA stand aside — range 97 pts ≥ 80 (H 53492 / L 53395)
- **2026-08-05** — ASIA stand aside — range 156 pts ≥ 80 (H 54501 / L 54345)
- **2026-08-06** — ASIA stand aside — range 86 pts ≥ 80 (H 54634 / L 54548)
- **2026-08-07** — ASIA stand aside — range 123 pts ≥ 80 (H 54005 / L 53882)
- **2026-08-10** — ASIA stand aside — range 150 pts ≥ 80 (H 54150 / L 54000)
- **2026-08-13** — ASIA stand aside — range 84 pts ≥ 80 (H 53886 / L 53802)
- **2026-08-17** — ASIA stand aside — range 108 pts ≥ 80 (H 53828 / L 53720)
- **2026-08-18** — ASIA stand aside — range 117 pts ≥ 80 (H 53558 / L 53441)
- **2026-08-24** — ASIA stand aside — range 107 pts ≥ 80 (H 53394 / L 53287)
- **2026-08-25** — ASIA stand aside — range 81 pts ≥ 80 (H 53522 / L 53441)
- **2026-08-26** — ASIA stand aside — range 91 pts ≥ 80 (H 53692 / L 53601)

## TradingView check

Compare these fills on **MYM1!** / **MNQ1!** (or Yahoo `MYM=F` / `MNQ=F`) **5-minute** Globex charts, America/New_York. Do not use YM/NQ daily opens — that is what the deleted Gemini audit used (e.g. Jul 28 “MNQ 28,210” vs real 5m open ~27,949).

Spot-checked against Yahoo 5m:

- **Aug 19 Asia:** MYM H 53408 / L 53337 (71 pts). Buy stop 53428 tagged 02:50. Matches trade #8.
- **Aug 26 OR30:** MNQ H 29333.25 / L 29173.75. Long 29174 at 10:25; TP 29300 at 14:30 (bar high 29304). Matches trade #13.

## How to re-run

```bash
npx tsx scripts/backtest-desk-last-month.ts
```

Green-day lock threshold in code: +$700. Max stop-outs: 2. First-fill planned risk: $400.
