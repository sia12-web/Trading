# 👥 05. Team Tape ("Team Taoe"), Questrade & Copy Advice Engine

> **NYC Team Tape (Questrade) See-Only Signals, Stock-to-Index Risk Transfer, and Peer Tape Brief**  
> **Source Files**: [`lib/trading/teamTape.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/teamTape.ts), [`lib/trading/questradeBook.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/questradeBook.ts), [`lib/trading/questradeTransfer.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/questradeTransfer.ts), [`lib/trading/peerTapeBrief.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/peerTapeBrief.ts), [`supabase/migrations/20260816_team_signals.sql`](file:///c:/Users/shahb/myApplications/Trading/supabase/migrations/20260816_team_signals.sql)

---

## 1. What is the Team Tape?

The **Team Tape** (referred to in operational communications as "Team Tape" or colloquially typed as "Team Taoe") is TradePulse's live **NYC Questrade Equity Signal Feed**:

```
 ┌────────────────────────────────────────────────────────┐
 │        NYC PEER TRADING DESK (QUESTRADE BOOK)          │
 │    Executes US Equities (NVDA, AAPL, MSFT, TSLA, etc.) │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │          TEAM TAPE INGESTION WEBHOOK & API             │
 │          (/api/trading/team-tape/ingest)               │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │            "SEE-ONLY" FILTER & DB PERSISTENCE          │
 │       Stored in public.team_signals (Supabase)         │
 │     *NEVER BURNS AN ATTEMPT* | *NEVER AUTO-FILLS*      │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │               TEAM COPY ADVICE ENGINE                  │
 │  Translates stock thesis into Futures Index Tickets    │
 │   - Checks Clocked-In Status                           │
 │   - Evaluates remaining fill capacity (0..3)           │
 │   - Sizes fixed risk ($400 → $250 → $150)              │
 │   - Calculates 1.5R Target on DOW or NASDAQ            │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Principles: The "See-Only" Mandate

1. **A Team Stock Fill Never Burns a Session Attempt**:
   - The desk's primary attempt ladder (2/2/2 across OR15, OR30, IB with a 3-trade daily cap) applies strictly to trades **placed by the trader**.
   - Team executions arriving from the Questrade feed are purely informational.
2. **Never an Automatic Futures Fill**:
   - A team stock execution is **never** automatically mirrored into CME futures or personal accounts.
   - The platform never executes orders autonomously without trader intent.
3. **Their Share Count is Their Own Book**:
   - A team trader buying 5,000 shares of AMD does not mean the futures trader trades 5 contracts. The trader sizes according to their own dollar risk budget ($400, $250, or $150) on an equity index (DOW or NASDAQ).

---

## 3. Team Tape Ingestion Pipeline (`/api/trading/team-tape/ingest`)

External execution webhooks from the Questrade book are ingested via `/api/trading/team-tape/ingest` and parsed by `parseTeamTapeIngest()`:

### Validation Rules:
1. **Symbol Verification (`isTeamTapeSymbol`)**:
   - Must be a valid US stock ticker (1 to 5 capital letters, optional class suffix e.g., `BRK.B`).
   - Options contracts, OTC penny stocks, and foreign exchange tickers are rejected.
2. **Side Normalization (`parseTeamTapeSide`)**:
   - Long variants: `BUY`, `LONG`, `BTO` (Buy to Open), `BTC` (Buy to Close), `COV` (Cover) $\rightarrow$ mapped to **`BUY`**.
   - Short variants: `SELL`, `SHORT`, `STC` (Sell to Close), `STO` (Sell to Open) $\rightarrow$ mapped to **`SELL`**.
3. **Quantity and Entry Verification**: Both `quantity` and `entryPrice` must be strictly positive numbers ($> 0$).
4. **Default 1.5R Take-Profit (`teamTapeTarget1_5R`)**:
   - If the team execution includes a stop loss but no explicit take-profit, the engine automatically projects a **`1.50 R`** target:
     $$\text{Target (Long)} = \text{Entry} + 1.5 \times (\text{Entry} - \text{Stop})$$
     $$\text{Target (Short)} = \text{Entry} - 1.5 \times (\text{Stop} - \text{Entry})$$

---

## 4. The Team Copy Advice Engine (`buildTeamCopyAdvice`)

When a trader inspects a team signal on the dashboard, the engine evaluates whether copying the trade onto CME futures is legally permitted under current risk parameters:

### Copy Decision States:

| Condition | `canCopy` | UI Headline | Advisory Directive |
| :--- | :---: | :--- | :--- |
| **Clock Cutoff Exceeded** | `false` | **"Do not copy. Flatten now."** | Mandatory flatten cutoff reached (16:59 ET regular / 12:59 ET holiday). Close all positions and cancel working orders. |
| **Daily Risk Cap Reached** | `false` | **"Do not copy — risk limit reached."** | 3 fills have already landed today or DLL has been reached. No size permitted until 18:00 ET session roll. |
| **Not Clocked In** | `false` | **"Clock in first."** | Trader must clock in on the desk before taking risk. Pick ONE NYC index (DOW or NASDAQ) on the same side. |
| **Risk Checks Passed** | `true` | **"You may copy."** | **Size \$[Risk Dollars] on DOW or NASDAQ (one only, same side). Close at 1.5R or flatten at 16:59 ET.** |

---

## 5. Stock-to-Index Risk Transfer Mapping (`questradeTransfer.ts`)

When copying an individual stock setup to CME Micro Futures, the engine translates the equity price volatility into index risk:

```typescript
export function stockRiskPct(entry: number, stop: number | null): number | null {
  const e = Number(entry);
  const s = Number(stop);
  if (!(e > 0) || !(s > 0) || e === s) return null;
  return Math.round((Math.abs(e - s) / e) * 10000) / 10000; // e.g. 0.0215 (2.15%)
}
```

1. **Index Selection (`suggestFuturesIndex` / `suggestTradeifyIndex`)**:
   - Tech, semiconductor, and software stocks (e.g., `NVDA`, `AAPL`, `MSFT`, `AMD`, `GOOGL`, `META`) $\rightarrow$ Mapped to **`NASDAQ` (`MNQ`)**.
   - Industrial, healthcare, banking, and cyclical stocks (e.g., `CAT`, `BA`, `JPM`, `UNH`, `GS`, `HD`) $\rightarrow$ Mapped to **`DOW` (`MYM`)**.
2. **Synthetic Stop Distance**:
   - The stock's risk percentage ($\Delta P_{\text{stock}} / P_{\text{stock}}$) is applied to the current index level to establish an equivalent structural stop on the index future.
3. **Fixed Dollar Sizing**:
   - The contract count is calculated strictly against the trader's remaining dollar ladder step ($400, $250, or $150).

---

## 6. The Peer Tape Brief: DOW ↔ NASDAQ Twin Tape (`peerTapeBrief.ts`)

In addition to individual equity signals, the desk evaluates the **NY Twin Tape** (DOW vs. NASDAQ) to determine market conviction:

```
┌────────────────────────────────────────────────────────┐
│ PEER TAPE BRIEF (Twin Context — Never Trade Levels)    │
│ Primary: NASDAQ | Twin Peer: DOW                       │
├────────────────────────────────────────────────────────┤
│ - NASDAQ Gap/Change: +0.65% · DOW Gap/Change: +0.42%   │
│ - Lean: CONFIRM BULLISH (Both leaning up)              │
│ - Conviction: Normal position sizing authorized        │
└────────────────────────────────────────────────────────┘
```

### Peer Lean Classifications:
1. **`confirm_bull`**: Both DOW and NASDAQ gap or change $\ge +0.12\%$. Confirms broad-market institutional buying pressure. Normal conviction authorized.
2. **`confirm_bear`**: Both DOW and NASDAQ gap or change $\le -0.12\%$. Confirms broad-market institutional selling pressure. Normal conviction authorized.
3. **`diverge`**: One index is green while the other is red (e.g., tech rallying while cyclicals dump). Signals sector rotation and mixed participation. **Directive: Prefer fewer levels, favor WATCH over PRIMARY, and demand strict CVD absorption before entering.**
4. **`neutral`**: Price movement within noise threshold ($< 0.12\%$). Peer provides no strong signal.

### ⚠️ The Non-Negotiable Peer Tape Rule:
> **Never copy peer prices as trade levels!**  
> All trade levels for NASDAQ must be derived strictly from NASDAQ candles, volume profiles, and AVWAP. Never paste a Dow support level onto a Nasdaq chart, and vice versa. Use the peer tape **only** for conviction confirmation vs. divergence.
