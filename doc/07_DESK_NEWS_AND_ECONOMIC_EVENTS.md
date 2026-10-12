# 📰 07. Desk News Intelligence & Economic Event Hazards

> **Desk News Wire Ingestion, Economic Calendar Hazard Engine, and Desk News AI Agent**  
> **Source Files**: [`lib/trading/deskNews.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/deskNews.ts), [`lib/trading/deskNewsHazard.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/deskNewsHazard.ts), [`lib/trading/deskNewsPrompt.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/deskNewsPrompt.ts), [`app/api/trading/news-ai/route.ts`](file:///c:/Users/shahb/myApplications/Trading/app/api/trading/news-ai/route.ts)

---

## 1. Overview & Core Mandates

The Desk News subsystem serves as TradePulse's **event intelligence and volatility warning radar**.

```
┌────────────────────────────────────────────────────────────────────────┐
│ THE DESK NEWS MANDATE                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Event Intelligence Only: Identifies, verifies, classifies, and      │
│    deduplicates material market events.                                │
│ 2. Context Only — Never a Signal: A news headline or economic release │
│    is NEVER a trade trigger.                                           │
│ 3. Strict Boundary with Technicals: The news engine does not create   │
│    support/resistance levels, identify Wyckoff springs, or place orders.│
│ 4. Specialist Routing: Routes verified events to relevant specialists  │
│    (NQ_AGENT, DOW_AGENT, GOLD_AGENT, OIL_AGENT, NIKKEI_AGENT).         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. News Wire Ingestion & Tagging Pipeline (`deskNews.ts`)

TradePulse integrates with the **Finnhub REST API** to stream live global headlines and economic releases:

```
[Finnhub Market News & Economic Calendar]
                   │
                   ▼
     [Source Reliability Filter] ────────── Favor Reuters, Bloomberg, WSJ, FT, Nikkei, CNBC
                   │
                   ▼
     [Timestamp Normalization] ────────── Convert to UTC / Montreal Time; Reject Noise
                   │
                   ▼
    [Regex Instrument & Theme Match] ──── Tag DOW, NASDAQ, NIKKEI, GOLD, CRUDE, SILVER
                   │
                   ▼
  [Card Categorization & Deduplication] ─ MACRO, EARNINGS, GEO, FLOW, OTHER
                   │
                   ▼
  [Trader Workstation & News AI Ingestion]
```

### News Card Categorization:
- **`MACRO`**: Central bank monetary policy, FOMC, CPI, PPI, PCE, Non-Farm Payrolls, GDP, Treasury yields.
- **`EARNINGS`**: Major index constituent quarterly reports, EPS surprises, revenue guidance revisions.
- **`GEO`**: Geopolitical tensions, sanctions, tariffs, wars, elections, trade agreements.
- **`FLOW`**: Institutional option flows, ETF rebalancing, large futures liquidations, volume spikes.
- **`OTHER`**: Miscellaneous corporate developments and market commentary.

---

## 3. Economic Calendar Hazard Engine (`deskNewsHazard.ts`)

High-impact macroeconomic releases create sudden volatility spikes, wide bid-ask spreads, and order book slippage. The **Economic Calendar Hazard Engine** protects capital by enforcing systematic warning windows:

```
                  HIGH-IMPACT ECONOMIC EVENT TIMELINE
────┬─────────────────────────────┬───────────────────────────┬────────►
    │                             │                           │
  -60 min                       -15 min                    0 min (Release)
 [CAREFUL WINDOW]            [STAND-ASIDE]               [RELEASED]
 Soft warning banner         NO NEW ENTRIES              Outcome reported
 Tighten open stops          Stand aside                 Wait for reaction
```

### Hazard Threat Levels:

| Hazard Level | Time Window | System Status & Trader Directive |
| :--- | :---: | :--- |
| **`none`** | $> 60\text{ min}$ before event | Normal trading conditions. All strategy setups active. |
| **`careful`** | $60\text{ to } 15\text{ min}$ before event | **Soft Warning**: High-impact catalyst approaching. Manage existing positions; avoid entering low-conviction setups. |
| **`stand_aside`** | $\le 15\text{ min}$ before event | **Hard Hazard Filter**: **STAND ASIDE**. Order entry gates refuse new executions to avoid slippage and whip-saw stops. |
| **`released`** | Post-release ($0\text{ to } 30\text{ min}$) | Event has crossed the tape. System displays actual vs. consensus figures and waits for technical reaction bars. |

### Timezone Representation:
All calendar events are formatted in **Montreal Time (`America/Toronto`)**:
```typescript
export function formatMontrealHms(atMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(atMs)); // e.g. "08:30"
}
```

---

## 4. The Desk News AI Agent (`DESK_NEWS_AGENT`)

The **Desk News AI Agent** (`lib/trading/deskNewsPrompt.ts`, `/api/trading/news-ai`) operates as an automated news desk assistant powered by Claude 3.7 Sonnet / GPT-4o:

### Complete System Prompt Specification (`DESK_NEWS_AGENT_PROMPT`):
```text
You are the Desk News & Event Intelligence Agent (DESK_NEWS_AGENT).

You cover six analysis markets:
YM, NQ, NKD, GC, and CL (plus SI for Silver).

Execution-size aliases (MYM, MNQ, MGC, SIL, MCL) are contract size, not separate markets. Do not analyze MYM as a different instrument from YM, or MNQ as a different instrument from NQ, or SIL as a different instrument from SI.

Your job is to identify, verify, classify, deduplicate, and summarize material market events.

You are not the technical execution agent.
You do not create support or resistance levels.
You do not identify springs, upthrusts, absorption, CVD divergence, failed auctions, or trade entries unless those observations are explicitly supplied by the technical system.
You do not maintain a persistent bullish or bearish regime for any market. Specialist agents own regimes.
You do not issue trades.

For every event:
1. Identify the factual event.
2. Record original source, publication timestamp, and receipt timestamp when supplied.
3. Separate FACT, ESTIMATE, RUMOR, and UNKNOWN.
4. Treat the supplied list as already deduplicated. One row is one event. Do not turn repeated headlines into separate developments.
5. Identify affected markets.
6. Identify likely transmission channels.
7. Assign importance (HIGH, MEDIUM, LOW) and expected horizon.
8. Compare a scheduled release with consensus and previous only when those fields are supplied.
9. Report only the market reaction supplied in context. If the reaction engine is not supplied, set market reaction to PENDING_REACTION_ENGINE and describe the latest available quote as a last print, not as a 5-minute or 15-minute path.
10. Route the event to the relevant specialist: OIL_AGENT, GOLD_AGENT, NQ_AGENT, DOW_AGENT, NIKKEI_AGENT, and SILVER_AGENT.
11. List only upcoming events present in the verified calendar block.
12. Never invent future events, price levels, market reactions, or missing statistics.

Calendar rules:
- Only report upcoming events that are present in verified calendar data.
- If calendar coverage is unavailable, state "UPCOMING CALENDAR DATA UNAVAILABLE."
- If no Tier-1 event is present in the verified window, state "NO VERIFIED TIER-1 EVENT IN CURRENT CALENDAR WINDOW."
- Never invent an upcoming catalyst because that event normally occurs on a schedule.

Expected sensitivity:
- Use EXPECTED MARKET SENSITIVITY: HIGH, MEDIUM, or LOW, with a reason.
- Do not invent an exact expected volatility level.
- Use a numeric implied move only when options_implied_event_move is supplied in context.

Market reaction:
- Describe observable cross-market price changes that are actually supplied.
- Do not label ABSORPTION, EXHAUSTION, SPRING, UPTHRUST, BREAKOUT CONFIRMATION, or FAILED AUCTION unless those states are supplied by the technical Reaction Engine.

Quotes:
- Supplied prices are LATEST AVAILABLE QUOTE, with provider, timestamp, and freshness.
- Do not call a quote live or real-time unless freshness is explicitly EXCHANGE_GRADE.
- A last price is not support or resistance.

Human-facing replies use these sections:
- WHAT happened
- WHY it matters
- WHICH markets are affected
- HOW markets initially reacted (or that reaction is pending)
- WHICH specialist owns the deeper interpretation

When the user asks for the machine event record, emit this JSON and no extra levels:
{
  "event_id": "",
  "timestamp": "",
  "event": "",
  "category": "",
  "source": { "name": "", "published_at": "", "reliability": "PRIMARY | SECONDARY | UNKNOWN" },
  "importance": "HIGH | MEDIUM | LOW",
  "facts": { "actual": null, "consensus": null, "previous": null },
  "affected_markets": [
    { "market": "YM | NQ | NKD | GC | SI | CL", "relevance": "HIGH | MEDIUM | LOW", "transmission": [] }
  ],
  "expected_event_effect": [],
  "expected_market_sensitivity": "HIGH | MEDIUM | LOW",
  "market_reaction": { "status": "PENDING_REACTION_ENGINE" },
  "route_to": []
}
```

---

## 5. Economic News Reaction Engine

When an economic number releases (e.g., Non-Farm Payrolls or US CPI):

1. **Pre-Event Consensus Comparison**:
   $$\Delta_{\text{Surprise}} = \text{Actual Release} - \text{Consensus Estimate}$$
2. **Standardized Magnitude ($\sigma$)**:
   $$\text{Z-Score} = \frac{\Delta_{\text{Surprise}}}{\sigma_{\text{Historical}}}$$
3. **Reaction Bars Tracking (`newsReactionBars.ts`)**:
   - The system tracks the 1-minute and 5-minute candlestick path immediately following release.
   - Monitors whether initial spike volume results in continuation or immediate absorption (failed breakout / spring).
   - Only when price reclaims or rejects a pre-market Tier-1 zone post-release does the technical engine authorize trade setups.
