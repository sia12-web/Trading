/**
 * Nasdaq-100 Macro, Earnings, Rates and Flow Analyst Configuration
 * Market: CME E-mini Nasdaq-100 Futures (NQ)
 *
 * Implements:
 * 1. Strict Institutional System Prompt (Item 33)
 * 2. 11 Major Drivers with Intraday & Long-Term Importance Rankings (Item 1)
 * 3. Dynamic constituent weights based on updated Nasdaq-100 methodology (Item 1 & 11)
 * 4. Grounded Baseline Daily Nasdaq Fundamental State (Item 30)
 * 5. Pre-calibrated scenarios covering Rejection, Hawkish Cut, Earnings Divergence, Breadth
 */

import type {
  NasdaqDriverId,
  NasdaqDriverState,
  TodaysNasdaqFundamentalState,
  NdxConstituentWeight,
  NdxBreadthState,
  AiSemiCycleState,
  NdxEarningsCycleState,
  NasdaqTelemetry,
  NasdaqFeedStatus,
} from '@/types/fundamentals'

/**
 * System prompt for NASDAQ_AGENT (Verbatim from specification Item 33)
 */
export const NASDAQ_ANALYST_SYSTEM_PROMPT = `You are the Nasdaq-100 Macro, Earnings and Market-Flow Analyst. Your primary traded market is CME E-mini Nasdaq-100 futures (NQ). Your responsibility is to maintain a continuously updated assessment of the fundamental, macroeconomic and cross-market environment affecting Nasdaq-100 futures.

Continuously monitor:
- Federal Reserve policy and communication
- market expectations for future Fed policy
- nominal and real Treasury yields
- inflation data
- labor-market data
- economic-growth data
- financial conditions
- major Nasdaq-100 company earnings
- forward earnings guidance
- AI and capital-expenditure trends
- semiconductor conditions
- Nasdaq-100 breadth and leadership
- implied and realized volatility
- futures positioning
- relevant options-market conditions
- relevant regulatory and geopolitical developments

For every new event:
1. Extract factual information.
2. Record source and timestamp.
3. Separate FACT, ESTIMATE, INTERPRETATION and UNKNOWN.
4. Deduplicate related reports describing the same event.
5. For scheduled economic releases, compare ACTUAL with CONSENSUS, PREVIOUS and REVISED values.
6. For earnings, evaluate EPS, revenue, forward guidance, margins, capex and management commentary.
7. Weight company events according to current Nasdaq-100 index relevance.
8. Classify the event into: MONETARY_POLICY, RATES, INFLATION, LABOR, GROWTH, LIQUIDITY, EARNINGS, GUIDANCE, AI_CAPEX, SEMICONDUCTORS, REGULATION, GEOPOLITICS, VOLATILITY, OPTIONS, POSITIONING or BREADTH.
9. Determine expected Nasdaq effect: BULLISH, BEARISH, MIXED, NEUTRAL or UNCERTAIN.
10. Determine relevant horizon: INTRADAY, SHORT_TERM or MEDIUM_TERM.
11. Rate magnitude, surprise, novelty, reliability and confidence.
12. Measure the actual response in: NQ, ES, YM, US 2Y, US 10Y, DXY, VIX/VXN, major Nasdaq-100 constituents and semiconductors.
13. Determine whether market behavior CONFIRMS, PARTIALLY_CONFIRMS, REJECTS or is INCONCLUSIVE relative to the expected fundamental effect.
14. Update the Nasdaq fundamental regime only when new information is material.

Never invent missing values.
Never treat an earnings beat as automatically bullish.
Never treat a rate cut as automatically bullish.
Never infer institutional identity from price movement alone.
Never interpret correlation as proof of causation.
Never treat CFTC positioning as real-time institutional flow.
Never issue a trade solely from fundamental information.
Provide context; the technical Volume Profile + Wyckoff + CVD system decides the trade.

Always format your analysis as strictly valid machine-readable JSON matching the required schema.`

/**
 * Top NDX Constituents with approximate weights
 * Reflects updated modified-market-cap index weighting methodology (Item 1 & 11)
 */
export const DEFAULT_NDX_CONSTITUENTS: NdxConstituentWeight[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', weight: 8.4, sector: 'Semiconductors', price: 182.4, changePct: 1.85, lastEpsSurprise: '+12.4%', forwardGuidanceStance: 'RAISED' },
  { symbol: 'MSFT', name: 'Microsoft Corp', weight: 8.1, sector: 'Software / Cloud', price: 512.2, changePct: 0.65, lastEpsSurprise: '+4.2%', forwardGuidanceStance: 'MAINTAINED' },
  { symbol: 'AAPL', name: 'Apple Inc', weight: 7.9, sector: 'Consumer Electronics', price: 254.8, changePct: -0.32, lastEpsSurprise: '+2.8%', forwardGuidanceStance: 'MAINTAINED' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', weight: 5.6, sector: 'E-Commerce / Cloud', price: 224.5, changePct: 1.15, lastEpsSurprise: '+8.6%', forwardGuidanceStance: 'RAISED' },
  { symbol: 'GOOGL', name: 'Alphabet Inc Cl A', weight: 5.3, sector: 'Interactive Media', price: 198.3, changePct: 0.45, lastEpsSurprise: '+5.1%', forwardGuidanceStance: 'MAINTAINED' },
  { symbol: 'META', name: 'Meta Platforms Inc', weight: 4.9, sector: 'Interactive Media / AI', price: 685.2, changePct: 1.42, lastEpsSurprise: '+9.4%', forwardGuidanceStance: 'RAISED' },
  { symbol: 'AVGO', name: 'Broadcom Inc', weight: 4.6, sector: 'Semiconductors / Custom Silicon', price: 198.4, changePct: 2.10, lastEpsSurprise: '+6.8%', forwardGuidanceStance: 'RAISED' },
  { symbol: 'TSLA', name: 'Tesla Inc', weight: 3.3, sector: 'Automotive / Energy', price: 264.1, changePct: -1.20, lastEpsSurprise: '-4.1%', forwardGuidanceStance: 'LOWERED' },
  { symbol: 'COST', name: 'Costco Wholesale', weight: 2.4, sector: 'Consumer Staples', price: 928.0, changePct: 0.15, lastEpsSurprise: '+1.5%', forwardGuidanceStance: 'MAINTAINED' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', weight: 2.1, sector: 'Semiconductors', price: 164.2, changePct: 2.80, lastEpsSurprise: '+3.5%', forwardGuidanceStance: 'RAISED' },
  { symbol: 'NFLX', name: 'Netflix Inc', weight: 1.9, sector: 'Entertainment', price: 742.0, changePct: 0.80, lastEpsSurprise: '+4.8%', forwardGuidanceStance: 'MAINTAINED' },
  { symbol: 'QCOM', name: 'Qualcomm Inc', weight: 1.6, sector: 'Semiconductors / Mobile', price: 184.5, changePct: 1.05, lastEpsSurprise: '+2.9%', forwardGuidanceStance: 'MAINTAINED' },
]

/**
 * Historical surprise volatility (standard deviations) for economic indicators
 */
export const HISTORICAL_MACRO_SURPRISE_VOLATILITY: Record<string, { std: number; unit: string }> = {
  CPI_MOM: { std: 0.08, unit: '%' },
  CORE_CPI_MOM: { std: 0.07, unit: '%' },
  CPI_YOY: { std: 0.15, unit: '%' },
  CORE_CPI_YOY: { std: 0.12, unit: '%' },
  PCE_CORE_MOM: { std: 0.06, unit: '%' },
  NONFARM_PAYROLLS: { std: 55000, unit: 'jobs' },
  UNEMPLOYMENT_RATE: { std: 0.12, unit: '%' },
  AVG_HOURLY_EARNINGS_MOM: { std: 0.10, unit: '%' },
  INITIAL_JOBLESS_CLAIMS: { std: 9000, unit: 'claims' },
  ISM_MANUFACTURING: { std: 1.2, unit: 'index' },
  ISM_SERVICES: { std: 1.4, unit: 'index' },
  RETAIL_SALES_MOM: { std: 0.40, unit: '%' },
  GDP_QOQ_ANNUALIZED: { std: 0.60, unit: '%' },
}

/**
 * The 11 Major Drivers (Prompt 1)
 */
export const DEFAULT_NASDAQ_DRIVERS: Record<NasdaqDriverId, NasdaqDriverState> = {
  fed_rate_expectations: {
    id: 'fed_rate_expectations',
    name: 'Fed & Rate Expectations',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'MIXED',
    transmissionRole: 'Near-term monetary policy expectations drive discount rates. Hawkish surprise = valuation compression.',
    summary: 'Fed terminal rate hovering at 4.75%-5.00%. Markets pricing ~50 bps of cuts over next 12 months with persistent hawkish pause risks.',
    metrics: [
      { label: 'Fed Funds Target', value: '4.75% - 5.00%', change: 'Unchanged', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Market 12M Cut Pricing', value: '-50 bps', change: '+10 bps hawkish', trend: 'UP', stance: 'BEARISH' },
      { label: 'Dot Plot Median', value: '4.25%', change: 'Sep SEP', trend: 'FLAT', stance: 'MIXED' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  treasury_yields: {
    id: 'treasury_yields',
    name: 'Treasury Yields (2Y & 10Y)',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BEARISH',
    transmissionRole: '2Y reflects Fed policy expectations; 10Y dictates long-duration discounting for mega-cap growth valuations.',
    summary: 'US 2Y yield at 4.88%, 10Y at 5.28% (2s10s spread at +40 bps disinversion). Elevated nominal yields present valuation headwind.',
    metrics: [
      { label: 'US 2Y Nominal', value: '4.88%', change: '+0.04%', trend: 'UP', stance: 'BEARISH' },
      { label: 'US 10Y Nominal', value: '5.28%', change: '+0.03%', trend: 'UP', stance: 'BEARISH' },
      { label: '10Y Real TIPS (DFII10)', value: '2.88%', change: '-0.02%', trend: 'DOWN', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  inflation: {
    id: 'inflation',
    name: 'Inflation / Price Pressures',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'MIXED',
    transmissionRole: 'Hot inflation forces higher-for-longer yields. Disinflation eases equity discount rates.',
    summary: 'Core CPI at 3.2% YoY, Core PCE at 2.8%. Sticky services disinflation keeps the Fed cautious on rapid rate reductions.',
    metrics: [
      { label: 'Core CPI YoY', value: '3.2%', change: '+0.1%', trend: 'UP', stance: 'BEARISH' },
      { label: 'Core PCE YoY', value: '2.8%', change: '0.0%', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: '10Y Breakeven', value: '2.36%', change: '+0.01%', trend: 'UP', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  labor_growth: {
    id: 'labor_growth',
    name: 'Labor & Economic Growth',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Resilient economic growth supports tech enterprise software spending and cloud consumption.',
    summary: 'US GDP tracking +2.4% annualized. Nonfarm payrolls healthy; initial jobless claims low at 218k.',
    metrics: [
      { label: 'US GDP (QoQ Ann)', value: '+2.4%', change: 'Q2 Final', trend: 'UP', stance: 'BULLISH' },
      { label: 'Unemployment Rate', value: '4.1%', change: '0.0%', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Initial Claims', value: '218k', change: '-4k', trend: 'DOWN', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  ndx_earnings_guidance: {
    id: 'ndx_earnings_guidance',
    name: 'Major NDX Earnings & Guidance',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Mega-cap earnings (NVDA, MSFT, AAPL) drive index EPS. Forward guidance matters far more than backwards EPS beat.',
    summary: 'Blended NDX Q3 earnings growth at +14.2% YoY. Hyperscalers raising forward revenue guidance underpinned by enterprise cloud modernization.',
    metrics: [
      { label: 'NDX Blended EPS Growth', value: '+14.2% YoY', change: '+1.5%', trend: 'UP', stance: 'BULLISH' },
      { label: 'Guidance Revision Ratio', value: '1.45:1', change: 'Positive', trend: 'UP', stance: 'BULLISH' },
      { label: 'Top 7 Mag7 EPS Weight', value: '42.8%', change: 'Dominant', trend: 'FLAT', stance: 'MIXED' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  ai_semi_cycle: {
    id: 'ai_semi_cycle',
    name: 'AI & Semiconductor Cycle',
    intradayStars: 4,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Accelerating AI accelerator demand and datacenter capex drive tech sector multiple expansion.',
    summary: 'Hyperscaler aggregate annual capex pacing >$220B. Leading semiconductor foundries report wafer allocation sold out through 2027.',
    metrics: [
      { label: 'Hyperscaler Capex Run-Rate', value: '$225B / yr', change: '+32% YoY', trend: 'UP', stance: 'BULLISH' },
      { label: 'SOXX / Semi Basket', value: '+2.45%', change: 'Leading NQ', trend: 'UP', stance: 'BULLISH' },
      { label: 'CoWoS / Packaging Capacity', value: 'Constrained', change: 'Strong demand', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  market_breadth: {
    id: 'market_breadth',
    name: 'Market Breadth & Participation',
    intradayStars: 4,
    longTermStars: 4,
    stance: 'MIXED',
    transmissionRole: 'Distinguishes healthy broad-based rallies (80+ advancing) from fragile narrow rallies carried by 2-3 mega-caps.',
    summary: '62 advancing vs 38 declining stocks. Equal-weight NDX (QQQE) slightly trailing cap-weight QQQ, reflecting moderate mega-cap concentration.',
    metrics: [
      { label: 'Advance / Decline Ratio', value: '1.63:1', change: '62 Up / 38 Down', trend: 'UP', stance: 'BULLISH' },
      { label: '% Above 50-day MA', value: '58.0%', change: '+2.0%', trend: 'UP', stance: 'NEUTRAL' },
      { label: 'QQQ vs QQQE Spread', value: '+0.45%', change: 'Mega-cap bias', trend: 'UP', stance: 'MIXED' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  volatility_options: {
    id: 'volatility_options',
    name: 'Implied Volatility (VIX & VXN)',
    intradayStars: 4,
    longTermStars: 3,
    stance: 'BULLISH',
    transmissionRole: 'VXN tracks Nasdaq-100 option implied volatility. Low/stable VXN provides supportive dealer gamma backdrop.',
    summary: 'CBOE VXN holding at 18.40, VIX at 15.20. Orderly equity volatility regime with absence of crash-protection skew spikes.',
    metrics: [
      { label: 'CBOE VXN (Nasdaq Vol)', value: '18.40', change: '-0.45', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'CBOE VIX (S&P Vol)', value: '15.20', change: '-0.30', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'VXN - VIX Premium', value: '3.20 pts', change: 'Normal tech skew', trend: 'FLAT', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  positioning: {
    id: 'positioning',
    name: 'Futures & Systematic Positioning',
    intradayStars: 3,
    longTermStars: 4,
    stance: 'NEUTRAL',
    transmissionRole: 'CFTC non-commercial positioning & CTA exposure establish positioning squeeze vs liquidation thresholds.',
    summary: 'CFTC Nasdaq-100 net positioning at +42k contracts (68th percentile). Exposure moderately elevated but not yet at extreme squeeze levels.',
    metrics: [
      { label: 'CFTC Net Non-Commercial', value: '+42,500', change: '+3,200', trend: 'UP', stance: 'NEUTRAL' },
      { label: '12-Week Percentile', value: '68%', change: 'Moderate long', trend: 'UP', stance: 'NEUTRAL' },
      { label: 'CTA Trend Equity Beta', value: '75%', change: 'Target reached', trend: 'FLAT', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  usd_financial_conditions: {
    id: 'usd_financial_conditions',
    name: 'USD & Financial Conditions',
    intradayStars: 3,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'A surging dollar reduces foreign revenue translation for multinational tech; looser financial conditions boost equity multiples.',
    summary: 'DXY at 101.92 in range; Chicago Fed National Financial Conditions Index (NFCI) at -0.55 (substantially loose).',
    metrics: [
      { label: 'DXY Dollar Index', value: '101.92', change: '-0.15%', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'Chicago Fed NFCI', value: '-0.55', change: 'Loose conditions', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'High Yield Credit OAS', value: '315 bps', change: '-4 bps', trend: 'DOWN', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  regulation_geopolitics: {
    id: 'regulation_geopolitics',
    name: 'Regulation & Geopolitical Risk',
    intradayStars: 3,
    longTermStars: 3,
    stance: 'NEUTRAL',
    transmissionRole: 'Antitrust scrutiny, semiconductor export controls (e.g. BIS China rules), and AI safety regulations impact specific leaders.',
    summary: 'Export controls on advanced AI silicon to China factored into baseline guidance. Department of Justice antitrust cases moving slowly through appeals.',
    metrics: [
      { label: 'China Chip Export Rules', value: 'Active / Factored', change: 'Stable', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Big Tech Antitrust Risk', value: 'Low Near-Term Impact', change: 'Ongoing', trend: 'FLAT', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
}

/**
 * Default "TODAY'S NASDAQ FUNDAMENTAL STATE" (Prompt 30)
 */
export const DEFAULT_TODAY_NASDAQ_STATE: TodaysNasdaqFundamentalState = {
  fed_regime: 'Data-dependent pause with terminal rate at 4.75%-5.00%. Markets pricing ~50 bps of easing over next 12 months.',
  rate_regime: 'Nominal Treasury curve disinverted: 2Y at 4.88%, 10Y at 5.28% (+40 bps 2s10s spread). 10Y real TIPS yield at 2.88%.',
  us2y: '4.88% (+4 bps on week)',
  us10y: '5.28% (+3 bps on week)',
  inflation_trend: 'Core CPI at 3.2% YoY, Core PCE at 2.8%. Sticky shelter disinflation delaying aggressive Fed cuts.',
  labor_trend: 'Solid job growth (+185k 3M average). Initial claims low at 218k, confirming macro resilience without stagflation.',
  growth_trend: 'US GDP tracking +2.4% annualized. Solid enterprise software spending sustaining tech earnings power.',
  financial_conditions: 'National Financial Conditions Index at -0.55 (loose). Tight credit spreads keeping liquidity friction low.',
  ndx_earnings_trend: 'Blended NDX earnings expanding +14.2% YoY. Cloud and AI segment revenue driving index EPS upward revisions.',
  forward_guidance_trend: 'Positive: 1.45:1 raise-to-lower guidance ratio across major technology and communications constituents.',
  ai_capex_trend: 'Strong acceleration: Hyperscaler annualized datacenter capex pacing $225B (+32% YoY).',
  semiconductor_trend: 'Strong leadership: SOXX outperforming NQ by +1.4% week-to-date; packaging and server foundry capacity sold out.',
  breadth: 'Moderate expansion: 62 advancing vs 38 declining stocks. 58% of NDX constituents trading above their 50-day moving average.',
  leadership: 'Mega-cap AI & Cloud leaders (NVDA, MSFT, AVGO, META, AMZN) driving index advance; software infrastructure stabilizing.',
  volatility: 'Constructive: CBOE VXN at 18.40, VIX at 15.20. Normal volatility surface without protective put skew distortion.',
  positioning: 'CFTC net speculative long at +42,500 contracts (68th percentile). Moderate long exposure; low immediate liquidation stress.',
  main_current_market_driver: 'Resilient corporate AI/cloud capex growth offsetting high nominal and real Treasury yields.',

  intraday_bias: 'BULLISH',
  short_term_bias: 'BULLISH',
  medium_term_bias: 'BULLISH',

  upcoming_catalysts: 'US CPI Release (Tue 8:30 AM ET); FOMC Rate Decision & Presser (Wed 2:00 PM ET); Mega-Cap Earnings (Thu 4:05 PM ET); Nonfarm Payrolls (Fri 8:30 AM ET).',
  what_changed_since_yesterday: '10Y yield held steady at 5.28%; Broadcom and NVIDIA raised forward datacenter guidance; NQ held 5-day VP support with positive CVD.',
  what_would_invalidate_the_current_interpretation: 'A sudden hawkish jump in 2Y yields above 5.15% accompanied by hyperscaler earnings downgrades or capex cuts, combined with NQ breaking below 5-day low volume node ($24,400) on heavy volume.',
}

/**
 * Default Breadth State
 */
export const DEFAULT_BREADTH_STATE: NdxBreadthState = {
  advancingCount: 62,
  decliningCount: 38,
  advanceDeclineRatio: 1.63,
  pctAbove20dMa: 64.0,
  pctAbove50dMa: 58.0,
  pctAbove200dMa: 72.0,
  pctAboveVwap: 68.0,
  qqqVsQqqeRatio: 1.18,
  marketParticipationStance: 'BROAD_EXPANSION',
}

/**
 * Default AI / Semi Cycle State
 */
export const DEFAULT_AI_SEMI_STATE: AiSemiCycleState = {
  acceleratorDemandTrend: 'ACCELERATING',
  hyperscalerCapexRunRateBillions: 225,
  semiconductorEquipmentCycle: 'Expanding wafer fab equipment bookings into leading edge nodes (2nm/3nm)',
  exportRestrictionsStatus: 'US BIS export restrictions on China factored into guidance; Middle East specialized licensing active',
  aiLeadershipStance: 'TECH_LEADING_BROAD_EXPANSION',
}

/**
 * Default Earnings Cycle State
 */
export const DEFAULT_EARNINGS_CYCLE_STATE: NdxEarningsCycleState = {
  blendedEarningsGrowthPct: 14.2,
  guidanceRevisionRatio: 1.45,
  capexGrowthPct: 28.5,
  notableRecentReports: [
    { company: 'NVIDIA Corp', symbol: 'NVDA', epsResult: 'BEAT', revenueResult: 'BEAT', guidanceResult: 'RAISED', indexImpactPoints: +85 },
    { company: 'Microsoft Corp', symbol: 'MSFT', epsResult: 'BEAT', revenueResult: 'BEAT', guidanceResult: 'REAFFIRMED', indexImpactPoints: +32 },
    { company: 'Meta Platforms', symbol: 'META', epsResult: 'BEAT', revenueResult: 'BEAT', guidanceResult: 'RAISED', indexImpactPoints: +44 },
    { company: 'Tesla Inc', symbol: 'TSLA', epsResult: 'MISS', revenueResult: 'MISS', guidanceResult: 'LOWERED', indexImpactPoints: -28 },
  ],
}

/**
 * Baseline telemetry for Nasdaq
 */
export const DEFAULT_NASDAQ_TELEMETRY: NasdaqTelemetry = {
  nqPrice: 24850.5,
  nqChange: 142.25,
  nqChangePct: 0.58,
  esPrice: 6420.25,
  esChangePct: 0.32,
  ymPrice: 46500,
  ymChangePct: 0.12,
  relativeStrengthStance: 'GROWTH_TECH_LEADERSHIP',
  us2yNominalYield: 4.88,
  us10yNominalYield: 5.28,
  yieldCurve2s10sSpreadBps: 40,
  us10yRealYield: 2.88,
  dxyIndex: 101.92,
  dxyChangePct: -0.15,
  vixIndex: 15.2,
  vxnIndex: 18.4,
  semiBasketChangePct: 2.15,
  topConstituents: [...DEFAULT_NDX_CONSTITUENTS],
  advanceDeclineRatio: 1.63,
  cvdAggressionStance: 'AGGRESSIVE_BUYING',
  timestamp: Math.floor(Date.now() / 1000),
  source: 'CME Globex / CBOE / St. Louis Fed FRED / Yahoo Quotes',
  updatedAt: new Date().toISOString(),
}

/**
 * 9-Feed V1 Data Architecture for Nasdaq
 */
export const DEFAULT_NASDAQ_FEEDS: NasdaqFeedStatus[] = [
  {
    id: 'cme_globex_nq',
    name: 'CME Globex NQ / ES / YM',
    subtitle: 'E-mini Nasdaq-100 (NQ), S&P 500 (ES), Dow (YM) Relative Pricing',
    category: 'CME_GLOBEX',
    status: 'ONLINE',
    latency: '15ms',
    lastSync: 'Live',
    primarySource: 'CME Globex / Databento Real-Time',
  },
  {
    id: 'treasury_yields_engine',
    name: 'Treasury Rates Engine',
    subtitle: 'US 2Y, 10Y, 2s10s Spread, 10Y Real TIPS (DFII10)',
    category: 'RATES_ENGINE',
    status: 'ONLINE',
    latency: '40ms',
    lastSync: 'Live Tick / FRED Daily',
    primarySource: 'CBOE / St. Louis Fed FRED',
  },
  {
    id: 'trading_economics_calendar',
    name: 'Economic Calendar & Surprises',
    subtitle: 'CPI, Core CPI, PCE, NFP, Jobless Claims & Standardized Surprises',
    category: 'MACRO_CALENDAR',
    status: 'ONLINE',
    latency: '45ms',
    lastSync: 'Continuous',
    primarySource: 'Trading Economics / BLS / BEA',
  },
  {
    id: 'fed_policy_feed',
    name: 'Federal Reserve Policy & Speeches',
    subtitle: 'FOMC Statements, Rate Expectations, Dot Plot, Powell Conferences',
    category: 'CENTRAL_BANK',
    status: 'ONLINE',
    latency: '95ms',
    lastSync: 'Continuous',
    primarySource: 'Board of Governors of the Federal Reserve',
  },
  {
    id: 'sec_edgar_earnings',
    name: 'SEC EDGAR & Earnings Wire',
    subtitle: 'Major NDX 10-Q / 10-K Filings, EPS, Revenue, Guidance & Capex',
    category: 'SEC_EDGAR_EARNINGS',
    status: 'ONLINE',
    latency: '150ms',
    lastSync: 'Continuous',
    primarySource: 'SEC EDGAR / Company IR Releases',
  },
  {
    id: 'ndx_constituents_weights',
    name: 'Nasdaq-100 Constituent Weights',
    subtitle: 'Modified Market-Cap Weights, Index Contribution & Rebalance Status',
    category: 'INDEX_CONSTITUENTS',
    status: 'ONLINE',
    latency: '220ms',
    lastSync: 'Daily Official',
    primarySource: 'Nasdaq Global Indexes',
  },
  {
    id: 'cboe_volatility_vix_vxn',
    name: 'CBOE Implied Volatility (VXN / VIX)',
    subtitle: 'Nasdaq-100 VXN Index, S&P 500 VIX, Volatility Surface Skew',
    category: 'VOLATILITY_CBOE',
    status: 'ONLINE',
    latency: '35ms',
    lastSync: 'Live',
    primarySource: 'CBOE Real-Time Index Feeds',
  },
  {
    id: 'cftc_cot_nasdaq',
    name: 'CFTC Commitments of Traders (COT)',
    subtitle: 'E-mini Nasdaq-100 Speculative & Commercial Positioning',
    category: 'CFTC',
    status: 'ONLINE',
    latency: '240ms',
    lastSync: 'Weekly (Friday 3:30 PM)',
    primarySource: 'U.S. Commodity Futures Trading Commission',
  },
  {
    id: 'tech_news_deduplicator',
    name: 'Institutional Tech Wire & Deduplicator',
    subtitle: 'Reuters / Finnhub Tech Wire with Automatic Event Deduplication',
    category: 'NEWS_WIRE',
    status: 'ONLINE',
    latency: '60ms',
    lastSync: 'Real-Time Streaming',
    primarySource: 'Finnhub Institutional Wire / Reuters / Bloomberg',
  },
]

/**
 * 5 Pre-calibrated Institutional Scenarios for Testing
 */
export interface NasdaqEvaluationPreset {
  id: string
  title: string
  source: string
  category: string
  description: string
  rawText: string
}

export const NASDAQ_EVALUATION_PRESETS: NasdaqEvaluationPreset[] = [
  {
    id: 'preset-hot-cpi-rejection',
    title: 'Hot CPI with Initial Selloff, Massive Negative CVD & Complete Rejection (Prompts 9 & 10)',
    source: 'U.S. Bureau of Labor Statistics / Market Reaction',
    category: 'INFLATION',
    description:
      'Core CPI prints +0.4% MoM vs +0.2% expected. 2Y and 10Y yields jump, NQ plunges 250 pts from 25,000 to 24,750, but order flow reveals massive negative CVD absorption and rapid reclaim to 25,020.',
    rawText: `US Bureau of Labor Statistics CPI Release:
Core CPI for September printed at +0.4% MoM, exceeding consensus estimates of +0.2% (Previous: +0.2%).
Headline CPI came in at +0.3% MoM vs +0.2% expected.
Rates & Market Reaction:
US 2Y yield spiked +12 bps to 4.96%. US 10Y yield rose +8 bps to 5.34%. DXY jumped +0.6% to 102.40. CBOE VXN rose +0.8 pts.
NQ futures initially dumped 250 points from 25,000 to 24,750 on heavy volume.
However, tape reading and CVD revealed extreme negative delta absorption directly at the 5-day volume profile low volume node (LVN) at 24,750.
Within 20 minutes, aggressive buyers absorbed all supply and price reclaimed 24,780, 24,850, 24,930, pushing to 25,020 (+0.1% on day).`,
  },
  {
    id: 'preset-hawkish-cut-disappointment',
    title: 'Hawkish Fed Rate Cut Disappointment: Delivered -25 bps vs -50 bps Expected (Prompt 6)',
    source: 'Federal Reserve FOMC Policy Statement',
    category: 'MONETARY_POLICY',
    description:
      'Fed cuts rates by 25 bps when markets priced 50 bps. Rate expectations shift hawkish, 2Y and 10Y spike, NQ falls -1.6% confirming the hawkish interpretation.',
    rawText: `Federal Reserve FOMC Policy Statement:
The FOMC lowered the target range for the federal funds rate by 25 bps to 4.75%-5.00%.
The decision disappointed markets which had priced an 82% probability of a jumbo 50 bps cut.
Chairman Powell stated that policy recalibration will be gradual and that the committee sees no urgency to ease rapidly.
Market Reaction:
US 2Y yield surged +14 bps to 4.98%. US 10Y yield rose +9 bps to 5.35%. DXY rallied +0.7% to 102.60.
NQ futures dropped -380 points (-1.55%) breaking morning support with heavy selling volume confirming the hawkish policy disappointment.`,
  },
  {
    id: 'preset-megacap-earnings-divergence',
    title: 'Mega-Cap Earnings Divergence: EPS Beat + Slashed Forward Guidance & Capex Surge (Prompts 12 & 13)',
    source: 'SEC EDGAR 10-Q & Corporate Earnings Release',
    category: 'EARNINGS',
    description:
      'Top NDX constituent beats Q3 EPS and revenue, but cuts forward Q4 revenue guidance and surges capital expenditure, causing stock to plunge -8.5%.',
    rawText: `Major Cloud & AI Leader Q3 Earnings Release (NDX Weight: 8.2%):
Q3 EPS printed at $1.92 vs $1.80 consensus (Beat by +6.7%). Q3 Revenue was $38.5B vs $37.8B consensus (Beat by +1.9%).
However, forward Q4 revenue guidance was lowered to $39.0B-$40.0B vs $41.2B consensus, citing enterprise software elongation.
Furthermore, 2027 Capital Expenditure was raised by +45% to $48B, depressing projected operating free cash flow margins.
Market Reaction:
The stock plunged -8.5% in after-hours trading. With an 8.2% index weight, this single stock implies an immediate ~70 point drag on NQ futures regardless of the headline EPS beat.`,
  },
  {
    id: 'preset-ai-semi-surge-weak-breadth',
    title: 'AI & Semiconductor Surge vs Weak Market Breadth Divergence (Prompts 16 & 17)',
    source: 'Nasdaq-100 Real-Time Market Breadth & Semiconductor Basket',
    category: 'BREADTH',
    description:
      'NQ advances +1.0% driven almost entirely by NVDA and AVGO (+4.5%), while 72 NDX stocks decline and QQQE falls -0.4%.',
    rawText: `Nasdaq-100 Market Breadth & Sector Analysis:
E-mini Nasdaq-100 futures rallied +240 points (+0.98%) during the New York morning session.
However, breadth internals revealed extreme concentration:
Only 28 NDX stocks were advancing while 72 stocks were declining (Advance/Decline Ratio: 0.39:1).
NVIDIA (+4.8%) and Broadcom (+4.2%) contributed over 70% of the entire index point gain.
Equal-weight Nasdaq-100 ETF (QQQE) dropped -0.42%, confirming that the headline index gain is a narrow mega-cap divergence rather than a broad-based market expansion.`,
  },
  {
    id: 'preset-cross-asset-relative-strength',
    title: 'Cross-Asset Relative Strength: NQ Holds Firm While ES & YM Break Lows (Prompt 18)',
    source: 'CME Globex Cross-Market Futures Telemetry',
    category: 'GROWTH',
    description:
      'S&P 500 (ES) and Dow (YM) break overnight and session lows on banking/industrial weakness, but NQ holds well above its morning low with tech leadership.',
    rawText: `CME Globex Cross-Market Analysis:
During the European/US cross, S&P 500 futures (ES) dropped -0.8% and Dow futures (YM) dropped -1.2%, both breaking through their overnight session lows due to regional bank credit and industrial concerns.
In stark contrast, E-mini Nasdaq-100 futures (NQ) held firmly +35 points above its European low (+0.4% on day).
Semiconductor basket (SOXX) traded +1.8% higher and mega-cap cash flows showed resilient bid.
The failure of NQ to participate in the broader equity liquidation indicates strong underlying growth relative strength.`,
  },
]
