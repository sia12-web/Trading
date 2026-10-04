# Chart Engine, Auction Theory & Visual Indicators Guide

> **TradePulse Financial Charting Architecture**  
> **Core Engine**: Lightweight Charts v4 (TradingView) + HTML5 2D Canvas Overlays  
> **Color Scheme**: Institutional TradingView Green (`#089981`) & Red (`#f23645`) Desk-Wide  
> **Timeframe Resolution**: `1m` (Scalp) · `5m` (Desk Standard) · `30m` (Structural) · `1D` (Macro Context)  

---

## 1. Chart Engine Architecture & Responsive Pane

TradePulse's charting interface is built on **TradingView's Lightweight Charts v4**, augmented by a multi-layered HTML5 Canvas overlay engine for complex auction profile rendering and interactive user drawings.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Chart Toolbar (Instrument Tabs, Timeframe Selector, Drawing Tools)     │
├────────────────────────────────────────────────────────────────────────┤
│ HUD Status Bar (Live Price, 5M VWAP, CVD, Day Type, Ask Leo Links)     │
├────────────────────────────────────────────────────────────────────────┤
│ Main Chart Pane:                                                       │
│   Layer 0: Lightweight Charts Candlestick Series (#089981 / #f23645)   │
│   Layer 1: Anchored VWAP + Standard Deviation Bands (±1σ, ±2σ, ±3σ)    │
│   Layer 2: Volume Histogram Series Overlay (Bottom Margin)             │
│   Layer 3: HTML5 2D Canvas: Session Boxes, Dalton Spikes, FRVP POC     │
│   Layer 4: HTML5 2D Canvas: Daily Tested Highs/Lows with Traded Volume │
│   Layer 5: HTML5 2D Canvas: User Drawings & Wyckoff Spring/Upthrust    │
│   Layer 6: Interactive Crosshair & OHLCV Tooltip                       │
├────────────────────────────────────────────────────────────────────────┤
│ Cumulative Volume Delta (CVD) Candlestick Sub-Pane (Collapsible)       │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Institutional Candlestick Styling
To ensure immediate visual clarity and eliminate distracting instrument color overrides, all markets (DOW, NASDAQ, ES, GOLD, CRUDE) enforce standard institutional colors:
- **Up Candle Body**: `#089981` (Solid Emerald Green)
- **Down Candle Body**: `#f23645` (Solid Crimson Red)
- **Wicks & Borders**: Matching `#089981` / `#f23645`

### 1.2 Multi-Timeframe Architecture & Viewport Persistence
- **Timeframes**:
  - `1m`: Micro execution and entry timing.
  - `5m`: Desk default standard for day trading and auction theory setups.
  - `30m`: Intermediate structural swings.
  - `1D`: Higher Timeframe multi-year macro context.
- **Isolated Viewport Storage**:
  - Panning and zooming preferences are persisted in `sessionStorage` under the key:
    $$\text{Key} = \text{tradepulse.chart.view.}[\text{instrument}].[\text{timeframe}]$$
  - Switching between `5m` and `1D` isolates their viewports, preventing an intraday zoom from collapsing the 2-year daily history.
- **Dedicated Daily Axis Scaling**:
  - On `1D`, the bar spacing defaults to `6px` and minimum bars to `120`, cleanly rendering 120 to 200 daily candles on load.
  - The bottom time axis switches from intraday clock times (`08:05 EDT`) to calendar dates (`Sep 14, 2026`).

---

## 2. Anchored VWAP, Simplified Standard Deviation Bands & Inspection Modal

Volume-Weighted Average Price (VWAP) represents the institutional volume-weighted benchmark. TradePulse provides a clear, clutter-free VWAP framework:

### 2.1 Simplified Band Hierarchy (Elimination of 7-Band Noise)
Seven AVWAP bands make the chart look scientific while quietly giving traders seven different excuses to enter bad trades. TradePulse strictly limits visible bands to at most:
- **AVWAP Center Line**: Volume-weighted mean price (`#10b981`, lineWidth: 2, prominent).
- **$\pm 1\sigma$ Standard Deviation Bands**: Primary Value Area High (`+1σ` blue `#3b82f6`) and Value Area Low (`-1σ` gold `#b8a04a`, lineWidth: 2, 68% normal distribution).
- **$\pm 2\sigma$ Standard Deviation Bands**: Institutional expansion limits (95% statistical boundary, lineWidth: 1).
- **$\pm 3\sigma$ Extreme Reference Bands**: Strict exhaustion reference only (`LineStyle.Dashed`, faint low-opacity lines) so they are never mistaken for routine intraday entries.
- **$\pm 4\sigma$ through $\pm 7\sigma$ Bands**: **Permanently eliminated** for routine intraday decisions.

### 2.2 5-Month Macro Anchored VWAP (Invisible on Chart Canvas by Default)
- **Anchor Point**: Cash open 5 months prior (~105 CME Globex daily sessions).
- **Screen Clarity Guarantee**: Kept **invisible on the chart canvas by default** (`show5mAvwapOnChart = false`) so the screen remains free of distracting multi-month lines during routine intraday execution.
- **Continuous Background Updating**: Sourced from genuine CME Globex daily bars via `/api/trading/context-55`, polled and recomputed every 60 seconds so Leo AI, risk models, and valuation metrics stay 100% live.

### 2.3 Top Toolbar Button & 5M Inspection Modal
- **Placement**: Sits on the top HUD toolbar directly next to Cumulative Volume (`CVD`):
  ```
  [VWAP: ...] | [📊 CVD: ON/OFF] | [🟢 5M AVWAP: 43,921.50 5 MO] | [⚖️ Critique: ...]
  ```
- **Interactive 5M AVWAP Modal**: Clicking the button opens a clean floating inspection window without putting lines on the chart screen:
  - **Center Line & Anchor Date**: Exact 5M AVWAP price and lookback anchor date.
  - **Live Price Comparison**: Distance in points and percentage divergence.
  - **Macro Valuation Regime**: `VALUE EQUILIBRIUM` ($\pm 1\sigma$), `INSTITUTIONAL MARKUP/MARKDOWN` ($\pm 1\sigma$ to $\pm 2\sigma$), or `EXTREME EXHAUSTION` ($> \pm 3\sigma$).
  - **Visual Position Gauge**: A horizontal spectrum meter showing where current price sits between $-3\sigma$ and $+3\sigma$.
  - **Simplified Bands Table**: Exact prices, point distances, and strategic roles for Center, $\pm 1\sigma$, $\pm 2\sigma$, and $\pm 3\sigma$.
  - **Optional Chart Toggle**: In-modal checkbox allowing traders to temporarily project the 5M line onto the chart canvas if desired (defaulted OFF).

### 2.4 Intraday Session Anchored VWAP
- On intraday timeframes (`1m`, `5m`, `30m`), the active session VWAP anchors to the cash open of the lookback sessions, providing clean intraday value reference without multi-month chart clutter.

---

## 3. Dalton Auction Market Theory Overlays

TradePulse implements Peter Steidlmayer and Jim Dalton's Auction Market Theory:

```
[Initial Balance: 09:30 - 10:30 EDT]
┌──────────────────────────────────────┐ <- Initial Balance High (IBH)
│                                      │
│               [Day POC]              │ <- Point of Control (Highest Volume)
│                                      │
└──────────────────────────────────────┘ <- Initial Balance Low (IBL)
```

### 3.1 Initial Balance (`IB`) & Opening Ranges (`OR15`, `OR30`)
- **OR15 (09:30 - 09:45 EDT)**: Captures opening order imbalances. Breakouts confirmed by volume indicate trend days.
- **OR30 (09:30 - 10:00 EDT)**: Secondary filter separating false opening drives from sustained expansion.
- **Initial Balance (09:30 - 10:30 EDT)**: The benchmark range against which morning extension (`IB Ext 1.5x`, `2.0x`) is measured.

### 3.2 5-Day Fixed Range Volume Profile (FRVP)
- **Point of Control (POC)**: The price level with the highest traded volume across the last 5 sessions. Rendered as a prominent horizontal line that **terminates precisely at the current candle** without extending into the empty chart margin.
- **Value Area (VAH & VAL)**: The price boundaries encompassing 70% of total traded volume.
- Automatically suppressed on the Daily (`1D`) timeframe to maintain clean macro visual clarity.

### 3.3 Dalton Late-Session Spikes
- Identifies aggressive price movement in the final 30–45 minutes of a trading session.
- Draws dashed shelves for **Spike Peak** (High/Low) and **Spike Base** (acceptance reference). Price opening within the spike signals acceptance; opening outside signals rejection.

---

## 4. Daily & Intraday Tested Highs/Lows with Volume Badges

The platform detects structural swing highs and lows and evaluates subsequent retests (`lib/chart/excesses.ts`):

```
       ▼ (142.5k) [Retest 0.82x]  <- Rose Triangle & Traded Volume
   ────┼────────────────────────── <- Horizontal Dashed Shelf (Bounded to Retest)
      ╱ ╲
     ╱   ╲
```

### 4.1 Daily Swing Extremes (`detectDailyExtremes`)
- Scans multi-year daily candles for structural pivot peaks and troughs over a rolling window.
- **Traded Volume**: Labels each pivot with its exact traded volume (`volStr`, e.g. `142.5k`).
- **Retest Confirmation**: Checks subsequent bars to detect whether price revisited the pivot level within a 0.1% tolerance.
  - If retested, flags `isRetested = true`, records the retesting bar's volume, and computes the volume absorption ratio (`retestVolumeRatio`, e.g. `[Retest 0.82x]`).
- **Shelf Horizon**: Dashed horizontal shelf terminates at the retest confirmation bar or a 20-day horizon (`retestTime ?? Math.min(lastBar.time, cur.time + 86400 * 20)`), preventing old lines from cluttering the current price action.

---

## 5. Cumulative Volume Delta (CVD) Sub-Pane

- **Cumulative Volume Delta**: Computes buy volume minus sell volume aggregated into candlesticks:
  $$\Delta V = V_{\text{buy}} - V_{\text{sell}}$$
- **Divergence Detection**: Identifies when price makes a higher high while CVD makes a lower high (exhaustion / absorption), or when price makes a lower low while CVD makes a higher low (accumulation).
- **Sub-Pane UI**: Rendered below the primary chart with synchronized time scale and independent autoscale. Completely decoupled from floating modals for an unobstructed view.

---

## 6. Traded Volume Histogram & Tooltip

- **Histogram Overlay**: Positioned along the bottom margin (`scaleMargins: { top: 0.82, bottom: 0 }`).
  - Up days/bars render green (`rgba(8, 153, 129, 0.45)`).
  - Down days/bars render red (`rgba(242, 54, 69, 0.45)`).
- **Hover Crosshair Tooltip**: Displays Open, High, Low, Close, Price Change ($pts and %), and Traded Volume (`V: 142.5k`).

---

## 7. Candlestick Patterns & Auction Market Excess Tails

The pattern recognition engine (`lib/trading/candlestickPatterns.ts`) evaluates classical candlestick reversal formations alongside Dalton Auction Market Theory excess rejections:

### 7.1 Auction Market Excess Tails (`buyingExcess` & `sellingExcess`)
An Excess Tail signifies rapid, aggressive rejection at price extremes where market participants refuse to conduct trade, leaving behind a sharp single-print wick:

- **Buying Excess Tail (Lower Rejection Tail)**:
  - $\text{lowerRatio} = \frac{\text{bottomWick}}{\text{range}} \ge 0.45$
  - $\text{bottomWick} \ge 1.4 \times \text{body}$
  - $\text{bottomWick} \ge 1.8 \times \text{topWick}$
  - Structural probe: $\text{low} \le \text{low}_{prev} + 0.0001$
  - **Chart Badge**: `▲ Excess Tail` rendered below the candle in emerald (`rgba(5, 150, 105, 0.95)`).

- **Selling Excess Tail (Upper Rejection Tail)**:
  - $\text{upperRatio} = \frac{\text{topWick}}{\text{range}} \ge 0.45$
  - $\text{topWick} \ge 1.4 \times \text{body}$
  - $\text{topWick} \ge 1.8 \times \text{bottomWick}$
  - Structural probe: $\text{high} \ge \text{high}_{prev} - 0.0001$
  - **Chart Badge**: `▼ Excess Tail` rendered above the candle in crimson (`rgba(220, 38, 38, 0.95)`).

### 7.2 Classical Candlestick Reversal Formations
- **Doji**: Neutral equilibrium / hesitation.
- **Bullish / Bearish Engulfing**: Trend reversal where body encompasses previous candle.
- **Bullish / Bearish Harami**: Inside bar compression hinting at turning points.
- **Morning Star / Evening Star**: 3-bar exhaustion and counter-offensive reversal.
- **Hammer / Inverted Hammer / Shooting Star / Hanging Man**: Directional pin bars with specific close and body constraints.
- **Marubozu**: Strong directional conviction with negligible wicks.
- **Tweezer Tops / Bottoms**: Exact test and rejection of high/low across two candles.
- **LVN Rejection Confluence**: Evaluates Bullish Engulfing or Excess Tail occurring directly at a Low Volume Node (LVN) or Value Area boundary, generating automated trade setups with defined risk points and take-profit targets.

---

## 8. Chart Visual Stability, Sub-Pane TimeScale Sync Lock & Aligned Price Scale Widths

To eliminate chart shaking, horizontal jitter, and visual micro-stuttering across the main candlestick chart and CVD sub-pane, TradePulse enforces strict visual rendering invariants:

### 8.1 Unified TimeScale Sync Mutual Exclusion (`isSyncingTimeScale`)
- **Feedback Loop Elimination**: Synchronizing time scales between two charts can create an infinite ping-pong feedback loop if floating-point logical ranges differ. TradePulse uses a single unified boolean lock (`isSyncingTimeScale`).
- **Sub-Pixel Epsilon Guard**:
  ```typescript
  const rangesDiffer = (r1: any, r2: any, eps = 0.05) => {
    if (!r1 || !r2) return true
    return Math.abs(r1.from - r2.from) >= eps || Math.abs(r1.to - r2.to) >= eps
  }
  ```
  If the target chart's logical range is already within 0.05 bars of the requested range, `setVisibleLogicalRange` is skipped, terminating rounding noise feedback.

### 8.2 Aligned Minimum Price Scale Width (`minimumWidth: 75px`)
- Lightweight Charts automatically sizes price scale widths based on label lengths.
- By setting `minimumWidth: 75` on both `DESK_CHART_THEME.rightPriceScale` and `cvdChart.rightPriceScale`, both plot areas have identical pixel widths, guaranteeing 1:1 vertical candle slot alignment.

### 8.3 Throttled Single-Pass Live Tick Overlay Painting
- Live tick updates (`paintTipBar`) call `paintOverlaysSinglePassRef.current()` at most once every 150ms.
- The 320ms kinetic scroll animation loop (`pokeOverlayLayout`) is reserved strictly for user drag and wheel gestures, saving tens of thousands of redundant DOM queries and canvas redraws per minute during fast market streams.

---

## 9. Horizontal S/R Runway & Scale-Invariant Empirical Velocity Corridor

### 9.1 Scale-Invariant Empirical Velocity ($\Delta P / \Delta t$)
Traditional geometric Gann Fans ($45^\circ$, $1\times1$) distort on digital monitors whenever the chart zooms or resizes. TradePulse calculates true **Scale-Invariant Empirical Velocity**:
- **Baseline Velocity ($1.0\times$)**: $\Delta P / \Delta t$ in points per 5-minute candle.
- **Parabolic Climax Ray ($1.5\times$)**: Warns when momentum goes parabolic into horizontal resistance, triggering profit take-outs.
- **Retest Floor Ray ($0.5\times$)**: Minimum slope required to maintain trend structure. Closing below signals momentum stall.

### 9.2 Horizontal S/R Runway Assessment
Evaluates multi-session levels (Overnight High/Low/POC, Yesterday RTH High/Low/POC, 5D-POC, 5M-AVWAP) to calculate the **Runway-to-Risk Ratio**:
$$\text{Runway Ratio} = \frac{\text{Distance to Nearest Overhead Resistance (pts)}}{\text{Entry to Stop Loss Risk (pts)}}$$
- **`EXCELLENT` ($\ge 2.5:1$)**: Clear institutional air pocket.
- **`ACCEPTABLE` ($1.5:1 - 2.49:1$)**: Standard rotational target.
- **`TIGHT_RUNWAY` ($< 1.5:1$)**: ⚠️ **High Trap Risk** directly beneath heavy supply.

---

## 10. "Questioning" — Auction Price Critique & Pre-Trade Self-Audit HUD

### 10.1 Interactive HUD Button & Hotkey `Q`
- Positioned in the top evaluator row: **`⚖️ Critique: [DISCOUNT / PREMIUM / FAIR / TRAP RISK]`**.
- Dynamically color-coded (Emerald = Discount, Rose = Premium, Amber = Trap Risk).
- Pressing **`Q`** or clicking the button toggles the floating **Auction Questioning & Critique Desk Card**.

### 10.2 Valuation Meter & Session Inventory Reality Card
- Displays a visual gradient pointer from $-100$ (Deep Discount) to $+100$ (Extreme Premium).
- Critiques 9:30 AM NY Open price action against overnight participants: *"Why buy at 9:30 AM when Asian & London buyers accumulated 30 points lower?"*
- Features 1-click **Ask Leo to Critique Price** integration, populating Leo with full telemetry and auto-executing an institutional auction audit.

---

## 11. Wyckoff Structure Line Engine & Trendline Setup Evaluation

TradePulse embeds the complete Wyckoff Structure Line & Auction Market Theory Strategy Engine (`lib/trading/wyckoffStrategy.ts`):

### 11.1 Dynamic Trendline Classification (`classifyWyckoffLine`)
When traders draw trendlines on the chart canvas (Hotkey: `W` or `X`), the engine classifies the line automatically:
- **Descending Slope ($p_2 \le p_1$)**: **Wyckoff Supply Line (Creek)** (`#f59e0b`, Warm Amber/Gold). Acts as primary resistance boundary.
- **Ascending Slope ($p_2 > p_1$)**: **Wyckoff Demand Line (Ice)** (`#38bdf8`, Sky Blue). Acts as primary support boundary.
- **Horizontal / S/R Lines**: Classified based on trader label (`support`/`demand` vs. `resistance`/`supply`) or price relation.

### 11.2 The 4 Intraday Execution Setups (`evaluateWyckoffSetup`)
The chart canvas continuously evaluates price interaction against active Wyckoff lines:
1. **Demand Line $\rightarrow$ Spring (Long)**: Price sweeps underneath the Ice line $\rightarrow$ sellers fail to continue lower $\rightarrow$ price reclaims above line.
   - **Stop**: Strictly below Spring low.
   - **CVD**: Bullish absorption (price equal/higher low, CVD lower low).
2. **Demand Line $\rightarrow$ Breakdown Failed Reclaim (Short)**: Price breaks Ice line with initiative drive $\rightarrow$ weak pullback fails to reclaim $\rightarrow$ Short continuation.
3. **Supply Line $\rightarrow$ Upthrust (Short)**: Price sweeps above Creek line $\rightarrow$ buyers fail to expand $\rightarrow$ price returns below line.
   - **Stop**: Strictly above Upthrust high.
   - **CVD**: Bearish absorption (price same/lower high, CVD higher high).
4. **Supply Line $\rightarrow$ Breakout Retest (Long - SOS $\rightarrow$ LPS)**: Price destroys Creek line with initiative volume $\rightarrow$ pullback holds as new support $\rightarrow$ Long continuation. **Never chase initial breakout.**

### 11.3 Mandatory $\ge 2.0\text{R}$ Target Verification (Rules 17 & 20)
- Before signaling a valid trade, the engine calls `findNextStructuralTarget()`, projecting reward to the nearest opposing pre-marked Tier-1 zone (5D POC/VAH/VAL, Yesterday VAH/VAL/POC, Overnight High/Low).
- If distance to the next major obstacle provides $< 2.0\text{R}$ risk/reward, `is2RValid` returns `false` and the setup is **STAND ASIDE**.

### 11.4 Midpoint Evaluation Badge & Canvas Overlays
- **Midpoint Badge**: Displays live classification tag: `📐 Wyckoff Demand Line (Ice) · Spring Setup | Stop: 21,480.0 | Tgt: 21,550.0 (2.4R) 🟢`.
- **Structural Invalidation Lines**: Automatically projects dashed price lines for structural stop loss and target zones directly on the chart canvas.

---

## 12. Top Chart HUD Quick Action Links

The top chart HUD strip integrates convenient 1-click action links:
- **Session VWAP HUD**: Clean readout displaying active session VWAP level.
- **Cumulative Volume Delta (`CVD`)**: `[📊 CVD: ON/OFF]` button toggles the synchronized CVD sub-chart pane.
- **5-Month Macro AVWAP (`5M AVWAP`)**: `[🟢 5M AVWAP: <price> 5 MO]` button placed directly next to `CVD`. Keeps the chart canvas clean and invisible by default while opening the comprehensive 5-Month Benchmark Inspection Modal on click.
- **Dalton Day Type**: `Day: {badgeText} [🤖 Ask Leo]` to evaluate session distribution and auction tails.
- **Audit Order Flow**: `[🤖 Audit Order Flow]` button placed next to CVD.
- **Compare Range Volume**: `[📈 Compare Range Volume]` button on the top HUD to compare volume across all user-drawn range boxes.
- **Auction Critique**: `[⚖️ Critique: STANDBY/DISCOUNT/PREMIUM]` button (Hotkey: `Q`).
