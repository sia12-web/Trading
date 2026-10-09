# Trading Desk Operations, Session Framework & Risk Guard

> **TradePulse Desk Operational Protocol**  
> **Target Profiles**: Personal Futures ($50,000 Desk) & Live Broker Accounts  
> **Trading Hours**: Structured Session Windows (Montreal EDT / UTC-4)  
> **Security Baseline**: 100% On-Platform Privacy — Zero Telegram Telemetry Leakage  

---

## 1. Multi-Session Desk Framework

TradePulse structures the trading day into four distinct market regimes based on liquidity, institutional volume participation, and volatility expansion:

```
00:00 EDT          03:00 EDT       09:30 EDT           12:00 EDT       16:00 EDT   16:59 EDT
  │                   │               │                   │               │           │
  ▼                   ▼               ▼                   ▼               ▼           ▼
┌───────────────────┬───────────────┬───────────────────┬───────────────┬───────────┐
│   ASIAN SESSION   │ LONDON EXP.   │ NY CASH OPEN (RTH)│ AFTERNOON CONT│ FLATTEN   │
│ 18:00 - 02:00 EDT │03:00-09:00 EDT│ 09:30 - 11:30 EDT │12:00-16:00 EDT│ 16:59 EDT │
│ Dow Narrow Range  │ Trend Origin  │ Primary Execution │ Secondary Move│ Close All │
└───────────────────┴───────────────┴───────────────────┴───────────────┴───────────┘
```

### 1.1 Asian Session (18:00 - 02:00 EDT)
- **Objective**: Monitor overnight inventory imbalances and identify narrow-range consolidation setups.
- **Dow Narrow Range Setup**: Evaluates Dow price action between 20:00 and 02:00 EDT. If the entire Asian range is under 80 points, it qualifies as an institutional coiling state, setting up an explosive London breakout.

### 1.2 London Session (03:00 - 09:00 EDT)
- **Objective**: Track European liquidity expansion and establish the Initial Trend Direction for New York.
- Tracks the London High (`LH`) and London Low (`LL`), which frequently serve as pre-market liquidity sweep targets before the US cash open.

### 1.3 New York Regular Trading Hours (RTH Cash Session: 09:30 - 11:30 EDT)
- **Objective**: The primary execution window for intraday index futures.
- Key reference markers formed:
  - **15-Minute Opening Range (`OR15`)**: 09:30 - 09:45 EDT. High/Low established during maximum opening auction volume.
  - **30-Minute Opening Range (`OR30`)**: 09:30 - 10:00 EDT. Confirms morning trend continuation or mean-reversion absorption.
  - **Excess Reference Range (Excess Selling High / Excess Buying Low)**: The sole canonical reference boundaries replacing legacy Initial Balance models (`excessLevelsFromCandles()` in `lib/trading/deskLevels.ts`). Identifies responsive seller entry at session highs and responsive buyer entry at session lows.
  - **Standardized Dalton Day Type (30-Min TPO Periods)**: Session day types (`TREND`, `NORMAL_VARIATION`, `NEUTRAL`, `NON_TREND`) are calculated by bucketing session price action into canonical 30-minute TPO periods starting from 09:30 AM cash open (`classifyMarketDayType` in `lib/chart/context55.ts`), ensuring identical classification across all chart timeframes (`1m`, `5m`, `30m`).

### 1.4 Afternoon Continuation Session (12:00 - 16:00 EDT)
- **Objective**: Trend continuation or late-day liquidation sweeps following the lunch transition.
- Generates the Afternoon Playbook (`/api/trading/afternoon-playbook`), analyzing whether price is accepted above Excess Selling High (`above_excess_selling`), below Excess Buying Low (`below_excess_buying`), or rotating within the excess range (`within_excess_range`).

### 1.5 Active CME Quarterly Contract Alignment (December 2026 Z6 Roll)
- **Contract Alignment**: Databento live futures hubs and OANDA basis offsets automatically adjust to active December 2026 quarterly contracts (`MYMZ6`, `MNQZ6`, `ESZ6`, `NKDZ6`, `MGCZ6`, `CLZ6`) via `getActiveCmeQuarterlyContract()`.

### 1.6 Globex Session-Aware 5-Market Radar
- Instead of deciding on a single asset class every morning, traders let the 5 benchmark markets (`NQ`, `ES`, `YM`, `GC`, `CL`) compete for attention based on volatility expansion and location.
- **Dedicated Cboe Volatility Gauges**:
  - `VIX` (30-day) & `VIX1D` (1-day expected 0DTE volatility) for Equities (`NQ`, `ES`, `YM`).
  - `OVX` (Cboe Crude Oil Volatility Index) for Crude Oil (`CL`).
  - `GVZ` (Cboe Gold Volatility Index) for Gold (`GC`).
- **Globex Session State Tracking**: Automatically recognizes session state (`CLOSED`, `ASIA`, `LONDON`, `NEW YORK`, `MAINTENANCE`). Evaluates overnight inventory accumulation (Long/Short %) during pre-market hours without generating false trade alerts.

---

## 2. Attendance & Trader Discipline Engine

Consistency in trading requires routine, preparation, and psychological discipline. TradePulse enforces accountability via the Attendance & Clock-In subsystem:

### 2.1 Clock-In & Attendance Protocol
- **Endpoint**: `POST /api/trading/clock-in`
- **Requirements**:
  - Trader must clock in before the market open (`09:30 EDT`).
  - Pre-flight checklist: Verify news events on the calendar, confirm market bias, review previous day high/lows.
- **Attendance Streaks**:
  - Consecutive on-time desk appearances increment the user's discipline streak.
  - Failure to clock in before placing orders triggers an audit warning in the desk journal.

### 2.2 Session Gate Validation (`/api/trading/session-gate`)
- The session gate evaluates whether an instrument is actively in an authorized trading window.
- Off-session order submissions (e.g. attempting to scalp Nasdaq cash moves at 01:00 AM) are flagged, requiring deliberate trader override.

---

## 3. Risk Management & Personal Futures Desk Constraints

The platform embeds institutional risk controls and telemetry designed for personal futures accounts:

| Risk Parameter | Default Constraint | Mechanism / System Action |
| :--- | :--- | :--- |
| **Max Dollar Risk Per Trade** | **$50.00** | Strict contract sizing calculation based on stop distance |
| **Daily Loss Limit (DLL)** | **-$500.00** | Immediate circuit-breaker lock; halts trade signals |
| **Max Trailing Drawdown** | **-$1,000.00** | Absolute risk boundary relative to high-water mark |
| **Green Day Lock** | **+$700.00** | Halts new signals once daily net profit reaches +$700 |
| **Attempt Ladder** | **5 Attempts Max** | Locks desk signals after max stop-out executions per day |
| **Reward-to-Risk Ratio** | **$\ge 2.0\text{R}$ Filter** | Take-profit distance must be at least 2.0x stop distance |
| **Execution Policy** | **Strict Read-Only** | Neither user nor Leo executes live orders; purely monitoring |

### 3.1 Position Sizing Formula
Every setup's suggested contract quantity is calculated deterministically from the user's defined risk limit:

$$\text{Contracts} = \left\lfloor \frac{\text{Dollar Risk Limit (\$50)}}{\text{Stop Loss Distance (pts)} \times \text{Point Value (\$/pt)}} \right\rfloor$$

---

## 4. Zero-Telemetry Policy (Telegram Completely Disabled)

In previous versions, automated notifications and signals were dispatched to Telegram bots. To ensure complete privacy, eliminate external telemetry leaks, and protect proprietary execution strategies, **Telegram notifications are permanently disabled desk-wide**:

- `telegramConfigured()` in `lib/notify/telegram.ts` unconditionally returns `false`.
- `sendTelegramMessage()` immediately exits with `{ ok: true, skipped: true }` without executing any network calls.
- All real-time signals, risk notifications, and Leo AI insights stream exclusively to the private web dashboard via secure Server-Sent Events (SSE) and on-screen audio synthesizers.

---

## 5. The "Questioning" Protocol — Auction Price Critique & Pre-Trade Self-Audit Desk

> *"The market is a place to do business. If price is not suitable for us, we never force a trade. Price advertises opportunity: when discounted we buy, when premium we short."*

### 5.1 Auction Market Valuation States (`priceQuestioning.ts`)
The engine computes composite weighted deviation across multi-horizon reference anchors (Yesterday POC: 30%, Overnight POC: 30%, 5D-POC: 25%, 5M-AVWAP: 15%) to classify current auction state:
- **`DEEP_DISCOUNT` (Score $-100 \dots -60$)**: Price trading far below wholesale value anchors. Prime location for responsive buying.
- **`DISCOUNT` (Score $-59 \dots -20$)**: Advantageous wholesale buying territory.
- **`FAIR_VALUE` (Score $-19 \dots +19$)**: Rotational equilibrium. Requires breakout momentum confirmation.
- **`PREMIUM` (Score $+20 \dots +59$)**: Advantageous wholesale shorting / retail exit territory.
- **`EXTREME_PREMIUM` (Score $+60 \dots +100$)**: Price extended far above wholesale benchmarks. High trap risk for buyers.

### 5.2 Session Inventory Reality Check
At the 9:30 AM New York Cash Open (and throughout the session), the platform compares current price to overnight participants:
- *"Why the hell should I buy at 9:30 AM when Asian and London participants accumulated 30 points lower overnight?"*
- Prevents buying expensive retail from overnight longs seeking exit liquidity, and prevents shorting into overnight sellers at structural session lows.

### 5.3 The 6-Point Questioning Pre-Trade Self-Audit
1. **Q1: Impulse Trap**: *Why enter now? Is it just because you saw a single bullish or bearish candle?*
2. **Q2: Psychological Magnet**: *Are you reacting just to a rounded number (.00 or .50 handle)?*
3. **Q3: Liquidity Vacuum**: *Is price moving in low volume where institutions set up traps?*
4. **Q4: Time Regulation**: *Can time regulate value right now (Session Phase: Open Drive vs 11:30–13:30 Lunch Doldrums)?*
5. **Q5: Global Inventory**: *Where did Asian, London & Overnight participants do business?*
6. **Q6: Wholesale vs. Retail**: *Is current price a wholesale discount or an expensive retail premium relative to Yesterday POC & 5D POC?*

---

## 6. The 22-Rule Wyckoff Execution & Risk Discipline Protocol

The desk operates under an absolute, non-negotiable **22-Rule Wyckoff & Auction Market Theory Strategy Engine** (`lib/trading/wyckoffStrategy.ts`, `app/dashboard/chart/components/WyckoffRulesPanel.tsx`, and `lib/ai/leoAssistant.ts`).

### 6.1 The 3-Tier Chart & Structural Hierarchy

Every screen reading decision must obey a strict top-down structural filter:

```
┌────────────────────────────────────────────────────────────────────────┐
│  TIER 1: MANDATORY PRE-MARKET STRUCTURAL MAP (FROZEN AT 09:30 AM ET)  │
│  • 5-Day Fixed Range Volume Profile (FRVP): 5D-POC, 5D-VAH, 5D-VAL, LVN│
│  • Yesterday NYC Cash Session: VAH, VAL, POC                           │
│  • Overnight / London Auction: ONH, ONL, ON-POC, LH, LL                │
│  *RULE: No new structural levels may be invented mid-session.*         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Must test a Tier 1 level
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  TIER 2: VOLUME & CVD EXECUTION CONFIRMATION                           │
│  • Effort vs. Result: High volume with narrow spread = Absorption      │
│  • CVD Aggressive Order Flow: Divergence confirms institutional trap   │
│  • Retest Confirmation: Spring reclaim or Upthrust failure             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Confirms the trade setup
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  TIER 3: CONTEXT & MACRO REFERENCE ONLY                                │
│  • 5-Month Anchored VWAP (Macro institutional bias)                    │
│  • Cross-Market Opportunity Radar (NQ, ES, YM, GC, CL selection)       │
│  • Cboe Volatility Gauges (VIX, VIX1D, OVX, GVZ)                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 6.2 The Complete 22 Wyckoff Execution Rules

| Rule # | Category | Core Mandate | Operational Detail & Code Reference |
| :---: | :--- | :--- | :--- |
| **1** | Pre-Market Map | **Pre-Market Levels Frozen at 09:30 ET** | Tier-1 levels (5D FRVP, Yesterday NYC, ONH/ONL) are locked at cash open. Never invent mid-day levels out of thin air. |
| **2** | Pre-Market Map | **No Execution Without Tier-1 Location** | Every trade entry must originate from a pre-marked Tier-1 structural boundary. No mid-air entries. |
| **3** | Pre-Market Map | **Identify Range Structure First** | Classify market state (Accumulation, Distribution, Re-accumulation, Re-distribution, or Trend) before looking for candles. |
| **4** | Pre-Market Map | **Mark the Creek and the Ice** | Identify the upper resistance boundary (Wyckoff Supply Line / Creek) and lower support boundary (Wyckoff Demand Line / Ice). |
| **5** | Pre-Market Map | **Map Liquidity Pools** | Locate buy-side liquidity (BSL) above swing highs and sell-side liquidity (SSL) below swing lows where retail stops cluster. |
| **6** | Execution | **The ONLY 4 Trades in the Universe** | Only 4 setups are valid: Spring Reclaim, Breakdown Failed Reclaim, Upthrust Return Below, Breakout Retest. All others are noise. |
| **7** | Execution | **Wait for the Reclaim Candle Close** | Never enter on the sweep itself. Wait for the candle to close back inside the structural boundary (`isReclaimed = true`). |
| **8** | Execution | **Test Confirms the Spring (Phase C)** | The safest entry is the secondary test (LPS / Phase C) following the initial Spring reclaim on reduced volume. |
| **9** | Execution | **Upthrust Requires Return Below** | Short only after price pokes above resistance, sweeps liquidity, and decisively closes back below the level. |
| **10** | Execution | **Breakout Requires Confirmed Retest** | Never chase a breakout bar. Enter only on the Sign of Strength (SOS) pullback retesting former resistance as support (LPS). |
| **11** | Volume & CVD | **Effort vs. Result** | High volume with narrow spread signifies institutional absorption. High volume without progress signals an immediate reversal. |
| **12** | Volume & CVD | **CVD Absorption Divergence** | If price pushes lower to a new low but CVD creates a higher low, aggressive sellers are being absorbed by institutional limit buyers. |
| **13** | Volume & CVD | **Volume Must Dry Up on Pullbacks** | Healthy trend pullbacks must show declining volume. Heavy volume on a pullback indicates opposing institutional participation. |
| **14** | Volume & CVD | **Volume Climax Signals Exhaustion** | Ultra-high volume spikes at range extremes mark selling or buying climaxes (SC/BC). Prepare for reversal, not continuation. |
| **15** | Risk Management | **Stop Placed at Structural Invalidation** | Stop loss is placed strictly beyond the sweep low (Spring) or sweep high (Upthrust). No arbitrary point stops. |
| **16** | Risk Management | **Mandatory $\ge 2.0\text{R}$ Target Runway** | Distance to the next opposing Tier-1 zone must be at least $2.0\times$ the stop loss distance (`is2RValid = true`). |
| **17** | Risk Management | **Never Widen a Stop Loss** | Stop loss is mathematically fixed upon order placement. Widening a stop loss is a catastrophic protocol violation. |
| **18** | Risk Management | **Scale Out at Opposing Structure** | Take first profit (TP1) at the range midpoint or first opposing Tier-1 zone; trail the remainder to breakeven. |
| **19** | Desk Discipline | **No Trades in the Middle of Balance** | The center of a trading range is the chop zone. All trading is strictly forbidden in fair value equilibrium. |
| **20** | Desk Discipline | **3-Stop Daily Lockout** | Three consecutive stopped-out executions permanently lock the desk until the next trading day. |
| **21** | Desk Discipline | **Respect the Lunch Doldrums** | 11:30 AM to 1:30 PM ET is the low-volume algorithmic rotation window. Avoid initiating new breakout positions. |
| **22** | Desk Discipline | **Zero FOMO / Wait for the Market** | The market is an auction. If price does not test your pre-marked zone with confirming order flow, do not trade. |

---

### 6.3 The ONLY 4 Valid Trades in the Universe

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        THE 4 VALID TRADES IN THE UNIVERSE                              │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ 1. SUPPORT: SPRING RECLAIM (LONG)      │ 2. SUPPORT: BREAKDOWN FAILED RECLAIM (SHORT)  │
│    • Price sweeps below Ice / Support  │    • Price breaks below Ice / Support         │
│    • Candle closes BACK ABOVE Support  │    • Retest tries to reclaim and FAILS        │
│    • CVD shows bullish absorption      │    • Weak volume on retest push               │
│    • Entry: On reclaim or LPS retest   │    • Entry: On confirmation of failed reclaim │
│    • Stop: Strictly below spring low   │    • Stop: Strictly above failed reclaim high │
│    • Target: Range POC / Range High    │    • Target: Next major lower Tier-1 zone     │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ 3. RESISTANCE: UPTHRUST RETURN (SHORT) │ 4. RESISTANCE: BREAKOUT RETEST (LONG)         │
│    • Price sweeps above Creek / Resist │    • Price breaks decisively above Creek      │
│    • Candle closes BACK BELOW Resist   │    • Pullback retests former resistance (LPS) │
│    • CVD shows bearish absorption      │    • Volume dries up on pullback              │
│    • Entry: On return below level      │    • Entry: On bounce from retest level       │
│    • Stop: Strictly above upthrust high│    • Stop: Strictly below retest low           │
│    • Target: Range POC / Range Low     │    • Target: Next major overhead Tier-1 zone  │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

---

### 6.4 The 8-Step Screen-Reading Sequence

Before clicking Buy or Sell, every trader must execute this deterministic sequence:

1. **Step 1: Check Pre-Market Structure**: Are Tier-1 levels (5D FRVP, Yesterday NYC, Overnight) clearly plotted and locked from 09:30 AM ET?
2. **Step 2: Check Price Location**: Is price at an extreme structural boundary (Creek/Resistance or Ice/Support)? If price is in the middle of balance, **STOP — DO NOT TRADE**.
3. **Step 3: Inspect Candle Action**: Is price sweeping liquidity beyond the boundary, or breaking out?
4. **Step 4: Audit Volume & CVD**: Is volume elevated on the sweep? Does CVD show absorption divergence (aggressive market orders trapped by passive limit orders)?
5. **Step 5: Identify the Setup**: Does this match one of the ONLY 4 valid setups (Spring Reclaim, Breakdown Failed Reclaim, Upthrust Return Below, Breakout Retest)?
6. **Step 6: Calculate Risk/Reward Runway**: Where is the next opposing Tier-1 structural zone? Is the profit runway $\ge 2.0\times$ the stop distance (`is2RValid`)? If $< 2.0\text{R}$, **SKIP THE TRADE**.
7. **Step 7: Formulate Order & Fixed Stop**: Calculate contract quantity via the \$400 dollar risk formula. Set the stop loss strictly at structural invalidation.
8. **Step 8: Execute & Hands Off**: Submit paired bracket. Do not micro-manage or move the stop backwards. Let the auction resolve.

---

### 6.5 Absolute Filters & Hard Desk Guardrails

- **The Invalidation Rule**: If price closes beyond the structural invalidation level (Spring low or Upthrust high), the premise is invalidated. Exit immediately. Never widen or remove a stop loss.
- **Runway Filter (`findNextStructuralTarget`)**: In `lib/trading/wyckoffStrategy.ts`, the strategy engine scans all pre-marked Tier-1 zones. If the distance to the nearest opposing zone yields an R:R below $2.0:1$, the setup is rejected with `is2RValid: false`.
- **Chop Guard**: Range-bound chop between Yesterday POC and Today VWAP is an institutional distribution trap. Wait for the boundary test.
- **Institutional Factor Scoring (0–100 pts)**:
  - $\ge 75$ pts = **Grade A Setup** (Full risk sizing: \$400).
  - $50-74$ pts = **Grade B Setup** (Reduced sizing: 0.5x risk / \$200).
  - $< 50$ pts = **Grade C Setup** (Strictly filtered — no execution).

---

## 7. Simplified AVWAP Hierarchy & 5M Inspection Modal Desk Protocol

To prevent cognitive overload, analysis paralysis, and "seven different excuses to enter a bad trade," TradePulse eliminates multi-band visual spiderwebs.

### 7.1 Simplified Bands Standard

The 5-Month Anchored VWAP engine (`lib/chart/context55.ts`, `app/dashboard/chart/components/TradingChart.tsx`) enforces a streamlined standard:
- **AVWAP Center Line**: Institutional 5-month volume-weighted wholesale benchmark.
- **$\pm 1\sigma$ Standard Deviation Bands**: Inner statistical Value Area (68.2% of auction volume).
- **$\pm 2\sigma$ Standard Deviation Bands**: Primary statistical outer boundary (95.4% of auction volume).
- **$\pm 3\sigma$ Subtle Dashed Bands**: Extreme outlier reference only (99.7% of volume). Rendered with thin dashed styling (`LineStyle.Dashed`).
- **$\pm 4\sigma$ through $\pm 7\sigma$ permanently eliminated**: Completely removed from calculations and chart series.

### 7.2 Invisible-by-Default Canvas State

- The 5-Month AVWAP series are kept **invisible on the chart canvas by default** (`show5mAvwapOnChart = false`).
- Intraday price action, candle sweeps, and Tier-1 auction zones remain completely unobstructed.
- The trader is freed from visual noise while the system continuously updates 5-month benchmark math in the background.

### 7.3 Top HUD Quick Action & Floating 5M Modal

- **Placement**: Directly on the top chart HUD toolbar, positioned next to Cumulative Volume Delta:
  ```
  [VWAP: 21,520.25] | [📊 CVD: ON/OFF] | [🟢 5M AVWAP: 21,450.75 5 MO]
  ```
- **Live Indicator Badge**: Displays live distance in points and percent from the 5-month benchmark.
- **1-Click Modal Inspection**: Clicking the `[🟢 5M AVWAP]` button launches the floating **5-Month Anchored VWAP Benchmark** inspection modal:
  - **Live Globex Distance**: Current price relative to 5M AVWAP (`+74.50 pts (+0.35%)`).
  - **Macro Regime Classification**: `BULLISH_EXPANSION` ($> +1\sigma$), `FAIR_VALUE_CORE` (within $\pm 1\sigma$), or `BEARISH_DISCOUNT` ($< -1\sigma$).
  - **Visual Position Gauge**: Horizontal gauge bar visually plotting current price between $-3\sigma$ and $+3\sigma$.
  - **Simplified Bands Table**: Exact price levels for Center, $\pm 1\sigma$, $\pm 2\sigma$, and $\pm 3\sigma$.
  - **Dismissal**: Easily dismissed via the `Esc` key or close button (`✕`) without altering chart state.
