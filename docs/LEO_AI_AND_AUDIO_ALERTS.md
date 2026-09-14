# Leo AI Assistant, Long-Term Memory & Web Audio Alerts

> **TradePulse Intelligence & Audio Alerting Infrastructure**  
> **AI Copilot**: Leo — Multi-Tier Contextual Trading Assistant  
> **Memory Architecture**: Persistent Higher-Timeframe Long-Term Memory (LTM) Zones  
> **Sound Engine**: Web Audio API Procedural Two-Tone Chime Synthesis (Zero MP3 Assets)  

---

## 1. Leo AI Assistant Architecture

Leo is TradePulse's native AI trading copilot and risk advisor. Unlike generic chatbots, Leo operates with continuous access to live chart state, market structure, open broker positions, and user-defined memory zones.

```mermaid
graph TD
    subgraph Context_Ingestion [Real-Time Context Pipeline]
        LIVE_PRICE[Live Price & Tick Velocity]
        CANDLES[Multi-TF OHLCV History - 1m, 5m, 1D]
        AUCTION[Auction Metrics - IB, OR15, OR30, AVWAP, POC]
        POSITIONS[Open Broker Positions & Working Orders]
        MEMORIES[Active Long-Term Memory Zones & Notes]
        DRAWINGS[User Chart Drawings - Trendlines, Boxes]
    end

    subgraph Leo_Core [Leo Processing Engine - /api/trading/leo/chat]
        PROMPT_BUILDER[Hierarchical Prompt Constructor]
        LLM[Anthropic Claude 3.5 Sonnet / Claude 3 Opus]
        SANITY_FILTER[Trade Desk Rule & Risk Validator]
    end

    subgraph Outputs [Actionable Desk Outputs]
        CHAT_RESP[Conversational Guidance & Playbook Review]
        ALERT_ACTION[Actionable Alert Banner & Proximity Warnings]
        MEM_SYNC[Persistent Zone Storage to Supabase]
    end

    Context_Ingestion --> PROMPT_BUILDER
    PROMPT_BUILDER --> LLM
    LLM --> SANITY_FILTER
    SANITY_FILTER --> Outputs
```

### 1.1 Hierarchical Prompt System
Leo's system prompt (`lib/ai/leoAssistant.ts`) enforces strict trading desk principles:
- **Higher-Timeframe Primacy**: Evaluates Daily (`1D`) structural levels as major institutional pivot zones rather than short-term scalp noise.
- **Auction Market Context**: Evaluates price relative to the 5-Month Anchored VWAP, Day POC, and Initial Balance.
- **Disciplined Execution**: Discourages overtrading, warns when Daily Loss Limits are near, and validates that stop-loss orders are placed at structural levels.

---

## 2. Long-Term Memory (LTM) Architecture

Traders frequently identify critical weekly, monthly, or daily inflection zones that must remain remembered for days or weeks.

```
┌────────────────────────────────────────────────────────┐
│  🧠 LEO MEMORY: Major Weekly Absorption [🔔 ALARM ON]  │
├────────────────────────────────────────────────────────┤
│  Price High: 44,850.00                                 │
│  Price Low:  44,720.00                                 │
│  Notes: Watch for buyer absorption; break targets POC. │
└────────────────────────────────────────────────────────┘
```

### 2.1 Memory Zone Structure (`lib/trading/leoLongTermMemory.ts`)
Each memory zone stores:
- `id`: Unique identifier.
- `instrument`: Associated asset (`DOW`, `NASDAQ`, `GOLD`, etc.).
- `priceHigh` & `priceLow`: Zone boundaries.
- `purpose`: High-level tactical description (e.g. "Weekly Absorption Zone").
- `notes`: Detailed trader notes and game plan.
- `alarmEnabled`: Boolean flag triggering audio chimes upon visit.
- `lastAlertAt`: Timestamp of the last alert (enforces a 90-second debounce cooldown).

### 2.2 1-Click Zone Creation
- When the trader draws a **Range Box** on the chart, the drawing toolbar displays a `🧠 Activate Long-Term Memory` button.
- Clicking this instantly attaches memory metadata, prompts for tactical notes, activates the audio alarm, and persists the zone to Supabase and browser cache.

---

## 3. Real-Time Proximity Scanner & Web Audio Chime Synthesis

### 3.1 Proximity Scanner Logic
Every incoming price tick is evaluated against active memory zones:
1. Checks if `price >= memory.priceLow && price <= memory.priceHigh`.
2. Verifies that `memory.alarmEnabled === true`.
3. Checks that `Date.now() - memory.lastAlertAt > 90,000ms` (cooldown guard).
4. If triggered:
   - Sets `memory.lastAlertAt = Date.now()`.
   - Triggers the Web Audio synthesizer.
   - Pushes an actionable alert banner to the HUD and Dashboard Notifications center.

### 3.2 Web Audio API Procedural Synthesizer (`lib/chart/soundEffects.ts`)
Rather than relying on external MP3/WAV files (which suffer from browser caching issues, network latency, and autoplay blocking), TradePulse generates an authentic **TradingView-style dual-tone chime** directly in memory using the Web Audio API (`AudioContext`):

```typescript
export function playTradingViewChime(): void {
  const ctx = getAudioContext()
  const now = ctx.currentTime

  // Tone 1: Fundamental A5 (880 Hz)
  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(880, now)
  gain1.gain.setValueAtTime(0.28, now)
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.38)
  osc1.connect(gain1); gain1.connect(ctx.destination)
  osc1.start(now); osc1.stop(now + 0.40)

  // Tone 2: Harmonic E6 (1318.51 Hz) + Upper Shimmer (1760 Hz)
  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1318.51, now + 0.12)
  gain2.gain.setValueAtTime(0.32, now + 0.12)
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.58)
  osc2.connect(gain2); gain2.connect(ctx.destination)
  osc2.start(now + 0.12); osc2.stop(now + 0.60)
}
```

- **Acoustic Characteristics**: Two pure sinusoidal tones spaced by a perfect fifth (A5 -> E6), producing the crisp, pleasant, and instantly recognizable TradingView alert chime.
- **Latency**: Sub-millisecond instantaneous trigger.
- **Zero Assets**: Operates completely offline with 0KB of downloaded audio assets.

---

## 4. Notifications Center & In-Chart Banners

- **Floating Alert Banners**: When price breaches a memory zone, a high-contrast toast banner appears at the top of the chart with an `Ask Leo` quick-action button, instantly populating Leo's chat with the memory context.
- **Dashboard Notifications Center (`DashboardNotifications.tsx`)**: An embedded live feed on the dashboard home page logging all recent breach events, chime test triggers, and active memory zone management.

---

## 5. Session Playbook Lifecycle Window (09:15 AM EDT Cutoff)

Trading desks prepare and debate playbooks during pre-market liquidity formation. Once the New York cash open approaches, institutional participant flows shift drastically:

- **Pre-Market Viability Window (00:00 - 09:15 AM EDT)**:
  - The `Discuss Playbook` trigger is actively available.
  - Traders review overnight inventory, Initial Balance projections, CME dealer Gamma Flips, and institutional stop pools with Leo.
- **09:15 AM Cutoff (`isPlaybookDiscussionEligible()`)**:
  - Exactly at 09:15 AM EDT (15 minutes prior to cash equity open at 09:30 AM), pre-market playbook discussions are **locked**.
  - **Rationale**: Cash open institutional order flows (dealer hedging, CTA trend liquidations, index rebalancing) override overnight models. Attempting to trade static pre-market theses into high-velocity open imbalances without live reaction validation leads to adverse selection.
  - **Dynamic Desk Transition**: The UI displays a live countdown timer until 09:15 AM. Once passed, the prompt badge transitions to `🔒 Locked (09:15 AM Cutoff Passed - Live Reaction Mode Active)`.

---

## 6. AI Stacked Hedging & CME Big Money Flow Integration

The Leo Assistant Panel embeds the **AI Stacked & Hedging Engine** directly into the workstation:

```
┌────────────────────────────────────────────────────────────────────────┐
│  ⚡ AI STACKED HEDGING & CME BIG MONEY FLOWS                           │
├────────────────────────────────────────────────────────────────────────┤
│  Dealer & CTA Triggers:                                                │
│  • 28,886.34 [HIGH]   PUT WALL          (+126.5 pts) [📌 Attach]       │
│    Dealer Put Wall support; institutional strike pinning & gamma floor.│
│  • 28,929.92 [MED]    CTA LIQUIDATION   (+82.9 pts)  [📌 Attach]       │
│    CTA trend liquidation trigger; systematic momentum forced exits.    │
│  • 29,012.07 [EXTR]   GAMMA FLIP        (+0.8 pts)   [📌 Attach]       │
│    Zero-gamma flip boundary; dealers shift from dampening to chasing.  │
│  • 29,147.05 [HIGH]   CALL WALL         (-134.2 pts) [📌 Attach]       │
│    Dealer Call Wall resistance; upside hedging supply ceiling.         │
└────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Attachment**: Each institutional trigger features a `📌 Attach` button. Clicking attaches the level as an interactive chip inside Leo's prompt box, auto-injecting its strike, distance, and institutional role into the LLM context.
- **Live Reaction Verification**: Playbook levels actively display real-time verification badges (`HELD 75%`, `BROKE`, `RESPECTED`, `CONTESTED`) computed on every incoming 1-minute candle close.

---

## 7. Order Execution & Desk Safety Invariants

### 7.1 AI Never Auto-Exits Positions (Zero Autonomous Closes)
> [!IMPORTANT]
> **Desk Invariant**: Under no circumstance does Leo AI automatically close, exit, or flatten an active broker position. Only the human trader possesses authorization to liquidate or exit positions.

- **Advisory Directives**: If Leo generates a `CLOSE_POSITION` directive or if a **Stagnation Timeout** is reached (e.g. 5 minutes without moving into profit), the system **blocks automated order dispatch**.
- **Actionable Advisory Prompt**: Instead, Leo plays an audio advisory chime, synthesizes speech (`"Leo recommends closing position: reason"`), and posts an advisory card with an explicit warning:
  `⚠️ [LEO EXIT ADVISORY - MANUAL ACTION REQUIRED] Please execute manual exit on your chart toolbar if desired.`

### 7.2 Defensive Bracket & Non-Inversion Geometry
When Leo drafts entry orders (`PLACE_ORDER` / `OPEN_POSITION`), the execution layer enforces strict mathematical boundary validation:
1. **Live Price Requirement**: Orders are rejected immediately if a valid, positive live price cannot be resolved. No stale hardcoded fallbacks are permitted.
2. **Instrument Canonicalization**: Handles all aliases (`NQ`/`MNQ` -> `NASDAQ`, `YM`/`MYM` -> `DOW`, `GC`/`MGC` -> `GOLD`, `CL`/`MCL` -> `CRUDE`, `NKD` -> `NIKKEI`).
3. **Bracket Sanity**:
   - **LONG**: Validates `stopLoss < entryPrice` and `profitTarget > entryPrice`. If inverted, snaps stop loss to `entryPrice - slDist` and target to `entryPrice + tpDist`.
   - **SHORT**: Validates `stopLoss > entryPrice` and `profitTarget < entryPrice`. If inverted, snaps stop loss to `entryPrice + slDist` and target to `entryPrice - tpDist`.
4. **TopstepX Risk Budgeting**: Sized strictly according to the account's $500 Maximum Loss Limit ($50 risk per micro contract).

---

## 8. High-Frequency Memory Crossing & Gap-Through Engine

When price moves rapidly during the New York or London open, ticks can skip discrete price levels between consecutive updates.

### 8.1 Adaptive Crossing Algorithm (`lib/trading/leoLongTermMemory.ts`)
The proximity evaluation engine does not rely solely on static inside-bounds testing:
```typescript
// 1. Adaptive tolerance based on zone width
const span = high - low
const tol = Math.max(1.0, span * 0.05)
const isInside = currentPrice >= (low - tol) && currentPrice <= (high + tol)

// 2. High-speed crossing & gap jump detection
const isCrossing = previousPrice != null && (
  (previousPrice < low && currentPrice > high) ||
  (previousPrice > high && currentPrice < low)
)

if (isInside || isCrossing) {
  // Trigger alarm chime and dispatch alert
}
```
- Tracks `previousPrice` across 250ms tick updates.
- If price jumps from 29,000 to 29,050 over an institutional memory zone at 29,025, `isCrossing` evaluates to `true`, ensuring zero missed triggers during opening breakouts.

---

## 9. Interactive Multiline Chat Interface

The trader input in `LeoAssistantPanel.tsx` is engineered for rapid keyboard workflows:
- **Auto-Expanding Multiline Textarea**: Expands dynamically up to 160px as the trader inputs complex game plans and multi-line theses.
- **Keybindings**:
  - `Enter`: Submits message immediately.
  - `Shift + Enter`: Inserts a clean newline without submitting.
- **Attachment Chips**: Attached CME triggers (Gamma Flips, Put Walls, CTA Liquidations) appear as interactive dismissible tags directly above the input box.
- **Voice-to-Text Support**: Includes Web Speech Recognition integration for hands-free audio dictation during fast-moving trading sessions.

