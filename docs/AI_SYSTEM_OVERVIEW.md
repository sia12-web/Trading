# AI System Overview — How Every AI Works in TradePulse

> Complete map of Chart Leo AI, Situations, Notes, Fundamentals agents, and Desk News AI.  
> Written from the live codebase (routes, prompts, storage, and data flow).

---

## 1. Executive verdict

TradePulse does **not** run one unified multi-agent brain. It runs **three AI product stacks** plus one coherent Leo subsystem for chart rules:

| Stack | What it is | Unified with Chart Leo? |
|-------|------------|-------------------------|
| **Chart Leo AI + Situations + Notes** | One execution / desk copilot with two rule ledgers | **Yes — one system** |
| **Fundamentals** | Five specialist macro agents (Oil, Gold, NQ, Dow, Nikkei) | **No — parallel stack** |
| **Desk News + News AI (“Leo Macro”)** | News wire + separate macro chat | **No — mostly isolated** |

What they share today:

- Claude / OpenAI streaming helpers (`streamClaudeResponse`, `streamOpenAIResponse` in `lib/ai/leoAssistant.ts`)
- Some market-data clients (Finnhub, Yahoo)
- Auth via `getOrCreateUser`

What they do **not** share:

- Prompts, memory, market IDs, orchestration, or a common agent bus
- Fundamentals state is **not** injected into Chart Leo
- Desk News headlines are **not** injected into Chart Leo or Fundamentals (only calendar → News AVWAP level reaches the chart)

---

## 2. Big-picture architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  STACK A — Chart Leo family (ONE agent)                                  │
│                                                                          │
│   /dashboard/chart  →  Leo AI panel                                      │
│         │                                                                │
│         ├─ arms DESK_ALERT / LTM     →  /dashboard/notes                 │
│         └─ arms CONDITIONAL / SIT    →  /dashboard/situations            │
│                                                                          │
│   API: POST /api/trading/leo/chat                                        │
│   Core: lib/ai/leoAssistant.ts + leoRules.ts + leoLongTermMemory.ts      │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  STACK B — Fundamentals (FIVE agents, cloned per market)                 │
│                                                                          │
│   /dashboard/fundamentals?market=CL|GC|NQ|YM|NKD                         │
│   APIs: /api/fundamentals[/{market}]/{chat,analyze}                       │
│   Core: lib/fundamentals/*AnalystConfig|Engine|StateStore                 │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  STACK C — Desk News + News AI                                           │
│                                                                          │
│   /dashboard/news  →  cards/hazards + “Leo Macro & News AI” chat         │
│   APIs: GET /api/trading/desk-news , POST /api/trading/news-ai           │
│   Core: lib/trading/deskNews.ts , deskNewsHazard.ts , newsCatalystVwap   │
│                                                                          │
│   Weak link → Chart: calendar hazard → News AVWAP level → Leo context    │
└──────────────────────────────────────────────────────────────────────────┘

Shared plumbing only: Claude/OpenAI streams + Finnhub/Yahoo + auth
```

---

## 3. Stack A — Chart Leo AI, Situations, and Notes

This is the cleanest part of the AI architecture: **one agent, three surfaces**.

### 3.1 Chart Leo AI (the agent)

| Piece | Location |
|-------|----------|
| UI | `app/dashboard/chart/components/LeoAssistantPanel.tsx` |
| Chart host | `TradingChart.tsx` builds `leoContext` and mounts the panel |
| Chat API | `POST /api/trading/leo/chat` → `app/api/trading/leo/chat/route.ts` |
| Prompt builder | `buildLeoSystemPrompt()` in `lib/ai/leoAssistant.ts` |
| Playbook UI | `WyckoffRulesPanel.tsx` (Wyckoff 22 Rules tab inside Leo) |

**Role:** institutional day-trading execution desk assistant. Leo is not a macro research bot. It reasons over **live chart telemetry** and arms/evaluates desk rules.

**Panel tabs:**

1. **CHAT** — conversation, voice, armed-rules tray, live evaluation loop  
2. **STRATEGY_RULES** — static Wyckoff 22 Rules reference + audit buttons  

Situations and Notes are **not** separate Leo tabs; they are dashboard pages over the same rules Leo writes.

### 3.2 What Leo sees each turn (context pipeline)

`TradingChart` assembles `LeoChatContext`, then `/api/trading/leo/chat` enriches it before the prompt is built:

1. Live Databento CME quote (overrides stale client price when available)
2. Candlestick patterns over recent bars
3. Price-questioning / range-volume comparison (when session active)
4. Cross-market volatility + radar report
5. Chart structure already in context: instrument, session, FRVP, AVWAP, IB/OR, drawings, CVD/order flow, open position, selected data points, long-term memories, optional News AVWAP catalyst level

`buildLeoSystemPrompt(ctx)` turns that into a large system prompt with:

- Wyckoff / auction / CVD playbook constraints
- Zero-hallucination rule (numbers must come from telemetry)
- Notes vs Situations distinction
- Allowed `<execute>` directive schemas
- Current instrument, session, position, and attached chart facts

### 3.3 Models and fallback

Order of preference (Leo chat, Fundamentals chat, and News AI all reuse the same stream helpers):

1. Anthropic Claude via `LLM_PROPOSER_MODEL` (or Claude 3.7 / 3.5 Sonnet defaults)
2. OpenAI `gpt-4o` / `gpt-4o-mini` fallback
3. Heuristic desk fallback text if no API keys are configured

### 3.4 How Leo differs per market

Leo is **one agent parameterised by chart instrument**, not five separate specialists.

Chart instruments: `DOW | NASDAQ | NIKKEI | GOLD | CRUDE`

Per-market differences:

| Behavior | How it varies |
|----------|----------------|
| Chat history | In-memory `leoHistoryByInstrument` switches with the tab |
| Armed rules | `leo_armed_rules_{MARKET}` in localStorage |
| Session profile | NYC desk language for US names; Tokyo / ASIA for NIKKEI |
| Default SL/TP language & touch tolerances | Different point sizes per market |
| Session expiry of armed rules | NYC 16:00 ET vs Tokyo close for NIKKEI |
| Default seeded situation | e.g. DOW 40 pts, NASDAQ 20, GOLD 5, CRUDE 0.5, NIKKEI 100 |

Same Wyckoff/auction persona for all five desks.

### 3.5 Directives — how Leo creates Situations and Notes

Leo may append machine-readable blocks:

```xml
<execute>
{ "action": "ARM_DESK_ALERT", ... }
</execute>
```

Parsed by `parseLeoDirectives()` and applied in `LeoAssistantPanel`.

| Directive | Meaning | Lands in |
|-----------|---------|----------|
| `ARM_DESK_ALERT` / `ARM_TELEGRAM_ALERT` | Price / level alarm | **Notes** |
| `SAVE_LONG_TERM_MEMORY` | HTF memory zone | **Notes** (memories) |
| `ARM_CONDITIONAL_ENTRY` | “If level + pattern, then watch / brackets” | **Situations** |
| `ARM_TRENDLINE_STRATEGY` | Trendline breakout / retest system | **Situations** |
| `ARM_STAGNATION_RULE` | Flatten if not in profit after N minutes | Situations + panel |
| `CLOSE_POSITION` | Immediate flatten instruction | Execution path |

### 3.6 Situations (`/dashboard/situations`)

| Piece | Detail |
|-------|--------|
| Page | `app/dashboard/situations/page.tsx` |
| Sidebar hint | “Per-market Leo rules” |
| Storage | All non-alert rule types inside `leo_armed_rules_*` |
| Rule types | `CONDITIONAL_ENTRY`, `MARKET_SITUATION`, trendline / stagnation variants |

**Meaning:** multi-condition **hypotheses** Leo (or you) armed — e.g. “at yesterday FRVP LVN, if bullish engulfing, track reaction with SL/TP.”

Evaluation happens on the **chart client** (timer / tick loop in Leo panel + chart overlays), not inside the LLM every second. When conditions fire, Leo can notify / surface the situation.

### 3.7 Notes (`/dashboard/notes`)

| Piece | Detail |
|-------|--------|
| Page | `app/dashboard/notes/page.tsx` |
| Sidebar hint | “Alarms & level alerts” |
| Storage | `DESK_ALERT` rows in `leo_armed_rules_*` + `leo_long_term_memories_v1` + `leo_memory_notifications_v1` |

**Meaning:** simple **notices / alarms** and longer-lived HTF memory zones (“watch this level”), not full if-then trade systems.

Chart proximity evaluation can chime (Web Audio) and write notification logs when a memory zone is visited.

### 3.8 Storage map (Stack A)

| Key / event | Module | Contents |
|-------------|--------|----------|
| `leo_armed_rules_DOW` … `_NIKKEI` | `lib/trading/leoRules.ts` | Situations + desk alerts |
| `leo_long_term_memories_v1` | `lib/trading/leoLongTermMemory.ts` | HTF zones |
| `leo_memory_notifications_v1` | same | Visit / trigger log |
| Events `leo-rules-updated`, `leo-memories-updated`, … | cross-tab sync | UI refresh |

Optional API: `GET/POST/DELETE /api/trading/leo/memories` (process-local fallback; chart/notes primarily use browser storage).  
Telegram path: `POST /api/trading/leo/notify`.

### 3.9 End-to-end Leo family flow

```text
Trader on NASDAQ chart talks to Leo
        │
        ▼
POST /api/trading/leo/chat
  ← messages + chartContext (price, FRVP, AVWAP, drawings, position, LTM, …)
  ← server injects Databento quote, patterns, cross-market radar
        │
        ▼
buildLeoSystemPrompt(ctx) → Claude/OpenAI stream
        │
        ▼
Reply (+ optional <execute>)
        │
        ├─ ARM_DESK_ALERT / SAVE_LONG_TERM_MEMORY  → Notes
        └─ ARM_CONDITIONAL_ENTRY / …               → Situations
        │
        ▼
localStorage keyed by market
        │
        ▼
Client evaluation loop on chart ticks
  → chimes, banners, Telegram notify, overlays
```

**Important asymmetry:** long-term memories are injected into the next Leo prompt; the full live list of armed Situations is evaluated client-side and is **not** fully re-dumped into every system prompt (beyond chat history / what the trader attaches).

---

## 4. Stack B — Fundamentals (five specialist agents)

### 4.1 Purpose

Fundamentals is a **research / macro context desk**, not the execution copilot. Each market has its own analyst persona that maintains driver/pillar state, evaluates catalysts, and chats about that market’s fundamental regime.

UI: `/dashboard/fundamentals?market=CL|GC|NQ|YM|NKD`

### 4.2 Agents by market

| UI market | Futures code | Config / engine / store | Focus |
|-----------|--------------|-------------------------|-------|
| Oil (default) | `CL` | `oilAnalyst*` | Supply, demand, inventories, OPEC+, curve |
| Gold | `GC` | `goldAnalyst*` | Real yields, USD, CB/ETF/CFTC/COMEX |
| Nasdaq | `NQ` | `nasdaqAnalyst*` | Fed/rates, earnings, semis, breadth, VXN |
| Dow | `YM` | `dowAnalyst*` | Cyclicals, DJIA contributions, rotation/credit |
| Nikkei | `NKD` | `nikkeiAnalyst*` | BoJ, USD/JPY, Tokyo session, constituents |

Each stack is largely **cloned**: config (system prompt + presets) + engine (`evaluate*Event`) + in-memory state store + dashboard/chat UI + API routes.

### 4.3 APIs

| Route family | Role |
|--------------|------|
| `GET/POST /api/fundamentals` (+ market variants) | Load / refresh state |
| `POST /api/fundamentals/.../analyze` | Event evaluation → structured JSON |
| `POST /api/fundamentals/.../chat` | Specialist chat (prepends that market’s system prompt + live state) |

Chat routes reuse Leo’s Claude/OpenAI stream helpers but **not** Leo’s chart prompt or rules storage.

### 4.4 Data & persistence

- Yahoo quotes, Finnhub general news (filtered per market), some FRED / Yahoo RSS / live econ helpers
- State lives in **process memory** (`*StateStore.ts` singletons), not a shared agent bus
- `formatTodays*FundamentalStateText()` exists and looks “for Leo,” but **Chart Leo never imports it** — only Fundamentals UI / test scripts use it today

### 4.5 Market ID mismatch vs Leo

| Leo / Desk News | Fundamentals |
|-----------------|--------------|
| `DOW` | `YM` |
| `NASDAQ` | `NQ` |
| `GOLD` | `GC` |
| `CRUDE` | `CL` |
| `NIKKEI` | `NKD` |

Same desks, different codes — another sign these stacks were built in parallel.

---

## 5. Stack C — Desk News and News AI

### 5.1 Desk News wire

| Piece | Location |
|-------|----------|
| UI | `/dashboard/news` — tabs ALL / DOW / NASDAQ / NIKKEI / GOLD / CRUDE |
| API | `GET /api/trading/desk-news` |
| Core | `lib/trading/deskNews.ts`, `deskNewsHazard.ts` |

Builds tagged headline cards + high-impact calendar hazards from Finnhub (and fallbacks). Soft-fails to empty/fallback calendars when providers are down.

### 5.2 News AI (“Leo Macro & News AI”)

| Piece | Location |
|-------|----------|
| UI | `DeskNewsAiAssistant.tsx` on the news page |
| API | `POST /api/trading/news-ai` |
| Prompt | Separate macro/news persona in the news-ai route |

This is a **third chat agent**. It reuses the “Leo” brand and the same stream helpers, but it does **not** call `/api/trading/leo/chat`, does not read Situations/Notes storage, and does not load Fundamentals state.

### 5.3 The only real bridge into Chart Leo

```text
Desk calendar (high impact)
    → deskNewsHazard
    → newsCatalystVwap on the chart
    → LeoChatContext.newsCatalystVwap
    → Leo sees a News AVWAP *level*, not the headline narrative
```

Fundamentals does **not** consume Desk News cards; each Fundamentals store re-fetches Finnhub independently.

---

## 6. How the pieces relate (and where they don’t)

### 6.1 What is unified

```text
Chart Leo AI  ←→  Situations  ←→  Notes
     (same agent, same localStorage family, same chat API)
```

### 6.2 What is parallel / unfinished

| Expected mental model | Actual code |
|-----------------------|-------------|
| Fundamentals agents brief Leo before trades | Formatters exist; **Leo never loads them** |
| Desk News feeds Leo and Fundamentals | Only calendar → News AVWAP reaches Leo; Fundamentals isolated |
| “Leo Macro” on News is Chart Leo | **Separate** prompt + route |
| One market ID scheme everywhere | `DOW` vs `YM`, `CRUDE` vs `CL`, etc. |
| Shared long-term AI memory | Leo = browser localStorage; Fundamentals = RAM; News = none |

### 6.3 Name collisions to ignore

| Name | Actual meaning |
|------|----------------|
| Chart **Leo AI** | Stack A execution copilot |
| News **“Leo Macro”** | Stack C news chat (different agent) |
| Dalton `deskSituation` / CALL | Desk advisory math — **not** Leo Situations |
| `deskSessionNotes` | Telegram session copy — **not** Notes dashboard |

---

## 7. Per-market AI responsibility matrix

| Market | Chart Leo | Situations / Notes | Fundamentals agent | Desk News tagging |
|--------|-----------|--------------------|--------------------|-------------------|
| Dow / YM | Yes (param) | `leo_armed_rules_DOW` | Dow Macro agent | DOW keywords + calendar |
| Nasdaq / NQ | Yes (param) | `leo_armed_rules_NASDAQ` | Nasdaq Macro agent | NASDAQ keywords + calendar |
| Gold / GC | Yes (param) | `leo_armed_rules_GOLD` | Gold Macro agent | GOLD keywords + calendar |
| Crude / CL | Yes (param) | `leo_armed_rules_CRUDE` | Oil Fundamental agent | CRUDE keywords + calendar |
| Nikkei / NKD | Yes (param, ASIA session) | `leo_armed_rules_NIKKEI` | Nikkei Macro agent | NIKKEI keywords + BoJ calendar |

---

## 8. Runtime sequence examples

### 8.1 “Leo, alert me if we hit yesterday NYC LVN”

1. Chart Leo chat → `/api/trading/leo/chat`
2. Prompt includes chart levels (e.g. short-term money / Y-VAL)
3. Leo confirms and emits `ARM_DESK_ALERT`
4. Panel saves into `leo_armed_rules_{instrument}` as `DESK_ALERT`
5. Notes page shows the alarm; chart loop watches price and can chime / Telegram

### 8.2 “If we get a bullish engulfing at FRVP LVN, track it 1:2”

1. Same Leo chat path
2. Leo emits `ARM_CONDITIONAL_ENTRY` with pattern + target reference + brackets
3. Stored as a Situation for that market
4. Situations page lists it; chart evaluates pattern+level; fires when conditions match

### 8.3 “What’s the oil fundamental picture after EIA?”

1. Open Fundamentals → CL
2. Oil state store / analyze / chat APIs
3. Oil Analyst prompt + pillar state — **Leo on the chart is not involved**

### 8.4 “Summarize today’s high-impact news for Nasdaq”

1. Desk News page / News AI chat → `/api/trading/news-ai`
2. Finnhub headlines + calendar + quotes in that prompt
3. Chart Leo only learns about a catalyst if a high-impact event becomes a News AVWAP on the chart

---

## 9. Key source files (quick index)

### Chart Leo family
- `app/dashboard/chart/components/LeoAssistantPanel.tsx`
- `app/dashboard/chart/components/WyckoffRulesPanel.tsx`
- `lib/ai/leoAssistant.ts`
- `lib/trading/leoRules.ts`
- `lib/trading/leoLongTermMemory.ts`
- `app/api/trading/leo/chat/route.ts`
- `app/api/trading/leo/memories/route.ts`
- `app/api/trading/leo/notify/route.ts`
- `app/dashboard/situations/page.tsx`
- `app/dashboard/notes/page.tsx`
- `docs/LEO_AI_AND_AUDIO_ALERTS.md`

### Fundamentals
- `app/dashboard/fundamentals/page.tsx` (+ `gold/`, `nasdaq/`, `dow/`, `nikkei/`)
- `lib/fundamentals/*AnalystConfig.ts`
- `lib/fundamentals/*AnalystEngine.ts`
- `lib/fundamentals/*StateStore.ts`
- `app/api/fundamentals/**`
- `types/fundamentals.ts`

### Desk News
- `app/dashboard/news/page.tsx`
- `app/dashboard/news/components/DeskNewsAiAssistant.tsx`
- `lib/trading/deskNews.ts`
- `lib/trading/deskNewsHazard.ts`
- `lib/chart/newsCatalystVwap.ts`
- `app/api/trading/desk-news/route.ts`
- `app/api/trading/news-ai/route.ts`

---

## 10. Bottom line

1. **Chart Leo AI** is the desk execution copilot on the chart.  
2. **Situations** and **Notes** are ledgers of rules that **same Leo** arms and evaluates — not separate AIs.  
3. **Fundamentals** is five specialist macro agents with their own UIs, prompts, and in-memory state — intended to brief the desk, but **not wired into Leo**.  
4. **Desk News** is a news/calendar product; its chat is a separate “Leo Macro” agent. The only automatic bridge into Chart Leo is **News AVWAP from high-impact calendar events**.  
5. Shared LLM streaming makes the products *feel* unified; the runtime architecture is still **three stacks**, with Stack A (Leo + Situations + Notes) being the only truly integrated AI subsystem.
`)