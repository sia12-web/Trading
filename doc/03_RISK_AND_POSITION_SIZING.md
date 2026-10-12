# 🛡️ 03. Risk Management, Personal Futures Rules & Position Sizing

> **Institutional Capital Preservation, Personal Futures $50k Model, and Fixed Dollar Sizing**  
> **Source Files**: [`lib/trading/tradeifyGrowth50k.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/tradeifyGrowth50k.ts), [`lib/trading/positionSizing.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/positionSizing.ts), [`lib/trading/instrumentTicks.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/instrumentTicks.ts), [`lib/trading/attemptLadder.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/attemptLadder.ts), [`lib/trading/sessionCleanup.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/sessionCleanup.ts)

---

## 1. Capital Preservation Model

The TradePulse risk architecture operates on a core institutional premise: **Trade generation is probabilistic, but risk management is 100% deterministic.** 

Every trade setup must pass through mathematical risk gatekeepers before any order ticket can be generated. If a setup violates the Daily Loss Limit or Ladder Quota, the execution gate locks down instantly.

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
       │        GATE 3: PERSONAL FUTURES $50K BOUNDS CHECK      │
       │   - DLL Remaining > Planned Risk? ($1,250 limit)       │
       │   - Stop-loss within remaining daily risk budget?      │
       │   - Correlated index hedge conflict check              │
       │   - Red-news economic event lock                       │
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

## 2. Personal Futures $50k Risk Profile Specification

The primary execution account tracked by the desk is the **Personal Futures $50,000 Account** (`lib/trading/tradeifyGrowth50k.ts`):

| Parameter | Value | Institutional Mechanism / Rule Behavior |
| :--- | :---: | :--- |
| **Starting Capital** | **$50,000.00** | Initial baseline equity. |
| **Daily Loss Limit (DLL)**| **-$1,250.00** | Intraday circuit-breaker. If realized + unrealized loss reaches -$1,250, trading halts for the session. |
| **Session Fill Limit** | **3 Fills** | Strict discipline cap: max 3 filled executions per trading day across all sessions. |
| **Progressive Risk Ladder**| **$400 → $250 → $150** | Risk per trade steps down on successive fills ($400 on #1, $250 on #2, $150 on #3). |
| **Session Window** | **18:00 ET to 18:00 ET** | Daily session window rolling each afternoon at 18:00 ET (covers Tokyo Nikkei + NY indexes). |
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

### Refusal Reason Codes

The risk evaluator (`resolvePersonalPlace()`) emits deterministic refusal codes:

- `'ok'`: Risk checks passed; order sizing permitted.
- `'session_full'`: 3 fills already taken on this session.
- `'dll_exhausted'`: Daily loss has reached or is within slippage of $1,250 DLL.
- `'stop_exceeds_dll'`: Proposed trade stop-loss dollar amount exceeds remaining room to DLL.
- `'risk_too_small'`: Calculated risk is below $50 (token size; refused).
- `'hedge_conflict'`: Attempting simultaneous opposing positions on correlated indices (YM/NQ/NKD).
- `'news_lock'`: High-impact Tier-1 economic event imminently scheduled ($\pm5$ minutes).

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

## 6. Session Close Risk Protocol & Clean Exits

Day trading discipline requires orderly risk management and avoiding unmonitored overnight exposure on intraday futures tickets.

### 6.1 Cash Close Protocol
- **Cash Close Time**: Market cash close (16:00 ET for NY equities, 15:00 JST for Tokyo).
- As the close approaches, the workstation flags open positions and working orders.
- Unfilled working limits past the active entry window are cancelled to avoid accidental fills in illiquid post-market conditions.

### 6.2 Holiday Sessions
- On designated CME equity early-close holidays (e.g., Black Friday, Christmas Eve), market close occurs at 13:00 ET.
- The workstation reflects early-close schedules in session countdowns.

---

## 7. Stop Loss Guard: Zero Stop Widening Doctrine

The system enforces a non-negotiable principle: **Stops are never widened under any condition.**

1. **Structural Anchoring**: Invalidation levels are anchored to observable auction boundaries (Spring Low, Upthrust High, Breakout Retest Low).
2. **Hypothesis Invalidation**: If the market trades beyond this boundary, the trading thesis was demonstrably incorrect.
3. **No Rationalization**: The AI and trader are forbidden from reclassifying failed setups into higher-timeframe swings or moving stops to "give the trade room to breathe."
4. **Immediate Exit**: An immediate loss of $-1\text{R}$ preserves capital; widening stops turns controlled $-1\text{R}$ losses into catastrophic $-3\text{R}$ account breaches.
