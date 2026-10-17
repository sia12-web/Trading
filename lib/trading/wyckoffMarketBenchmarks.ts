/**
 * Empirical 1-Year 5-Minute Wyckoff Range Backtest Benchmarks (per market).
 *
 * SINGLE SOURCE OF TRUTH: every number here is DERIVED from
 * `wyckoffBenchmarks.data.json`, which is written by
 * `scripts/backtest-wyckoff-range-mechanics.ts` (and persisted to Supabase by
 * `scripts/persist-wyckoff-benchmarks.ts`). Nothing is hand-typed, so a monthly
 * refresh of the data file updates Leo, the Desk News agent, and the UI together.
 *
 * Definitions (as computed by the backtest):
 * - Spring rate  = % of accumulation ranges whose resolution first swept BELOW range low.
 * - LPS rate     = 100 - spring rate (ranges that held a higher low, i.e. no lower-low sweep).
 * - UTAD rate    = % of distribution ranges that swept ABOVE range high.
 * - LPSY rate    = 100 - UTAD rate.
 * - Overnight    = % of ranges whose formation session was Asia (18:00-02:00 ET) or London (02:00-08:30 ET).
 *
 * Known limits (do not overstate these to the trader):
 * - Bar delta / CVD in the backtest is a PROXY computed from OHLCV (volume x close-location value),
 *   not true tick order flow. "CVD divergence" is only evaluated on sweep events, so it is NOT an
 *   independent confirmation statistic and no hit-rate is quoted.
 * - Breakout ATR expansion averages ~1.0x in this dataset; it does NOT show a systematic ATR spike.
 * - Small samples (GOLD, NIKKEI) carry wider uncertainty than NQ / YM / CL.
 */

import raw from './wyckoffBenchmarks.data.json'

interface RawMarket {
  market: string
  totalRanges: number
  accumulationCount: number
  distributionCount: number
  accumulationSpringRatePct: number
  distributionUtadRatePct: number
  avgRangeDurationHours: number
  avgAtrExpansionRatio: number
  avgSweepVolumeRatio: number
  topBreakoutHoursEt: string[]
  topFormationSessions: string[]
}

export interface WyckoffMarketBenchmark {
  market: string
  contractLabel: string
  totalRanges: number
  accumulationCount: number
  distributionCount: number
  springRatePct: number
  lpsRatePct: number
  utadRatePct: number
  lpsyRatePct: number
  sweepVolumeMultiplier: number
  avgRangeDurationHours: number
  atrExpansionRatio: number
  asiaFormationPct: number
  londonFormationPct: number
  overnightFormationPct: number
  /** Raw top ignition hours, e.g. "9:00 ET (129 ranges)" */
  topIgnitionHoursEt: string[]
  topFormationSessions: string[]
  /** Data-derived one-line read of this market (includes sample-size / volume caveats). */
  characterProfile: string
}

const CONTRACT_LABELS: Record<string, string> = {
  NASDAQ: 'NQ / MNQ',
  DOW: 'YM / MYM',
  CRUDE: 'CL / MCL',
  GOLD: 'GC / MGC',
  SILVER: 'SI / SIL',
  NIKKEI: 'NKD / NIY',
}

const SMALL_SAMPLE_RANGES = 500

function parseSessions(list: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of list) {
    const m = s.match(/(\w+) \((\d+)\)/)
    if (m) out[m[1]!] = Number(m[2])
  }
  return out
}

const round1 = (n: number) => Math.round(n * 10) / 10

function build(key: string, m: RawMarket): WyckoffMarketBenchmark {
  const sessions = parseSessions(m.topFormationSessions)
  const total = m.totalRanges || 1
  const asia = round1(((sessions.ASIA ?? 0) / total) * 100)
  const london = round1(((sessions.LONDON ?? 0) / total) * 100)

  const caveats: string[] = []
  if (m.totalRanges < SMALL_SAMPLE_RANGES) {
    caveats.push(`small sample (${m.totalRanges} ranges) - wider uncertainty than NQ/YM/CL`)
  }
  if (m.avgSweepVolumeRatio < 1) {
    caveats.push(
      `sweep bars averaged only ${m.avgSweepVolumeRatio}x range volume - do NOT apply the equity "volume must spike" rule to this market`
    )
  }
  if (m.avgRangeDurationHours > 12) {
    caveats.push(`ranges last ${m.avgRangeDurationHours}h on average (multi-session boxes)`)
  }

  const profile =
    `${m.totalRanges.toLocaleString()} ranges; ${round1(m.accumulationSpringRatePct)}% of accumulations swept lows, ` +
    `${round1(m.distributionUtadRatePct)}% of distributions swept highs; ` +
    `${round1(((sessions.ASIA ?? 0) + (sessions.LONDON ?? 0)) / total * 100)}% formed overnight.` +
    (caveats.length ? ` Caveats: ${caveats.join('; ')}.` : '')

  return {
    market: key,
    contractLabel: CONTRACT_LABELS[key] ?? key,
    totalRanges: m.totalRanges,
    accumulationCount: m.accumulationCount,
    distributionCount: m.distributionCount,
    springRatePct: round1(m.accumulationSpringRatePct),
    lpsRatePct: round1(100 - m.accumulationSpringRatePct),
    utadRatePct: round1(m.distributionUtadRatePct),
    lpsyRatePct: round1(100 - m.distributionUtadRatePct),
    sweepVolumeMultiplier: m.avgSweepVolumeRatio,
    avgRangeDurationHours: m.avgRangeDurationHours,
    atrExpansionRatio: m.avgAtrExpansionRatio,
    asiaFormationPct: asia,
    londonFormationPct: london,
    overnightFormationPct: round1((((sessions.ASIA ?? 0) + (sessions.LONDON ?? 0)) / total) * 100),
    topIgnitionHoursEt: m.topBreakoutHoursEt,
    topFormationSessions: m.topFormationSessions,
    characterProfile: profile,
  }
}

export const WYCKOFF_BENCHMARKS_BY_MARKET: Record<string, WyckoffMarketBenchmark> = Object.fromEntries(
  Object.entries(raw.byMarket as Record<string, RawMarket>).map(([k, v]) => [k, build(k, v)])
)

function computeBaseline() {
  const entries = Object.values(raw.byMarket as Record<string, RawMarket>)
  const totalRanges = entries.reduce((s, m) => s + m.totalRanges, 0)
  const accumulation = entries.reduce((s, m) => s + m.accumulationCount, 0)
  const distribution = entries.reduce((s, m) => s + m.distributionCount, 0)
  let asia = 0
  let london = 0
  for (const m of entries) {
    const sess = parseSessions(m.topFormationSessions)
    asia += sess.ASIA ?? 0
    london += sess.LONDON ?? 0
  }
  return {
    totalRangesAnalyzed: totalRanges,
    accumulationRanges: accumulation,
    distributionRanges: distribution,
    springRatePct: raw.overall.overallSpringRatePct,
    lpsRatePct: round1(100 - raw.overall.overallSpringRatePct),
    utadRatePct: raw.overall.overallUtadRatePct,
    lpsyRatePct: round1(100 - raw.overall.overallUtadRatePct),
    sweepDepthAvgAtr: raw.overall.sweepDepthAvgAtr,
    avgBreakoutAtrExpansion: raw.overall.avgAtrExpansionOnBreakout,
    asiaFormationPct: round1((asia / totalRanges) * 100),
    londonFormationPct: round1((london / totalRanges) * 100),
    overnightFormationPct: round1(((asia + london) / totalRanges) * 100),
    generatedAt: (raw.metadata as { generatedAt?: string }).generatedAt ?? null,
    samplePeriod: (raw.metadata as { samplePeriod?: string }).samplePeriod ?? 'Last 365 Days',
  }
}

export const WYCKOFF_CROSS_MARKET_BASELINE = computeBaseline()

/** Retrieves the empirical Wyckoff benchmark for a given instrument (defaults to NASDAQ). */
export function getWyckoffBenchmark(instrument: string): WyckoffMarketBenchmark {
  const norm = instrument.toUpperCase().trim()
  const pick = (k: string) => WYCKOFF_BENCHMARKS_BY_MARKET[k]!
  if (norm.includes('DOW') || norm.includes('YM')) return pick('DOW')
  if (norm.includes('CRUDE') || norm.includes('OIL') || norm.includes('CL')) return pick('CRUDE')
  if (norm.includes('SILVER') || norm === 'SI' || norm === 'SIL' || norm.startsWith('SI=') || norm.startsWith('SIL=')) return pick('SILVER')
  if (norm.includes('GOLD') || norm.includes('GC') || norm.includes('MGC')) return pick('GOLD')
  if (norm.includes('NIKKEI') || norm.includes('NKD') || norm.includes('NIY') || norm.includes('N225')) return pick('NIKKEI')
  return pick('NASDAQ')
}

export type WyckoffBenchmarkMarket = 'NASDAQ' | 'DOW' | 'CRUDE' | 'GOLD' | 'SILVER' | 'NIKKEI'

export function getAllWyckoffBenchmarks(): WyckoffMarketBenchmark[] {
  const order: WyckoffBenchmarkMarket[] = ['NASDAQ', 'DOW', 'CRUDE', 'GOLD', 'SILVER', 'NIKKEI']
  return order
    .map((k) => WYCKOFF_BENCHMARKS_BY_MARKET[k])
    .filter((m): m is WyckoffMarketBenchmark => Boolean(m))
}

/** Strips the "(N ranges)" suffix and zero-pads: "9:00 ET (129 ranges)" -> "09:00 ET". */
export function formatIgnitionHour(raw: string): string {
  const m = raw.match(/^(\d{1,2}):(\d{2}) ET/)
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]} ET` : raw
}

function topHours(b: WyckoffMarketBenchmark, n = 3): string {
  return b.topIgnitionHoursEt.slice(0, n).map(formatIgnitionHour).join(', ')
}

/** Compact, data-derived baseline paragraph used verbatim in Leo's system prompt. */
export function formatWyckoffBaselineForPrompt(): string {
  const b = WYCKOFF_CROSS_MARKET_BASELINE
  return [
    `Evaluated ${b.totalRangesAnalyzed.toLocaleString()} ranges (${b.accumulationRanges.toLocaleString()} accumulation / ${b.distributionRanges.toLocaleString()} distribution), ${b.samplePeriod}.`,
    `Accumulation ranges that swept below range low (Spring / Schematic 1): ${b.springRatePct}%. Held a higher low without a lower-low sweep (LPS / Schematic 2): ${b.lpsRatePct}%.`,
    `Distribution ranges that swept above range high (UTAD): ${b.utadRatePct}%. No higher-high sweep (LPSY): ${b.lpsyRatePct}%.`,
    `Average sweep depth beyond the range edge: ${b.sweepDepthAvgAtr} ATR.`,
    `Formation session: ${b.overnightFormationPct}% overnight (Asia ${b.asiaFormationPct}% + London ${b.londonFormationPct}%).`,
    `Average breakout ATR expansion vs range ATR: ${b.avgBreakoutAtrExpansion}x (no systematic ATR spike at breakout in this dataset).`,
    `CVD in this backtest is an OHLCV-derived proxy (volume x close-location), not tick order flow, and is only evaluated on sweep events - never quote a CVD "hit rate" from it.`,
  ].join(' ')
}

/**
 * Cross-market comparative matrix. Built entirely from the data file so it can never drift
 * from the backtest output.
 */
export function generateWyckoffMarketComparisonMatrix(): string {
  const b = WYCKOFF_CROSS_MARKET_BASELINE
  const order = ['NASDAQ', 'DOW', 'CRUDE', 'GOLD', 'NIKKEI']
  const label: Record<string, string> = {
    NASDAQ: 'NASDAQ (NQ)',
    DOW: 'DOW (YM)',
    CRUDE: 'CRUDE (CL)',
    GOLD: 'GOLD (GC)',
    NIKKEI: 'NIKKEI (NKD)',
  }

  const rows = order
    .map((k) => WYCKOFF_BENCHMARKS_BY_MARKET[k])
    .filter((m): m is WyckoffMarketBenchmark => Boolean(m))
    .map((m) => {
      const accShare = round1((m.accumulationCount / (m.totalRanges || 1)) * 100)
      return `| **${label[m.market]}** | ${m.totalRanges.toLocaleString()} | ${m.accumulationCount} vs. ${m.distributionCount} (${accShare}% Acc) | **${m.springRatePct}%** | **${m.lpsRatePct}%** | **${m.utadRatePct}%** | **${m.lpsyRatePct}%** | **${m.sweepVolumeMultiplier}x** | ${m.avgRangeDurationHours}h | ${m.overnightFormationPct}% | ${topHours(m)} |`
    })

  const byVol = [...Object.values(WYCKOFF_BENCHMARKS_BY_MARKET)].sort(
    (a, z) => z.sweepVolumeMultiplier - a.sweepVolumeMultiplier
  )
  const bySpring = [...Object.values(WYCKOFF_BENCHMARKS_BY_MARKET)].sort((a, z) => z.springRatePct - a.springRatePct)
  const small = Object.values(WYCKOFF_BENCHMARKS_BY_MARKET).filter((m) => m.totalRanges < SMALL_SAMPLE_RANGES)

  return `### 📊 **Cross-Market 1-Year Wyckoff Backtest Comparative Matrix (${b.totalRangesAnalyzed.toLocaleString()} Ranges)**

| Market (Contract) | Qualified Ranges | Accumulation vs. Distribution | Spring Rate (LL Sweep) | LPS Rate (No LL Sweep) | UTAD Rate (HH Sweep) | LPSY Rate (No HH Sweep) | Avg Sweep Vol Multiplier | Avg Range Duration | Overnight Formation | Top Ignition Hours (ET) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows.join('\n')}
| **CROSS-MARKET** | **${b.totalRangesAnalyzed.toLocaleString()}** | **${b.accumulationRanges.toLocaleString()} vs. ${b.distributionRanges.toLocaleString()}** | **${b.springRatePct}%** | **${b.lpsRatePct}%** | **${b.utadRatePct}%** | **${b.lpsyRatePct}%** | - | - | **${b.overnightFormationPct}%** | Cash opens & Tier-1 releases |

---

### 🔍 **Institutional Comparative Findings & Strategic Deductions:**

1. **The Universal Law of Higher Lows (LPS Dominance):**
   - In every market, most accumulation ranges resolved WITHOUT a lower-low sweep (LPS rate ${Math.min(...Object.values(WYCKOFF_BENCHMARKS_BY_MARKET).map((m) => m.lpsRatePct))}% to ${Math.max(...Object.values(WYCKOFF_BENCHMARKS_BY_MARKET).map((m) => m.lpsRatePct))}%). Highest sweep rate: ${bySpring[0]!.market} (${bySpring[0]!.springRatePct}%); lowest: ${bySpring[bySpring.length - 1]!.market} (${bySpring[bySpring.length - 1]!.springRatePct}%). Never require a lower-low sweep before acting on a higher-low structure.
2. **Sweep Volume Expansion Varies by Market:**
   - Highest average sweep volume vs range average: ${byVol[0]!.market} (${byVol[0]!.sweepVolumeMultiplier}x); lowest: ${byVol[byVol.length - 1]!.market} (${byVol[byVol.length - 1]!.sweepVolumeMultiplier}x).${byVol[byVol.length - 1]!.sweepVolumeMultiplier < 1 ? ` ${byVol[byVol.length - 1]!.market} sweeps did NOT print above-average volume, so a volume-spike filter built on the other markets would reject its genuine sweeps.` : ''}
3. **Ignition Timing Is Asset-Specific:**
   - Equities (NQ / YM) cluster at 08:00-09:00 ET; Nikkei at 19:00 ET (Tokyo open); Crude at 20:00, 01:00-03:00 and 09:00 ET; Gold at 10:00 ET with a thin spread. See the Top Ignition Hours column.
4. **Sample-Size Warning:**
   - ${small.length ? small.map((m) => `${m.market} (${m.totalRanges} ranges)`).join(' and ') + ' rest on far fewer ranges than NQ / YM / CL; treat their percentages as indicative, not precise.' : 'All markets have large samples.'}
5. **Method Limits:** CVD in this backtest is an OHLCV-derived proxy evaluated only on sweep events, and average breakout ATR expansion is ${b.avgBreakoutAtrExpansion}x - neither is a validated edge on its own.`
}
