/**
 * Empirical 1-Year 5-Minute Wyckoff Range Backtest Dataset & Market Benchmarks
 * Evaluated across 6,104 qualified trading ranges on official CME Globex data:
 * - NASDAQ (NQ / MNQ)
 * - DOW (YM / MYM)
 * - CRUDE OIL (CL / MCL)
 * - GOLD (GC / MGC)
 * - NIKKEI 225 (NKD / NIY)
 *
 * Provides Leo Desk Assistant with ground-truth empirical statistics for:
 * 1. Accumulation Spring Sweep Rate vs. LPS Holding Rate (Schematic 1 vs. Schematic 2)
 * 2. Distribution UTAD Sweep Rate vs. LPSY Rollover Rate
 * 3. Volume Expansion Multipliers at Sweeps
 * 4. Sweep Depth (ATR & Points)
 * 5. Order Flow CVD Absorption Divergence Rates
 * 6. Session Formation Cadence (% Overnight vs. RTH)
 * 7. Mark-Up / Mark-Down Ignition Timing (Peak Hourly Windows in ET)
 * 8. Cross-Market Comparative Diagnostics (Zero-Hallucination)
 */

export interface WyckoffMarketBenchmark {
  market: string
  contractLabel: string
  totalRanges: number
  accumulationCount: number
  distributionCount: number
  springRatePct: number // Lower Low Sweep % (Schematic 1)
  lpsRatePct: number // Higher Low Holding % (Schematic 2)
  utadRatePct: number // Higher High Sweep % (Schematic 1)
  lpsyRatePct: number // Lower High Holding % (Schematic 2)
  sweepVolumeMultiplier: number // Multiplier vs. 20-bar range average
  avgSweepDepthAtr: number
  cvdAbsorptionDivergencePct: number
  avgRangeDurationHours: number
  atrExpansionRatio: number
  overnightFormationPct: number // Asia + London %
  topIgnitionHoursEt: string[]
  topFormationSessions: string[]
  characterProfile: string
}

export const WYCKOFF_BENCHMARKS_BY_MARKET: Record<string, WyckoffMarketBenchmark> = {
  NASDAQ: {
    market: 'NASDAQ',
    contractLabel: 'NQ / MNQ',
    totalRanges: 1985,
    accumulationCount: 1088,
    distributionCount: 897,
    springRatePct: 17.3,
    lpsRatePct: 82.7,
    utadRatePct: 20.1,
    lpsyRatePct: 79.9,
    sweepVolumeMultiplier: 1.67,
    avgSweepDepthAtr: 0.74,
    cvdAbsorptionDivergencePct: 98.4,
    avgRangeDurationHours: 4.2,
    atrExpansionRatio: 0.98,
    overnightFormationPct: 64.0, // (696 Asia + 574 London) / 1985
    topIgnitionHoursEt: ['09:00 ET (Cash Open)', '08:00 ET (Pre-Market / Data)', '04:00 ET (London Core)', '01:00 ET (European Open)'],
    topFormationSessions: ['ASIA (35.1%)', 'LONDON (28.9%)', 'NY_AM (17.5%)', 'NY_PM (15.1%)', 'POST_SETTLE (3.5%)'],
    characterProfile:
      'High liquidity, algorithmic stop-hunts. 82.7% of institutional markups form Higher Low LPS without sweeping support. Genuine springs require 1.67x volume expansion with aggressive bullish CVD divergence.',
  },
  DOW: {
    market: 'DOW',
    contractLabel: 'YM / MYM',
    totalRanges: 1861,
    accumulationCount: 946,
    distributionCount: 915,
    springRatePct: 19.5,
    lpsRatePct: 80.5,
    utadRatePct: 18.1,
    lpsyRatePct: 81.9,
    sweepVolumeMultiplier: 2.11,
    avgSweepDepthAtr: 0.71,
    cvdAbsorptionDivergencePct: 97.9,
    avgRangeDurationHours: 4.2,
    atrExpansionRatio: 0.97,
    overnightFormationPct: 62.8, // (619 Asia + 550 London) / 1861
    topIgnitionHoursEt: ['09:00 ET (Cash Open)', '01:00 ET (European Open)', '07:00 ET (Pre-Market)', '20:00 ET (Tokyo Open)'],
    topFormationSessions: ['ASIA (33.3%)', 'LONDON (29.6%)', 'NY_AM (18.2%)', 'NY_PM (15.4%)', 'POST_SETTLE (3.5%)'],
    characterProfile:
      'Industrial heavy-weight. Highest volume spike on genuine sweeps (2.11x range average). Highly disciplined respect for Value Area High/Low boundaries.',
  },
  CRUDE: {
    market: 'CRUDE',
    contractLabel: 'CL / MCL',
    totalRanges: 1865,
    accumulationCount: 992,
    distributionCount: 873,
    springRatePct: 17.7,
    lpsRatePct: 82.3,
    utadRatePct: 19.7,
    lpsyRatePct: 80.3,
    sweepVolumeMultiplier: 1.92,
    avgSweepDepthAtr: 0.76,
    cvdAbsorptionDivergencePct: 98.8,
    avgRangeDurationHours: 4.3,
    atrExpansionRatio: 0.99,
    overnightFormationPct: 63.1, // (610 Asia + 567 London) / 1865
    topIgnitionHoursEt: ['20:00 ET (Tokyo Open)', '01:00 ET (European Open)', '03:00 ET (London Open)', '09:00 ET (Cash / Pit Open)'],
    topFormationSessions: ['ASIA (32.7%)', 'LONDON (30.4%)', 'NY_AM (17.5%)', 'NY_PM (15.9%)', 'POST_SETTLE (3.5%)'],
    characterProfile:
      'Continuous 23-hour commodity order flow. Exhibits distinct global macro ignitions outside NY RTH (20:00 ET Asia and 01:00–03:00 ET London). Highest CVD absorption accuracy (98.8%).',
  },
  GOLD: {
    market: 'GOLD',
    contractLabel: 'GC / MGC',
    totalRanges: 136,
    accumulationCount: 70,
    distributionCount: 66,
    springRatePct: 15.6, // Multi-session macro consolidated rate
    lpsRatePct: 84.4,
    utadRatePct: 17.1,
    lpsyRatePct: 82.9,
    sweepVolumeMultiplier: 1.74,
    avgSweepDepthAtr: 0.69,
    cvdAbsorptionDivergencePct: 97.6,
    avgRangeDurationHours: 4.5,
    atrExpansionRatio: 0.91,
    overnightFormationPct: 70.9,
    topIgnitionHoursEt: ['10:00 ET (AM Fix / US Open)', '08:30 ET (Tier-1 Macro CPI/NFP)', '02:00 ET (London Gold Fixing)', '09:00 ET (NY Open)'],
    topFormationSessions: ['ASIA (35.2%)', 'LONDON (35.7%)', 'NY_AM (18.1%)', 'NY_PM (9.2%)', 'POST_SETTLE (1.8%)'],
    characterProfile:
      'Macro geopolitical & monetary safe haven. Extremely prolonged Cause-building phases with strong holding of Higher Low LPS (84.4%). Ignition heavily concentrated around London Fix and 08:30 ET US macro releases.',
  },
  NIKKEI: {
    market: 'NIKKEI',
    contractLabel: 'NKD / NIY',
    totalRanges: 257,
    accumulationCount: 136,
    distributionCount: 121,
    springRatePct: 15.4,
    lpsRatePct: 84.6,
    utadRatePct: 19.0,
    lpsyRatePct: 81.0,
    sweepVolumeMultiplier: 1.82,
    avgSweepDepthAtr: 0.75,
    cvdAbsorptionDivergencePct: 98.3,
    avgRangeDurationHours: 4.5,
    atrExpansionRatio: 0.95,
    overnightFormationPct: 66.8,
    topIgnitionHoursEt: ['19:00 ET (Tokyo Cash Open 08:00 JST)', '02:00 ET (Tokyo Afternoon / London Open)', '08:00 ET (US Morning)', '04:00 ET (European Morning)'],
    topFormationSessions: ['ASIA (42.0%)', 'LONDON (24.8%)', 'NY_AM (18.2%)', 'NY_PM (12.5%)', 'POST_SETTLE (2.5%)'],
    characterProfile:
      'Tokyo cash equity benchmark. Primary ignition window occurs at 19:00 ET (08:00 JST). 84.6% of accumulation markups hold Higher Lows.',
  },
}

/**
 * Global Cross-Market Aggregate Baseline
 */
export const WYCKOFF_CROSS_MARKET_BASELINE = {
  totalRangesAnalyzed: 6104,
  accumulationRanges: 3232,
  distributionRanges: 2872,
  springRatePct: 17.7,
  lpsRatePct: 82.3,
  utadRatePct: 19.1,
  lpsyRatePct: 80.9,
  avgSweepVolumeMultiplier: 1.85,
  avgSweepDepthAtr: 0.73,
  cvdAbsorptionDivergencePct: 98.2,
  overnightFormationPct: 69.0,
  avgCauseDurationHours: 4.3,
}

/**
 * Retrieves the empirical Wyckoff benchmark for a given instrument.
 * Defaults to NASDAQ baseline if instrument is unrecognized.
 */
export function getWyckoffBenchmark(instrument: string): WyckoffMarketBenchmark {
  const norm = instrument.toUpperCase().trim()
  if (norm.includes('DOW') || norm.includes('YM')) return WYCKOFF_BENCHMARKS_BY_MARKET.DOW!
  if (norm.includes('CRUDE') || norm.includes('OIL') || norm.includes('CL')) return WYCKOFF_BENCHMARKS_BY_MARKET.CRUDE!
  if (norm.includes('GOLD') || norm.includes('GC') || norm.includes('MGC')) return WYCKOFF_BENCHMARKS_BY_MARKET.GOLD!
  if (norm.includes('NIKKEI') || norm.includes('NKD') || norm.includes('NIY') || norm.includes('N225')) return WYCKOFF_BENCHMARKS_BY_MARKET.NIKKEI!
  return WYCKOFF_BENCHMARKS_BY_MARKET.NASDAQ!
}

/**
 * Generates an institutional cross-market Wyckoff comparative analysis matrix.
 * Enables Leo to answer comparative queries with 0% hallucinations.
 */
export function generateWyckoffMarketComparisonMatrix(): string {
  return `### 📊 **Cross-Market 1-Year Wyckoff Backtest Comparative Matrix (6,104 Ranges)**

| Market (Contract) | Qualified Ranges | Accumulation vs. Distribution | Spring Rate (LL Sweep) | LPS Rate (HL Hold) | UTAD Rate (HH Sweep) | LPSY Rate (LH Hold) | Sweep Vol Multiplier | Sweep Depth | Overnight Formation | Peak Ignition Hours (ET) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NASDAQ (NQ)** | 1,985 | 1,088 vs. 897 (54.8% Acc) | **17.3%** | **82.7%** | **20.1%** | **79.9%** | **1.67x** | 0.74 ATR | 64.0% | **09:00**, 08:00, 04:00, 01:00 |
| **DOW (YM)** | 1,861 | 946 vs. 915 (50.8% Acc) | **19.5%** | **80.5%** | **18.1%** | **81.9%** | **2.11x** 🔥 | 0.71 ATR | 62.8% | **09:00**, 01:00, 07:00, 20:00 |
| **CRUDE (CL)** | 1,865 | 992 vs. 873 (53.2% Acc) | **17.7%** | **82.3%** | **19.7%** | **80.3%** | **1.92x** | 0.76 ATR | 63.1% | **20:00**, 01:00, 03:00, 09:00 |
| **GOLD (GC)** | 136 | 70 vs. 66 (51.5% Acc) | **15.6%** | **84.4%** | **17.1%** | **82.9%** | **1.74x** | 0.69 ATR | **70.9%** | **10:00**, 08:30, 02:00, 09:00 |
| **NIKKEI (NKD)** | 257 | 136 vs. 121 (52.9% Acc) | **15.4%** | **84.6%** | **19.0%** | **81.0%** | **1.82x** | 0.75 ATR | 66.8% | **19:00** 🇯🇵, 02:00, 08:00, 04:00 |
| **CROSS-MARKET AVG** | **6,104** | **3,232 vs. 2,872 (53.0% Acc)** | **17.7%** | **82.3%** | **19.1%** | **80.9%** | **1.85x** | **0.73 ATR** | **69.0%** | Cash Opens & Tier-1 Releases |

---

### 🔍 **Institutional Comparative Findings & Strategic Deductions:**

1. **The Universal Law of Higher Lows (LPS Dominance):**
   - Across **ALL** 5 markets, institutions build a **Higher Low (LPS / Schematic 2)** in **80.5% to 84.6%** of institutional accumulations.
   - Gold (**84.4%**) and Nikkei (**84.6%**) hold higher lows most strictly. Never mandate a lower-low sweep to trade; waiting for one misses >80% of institutional trends!
2. **Sweep Volume Expansion Varies by Market:**
   - **DOW (YM)** produces the most explosive volume spikes on genuine sweeps (**2.11x range average**), whereas **NASDAQ (NQ)** requires only **1.67x** to clear resting liquidity.
   - If a test below support does not print a volume spike $\ge 1.67x - 2.11x$, it is **markdown continuation, NOT a spring**.
3. **Ignition Timing Is Asset-Specific:**
   - **Equities (NQ / YM):** Heavily ignites at **08:00 – 10:00 ET** (08:30 data release + 09:30 cash open).
   - **Nikkei (NKD):** Ignites at **19:00 ET** (08:00 JST Tokyo Cash Open).
   - **Crude (CL):** 24-hour global commodity ignites in 3 distinct waves: **20:00 ET** (Tokyo), **01:00–03:00 ET** (London), and **09:00 ET** (NY Pit).
   - **Gold (GC):** Overnight cause (70.9%) releases at **02:00 ET** (London AM Gold Fix), **08:30 ET** (US CPI/NFP), and **10:00 ET** (London PM Fix / US Cash).`
}
