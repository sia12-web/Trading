# 📘 SYSTEM EXECUTION & STRATEGY SPECIFICATION GUIDE

> **Institutional Automated Trading Architecture**  
> **Target Account**: Tradeify Growth $50,000 Evaluation & Funded Accounts  
> **Execution Engine**: Hands-Free Autonomous System & Institutional Trader Workstation  
> **Timezone Standard**: Montreal Time (EDT - UTC-4)  

---

## 1. 🏗️ SYSTEM ARCHITECTURE & EXECUTOR OVERVIEW

The system is a **100% deterministic, hands-free execution engine and trading workstation** designed to eliminate human bias, manual delay, and emotional intervention during high-probability trading windows.

```
                  ┌────────────────────────────────────────┐
                  │       AUTOMATED SESSION GATED CLOCK    │
                  │   02:00 AM ET (Asia) | 09:30 AM (RTH)  │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       PRE-FLIGHT RISK CHECKS           │
                  │  Check DLL ($1,250), Drawdown, Attempts│
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │   22-RULE WYCKOFF & AUCTION MARKET EDGE │
                  │ 4 Valid Setups | Tier 1 Frozen Map | 2R │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │     POSITION SIZING & TICK SNAPPING    │
                  │  Calculate Contracts ($400 Risk Limit) │
                  └───────────────────┬────────────────────┘
                                      │
          ┌───────────────────────────┴───────────────────────────┐
          ▼                                                       ▼
┌───────────────────────────┐                           ┌───────────────────┐
│ REAL-TIME DASHBOARD SSE   │                           │ DATABASE JOURNAL  │
│ Web Audio Chimes & Toasts │                           │ Supabase Record   │
└───────────────────────────┘                           └───────────────────┘
```

---

## 2. 🛡️ RISK MANAGEMENT & FUNDING RULE CONSTRAINTS

The trading architecture strictly enforces **Tradeify 50k Growth Rules**:

| Risk Metric | Parameter Level | System Action / Fail-Safe |
| :--- | :--- | :--- |
| **Account Capital** | **$50,000.00** | Evaluation & Funded Base Capital |
| **Fixed Risk Per Trade** | **$400.00** | Strict Step 1 sizing per setup (0.80% of account) |
| **Daily Loss Limit (DLL)** | **$1,250.00** | Immediate circuit-breaker halt if breached |
| **Max Trailing Drawdown** | **$2,000.00** | Absolute liquidation boundary ($48,000 floor) |
| **Green Day Lock** | **+$700.00** | System stops opening new setups once day P&L $\ge +\$700$ |
| **Max Daily Attempts** | **3 Attempts** | Attempt Ladder locks desk after 3 attempts |

---

## 3. 📐 CME MICRO FUTURES POSITION SIZING FORMULA

The position sizer (`lib/trading/positionSizing.ts`) dynamically calculates contract counts so that **dollar risk is fixed at exactly $400** regardless of stop loss distance:

$$\text{Position Size (Contracts)} = \text{Math.round}\left( \frac{\text{Fixed Risk (\$400)}}{\text{Stop Loss Distance (pts)} \times \text{Point Value (\$/pt)}} \right)$$

### Instrument Contract Specification Table

| Instrument | CME Contract | Ticker | Point Value (\$/pt) | Tick Increment | Standard Stop Distance | Risk / Contract | **Default Contract Size** |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Nasdaq-100** | Micro E-mini Nasdaq | `MNQ` | **$2.00** | 0.25 pt | 20.0 pts | $40.00 | **`10 Contracts`** |
| **Dow Jones** | Micro E-mini Dow | `MYM` | **$0.50** | 1.0 pt | 50.0 pts | $25.00 | **`16 Contracts`** |
| **Gold** | Micro Gold | `MGC` | **$10.00** | 0.10 pt | 4.0 pts | $40.00 | **`10 Contracts`** |
| **Russell 2000** | Micro E-mini Russell | `M2K` | **$5.00** | 0.10 pt | 8.0 pts | $40.00 | **`10 Contracts`** |
| **Euro FX** | Micro Euro FX | `M6E` | **$125,000** ($1.25/pip) | 0.0001 | 0.0040 (40 pips) | $50.00 | **`8 Contracts`** |
| **Silver** | Micro Silver (1,000 oz) | `SIL` | **$1,000** | 0.005 | $0.40 (40 cents) | $400.00 | **`1 Contract`** |

---

## 4. 🧠 CORE TRADING STRATEGIES & ENTRY EDGES

The system scans 4 distinct structural market setups across the daily auction:

### 1️⃣ Strategy #1: Dow Asia Narrow Range Compression Breakout (`ASIA`)
* **Execution Window**: **02:00 AM ET (Montreal Time)**
* **Scan Range**: **8:00 PM ET to 2:00 AM ET (20:00 – 02:00 ET)**
* **Compression Filter**: 
  $$\text{Asia Range} = \text{Asia High} - \text{Asia Low}$$
  - **Rule**: If $\text{Asia Range} < 80\text{ points}$, Compression Edge is **ACTIVE** 🟢.
  - If $\text{Asia Range} \ge 80\text{ points}$, Range is too wide $\rightarrow$ **STAND ASIDE** 🔴.
* **Order Placement**:
  - **Buy Stop**: $\text{Asia High} + 20\text{ points}$
  - **Sell Stop**: $\text{Asia Low} - 20\text{ points}$
  - **Stop Loss**: $\text{Asia Midpoint} = \frac{\text{Asia High} + \text{Asia Low}}{2}$
  - **Take Profit**: **`1.50 R`** ($1.50 \times \text{Risk Distance}$)

### 2️⃣ Strategy #2: 15-Minute Open Range Breakout (`OR15`)
* **Execution Window**: **09:45 AM ET (RTH Open)**
* **Establishment Window**: 09:30 AM – 09:45 AM ET (First 15 minutes of RTH).
* **Strategy Mechanics**:
  - Tracks high and low established during the initial 15-minute cash open volatility.
  - Triggers Buy Stop on initiative candle close above OR15 High, or Sell Stop below OR15 Low.
* **Stop Loss**: Opposite boundary of OR15 range (or fixed 20 pts on MNQ).
* **Take Profit**: **`2.00 R`** (2.0x risk distance).

### 3️⃣ Strategy #3: 30-Minute Open Range Midpoint Continuation (`OR30`)
* **Execution Window**: **10:00 AM – 10:30 AM ET**
* **Establishment Window**: 09:30 AM – 10:00 AM ET (First 30 minutes of RTH).
* **Strategy Mechanics**:
  - Calculates the 50% midpoint of the 30-minute opening range.
  - When One-Time-Framing (OTF) buyers hold value above midpoint, places limit/market entry on pull-back to 50% level.
* **Stop Loss**: Below OR30 50% midpoint (20 pts on MNQ).
* **Take Profit**: **`2.00 R`** (2.0x risk distance targeting macro 20-day VPOC/VAH).

### 4️⃣ Strategy #4: Initial Balance 60-Minute Range Rotation (`IB`)
* **Execution Window**: **10:30 AM – 11:30 AM ET**
* **Establishment Window**: 09:30 AM – 10:30 AM ET (First hour range).
* **Strategy Mechanics**:
  - Identifies responsive buyers at IB Low or responsive sellers at IB High when auction shows value area acceptance.
  - Fades extreme when Point of Control (POC) rejects expansion.
* **Stop Loss**: Beyond IB structural extreme + buffer (e.g. 4 pts Gold, 40 pips Euro FX, $0.40 Silver).
* **Take Profit**: **`2.00 R`** (2.0x risk distance targeting IB midpoint / opposite extreme).

---

## 5. 📡 DESK NOTIFICATIONS, SOUND CHIMES & ZERO-TELEMETRY JOURNALING

Whenever an order or setup is triggered:

1. **Zero-Telemetry Local Notification & Web Audio Chime**:
   - Telegram notifications are permanently disabled desk-wide (`telegramConfigured() === false`) to enforce 100% on-platform execution privacy.
   - Real-time alerts stream directly to the local dashboard via Server-Sent Events (SSE) and play zero-latency TradingView-style dual-tone chimes synthesized via the Web Audio API.

2. **Supabase Database Journaling**:
   - Automatically logs trade record with setup name, instrument, entry price, stop loss, take profit, position size, risk dollars, R:R ratio, and execution timestamp.

---

## 6. ⚙️ TICK SNAPPING & PRICE PRECISION MECHANICS

All limit, stop-loss, and take-profit orders pass through the `snapDeskPrice()` utility (`lib/trading/instrumentTicks.ts`):

- **Index Futures (NQ, YM, ES)**: Snapped to whole points / 0.25 pt tick increments.
- **Gold Futures (GC)**: Snapped to 0.10 pt tick increments.
- **Russell 2000 (RTY)**: Snapped to 0.10 pt tick increments.
- **Euro FX (6E)**: Snapped to 0.0001 (1 pip) tick increments.
- **Silver (SI)**: Snapped to 0.005 tick increments.

`snapStopToTick()` and `snapTargetToTick()` guarantee that protective stops and profit targets always remain on the correct side of the market after rounding.

---

## 7. ⚖️ THE "QUESTIONING" AUCTION PRICE CRITIQUE PROTOCOL

Every setup is evaluated by the **Auction Price Critique & "Questioning" Engine** (`lib/trading/priceQuestioning.ts`):

1. **Wholesale vs. Retail Valuation**:
   - Classifies current price relative to multi-horizon POCs (Yesterday NYC POC, Overnight POC, 5D-POC, 5M-AVWAP): `DEEP_DISCOUNT`, `DISCOUNT`, `FAIR_VALUE`, `PREMIUM`, `EXTREME_PREMIUM`.
2. **Session Inventory Reality Check**:
   - Critiques 9:30 AM NY Open entries against overnight participants: *"Why buy at 9:30 AM when Asian and London participants accumulated 30 points lower overnight?"*
3. **6-Point Pre-Trade Self-Audit**:
   - Evaluates Q1 Impulse Trap, Q2 Psychological Magnet, Q3 Liquidity Vacuum, Q4 Time Regulation (Open Drive vs 11:30–13:30 Lunch Doldrums), Q5 Global Inventory, and Q6 Wholesale vs Retail Valuation.
4. **Horizontal S/R Runway & Empirical Velocity Corridor**:
   - Calculates scale-invariant momentum slope ($\Delta P / \Delta t$) with $1.0\times$ Equilibrium, $1.5\times$ Climax, and $0.5\times$ Retest Floor rays.
   - Evaluates overhead resistance runway ratio to reject tight runway traps ($< 1.5:1$ R:R).
5. **NY Session Window Gating**:
   - Pre-trade critique is active strictly during New York pre-market & cash hours (09:00 ET / 09:15 ET to 16:00 ET close).

---

## 8. 🏛️ THE TRADER'S 22-RULE WYCKOFF & AUCTION MARKET THEORY PLAYBOOK

The execution engine and Leo Assistant operate strictly according to the **22-Rule Wyckoff Playbook** (`lib/ai/leoAssistant.ts`, `lib/trading/wyckoffStrategy.ts`):

### 8.1 The 4 Valid Trade Setups (Absolute Universe)
*Only 4 trade setups are valid in the entire execution universe. Everything else MUST be ignored:*

1. **Support: Spring $\rightarrow$ Reclaim $\rightarrow$ LONG**
   - Price sweeps key support boundary (Yesterday VAL, 5D LVN, Overnight Low) and immediately **reclaims** back above support with buying absorption.
   - **Stop Loss**: Strictly below the Spring low.
2. **Support: Breakdown $\rightarrow$ Failed Reclaim $\rightarrow$ SHORT**
   - Price breaks key support, attempts to reclaim, but fails at lower volume/delta.
   - **Stop Loss**: Strictly above the failed reclaim pivot.
3. **Resistance: Upthrust $\rightarrow$ Return Below $\rightarrow$ SHORT**
   - Price sweeps key resistance boundary (Yesterday VAH, 5D HVN, Overnight High) and immediately **returns below** resistance with selling absorption.
   - **Stop Loss**: Strictly above the Upthrust high.
4. **Resistance: Breakout $\rightarrow$ Successful Retest (SOS $\rightarrow$ LPS / SOW $\rightarrow$ LPSY) $\rightarrow$ LONG**
   - Price breaks out with strong volume/initiative, then successfully retests breakout level as new support (Sign of Strength $\rightarrow$ Last Point of Support).
   - **Stop Loss**: Strictly below the retest low.

---

### 8.2 Three-Tier Chart Hierarchy
1. **Tier 1 (Mandatory Key Levels)**:
   - Price action, 5-Day Volume Profile (POC, HVN, LVN), Yesterday's Profile (VAH, POC, VAL, High, Low), Overnight/London (High, Low, POC).
   - **Pre-Market Map Gating**: Levels are permanently **frozen at 09:30 ET cash open**.
2. **Tier 2 (Execution Confirmation)**:
   - Volume (Effort vs. Result), Cumulative Volume Delta (CVD Absorption & Divergence).
3. **Tier 3 (Context Only - Never Overrides Tier 1)**:
   - 5-Month CME Globex Anchored VWAP (AVWAP) and VIX/cross-asset volatility gauges.

---

### 8.3 Institutional Factor Scoring Engine (0–100 Points)
`evaluateSpringOrUpthrustTrendline()` evaluates user-drawn Action/Demand/Supply Trendlines (Hotkey: W or X) connecting Spring or Upthrust origin pivots across 5 institutional factors:
* **Volume Expansion (25 Pts)**: Volume ratio $> 1.2\times$ baseline indicating aggressive institutional participation.
* **CVD Absorption Divergence (25 Pts)**: Positive delta divergence for Spring / Negative delta for Upthrust.
* **Multi-Touch Structural Validation (20 Pts)**: $\ge 2$ structural touches confirming trendline validity.
* **Tier-1 Volume Profile Confluence (20 Pts)**: Confluence with Yesterday VAH/VAL/POC or 5D LVN/HVN.
* **HTF 5-Month AVWAP Alignment (10 Pts)**: Price relation alignment with 5-Month AVWAP trend direction.

#### Grade Classifications:
* **Grade A ($\ge 75$ Pts)**: High Probability Institutional Setup 🟢
* **Grade B ($50-74$ Pts)**: Moderate Setup — Requires Tier-2 CVD confirmation 🟡
* **Grade C ($< 50$ Pts)**: Weak / Speculative Setup — Stand Aside 🔴

---

### 8.4 Strict Risk & 2R Filter Rules
- **Minimum 2R Distance**: Distance to the next major opposing Tier-1 zone must be $\ge 2.0\times$ stop loss distance (`is2RValid`). If distance $< 2\text{R}$, **STAND ASIDE**.
- **Stop Loss = Structural Invalidation**: Stop loss is placed strictly beyond structural extremes. Stops are **never widened or expanded**.
- **No Chop Execution**: Do not trade inside tight Dalton balance ranges without structural sweeps.

---

## 9. 🎯 CROSS-ASSET VOLATILITY GAUGES & GLOBEX SESSION-AWARE 5-MARKET RADAR

The **5-Market Opportunity Radar** (`app/dashboard/chart/components/CrossMarketRadarStrip.tsx`, `lib/trading/crossMarketRadar.ts`) provides continuous market selection across 5 futures benchmarks: **`NQ`**, **`ES`**, **`YM`**, **`GC` (Gold)**, and **`CL` (Crude Oil)**.

### 9.1 Globex Session Awareness & Pre-Market State
- **Session State Recognition**: Dynamically tracks session windows (`CLOSED`, `ASIA`, `LONDON`, `NEW YORK`, `MAINTENANCE`).
- **Closed / Pre-Market Behavior**: When markets are closed or in Globex pre-market, evaluates overnight inventory accumulation (Long/Short % bias) and pre-market structure without generating false intraday trade alerts.

### 9.2 Asset-Specific Volatility Gauges
- **Equities (`NQ`, `ES`, `YM`)**: `VIX` (30-day) & `VIX1D` (1-day 0DTE expected volatility).
- **Crude Oil (`CL`)**: `OVX` (Cboe Crude Oil Volatility Index).
- **Gold (`GC`)**: `GVZ` (Cboe Gold Volatility Index).

---

## 10. 📊 5-MONTH ANCHORED VWAP & STANDARD DEVIATION BANDS

The chart features a **5-Month CME Globex Anchored VWAP** (`show5mAvwapOnChart`) providing macro institutional value benchmark context:

- **Lookback**: Anchored to 5 months of continuous CME Globex trading data.
- **Standard Deviation Bands**: Computes volume-weighted dispersion bands ($\pm 1\sigma, \pm 2\sigma, \pm 3\sigma$).
- **Top HUD Controls**: Managed via a clean `5M AVWAP: ON/OFF` toggle button on the chart header strip right next to CVD and News.

---

## 11. 🤖 PURGED AI STACK & INTEGRATED WYCKOFF PLAYBOOK PANEL IN LEO

### 11.1 Total Purge of AI Stacked & Hedging
The experimental multi-agent AI Stack (Aegis hedging specialist, dealer gamma flip levels, CTA liquidation trigger bands, and consensus orchestrator) was **completely purged** from the codebase to eliminate speculative noise and confusion.

### 11.2 Interactive `📜 Wyckoff 22 Rules` Panel
In [`LeoAssistantPanel.tsx`](file:///c:/Users/shahb/myApplications/Trading/app/dashboard/chart/components/LeoAssistantPanel.tsx), the AI Stack tab has been replaced with the dedicated **`📜 Wyckoff 22 Rules`** interactive panel ([`WyckoffRulesPanel.tsx`](file:///c:/Users/shahb/myApplications/Trading/app/dashboard/chart/components/WyckoffRulesPanel.tsx)):
- **4 Valid Setup Cards**: Diagrams and rules for Spring Reclaim, Breakdown Failed Reclaim, Upthrust Return Below, and Breakout Retest.
- **3-Tier Hierarchy & 8-Step Checklist**: Visual guide to Tier 1 frozen levels, Tier 2 volume/CVD, and Tier 3 context.
- **One-Click Audit Buttons**: Instantly prompt Leo to audit setups, verify frozen levels, or review CVD absorption.

### 11.3 Relocated Chart HUD "Ask Leo" Quick Action Links
Quick-action buttons are conveniently placed along the top chart HUD bar:
- **Dalton Day Type**: `[🤖 Ask Leo]` button next to `Day: {badgeText}` (and `Day: Pre-Session` in Globex) to analyze session distribution and auction tails.
- **Audit Order Flow**: `[🤖 Audit Order Flow]` button next to `CVD: ON/OFF` to audit buyer/seller absorption, CVD delta, and Tier-2 volume criteria vs. VWAP.
- **Compare Range Volume**: `[📈 Compare Range Volume]` button on the top HUD to compare volume across all user-drawn range boxes and fixed volume profiles.
- **Synchronized Leo Quick Chips**: `🏛️ Audit 4 Setups`, `⚡ Audit Order Flow`, `📈 Compare Range Volumes`, `📊 Dalton Day Type`.
