# Target AI Architecture

> Accepted direction for TradePulse AI.  
> Current runtime is still three stacks. This document is the target, plus the first seam that is now in code.

Related: [`AI_SYSTEM_OVERVIEW.md`](./AI_SYSTEM_OVERVIEW.md), [`AI_PROMPTS_CHART_LEO.md`](./AI_PROMPTS_CHART_LEO.md), [`AI_PROMPTS_FUNDAMENTALS.md`](./AI_PROMPTS_FUNDAMENTALS.md), [`AI_PROMPTS_DESK_NEWS.md`](./AI_PROMPTS_DESK_NEWS.md).

---

## 1. Rating of what exists today

| Dimension | Score | Why |
|-----------|-------|-----|
| Concept | 9/10 | Execution copilot vs specialist macro vs news is the right split |
| Separation of responsibilities | 9/10 | Chart Leo does not download OPEC reports |
| Agent specialization | 9/10 | Oil and Nasdaq do not share one generic fundamentals brain |
| Integration | 5/10 | Specialists do not publish into Leo; Desk News is its own universe |
| Persistence / reliability | 5/10 | Fundamentals live in process memory; Situations evaluate in the browser |

The philosophy is right. The missing piece is the infrastructure that connects it.

---

## 2. What stays

### Chart Leo stays the execution brain

Leo already receives live quote, candles, range/volume, cross-market radar, FRVP, AVWAP, IB/OR, CVD, position, drawings, long-term memories, and News AVWAP. It answers:

- Where are we?
- What setup is forming?
- Are sellers actually getting result?
- Did the spring reclaim?
- Where is structural invalidation?
- Is there room for 2R?

Leo does not become a research agent.

### The five fundamental agents stay

| Canonical id | Agent | Language |
|--------------|-------|----------|
| `CL` | Oil | Supply, demand, OPEC, inventories, curve |
| `GC` | Gold | Real yields, USD, central banks, ETF, CFTC |
| `NQ` | Nasdaq | Fed, rates, earnings, semis, breadth |
| `YM` | Dow | Cyclicals, Dow contribution, credit, rotation |
| `NK225` | Nikkei | BoJ, USD/JPY, Tokyo, constituents |

Do not collapse these into one `FUNDAMENTALS_AI`.

### `<execute>` stays

Leo proposes intent as a schema (`ARM_DESK_ALERT`, `ARM_CONDITIONAL_ENTRY`, …). Application code validates and stores the rule. Freeform prose never mutates rules or positions.

---

## 3. The rule that completes the design

**One data truth. Multiple specialist interpretations. One execution copilot. One deterministic risk layer.**

Agents do not talk to each other. They publish state. Other components consume state.

```text
EXTERNAL DATA
      │
      ├─ NEWS / MACRO RELEASES          MARKET DATA
      │         │                            │
      ▼         ▼                            ▼
 EVENT NORMALIZER                    MARKET DATA ENGINE
      │                                    │
 EVENT DEDUP + ENTITY + IMPORTANCE         │
      │                                    │
      ▼                                    ▼
 SHARED EVENT BUS                    REACTION ENGINE
      │                                    │
      ├──────────────┬──────────────┬──────┘
      ▼              ▼              ▼
  OIL AGENT      GOLD AGENT      NQ AGENT
      │              │              │
      ├──────── DOW AGENT ──────────┤
      │              │              │
      └──────── NIKKEI AGENT ───────┘
                     │
                     ▼
            MARKET STATE STORE
                     │
              SESSION DESK BRIEF
                     │
                     ▼
                 CHART LEO
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
     NOTES      SITUATIONS    TRADE THESIS
                     │
                     ▼
          DETERMINISTIC RULE ENGINE
                     │
                     ▼
                RISK ENGINE
                     │
                     ▼
            ALERT / (future) EXECUTION
```

---

## 4. Shared market intelligence bus

Specialists publish a normalized snapshot. Leo does not read their essays.

```json
{
  "market": "NQ",
  "timestamp": "…",
  "fundamental": { "intraday": "BEARISH", "short_term": "NEUTRAL", "confidence": 0.81 },
  "primary_driver": "RATES",
  "catalyst": { "type": "CPI", "surprise": "HOT", "magnitude": "HIGH" },
  "market_confirmation": { "status": "REJECTED" },
  "abnormal_behavior": { "detected": true, "type": "BULLISH_RELATIVE_STRENGTH" }
}
```

Leo receives only the compact desk brief:

```text
NQ DESK BRIEF
Fundamental regime: intraday bearish / short-term neutral
Catalyst: hot CPI
Market confirmation: rejected bearish impulse
Abnormal behavior: bullish relative strength
Confidence: HIGH
Do not infer trade direction. Wait for chart confirmation.
```

**Implemented now**

| Piece | Path |
|-------|------|
| Canonical ids `YM NQ GC CL NK225` plus display aliases | `lib/ai/canonicalMarkets.ts` |
| In-process bus, append-on-change history, desk brief | `lib/ai/marketIntelligenceBus.ts` |
| Adapter from the five in-memory specialist stores | `lib/ai/fundamentalBusSync.ts` |
| Brief injected at the top of `buildLeoSystemPrompt` | `lib/ai/leoAssistant.ts` |
| Sync on each Leo chat turn (failure does not block Leo) | `app/api/trading/leo/chat/route.ts` |
| Persistence tables (events, interpretations, state history) | `supabase/migrations/20261004_market_intelligence_bus.sql` |

Baseline seeds are **not** treated as a live fundamental read. Until a specialist records an evaluation (`recentEvents.length > 0`), Leo is told there is no evaluated snapshot and must stay on chart structure.

**Not wired yet:** writing those snapshots to Supabase on publish, reaction-engine fields (`market_confirmation`), and catalyst surprise/magnitude from a real event bus.

---

## 5. One event, many interpretations

Store the raw event separately from each specialist’s reading.

```text
EVENT
  CPI actual 0.4 / consensus 0.2

MARKET_INTERPRETATION
  NQ  bearish  (rates)
  YM  bullish  (growth)
  GC  bearish  (real yields)
  CL  mixed    (demand vs USD)
```

Never store a single global `headline.sentiment = BEARISH`.

Desk News should stop owning a private news universe. Target: one `EVENT_INGESTION_SERVICE` (timestamp, dedup, entities, market tags, importance, source reliability, event id). Oil Agent, Desk News, and Leo’s brief all consume that event. Fundamentals must stop refetching Finnhub on their own once this exists.

Tables for this split are created. The ingestion service is not built yet. News AI remains a separate prompt until it is demoted to a display over the same event bus.

---

## 6. Persistence and history

Process-memory singletons are a prototype. Restarts, deploys, and extra workers drop or fork state.

Target tables:

| Table | Role |
|-------|------|
| `market_events` | Raw normalized events |
| `market_interpretations` | One row per event × market × agent |
| `market_state_history` | Append-only specialist regime changes |

Do not overwrite “NQ bearish” with “NQ neutral”. Keep:

```text
09:30  BEARISH  0.82
09:42  BEARISH  0.71
10:05  MIXED    0.65
10:17  BULLISH  0.76
```

and why. That history is the research dataset.

The in-memory bus already appends when the fingerprint changes (cap 200). Database inserts are the next step.

Every brief also needs freshness: `generated_at`, last material event, and ages for slow feeds (CFTC, ETF flows). Leo must not treat a four-day CFTC print as a 10:37 tape event. The current brief reports `stateAgeSec` when the specialist state has a timestamp.

---

## 7. Canonical market ids

| Display (Leo / News) | Canonical id | Fundamentals agent |
|----------------------|--------------|--------------------|
| DOW | `YM` | DOW_AGENT |
| NASDAQ | `NQ` | NASDAQ_AGENT |
| GOLD | `GC` | GOLD_AGENT |
| CRUDE | `CL` | OIL_AGENT |
| NIKKEI | `NK225` | NIKKEI_AGENT |

`resolveCanonicalMarketId()` accepts `DOW`, `NASDAQ`, `YM`, `NQ`, `NKD`, `GC`, `CL`, and the other aliases in `lib/ai/canonicalMarkets.ts`. New code should store the canonical id. Display names stay in the UI.

---

## 8. Situations: AI proposes, code watches

Client-side evaluation is acceptable for the chart overlay. It is not acceptable as the only monitor (sleeping tab, closed laptop).

Target:

```text
Leo creates the rule via <execute>
        │
        ▼
schema validation
        │
        ▼
SERVER RULE ENGINE + persistent store
        │
        ▼
client displays the result
```

The LLM must not tick every price. Deterministic code does surveillance.

---

## 9. Risk engine (not an agent)

A deterministic service, not another model:

Inputs: equity, realized and open P&L, position, multiplier, entry, stop, correlation, volatility.  
Outputs: `allowed_size`, `maximum_risk`, `trade_allowed`, `reason_if_blocked`.

If the risk engine denies, the denial stands. Leo does not negotiate.

This service does not exist yet. Chart Leo remains read-only and does not place orders.

---

## 10. Reaction engine (not an agent)

For each catalyst, code computes price/volume/CVD at +10s, +1m, +5m, +15m, +60m and labels `CONFIRMED | PARTIAL | REJECTED | INCONCLUSIVE`.

The specialist interprets that label. The model does not hand-calculate the reaction. The snapshot field `marketConfirmation.status` is reserved for this and is null until the engine exists.

---

## 11. Confidence

A bare `0.86` is decorative unless its parts are stored (source quality, completeness, surprise, cross-market confirmation, price confirmation). Until that exists, the desk brief leads with `HIGH | MEDIUM | LOW | UNKNOWN`. A numeric value is shown only as a secondary figure, normalized from either `0.84` or `84`.

---

## 12. What this change does not do

- Does not merge the five specialists into one prompt
- Does not let agents message each other
- Does not move OPEC/CPI parsing into Chart Leo
- Does not replace `<execute>` with freeform memory
- Does not turn News AI into Chart Leo
- Does not place trades

---

## 13. Build order after this seam

1. Persist bus publishes into `market_state_history` (and stop trusting process memory across deploys).
2. Event ingestion service; Desk News and Fundamentals subscribe; stop the second Finnhub fetch.
3. Reaction engine fills `market_confirmation`.
4. Server rule engine for Situations / Notes, client becomes a display.
5. Risk engine with veto, still outside Leo.
6. Confidence components, or drop the float entirely.
