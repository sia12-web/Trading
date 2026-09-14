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
│ HUD Status Bar (Live Price, 5M VWAP Readout, CVD Stats, Tooltips)      │
├────────────────────────────────────────────────────────────────────────┤
│ Main Chart Pane:                                                       │
│   Layer 0: Lightweight Charts Candlestick Series (#089981 / #f23645)   │
│   Layer 1: Anchored VWAP + Standard Deviation Bands (±1σ, ±2σ, ±3σ)    │
│   Layer 2: Volume Histogram Series Overlay (Bottom Margin)             │
│   Layer 3: HTML5 2D Canvas: Session Boxes, Dalton Spikes, FRVP POC     │
│   Layer 4: HTML5 2D Canvas: Daily Tested Highs/Lows with Traded Volume │
│   Layer 5: HTML5 2D Canvas: User Drawings & Leo Long-Term Memory Boxes │
│   Layer 6: Interactive Crosshair & OHLCV Tooltip                       │
├────────────────────────────────────────────────────────────────────────┤
│ Cumulative Volume Delta (CVD) Candlestick Sub-Pane (Collapsible)       │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Institutional Candlestick Styling
To ensure immediate visual clarity and eliminate distracting instrument color overrides, all markets (DOW, NASDAQ, GOLD, CRUDE, NIKKEI) enforce standard institutional colors:
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

## 2. Anchored VWAP & Standard Deviation Bands

Volume-Weighted Average Price (VWAP) represents the true institutional benchmark price. TradePulse computes two distinct AVWAP models based on the active timeframe:

### 2.1 Daily Chart (`1D`): 5-Month Anchored VWAP
- **Anchor Point**: RTH open 5 months prior to the current date.
- **Mathematical Formulation**:
  $$\text{VWAP}_t = \frac{\sum_{i=1}^t P_i \times V_i}{\sum_{i=1}^t V_i}$$
  $$\sigma_t = \sqrt{\frac{\sum_{i=1}^t P_i^2 \times V_i}{\sum_{i=1}^t V_i} - (\text{VWAP}_t)^2}$$
- **Volatility Bands**:
  - **Upper 1σ / Lower 1σ**: $\text{VWAP} \pm 1\sigma$ (Blue `#3b82f6` / Gold `#b8a04a`)
  - **Upper 2σ / Lower 2σ**: $\text{VWAP} \pm 2\sigma$ (Teal `#3d8f7a`)
  - **Upper 3σ / Lower 3σ**: $\text{VWAP} \pm 3\sigma$ (Subtle Teal `#3d8f7a`)
- **Axis Readout**: `lastValueVisible: true` ensures exact numerical price tags are pinned to the right price scale.

### 2.2 Intraday Charts (`1m`, `5m`, `30m`): Session Anchored VWAP + Macro 5M Line
- **Intraday Anchored VWAP**: Anchors to the active session cash open, wrapping the candlesticks tightly within intraday statistical deviation bands.
- **Macro 5M Benchmark Line**: A horizontal dashed cyan line (`paint5mAvwapBenchmark`) displays the 5-month macro anchor level simultaneously, giving traders both immediate scalp context and institutional macro inflection levels.

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
