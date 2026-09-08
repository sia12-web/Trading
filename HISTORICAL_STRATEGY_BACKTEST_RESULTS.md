# Historical Strategy Backtest Results

## Confluence Divergence Strategy
**Methodology:** Market Profile Value Area (Yesterday VAH/VAL/POC) + Session VWAP $\pm1\sigma$ + John Kurisko Stochastic (14,3,3) Divergence.

---

### Portfolio Performance Summary (DOW, NASDAQ, GOLD)

| Metric | Portfolio Value |
| :--- | :--- |
| **Total Trades** | **257** |
| **Win Rate** | **36.6%** (94 W / 163 L) |
| **Profit Factor** | **1.21** |
| **Gross Profit** | **+$17,271** |
| **Gross Loss** | **-$14,245** |
| **Net Profit** | **+$3,026** |
| **Total R-Multiple** | **+35.7R** |

---

### Breakdown By Instrument

| Instrument | Trades | Win Rate | Profit Factor | Net PnL ($) | Max Drawdown | Total R |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DOW** | 67 | 37.3% | 1.1 | +$123 | $318 | +6.3R |
| **NASDAQ** | 69 | 27.5% | 0.8 | +$-1,233 | $2,055 | +-6.7R |
| **GOLD** | 64 | 37.5% | 1.79 | +$3,917 | $871 | +28.3R |
| **CRUDE** | 57 | 45.6% | 1.11 | +$219 | $526 | +7.8R |

---

### Individual Trade Log Sample (Last 10 Trades)

| # | Date | Market | Direction | Entry | Stop Loss | Exit | Result | PnL ($) | R | Location Setup |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 43 | 2026-08-31 | CRUDE | **SELL** | 85.72999999999999 | 86.07 | 85.05 | WIN_FULL | +$101 | +1.49R | VWAP +1σ Upper Band Resistance |
| 44 | 2026-08-31 | CRUDE | **BUY** | 84.92699999999999 | 84.64 | 85.5 | WIN_FULL | +$91 | +1.58R | VWAP -1σ Lower Band Support |
| 45 | 2026-09-01 | CRUDE | **SELL** | 86.752 | 87.13 | 87.13 | LOSS | $-76 | -1R | VWAP +1σ Upper Band Resistance |
| 46 | 2026-09-02 | CRUDE | **SELL** | 90.832 | 91.18 | 90.832 | WIN_PARTIAL | +$151 | +2.18R | Yesterday VAH Resistance |
| 47 | 2026-09-02 | CRUDE | **SELL** | 90.791 | 91.16 | 91.16 | LOSS | $-74 | -1R | Yesterday VAH Resistance |
| 48 | 2026-09-02 | CRUDE | **SELL** | 91.101 | 91.49 | 91.49 | LOSS | $-78 | -1R | VWAP +1σ Upper Band Resistance |
| 49 | 2026-09-03 | CRUDE | **SELL** | 91.16499999999999 | 91.53 | 90.5 | WIN_FULL | +$98 | +1.34R | Yesterday VAH Resistance |
| 50 | 2026-09-03 | CRUDE | **SELL** | 91.398 | 91.67 | 91.67 | LOSS | $-54 | -1R | Yesterday VAH Resistance |
| 51 | 2026-09-04 | CRUDE | **SELL** | 92.05799999999999 | 92.38 | 91.25 | WIN_FULL | +$92 | +1.42R | Yesterday VAH Resistance |
| 52 | 2026-09-04 | CRUDE | **SELL** | 91.618 | 91.89 | 91.273 | WIN_PARTIAL | +$69 | +1.27R | VWAP +1σ Upper Band Resistance |
| 53 | 2026-09-07 | CRUDE | **SELL** | 92.22399999999999 | 92.48 | 92.48 | LOSS | $-51 | -1R | VWAP +1σ Upper Band Resistance |
| 54 | 2026-09-07 | CRUDE | **SELL** | 92.25 | 92.54 | 92.54 | LOSS | $-58 | -1R | VWAP +1σ Upper Band Resistance |
| 55 | 2026-09-07 | CRUDE | **SELL** | 92.609 | 92.92 | 92.466 | WIN_PARTIAL | +$29 | +0.46R | VWAP +1σ Upper Band Resistance |
| 56 | 2026-09-08 | CRUDE | **SELL** | 92.74799999999999 | 93.01 | 93.01 | LOSS | $-52 | -1R | Yesterday VAH Resistance |
| 57 | 2026-09-08 | CRUDE | **BUY** | 92.884 | 92.34 | 92.34 | LOSS | $-109 | -1R | Yesterday VAL Support |
