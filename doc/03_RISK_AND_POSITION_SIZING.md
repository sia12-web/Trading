# 🛡️ 03. Risk Management, Tradeify Rules & Position Sizing

> **Institutional Capital Preservation, Tradeify Growth $50k Overlay, and Fixed Dollar Sizing**  
> **Source Files**: [`lib/trading/tradeifyGrowth50k.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/tradeifyGrowth50k.ts), [`lib/trading/positionSizing.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/positionSizing.ts), [`lib/trading/instrumentTicks.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/instrumentTicks.ts), [`lib/trading/attemptLadder.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/attemptLadder.ts), [`lib/trading/deskExitGuard.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/deskExitGuard.ts)

---

## 1. Capital Preservation Model

The TradePulse risk architecture operates on a core institutional premise: **Trade generation is probabilistic, but risk management is 100% deterministic.** 

Every trade setup must pass through mathematical risk gatekeepers before any order ticket can be generated. If a setup violates the Daily Loss Limit, Trailing Drawdown, or Ladder Quota, the execution gate locks down instantly.

```
       ┌────────────────────────────────────────────────────────┐
       │                NEW TRADE HYPOTHESIS                    │
       │    (Identified by Trader, Rule Engine, or Alert)       │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │             GATE 1: CLOCKED-IN STATUS CHECK            │
       │     Is trader clocked in on desk? (Session active)     │
       └───────────────────────────┬────────────────────────────┘
                                   │ YES
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │             GATE 2: ATTEMPT LADDER CHECK               │
       │  Fills used < 3 today? Window capacity available?       │
       └───────────────────────────┬────────────────────────────┘
                                   │ YES
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │           GATE 3: TRADEIFY $50K BOUNDS CHECK           │
       │   - DLL Remaining > Planned Risk? ($1,250 limit)       │
       │   - Balance > Invalidation Floor? ($48,000 + EOD peak) │
       │   - Green Day Locked? ($700 profit lock)               │
       │   - Flatten Time Exceeded? (16:59 ET regular)          │
       └───────────────────────────┬────────────────────────────┘
                                   │ YES
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │          GATE 4: DYNAMIC POSITION SIZING               │
       │  Calculate contracts: Fixed Dollar Risk / ($/point)    │
       │  Snap Entry, SL, TP to authentic CME Tick Increment    │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
                      [ORDER EXECUTION AUTHORIZED]
```

---

## 2. Tradeify Growth $50k Risk Profile Specification

The primary prop execution account simulated and tracked by the desk is the **Tradeify Growth $50,000 Evaluation Account** (`lib/trading/tradeifyGrowth50k.ts`):

| Parameter | Value | Institutional Mechanism / Rule Behavior |
| :--- | :---: | :--- |
| **Starting Balance** | **$50,000.00** | Initial baseline evaluation equity. |
| **Profit Target** | **+$3,000.00 ($53,000)** | Evaluation target to qualify for funded allocation. |
| **Daily Loss Limit (DLL)**| **-$1,250.00** | Intraday circuit-breaker. If realized + unrealized loss reaches -$1,250, trading halts for the session. |
| **Trailing Max Drawdown** | **$2,000.00** | Maximum permitted equity decline from high-water mark. |
| **Breach Floor (Initial)**| **$48,000.00** | $\$50,000 - \$2,000 = \$48,000$. Any tick below breaches account. |
| **Peak EOD Ratchet Floor**| **$\max(48,000, \text{Peak EOD} - 2,000)$** | The floor trails only at **End-of-Day Close**. Intraday unrealized peaks **do not** ratchet the floor. |
| **Funded Lock Balance** | **$52,100.00** | Once equity crosses $52,100, the trailing drawdown permanently locks at $50,100 ($100 buffer). |
| **Green Day Lock** | **+$700.00** | If session realized P&L reaches +$700, the day locks to prevent giving back profits. |
| **Max Daily Stop-Outs** | **2 Stop-Outs** | If two trades hit full stop-loss in a single day, the desk triggers emergency lock. |
| **Slippage Buffer** | **$75.00** | Conservative reserve deducted from risk calculations to prevent accidental DLL breach. |
| **Commission Reserve** | **$20.00 / fill** | Estimated round-trip futures exchange & clearing commission. |

---

## 3. The Progressive Dollar Risk Ladder

Rather than risking a constant dollar amount as fatigue increases, TradePulse employs an institutional **regressive risk-down ladder**:

```
Fill #1: $400.00 Risk (1R) ───► Fill #2: $250.00 Risk ───► Fill #3: $150.00 Risk ───► LOCKED (3/3 Cap)
```

1. **Trade #1 (Fresh Focus)**: **`$400.00 Dollar Risk`** (Primary 1R unit). Full conviction on pre-market Tier-1 setup.
2. **Trade #2 (Secondary Opportunity)**: **`$250.00 Dollar Risk`**. Lower risk to preserve capital if Trade #1 failed or lock in gains if Trade #1 succeeded.
3. **Trade #3 (Final Session Probe)**: **`$150.00 Dollar Risk`**. Minimal probe size.
4. **Hard 3-Fill Session Cap**: Once 3 filled trades land in a session, **every window locks down completely**, regardless of whether any window shows spare probes or whether the trader is up or down.

### Tradeify Refusal Reason Codes

The risk evaluator (`resolveTradeifyPlace()`) emits deterministic refusal codes:

- `'ok'`: Risk checks passed; order sizing permitted.
- `'session_full'`: 3 fills already taken on this session.
- `'day_locked_stops'`: 2 full stop-outs occurred today; desk locked.
- `'day_locked_green'`: +$700 daily target reached; profits protected.
- `'dll_exhausted'`: Daily loss has reached or is within slippage of $1,250 DLL.
- `'floor_exhausted'`: Equity is within slippage of the trailing drawdown floor.
- `'stop_exceeds_dll'`: Proposed trade stop-loss dollar amount exceeds remaining room to DLL.
- `'stop_exceeds_floor'`: Proposed trade stop-loss dollar amount exceeds room to trailing floor.
- `'risk_too_small'`: Calculated risk is below $50 (token size; refused).
- `'must_flatten'`: Mandatory flatten clock reached (16:59 ET regular / 12:59 ET holiday).
- `'hedge_conflict'`: Attempting simultaneous opposing positions on correlated indices.
- `'news_lock'`: High-impact Tier-1 economic event imminently scheduled.

---

## 4. CME Micro & Mini Futures Position Sizing Formula

The position sizer (`lib/trading/positionSizing.ts`) calculates contract counts dynamically so that **dollar risk is fixed at exactly the planned ladder step ($400, $250, or $150)**, regardless of the stop loss distance:

$$\text{Position Size (Contracts)} = \text{Math.round}\left( \frac{\text{Fixed Risk Dollars}}{\text{Stop Loss Distance (pts)} \times \text{Point Value (\$/pt)}} \right)$$

$$\text{Stop Loss Distance (pts)} = |\text{Entry Price} - \text{Structural Invalidation Price}|$$

### Instrument Contract Specification Table

| Instrument | CME Contract | Ticker | Point Value (\$/pt) | Tick Increment | Standard Stop Distance | Dollar Risk / Contract | **Default Contracts ($400 1R)** |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Nasdaq-100** | Micro E-mini Nasdaq | `MNQ` | **$2.00** | 0.25 pt | 20.0 pts | $40.00 | **`10 Contracts`** |
| **Dow Jones** | Micro E-mini Dow | `MYM` | **$0.50** | 1.0 pt | 51.5 pts | $25.75 | **`16 Contracts`** |
| **Gold** | Micro Gold | `MGC` | **$10.00** | 0.10 pt | 4.0 pts | $40.00 | **`10 Contracts`** |
| **Russell 2000** | Micro E-mini Russell | `M2K` | **$5.00** | 0.10 pt | 8.0 pts | $40.00 | **`10 Contracts`** |
| **Euro FX** | Micro Euro FX | `M6E` | **$125,000** ($1.25/pip) | 0.0001 | 40.0 pips | $50.00 | **`8 Contracts`** |
| **Silver** | Micro Silver (1,000 oz) | `SIL` | **$1,000** | 0.005 | $0.40 (40 cents) | $400.00 | **`1 Contract`** |
| **Crude Oil** | Micro WTI Crude | `MCL` | **$100.00** | 0.01 pt | 0.40 pts ($0.40) | $40.00 | **`10 Contracts`** |

### Practical Sizing Examples

1. **MNQ (Nasdaq-100)**:
   - Entry: `28,210.00` | Structural Spring Stop: `28,190.00`
   - Stop Distance: $20.00\text{ pts}$
   - Dollar Risk per Contract: $20.00 \times \$2.00 = \$40.00$
   - Sizing: $\frac{\$400.00}{\$40.00} = \mathbf{10\text{ MNQ Contracts}}$
   - Target ($\ge 2.0\text{R}$): $28,210 + (2 \times 20) = \mathbf{28,250.00}$ (Potential Reward: $+800.00$)

2. **MYM (Dow Jones)**:
   - Entry: `53,440.00` | Asia Breakout Stop: `53,388.50`
   - Stop Distance: $51.50\text{ pts}$
   - Dollar Risk per Contract: $51.50 \times \$0.50 = \$25.75$
   - Sizing: $\text{round}\left(\frac{\$400.00}{\$25.75}\right) = \mathbf{16\text{ MYM Contracts}}$
   - Target ($1.50\text{R}$): $53,440 + (1.5 \times 51.5) = \mathbf{53,517.25} \rightarrow \mathbf{53,517.00}$ (Snapped)

---

## 5. Tick Snapping & Precision Rules (`instrumentTicks.ts`)

To avoid broker API order rejections due to illegal price decimal places, all prices pass through the **Tick Snapping Engine**:

```typescript
// Snapping Formula
export function snapDeskPrice(price: number, instrument: string): number {
  const tick = getTickSize(instrument);
  return Math.round(price / tick) * tick;
}
```

- **Protective Stop Snapping (`snapStopToTick`)**:
  - Long Stop Loss: Rounds **DOWN** to ensure the stop is strictly at or below the structural invalidation point.
  - Short Stop Loss: Rounds **UP** to ensure the stop is strictly at or above the structural invalidation point.
- **Profit Target Snapping (`snapTargetToTick`)**:
  - Long Take Profit: Rounds **DOWN** to ensure target fills reliably without front-running the ceiling.
  - Short Take Profit: Rounds **UP** to ensure short target fills reliably above the floor.

---

## 6. Mandatory Cash Close Flatten & Holiday Protocol

Prop evaluation rules strictly forbid holding positions overnight past exchange closing windows.

### 6.1 Regular Session Flatten
- **Daily Cutoff Time**: **`16:59:00 ET`** (America/New_York / Montreal Time).
- At 16:55 ET, the workstation sounds a persistent audio alert.
- At 16:59 ET, all working limit orders are cancelled and all open positions are marked for immediate market liquidation.

### 6.2 Holiday Early-Close Flatten
- On designated CME equity early-close holidays, market close occurs at 13:00 ET.
- **Holiday Cutoff Time**: **`12:59:00 ET`**.
- Hard-coded holiday dates (`TRADEIFY_EARLY_CLOSE_ET_YMD`):
  - Day before Independence Day (July 3)
  - Day after Thanksgiving (Black Friday)
  - Christmas Eve (December 24)

---

## 7. Stop Loss Guard: Zero Stop Widening Doctrine

The system enforces a non-negotiable principle: **Stops are never widened under any condition.**

1. **Structural Anchoring**: Invalidation levels are anchored to observable auction boundaries (Spring Low, Upthrust High, Breakout Retest Low).
2. **Hypothesis Invalidation**: If the market trades beyond this boundary, the trading thesis was demonstrably incorrect.
3. **No Rationalization**: The AI and trader are forbidden from reclassifying failed setups into higher-timeframe swings or moving stops to "give the trade room to breathe."
4. **Immediate Exit**: An immediate loss of $-1\text{R}$ preserves capital; widening stops turns controlled $-1\text{R}$ losses into catastrophic $-3\text{R}$ account breaches.
