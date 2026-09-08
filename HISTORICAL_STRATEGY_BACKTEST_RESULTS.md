# Historical Strategy Backtest Results (1-Year / 365 Days Lookback)

## Confluence Divergence Strategy
**Methodology:** Market Profile Value Area (Yesterday VAH/VAL/POC) + Session VWAP $\pm1\sigma$ + John Kurisko Stochastic (14,3,3) Divergence.
**Lookback Horizon:** 365 Days (Full 1-Year Multi-Market Simulation)

---

### Portfolio Performance Summary (DOW, NASDAQ, GOLD, CRUDE)

| Metric | Portfolio Value |
| :--- | :--- |
| **Total Trades** | **1721** |
| **Win Rate** | **35.2%** (605 W / 1116 L) |
| **Profit Factor** | **1.06** |
| **Gross Profit** | **+$113,652** |
| **Gross Loss** | **-$106,797** |
| **Net Profit** | **+$6,855** |
| **Total R-Multiple** | **+73.9R** |

---

### Breakdown By Instrument

| Instrument | Trades | Win Rate | Profit Factor | Net PnL ($) | Max Drawdown | Total R |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DOW** | 562 | 33.3% | 0.98 | +$-289 | $2,534 | +12.4R |
| **NASDAQ** | 516 | 32.4% | 0.96 | +$-2,006 | $5,224 | +12R |
| **GOLD** | 458 | 40.2% | 1.32 | +$10,248 | $2,245 | +64.4R |
| **CRUDE** | 185 | 36.2% | 0.82 | +$-1,098 | $1,921 | +-14.9R |

---

### Individual Trade Log Sample (Last 10 Trades)

| # | Date | Market | Direction | Entry | Stop Loss | Exit | Result | PnL ($) | R | Location Setup |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 171 | 2026-08-20 | CRUDE | **SELL** | 86.981 | 87.36 | 87.36 | LOSS | $-76 | -1R | VWAP +1σ Upper Band Resistance |
| 172 | 2026-08-20 | CRUDE | **SELL** | 87.207 | 87.49 | 87.06899999999999 | WIN_PARTIAL | +$28 | +0.49R | VWAP +1σ Upper Band Resistance |
| 173 | 2026-08-21 | CRUDE | **BUY** | 87.187 | 86.92 | 87.04599999999999 | LOSS | $-28 | -0.53R | VWAP -1σ Lower Band Support |
| 174 | 2026-08-24 | CRUDE | **BUY** | 85.089 | 84.75 | 85.279 | WIN_FULL | +$38 | +0.56R | VWAP -1σ Lower Band Support |
| 175 | 2026-08-25 | CRUDE | **BUY** | 82.437 | 82.11 | 82.11 | LOSS | $-65 | -1R | VWAP -1σ Lower Band Support |
| 176 | 2026-08-26 | CRUDE | **SELL** | 82.48899999999999 | 82.9 | 82.9 | LOSS | $-82 | -1R | Yesterday VAH Resistance |
| 177 | 2026-08-26 | CRUDE | **BUY** | 82.17699999999999 | 81.96 | 82.121 | LOSS | $-11 | -0.26R | Yesterday VAL Support |
| 178 | 2026-08-27 | CRUDE | **SELL** | 82.91499999999999 | 83.13 | 83.13 | LOSS | $-43 | -1R | Yesterday VAH Resistance |
| 179 | 2026-08-27 | CRUDE | **SELL** | 82.964 | 83.34 | 83.34 | LOSS | $-75 | -1R | Yesterday VAH Resistance |
| 180 | 2026-08-28 | CRUDE | **SELL** | 83.297 | 83.64 | 83.64 | LOSS | $-69 | -1R | VWAP +1σ Upper Band Resistance |
| 181 | 2026-08-28 | CRUDE | **SELL** | 83.573 | 83.92 | 83.58 | LOSS | $-1 | -0.02R | Yesterday VAH Resistance |
| 182 | 2026-09-02 | CRUDE | **SELL** | 90.776 | 91.14 | 91.14 | LOSS | $-73 | -1R | Yesterday VAH Resistance |
| 183 | 2026-09-03 | CRUDE | **SELL** | 91.99199999999999 | 92.33 | 91.792 | WIN_PARTIAL | +$40 | +0.59R | VWAP +1σ Upper Band Resistance |
| 184 | 2026-09-04 | CRUDE | **SELL** | 91.67299999999999 | 92 | 91.44999999999999 | WIN_PARTIAL | +$45 | +0.68R | Yesterday VAH Resistance |
| 185 | 2026-09-07 | CRUDE | **BUY** | 92.454 | 92.23 | 92.583 | WIN_FULL | +$26 | +0.58R | VWAP -1σ Lower Band Support |
