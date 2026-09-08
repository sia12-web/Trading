# Historical Strategy Backtest Results

## Confluence Divergence Strategy
**Methodology:** Market Profile Value Area (Yesterday VAH/VAL/POC) + Session VWAP $\pm1\sigma$ + John Kurisko Stochastic (14,3,3) Divergence.

---

### Portfolio Performance Summary (DOW, NASDAQ, GOLD)

| Metric | Portfolio Value |
| :--- | :--- |
| **Total Trades** | **257** |
| **Win Rate** | **34.2%** (88 W / 169 L) |
| **Profit Factor** | **1.15** |
| **Gross Profit** | **+$16,901** |
| **Gross Loss** | **-$14,742** |
| **Net Profit** | **+$2,159** |
| **Total R-Multiple** | **+27.5R** |

---

### Breakdown By Instrument

| Instrument | Trades | Win Rate | Profit Factor | Net PnL ($) | Max Drawdown | Total R |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DOW** | 67 | 38.8% | 1.15 | +$181 | $309 | +10.5R |
| **NASDAQ** | 69 | 26.1% | 0.8 | +$-1,200 | $2,252 | +-8.4R |
| **GOLD** | 64 | 34.4% | 1.69 | +$3,557 | $872 | +26.1R |
| **CRUDE** | 57 | 38.6% | 0.83 | +$-379 | $814 | +-0.7R |

---

### Individual Trade Log Sample (Last 10 Trades)

| # | Date | Market | Direction | Entry | Stop Loss | Exit | Result | PnL ($) | R | Location Setup |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 43 | 2026-08-31 | CRUDE | **SELL** | 85.85 | 86.19 | 85.17 | WIN_FULL | +$101 | +1.49R | VWAP +1σ Upper Band Resistance |
| 44 | 2026-08-31 | CRUDE | **BUY** | 85.047 | 84.76 | 85.62 | WIN_FULL | +$91 | +1.58R | VWAP -1σ Lower Band Support |
| 45 | 2026-09-01 | CRUDE | **SELL** | 86.872 | 87.25 | 87.25 | LOSS | $-76 | -1R | VWAP +1σ Upper Band Resistance |
| 46 | 2026-09-02 | CRUDE | **SELL** | 90.968 | 91.31 | 90.968 | WIN_PARTIAL | +$136 | +1.98R | Yesterday VAH Resistance |
| 47 | 2026-09-02 | CRUDE | **SELL** | 90.911 | 91.28 | 91.28 | LOSS | $-74 | -1R | Yesterday VAH Resistance |
| 48 | 2026-09-02 | CRUDE | **SELL** | 91.221 | 91.61 | 91.61 | LOSS | $-78 | -1R | VWAP +1σ Upper Band Resistance |
| 49 | 2026-09-03 | CRUDE | **BUY** | 90.703 | 90.48 | 90.48 | LOSS | $-45 | -1R | Yesterday VAL Support |
| 50 | 2026-09-03 | CRUDE | **SELL** | 91.518 | 91.79 | 91.79 | LOSS | $-54 | -1R | Yesterday VAH Resistance |
| 51 | 2026-09-04 | CRUDE | **BUY** | 91.674 | 91.32 | 91.32 | LOSS | $-71 | -1R | Yesterday VAL Support |
| 52 | 2026-09-04 | CRUDE | **SELL** | 91.738 | 92.01 | 91.393 | WIN_PARTIAL | +$69 | +1.27R | VWAP +1σ Upper Band Resistance |
| 53 | 2026-09-07 | CRUDE | **SELL** | 92.344 | 92.6 | 92.6 | LOSS | $-51 | -1R | VWAP +1σ Upper Band Resistance |
| 54 | 2026-09-07 | CRUDE | **SELL** | 92.37 | 92.66 | 92.66 | LOSS | $-58 | -1R | VWAP +1σ Upper Band Resistance |
| 55 | 2026-09-07 | CRUDE | **SELL** | 92.729 | 93.04 | 92.586 | WIN_PARTIAL | +$29 | +0.46R | VWAP +1σ Upper Band Resistance |
| 56 | 2026-09-08 | CRUDE | **SELL** | 93.049 | 93.3 | 93.3 | LOSS | $-50 | -1R | Yesterday VAH Resistance |
| 57 | 2026-09-08 | CRUDE | **BUY** | 93.004 | 92.46 | 92.46 | LOSS | $-109 | -1R | Yesterday VAL Support |
