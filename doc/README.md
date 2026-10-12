# 📖 TradePulse Institutional Trading System Documentation

> **Autonomous Market-Structure Analytics, Multi-Broker Execution, and AI Auditor Platform**  
> **Market Data Core**: CME Globex MDP 3.0 Real-Time & Historical (via Databento) + Yahoo Finance Real-Time Fallback  
> **Execution Venues**: CME Direct Futures, Tradeify Growth ($50k Evaluation), and CMC Markets Canada (CFD / Spread Betting)  
> **Team Intelligence**: NYC Questrade Stock Tape ("Team Tape") & Multi-Market Fundamental Intelligence Bus  
> **AI Auditor Engine**: Leo AI (Claude 3.7 Sonnet / GPT-4o) Market Structure Auditor & Desk News Intelligence Agent  
> **Timezone Standards**: Montreal Time (EDT/EST, UTC-4/UTC-5 / `America/Toronto`) & New York Wall Clock (`America/New_York`)  

---

## 🏛️ Documentation Map & Navigation

This documentation suite provides a comprehensive, production-grade specification of every component, mathematical model, execution rule, data pipeline, and AI prompt powering the TradePulse system.

| Document | Primary Domain | Key Topics Covered |
| :--- | :--- | :--- |
| [**01. System Architecture**](file:///c:/Users/shahb/myApplications/Trading/doc/01_SYSTEM_ARCHITECTURE.md) | **System Topology & Technology Stack** | Next.js 14 App Router, WebSockets/SSE, Supabase DB schema, Databento MDP 3.0 pipeline, TradingView chart canvas, Web Audio sound synthesis, microservices API routing. |
| [**02. Strategy Playbook**](file:///c:/Users/shahb/myApplications/Trading/doc/02_STRATEGY_PLAYBOOK.md) | **Institutional Market Edge & Setups** | The 22 Wyckoff & AMT Rules, The ONLY 4 Valid Trades in the universe, 3-Tier Chart Hierarchy, 8-Step Screen-Reading Sequence, Dalton Day Types, Rotation Factor (RF), Developing POC (dPOC), OR15, OR30, IB60, Dow Asia Compression Edge, Value Acceptance. |
| [**03. Risk & Position Sizing**](file:///c:/Users/shahb/myApplications/Trading/doc/03_RISK_AND_POSITION_SIZING.md) | **Capital Preservation & Tradeify Rules** | Tradeify Growth $50k specification, Daily Loss Limit ($1,250 DLL), Trailing Drawdown ($2,000), Hard Floor ($48,000), Peak EOD Ratchet, Green Day Lock ($700), Progressive Dollar Risk Ladder ($400 → $250 → $150), Contract Sizing Formulas, Tick Snapping. |
| [**04. CME Exchange & Execution**](file:///c:/Users/shahb/myApplications/Trading/doc/04_CME_EXCHANGE_AND_EXECUTION.md) | **CME Globex Futures & Feeds** | CME contract specs (NQ, MNQ, YM, MYM, GC, MGC, CL, MCL, SI, SIL, NKD/NK225, RTY/M2K, 6E/M6E), tick sizes, multipliers, margin, Databento CME feed, CME basis & fair value, Globex & Tokyo trading session clocks. |
| [**05. Team Tape & Questrade**](file:///c:/Users/shahb/myApplications/Trading/doc/05_TEAM_TAPE_AND_QUESTRADE.md) | **Team Tape ("Team Taoe") & Peer Signals** | NYC Team Tape (Questrade), See-Only signal ingestion, Stock-to-Index risk transfer mapping, Team Copy Advice engine, Clock-in enforcement, Peer Tape Brief (DOW ↔ NASDAQ Confirm vs Diverge). |
| [**06. CMC Markets & Fundamentals**](file:///c:/Users/shahb/myApplications/Trading/doc/06_CMC_MARKETS_AND_FUNDAMENTALS.md) | **CMC CFDs & Fundamental Bus** | CMC Markets Canada CAD account performance ledger audit, CFD asset mechanics, Market Intelligence Bus (`market_events`, `market_interpretations`, `market_state_history`), 5 Fundamental Specialist Agents (Nasdaq, Dow, Gold, Crude Oil, Nikkei). |
| [**07. Desk News & Economic Events**](file:///c:/Users/shahb/myApplications/Trading/doc/07_DESK_NEWS_AND_ECONOMIC_EVENTS.md) | **News Intelligence & Event Hazards** | Finnhub news wire ingestion & tagging (MACRO, EARNINGS, GEO, FLOW), Economic calendar hazard engine (Careful 60m / Stand-Aside 15m), News Reaction Bars, Desk News AI Agent (`DESK_NEWS_AGENT`). |
| [**08. Leo AI Architecture & Prompts**](file:///c:/Users/shahb/myApplications/Trading/doc/08_LEO_AI_ARCHITECTURE_AND_PROMPTS.md) | **AI Prompts & Autonomous Auditor** | Leo Auditor doctrine (read-only, no execution, challenger), Screen-reading telemetry injection, Directives & Action Tags, Long-Term Memories, Complete Verbatim System Prompts (Leo, Desk News, 5 Fundamental Specialists, Output Contracts). |
| [**09. Operational Runbook & Cheatsheet**](file:///c:/Users/shahb/myApplications/Trading/doc/09_OPERATIONAL_RUNBOOK_AND_CHEATSHEET.md) | **Trader Workstation Runbook** | Daily session timeline (Montreal / NY / Tokyo), Pre-flight checks, Session open procedures, Cash close flattening protocol, Audio chime index, Keyboard shortcuts, System troubleshooting & fallback modes. |

---

## 🎯 System Philosophy & Core Mandates

1. **Deterministic Execution Over Speculation**:
   - The platform strictly separates **analysis** from **opinion**.
   - No dealer gamma conspiracy theories, no speculative institutional positioning tales ("London is trapped"). Market auction behavior is measured strictly through observable price, volume effort vs. result, and cumulative volume delta (CVD).

2. **Absolute Read-Only Platform Guarantee**:
   - The workstation and its AI assistants (Leo, News AI, Fundamental Specialists) **never place broker orders directly**.
   - The system is an institutional **analytics, telemetry, situational surveillance, and discipline enforcement workstation**. All broker execution occurs through trader confirmation or external broker APIs governed by strict pre-flight risk checks.

3. **Fixed Dollar Risk & Structural Stops**:
   - The dollar risk per trade is strictly capped ($400 on Fill #1, $250 on Fill #2, $150 on Fill #3).
   - Invalidation stops are anchored strictly to **market structure** (Spring low, Upthrust high, Failed Reclaim pivot, Retest floor). Stops are **NEVER widened** under any circumstance.

4. **Zero-Hallucination AI Architecture**:
   - AI models in the system (Leo, Desk News, Fundamental Analysts) operate with strict mathematical and telemetry bounds.
   - If a numerical quote, volume figure, delta reading, or economic result is missing from live feeds, the AI outputs `UNAVAILABLE`. AI agents never synthesize fake numbers, fake trade setups, or ungrounded price levels.

5. **Multi-Horizon Value Synchronization**:
   - The desk operates with a synchronized 3-Tier hierarchy:
     - **Tier 1 (Mandatory Structure)**: Rolling 5-Day Volume Profile (5D POC, HVN, LVN), Yesterday's Profile (VAH, POC, VAL, High, Low), and Overnight Extremes (ONH, ONL, ONPOC).
     - **Tier 2 (Execution Confirmation)**: Candlestick price action, volume effort vs. result, and Cumulative Volume Delta (CVD) absorption.
     - **Tier 3 (Contextual Anchor)**: 5-Month Anchored VWAP (5M AVWAP $\pm1\sigma, \pm2\sigma, \pm3\sigma$) and Cross-Asset Volatility Gauges (`VIX1D`, `OVX`, `GVZ`, `JNIV`). Tier 3 **never** overrides Tier 1.
