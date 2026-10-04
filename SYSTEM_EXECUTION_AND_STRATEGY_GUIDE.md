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

### 8.1 The 4 Valid Trade Setups (The ONLY 4 Trades in the Universe - Rule 11)
*Only 4 trade setups are valid in the entire execution universe. Everything else MUST be ignored:*

1. **Support: Spring $\rightarrow$ Reclaim $\rightarrow$ LONG (Rule 5)**
   - Price reaches predetermined support zone $\rightarrow$ sweeps underneath $\rightarrow$ sellers fail to continue $\rightarrow$ price reclaims zone $\rightarrow$ **LONG**.
   - Buying the failed breakdown and reclaim, not the falling knife bottom.
   - **Stop Loss**: Strictly below the Spring low (Rule 6). Never widen stop.
   - **CVD Confirmation (Rule 7)**: Bullish Absorption (price makes equal/higher low while CVD makes lower low).

2. **Support: Breakdown $\rightarrow$ Failed Reclaim $\rightarrow$ SHORT (Rule 10/11)**
   - Price cleanly breaks predetermined support zone with initiative volume $\rightarrow$ weak bounce fails to reclaim level $\rightarrow$ **SHORT**.
   - **Stop Loss**: Strictly above the failed reclaim pivot.
   - **Target**: Next pre-marked 5D / Yesterday structural support zone.

3. **Resistance: Upthrust $\rightarrow$ Return Below $\rightarrow$ SHORT (Rule 8)**
   - Price reaches predetermined resistance zone $\rightarrow$ breaks above $\rightarrow$ buyers fail to continue higher $\rightarrow$ price returns below resistance $\rightarrow$ **SHORT**.
   - **Stop Loss**: Strictly above the Upthrust high.
   - **CVD Confirmation (Rule 9)**: Bearish Absorption (price makes same/lower high while CVD makes higher high).

4. **Resistance: Breakout $\rightarrow$ Successful Retest (SOS $\rightarrow$ LPS) $\rightarrow$ LONG (Rule 10)**
   - Price destroys resistance with initiative volume (Jump Across Creek / Sign of Strength) $\rightarrow$ **never chase the breakout candle** $\rightarrow$ wait for pullback to hold as new support (Last Point of Support) $\rightarrow$ **LONG**.
   - **Stop Loss**: Strictly below the retest floor.

---

### 8.2 Three-Tier Chart & Structure Hierarchy (Rule 2)
1. **Tier 1 (Mandatory - Pre-market Structure)**:
   - **Rolling 5-Day Volume Profile (5D)**: 5D POC, 5D HVNs (Value Area High), 5D LVNs (Value Area Low). Identifies where business was accepted across recent sessions.
   - **Yesterday's Volume Profile**: Yesterday VAH, Yesterday POC, Yesterday VAL, Yesterday High, Yesterday Low. Essential intraday pivot zones.
   - **Overnight / London Profile**: Overnight High (`ONH`), Overnight Low (`ONL`), Overnight POC, London High/Low. Contextual inventory reference only; does not alone trigger trades.
   - **Pre-Market Map Gating (Rule 3)**: Combine nearby levels into **ZONES** (not laser beams). **Freeze the map permanently at 09:30 ET cash open**. Do not invent new levels every 15 minutes. If a random trading range appears in the middle of nowhere: **IGNORE IT**.

2. **Tier 2 (Execution Confirmation)**:
   - Current Price Action, Volume Bars (Effort vs. Result), Cumulative Volume Delta (CVD Absorption & Confirmation). This is the execution information that confirms setup quality.

3. **Tier 3 (Context Only - NEVER Overrides Tier 1)**:
   - 5-Month CME Globex Anchored VWAP (5M AVWAP) + simplified $\pm 1\sigma, \pm 2\sigma, \pm 3\sigma$ bands.
   - Cross-Asset Volatility Gauges (`VIX1D`, `OVX`, `GVZ`).
   - **Golden Rule**: *Tier 3 can NEVER override Tier 1.*

---

### 8.3 The 22 Complete Strategy Rules

| Rule # | Category | Core Execution Principle |
| :---: | :--- | :--- |
| **Rule 1** | **Watchlist & Scanning** | Primary watchlist: `NQ`, `ES`, `YM`, `Gold`, `Oil`. Never pre-decide that today is a "Nasdaq day". At open, seek the asset showing the best confluence of: **Volatility + Participation + Location**. |
| **Rule 2** | **Chart Hierarchy** | Tier 1 (5D Profile, Yesterday Profile, Overnight) $\rightarrow$ Tier 2 (Volume Effort vs Result, CVD) $\rightarrow$ Tier 3 (5M AVWAP, VIX context). |
| **Rule 3** | **Pre-Market Map Gating** | Build zones before 09:30 ET. **Freeze the map at 09:30 ET**. Never invent levels dynamically mid-session. |
| **Rule 4** | **First Question After Open** | Never ask "Long or short?". Ask: *"Which of my important pre-marked zones is price approaching?"* If not near one $\rightarrow$ **NO TRADE**. |
| **Rule 5** | **Primary Long (Spring)** | Predetermined support sweep $\rightarrow$ sellers fail $\rightarrow$ price reclaims zone $\rightarrow$ **LONG**. |
| **Rule 6** | **Stop for Spring** | Strictly below the Spring low. If breached, hypothesis was wrong $\rightarrow$ exit immediately. Never widen stop. |
| **Rule 7** | **CVD for Spring** | Bullish absorption: Price equal/higher low while CVD lower low. CVD confirms quality; price reclaim triggers trade. |
| **Rule 8** | **Primary Short (Upthrust)** | Predetermined resistance sweep $\rightarrow$ buyers fail $\rightarrow$ price returns below $\rightarrow$ **SHORT**. Stop strictly above Upthrust high. |
| **Rule 9** | **CVD for Short** | Bearish absorption: Price same/lower high while CVD higher high. Confirms sellers absorbing aggressive market buyers. |
| **Rule 10** | **Secondary (Breakout Retest)**| Never chase initial breakout candle! Wait for pullback to hold (SOS $\rightarrow$ LPS for long; SOW $\rightarrow$ LPSY for short). |
| **Rule 11** | **The ONLY 4 Trades** | 1. Spring Reclaim (Long), 2. Breakdown Retest (Short), 3. Upthrust Return (Short), 4. Breakout Retest (Long). *Everything else: IGNORE.* |
| **Rule 12** | **Volume's Job** | Effort vs. Result. Heavy selling + little downward price progress = Absorption. Heavy buying + little upside = Absorption. |
| **Rule 13** | **CVD's Job** | Ask only: *"Is aggressive order flow actually achieving a result?"* Falling CVD + holding price = Bullish absorption. Rising CVD + rejecting price = Bearish absorption. |
| **Rule 14** | **Ignore Participant Identity**| Never speculate on "London is trapped" or "dealers hedging gamma". Trade observable, measurable auction behavior. |
| **Rule 15** | **Market Selection Method** | Across NQ/ES/YM/GC/CL, evaluate: 1. Is participation expanding? 2. Is price near a predetermined zone? 3. Is a setup forming? Focus 100% on the asset with all three. |
| **Rule 16** | **Highest-Ranked Asset Rule**| Do not trade the most volatile market. Trade the market with **Volatility + Location + Structure**. |
| **Rule 17** | **Take-Profit Rule ($\ge 2\text{R}$)**| Check distance to next major pre-marked zone before entering. If room to next major obstacle is $< 2.0\text{R}$, **SKIP THE TRADE**. |
| **Rule 18** | **Position Sizing** | Stop loss is determined strictly by market structure (Spring low / Upthrust high). Contract quantity is calculated from fixed $400 risk (1R). |
| **Rule 19** | **Never Widen the Stop** | Invalidation is final. Exit immediately. Never turn -1R into -3R while holding an emergency internal seminar. |
| **Rule 20** | **Absolute Filters (When NOT to Trade)**| No predetermined zone $\rightarrow$ NO TRADE. Middle of value chop $\rightarrow$ NO TRADE. Random range $\rightarrow$ NO TRADE. Spring without reclaim $\rightarrow$ NO TRADE. Upthrust without return $\rightarrow$ NO TRADE. Breakout without pullback $\rightarrow$ DON'T CHASE. $< 2\text{R}$ room $\rightarrow$ NO TRADE. Confusing structure $\rightarrow$ NO TRADE. Nothing happens all day $\rightarrow$ **ZERO TRADES (Fully OK)**. |
| **Rule 21** | **Friday Rule** | Friday does not change the strategy. Setups stay identical. Be increasingly selective in the afternoon. Never force trades because it's Friday. |
| **Rule 22** | **Observable Structure Over Speculation**| Trade the observable auction event (Sweep & Reclaim / Spring / Upthrust), not speculative market narratives. |

---

### 8.4 The 8-Step Screen-Reading Sequence (Rule 23)
Traders and the Leo AI engine execute a strict 8-step screen-reading sequence before taking any action:

$$\boxed{\text{1. LOCATION}} \longrightarrow \boxed{\text{2. REACTION}} \longrightarrow \boxed{\text{3. RESULT}} \longrightarrow \boxed{\text{4. CVD + VOL}} \longrightarrow \boxed{\text{5. TRIGGER}} \longrightarrow \boxed{\text{6. RISK}} \longrightarrow \boxed{\text{7. REWARD } (\ge 2\text{R})} \longrightarrow \boxed{\text{8. ENTER}}$$

1. **LOCATION**: Is price interacting with one of our frozen pre-market Tier-1 zones?
2. **REACTION**: Did price sweep through the level and attempt expansion?
3. **RESULT**: Did the sweep fail to continue (Spring / Upthrust)?
4. **CVD + VOLUME**: Is aggressive market order flow being absorbed (Effort vs. Result divergence)?
5. **TRIGGER**: Has price cleanly reclaimed the key level?
6. **RISK**: Is the structural invalidation stop clearly defined beyond the pivot?
7. **REWARD**: Is there at least $\ge 2.0\text{R}$ of clean runway before the next opposing pre-marked zone?
8. **ENTER**: Execute disciplined order sizing ($400 fixed 1R risk).

---

### 8.5 Institutional Factor Scoring Engine (0–100 Points)
The `evaluateWyckoffSetup()` engine (`lib/trading/wyckoffStrategy.ts`) classifies user-drawn trendlines into **Wyckoff Supply Lines (Creek)** and **Wyckoff Demand Lines (Ice)** based on slope and price orientation, scoring setups across 5 factors:
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

## 10. 📊 5-MONTH ANCHORED VWAP & SIMPLIFIED BANDS (INSPECTION MODAL)

Seven AVWAP bands make the chart look scientific while quietly giving traders seven different excuses to enter a bad trade. TradePulse eliminates chart clutter and enforces strict execution discipline:

### 10.1 Simplified Band Hierarchy (Max 4 Reference Boundaries)
The system tracks at most:
- **AVWAP Center Line**: Institutional 5-month volume-weighted equilibrium (`#10b981`, lineWidth: 2).
- **$\pm 1\sigma$ Standard Deviation Bands**: Primary Value Area High & Low boundaries (68% normal distribution, `#3b82f6` / `#b8a04a`, lineWidth: 2).
- **$\pm 2\sigma$ Standard Deviation Bands**: Institutional expansion limits (95% statistical boundary, lineWidth: 1).
- **$\pm 3\sigma$ Extreme Reference Bands**: Extreme multi-month exhaustion reference only (`LineStyle.Dashed`, low-opacity lines).
- **$\pm 4\sigma$ through $\pm 7\sigma$ Bands**: **Permanently eliminated** for routine intraday decisions.

### 10.2 Invisible on Chart Canvas by Default
- The 5-Month AVWAP horizontal benchmark lines and multi-month bands are **invisible on the chart canvas by default** (`show5mAvwapOnChart = false`) to keep intraday candlestick execution clean and focused.
- **Dynamic Background Updates**: Sourced from genuine CME Globex daily bars via `/api/trading/context-55`, recomputed and polled every 60 seconds in the background so Leo AI, risk models, and valuation metrics are always real-time.

### 10.3 Top Toolbar Button & 5M Inspection Modal
- **Toolbar Button**: Located on the top HUD strip directly next to Cumulative Volume (`CVD`):
  ```
  [VWAP: ...] | [📊 CVD: ON/OFF] | [🟢 5M AVWAP: 43,921.50 5 MO] | [⚖️ Critique: ...]
  ```
- **Interactive 5M AVWAP Modal**: Clicking the button opens an on-demand inspection window without putting lines on the chart screen:
  - **Center Line & Anchor Date**: Exact 5M AVWAP price and lookback anchor date (~105 CME Globex daily sessions).
  - **Live Price Comparison**: Distance in points and percentage divergence.
  - **Macro Valuation Regime**: `VALUE EQUILIBRIUM` ($\pm 1\sigma$), `INSTITUTIONAL MARKUP/MARKDOWN` ($\pm 1\sigma$ to $\pm 2\sigma$), or `EXTREME EXHAUSTION` ($> \pm 3\sigma$).
  - **Visual Position Gauge**: A horizontal spectrum meter showing where current price sits between $-3\sigma$ and $+3\sigma$.
  - **Simplified Bands Table**: Exact prices, point distances, and strategic roles for Center, $\pm 1\sigma$, $\pm 2\sigma$, and $\pm 3\sigma$.
  - **Optional Chart Toggle**: In-modal checkbox allowing traders to temporarily project the 5M line onto the chart canvas if desired (defaulted OFF).

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
