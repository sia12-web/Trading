# Trading Desk Operations, Session Framework & Risk Guard

> **TradePulse Desk Operational Protocol**  
> **Target Profiles**: Prop Firm Evaluation / Funded ($50,000 / $150,000) & Live Broker Accounts  
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
- **Contract Alignment**: Databento live futures hubs and OANDA basis offsets automatically adjust to active December 2026 quarterly contracts (`MYMZ6`, `MNQZ6`, `NKDZ6`, `MGCZ6`, `CLZ6`) via `getActiveCmeQuarterlyContract()`.

### 1.6 End-of-Day (EOD) Risk Flatten Window (16:59 EDT)
- **Rule**: All intraday day-trading positions must be flattened by 16:59 EDT.
- Prevents overnight margin expansion and eliminates gap risk across non-trading hours for prop firm accounts. Multi-day swing positions (e.g. SPY, GOOG equities in Questrade) remain unaffected.

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

## 3. Risk Management & Prop Firm Constraints

The platform embeds institutional risk controls designed to pass and preserve prop firm evaluations (TopstepX, Tradeify, Apex):

| Risk Parameter | Default Constraint | Mechanism / System Action |
| :--- | :--- | :--- |
| **Max Dollar Risk Per Trade** | **$400.00** | Strict contract sizing calculation based on stop distance |
| **Daily Loss Limit (DLL)** | **-$1,250.00** | Immediate circuit-breaker lock; disables order placement |
| **Max Trailing Drawdown** | **-$2,000.00** | Absolute liquidation boundary relative to high-water mark |
| **Green Day Lock** | **+$700.00** | Halts new entries once daily net profit reaches +$700 |
| **Attempt Ladder** | **3 Attempts Max** | Locks desk trading after 3 stop-out executions per day |
| **Reward-to-Risk Ratio** | **$\ge 1.5\text{R}$ to $2.0\text{R}$** | Take-profit must be at least 1.5x stop distance |

### 3.1 Position Sizing Formula
Every order's contract quantity is calculated deterministically from the user's defined risk limit:

$$\text{Contracts} = \left\lfloor \frac{\text{Dollar Risk Limit (\$400)}}{\text{Stop Loss Distance (pts)} \times \text{Point Value (\$/pt)}} \right\rfloor$$

*Example*: For Micro Nasdaq (`MNQ`) with a 20-point stop loss ($2.00/pt):
$$\text{Contracts} = \left\lfloor \frac{400}{20 \times 2.00} \right\rfloor = 10\text{ MNQ contracts}$$

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

### 5.4 Weak-Hand Trap & Emotional Retail Protection
- **Single-Candle FOMO**: Flagged when a large impulse candle spikes into Extreme Premium or Deep Discount.
- **Round-Number Magnet**: Flagged when price approaches century/half-century handles without supporting volume.
- **Thin Liquidity Vacuum**: Flagged when price extends rapidly on low volume.
- **Lunch Doldrums Chop**: Flagged during 11:30 AM – 1:30 PM ET low-liquidity rotational chop.

### 5.5 Accurate NY Session Window Gating
- **Active Window**: Weekdays (Mon–Fri) from **09:00 AM / 09:15 AM ET** (pre-market unlock) through **16:00 ET** (Cash Market Close) strictly locked to `America/New_York` timezone.
- **Off-Session Inactivity**: During Asian session (18:00–03:00 ET), London session (03:00–09:00 ET), post-close (16:00+ ET), and weekends, the `⚖️ Critique:` HUD button is completely hidden, hotkey `Q` is disabled, and Leo provides off-session guidance directing traders to wait for NY pre-market formation.
