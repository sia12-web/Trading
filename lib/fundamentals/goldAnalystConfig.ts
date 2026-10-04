/**
 * Gold Macro, Monetary and Physical Demand Analyst Configuration
 * Market: COMEX Gold Futures (GC)
 *
 * Implements:
 * 1. Strict Institutional System Prompt (Item 35)
 * 2. 7 Major Drivers with Intraday & Long-Term Importance Rankings (Item 1)
 * 3. Historical surprise volatility table for Standardized Surprises (Item 8)
 * 4. Grounded Baseline Daily Gold Fundamental State (Item 37)
 * 5. Institutional presets covering Rejection, Failure, Central Banks, CFTC Crowding
 */

import type {
  GoldDriverId,
  GoldDriverState,
  TodaysGoldFundamentalState,
  GoldEtfFlowState,
  CftcGoldPositioningState,
  ComexDepositoryInventoryState,
  CentralBankDemandState,
  GoldFeedStatus,
  GoldTelemetry,
} from '@/types/fundamentals'

/**
 * System prompt for Gold Agent (Verbatim from specification Item 35)
 */
export const GOLD_ANALYST_SYSTEM_PROMPT = `You are the Gold Macro, Monetary and Physical Demand Analyst. Your primary traded market is COMEX Gold futures (GC). Your responsibility is to maintain a continuously updated assessment of the fundamental environment affecting gold.

Continuously monitor:
- Federal Reserve policy and rate expectations
- nominal Treasury yields
- real Treasury yields
- inflation expectations
- the US dollar
- inflation, labor and growth data
- geopolitical and financial-system risk
- central-bank gold purchases and sales
- global gold ETF holdings and flows
- speculative futures positioning
- physical gold demand
- mine supply, recycling and producer hedging
- COMEX depository inventories and deliveries
- gold options volatility
- relevant cross-market behavior

For every new event:
1. Extract factual information.
2. Record source and timestamp.
3. Separate FACT, ESTIMATE, INTERPRETATION and UNKNOWN.
4. For scheduled releases, compare ACTUAL with CONSENSUS, PREVIOUS and REVISION.
5. Classify the event into its primary gold transmission mechanism: REAL_RATES, NOMINAL_RATES, USD, INFLATION, GROWTH, LIQUIDITY, GEOPOLITICAL_RISK, FINANCIAL_STRESS, CENTRAL_BANK_DEMAND, ETF_FLOWS, POSITIONING, PHYSICAL_DEMAND, SUPPLY or COMEX_MARKET_STRUCTURE.
6. Determine expected impact on gold: BULLISH, BEARISH, MIXED, NEUTRAL or UNCERTAIN.
7. Determine relevant horizon: INTRADAY, SHORT_TERM or MEDIUM_TERM.
8. Rate magnitude, novelty, reliability and confidence.
9. Measure actual response in: GC, real yields, nominal yields, USD, silver, gold volatility and relevant risk markets.
10. Determine whether market behavior CONFIRMS, REJECTS or is INCONCLUSIVE relative to the expected effect.
11. Update the Gold fundamental state only when information is material.

Never invent missing values.
Never interpret a fall in COMEX registered stocks as proof of a shortage.
Never assume central-bank buying creates an immediate intraday trade.
Never assume geopolitical news is automatically bullish gold.
Never assume a falling dollar or falling real yields guarantee gold will rise.
Never infer institutional identity from price action alone.
Never issue a trade based solely on fundamental information.
Provide context; the technical Volume Profile + Wyckoff + CVD system decides the trade.

Always format your analysis as strictly valid machine-readable JSON matching the required schema.`

/**
 * Historical surprise volatility (standard deviations) for economic indicators
 * Used to compute standardized surprise: (actual - consensus) / surprise_volatility
 */
export const HISTORICAL_SURPRISE_VOLATILITY: Record<string, { std: number; unit: string }> = {
  CPI_MOM: { std: 0.08, unit: '%' },
  CORE_CPI_MOM: { std: 0.07, unit: '%' },
  CPI_YOY: { std: 0.15, unit: '%' },
  CORE_CPI_YOY: { std: 0.12, unit: '%' },
  PCE_CORE_MOM: { std: 0.06, unit: '%' },
  PCE_CORE_YOY: { std: 0.11, unit: '%' },
  NONFARM_PAYROLLS: { std: 55000, unit: 'jobs' },
  UNEMPLOYMENT_RATE: { std: 0.12, unit: '%' },
  AVG_HOURLY_EARNINGS_MOM: { std: 0.10, unit: '%' },
  INITIAL_JOBLESS_CLAIMS: { std: 9000, unit: 'claims' },
  ISM_MANUFACTURING: { std: 1.2, unit: 'index' },
  ISM_SERVICES: { std: 1.4, unit: 'index' },
  RETAIL_SALES_MOM: { std: 0.40, unit: '%' },
  GDP_QOQ_ANNUALIZED: { std: 0.60, unit: '%' },
  PPI_FINAL_DEMAND_MOM: { std: 0.20, unit: '%' },
  MICH_CONSUMER_SENTIMENT: { std: 1.8, unit: 'index' },
}

/**
 * 7 Major Drivers with Intraday vs Longer-Term Importance Stars (Item 1)
 */
export const DEFAULT_GOLD_DRIVERS: Record<GoldDriverId, GoldDriverState> = {
  real_interest_rates: {
    id: 'real_interest_rates',
    name: 'Real Interest Rates (10Y TIPS)',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BEARISH',
    transmissionRole: 'Real Yields ↑ -> Opportunity cost of holding zero-yield gold ↑ -> Price pressure.',
    summary: '10Y real TIPS yield elevated at ~2.88% (DFII10). Elevated real yields exert structural pressure on gold, but physical/sovereign bids have partially blunted sensitivity.',
    metrics: [
      { label: '10Y Real TIPS Yield', value: '2.88%', change: '-0.05%', trend: 'DOWN', stance: 'BULLISH' },
      { label: '5Y Real TIPS Yield', value: '2.65%', change: '-0.08%', trend: 'DOWN', stance: 'BULLISH' },
      { label: '10Y Breakeven Inflation', value: '2.36%', change: '+0.02%', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  fed_rate_expectations: {
    id: 'fed_rate_expectations',
    name: 'Federal Reserve / Rate Expectations',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'MIXED',
    transmissionRole: 'Hawkish surprise -> Real rates ↑ + USD ↑ -> Gold ↓. Relative expectation matters, not just cut/hike sign.',
    summary: 'Fed policy rate at 4.75%-5.00%. Markets pricing modest 50 bps easing over next 12 months with hawkish sticky-inflation pauses.',
    metrics: [
      { label: 'Fed Funds Target', value: '4.75% - 5.00%', change: 'Unchanged', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Market 12M Cut Pricing', value: '-50 bps', change: '+12 bps hawkish', trend: 'UP', stance: 'BEARISH' },
      { label: 'Dot Plot Terminal Rate', value: '4.25%', change: 'Sep SEP', trend: 'FLAT', stance: 'MIXED' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  us_dollar: {
    id: 'us_dollar',
    name: 'U.S. Dollar (DXY & FX Crosses)',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'NEUTRAL',
    transmissionRole: 'USD ↑ -> Dollar-denominated gold becomes more expensive internationally -> Downward drag. Flag divergences (DXY ↑ + Gold ↑ = extreme relative strength).',
    summary: 'DXY hovering near 101.92. Gold has repeatedly displayed decoupling and relative strength when USD spikes fail to break lower support.',
    metrics: [
      { label: 'DXY Index', value: '101.92', change: '-0.15%', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'EUR/USD', value: '1.1257', change: '+0.002', trend: 'UP', stance: 'BULLISH' },
      { label: 'USD/JPY', value: '153.40', change: '+0.30', trend: 'UP', stance: 'BEARISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  inflation_macro: {
    id: 'inflation_macro',
    name: 'Inflation / Macro Data',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Hot CPI/PCE -> Fed tightening fear (short-term bearish) VS currency debasement hedge (longer-term bullish).',
    summary: 'Core inflation sticky at 3.2% YoY. Long-term monetary debasement protection remains a core pillar for global sovereign and retail gold accumulation.',
    metrics: [
      { label: 'Core CPI YoY', value: '3.2%', change: '+0.1%', trend: 'UP', stance: 'MIXED' },
      { label: 'Core PCE YoY', value: '2.8%', change: '0.0%', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: '10Y Breakeven', value: '2.36%', change: '+0.02%', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  geopolitical_financial_stress: {
    id: 'geopolitical_financial_stress',
    name: 'Geopolitical / Financial Stress',
    intradayStars: 4,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Safe-Haven Flow (Gold ↑, Real rates ↓, risk assets ↓) VS General Liquidation (Gold ↓, USD ↑ cash scramble). Distinguish context.',
    summary: 'Elevated Middle East tensions and sanctions risks provide structural safe-haven tailwinds. No systemic credit seizure detected.',
    metrics: [
      { label: 'Regime Type', value: 'SAFE_HAVEN_FLOW', change: 'Stable', trend: 'FLAT', stance: 'BULLISH' },
      { label: 'High Yield OAS Spread', value: '325 bps', change: '-5 bps', trend: 'DOWN', stance: 'NEUTRAL' },
      { label: 'VIX Index', value: '15.20', change: '-0.60', trend: 'DOWN', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  etf_speculative_flows: {
    id: 'etf_speculative_flows',
    name: 'ETF & Speculative Investment Flows',
    intradayStars: 3,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Multi-day/multi-week context only (not intraday). Price ↑ + ETF holdings ↑ = investment confirming. Price ↑ + ETF ↓ = central-bank/OTC driven.',
    summary: 'Global gold ETF holdings holding firm at ~3,180 tonnes. Western ETF redemption cycle has arrested, with net monthly inflows returning.',
    metrics: [
      { label: 'Global ETF Tonnes', value: '3,180 t', change: '+14.2 t (MoM)', trend: 'UP', stance: 'BULLISH' },
      { label: 'SPDR Gold (GLD)', value: '878.5 t', change: '+3.1 t', trend: 'UP', stance: 'BULLISH' },
      { label: 'Asian ETF Demand', value: '+8.4 t', change: 'Strong YoY', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  central_bank_physical_demand: {
    id: 'central_bank_physical_demand',
    name: 'Central-Bank / Physical Demand',
    intradayStars: 2,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Longer-term monetary anchor. Quarterly WGC & IMF statistics. Slower fundamental regime, not an immediate 10:04 AM trade trigger.',
    summary: 'Historical record pace of official sector purchases (>1,000 tonnes/yr) led by PBOC, RBI, Turkey, and Eastern Europe for reserve de-dollarization.',
    metrics: [
      { label: 'Annual Official Buying', value: '1,080 tonnes/yr', change: 'Record pace', trend: 'UP', stance: 'BULLISH' },
      { label: 'PBOC Reserves', value: '72.80M oz', change: '+60k oz', trend: 'UP', stance: 'BULLISH' },
      { label: 'Shanghai Gold Premia', value: '+$18.50/oz', change: 'Over London', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
}

/**
 * Default "TODAY'S GOLD FUNDAMENTAL STATE" (Item 37)
 */
export const DEFAULT_TODAY_GOLD_STATE: TodaysGoldFundamentalState = {
  monetary_policy:
    'FOMC policy rate held at 4.75%-5.00%. Fed communications emphasize data dependence; market pricing 50 bps easing over next 12 months with persistent pause risk.',
  real_rate_regime:
    '10Y TIPS real yield elevated at 2.88% (DFII10), hovering near cyclical highs. Structural headwind for non-yielding bullion offset by sovereign credit risk premium.',
  usd_regime:
    'DXY trading at 101.92, consolidating in range. Dollar strength exerting intermittent pressure, but gold exhibiting notable relative strength divergence on USD rallies.',
  inflation:
    'Core CPI at 3.2% YoY, Core PCE at 2.8%. 10Y Breakeven inflation expectations anchored at 2.36%. Gold retaining monetary debasement hedge demand.',
  growth:
    'US GDP tracking +2.4% annualized. Solid labor market mitigating immediate recessionary flight-to-safety, keeping macro demand balanced.',
  financial_stress:
    'Credit spreads tight; banking sector stable. No systemic liquidity crunch underway; standard safe-haven flows rather than liquidation scrambles.',
  geopolitical_risk:
    'Persistent Middle East and Eastern European conflict maintaining elevated sovereign risk premium; sustained bid on any risk-off escalation.',
  etf_flows:
    'Global physically backed gold ETFs holding 3,180 tonnes. Western outflows stabilizing; Asian fund inflows expanding, signaling turning investment tide.',
  central_bank_demand:
    'Central banks bought 1,037 tonnes in 2023 and 1,080+ in 2024-2025. PBOC reserve accumulation pacing ~72.8M oz, leading sovereign de-dollarization.',
  cftc_positioning:
    'Managed Money net long at 245,000 contracts (4.2:1 long/short ratio). Approaching stretched levels (Crowding Index 78/100); elevated susceptibility to liquidation flush on macro shocks.',
  physical_demand:
    'China and India jewellery and bar/coin consumption solid at 1,150 tonnes/yr. Shanghai Gold Exchange (SGE) premium at +$18/oz to London loco.',
  supply:
    'Mine production flat at ~3,640 tonnes/yr. Recycling rising (+8%) due to multi-decade record prices. Supply inelastic.',
  comex_inventory_deliveries:
    'Registered stocks: 8.85M oz. Eligible stocks: 11.20M oz. Total: 20.05M oz. Active delivery pace orderly. Note: COMEX stock changes do not equal trade signals.',
  gold_volatility:
    'CME Gold CVOL index at 16.4%, reflecting moderate implied option volatility. Realized 30d vol at 14.8%.',

  intraday_bias: 'NEUTRAL',
  short_term_bias: 'BULLISH',
  medium_term_bias: 'BULLISH',

  main_current_driver:
    'Central-bank de-dollarization and structural sovereign debt debasement offsetting elevated US real yields (~2.88%).',
  upcoming_catalysts:
    'US CPI (Tue 8:30 AM ET); FOMC Rate Decision & Presser (Wed 2:00 PM ET); Non-Farm Payrolls (Fri 8:30 AM ET); CFTC COT (Fri 3:30 PM ET).',
  what_changed_since_yesterday:
    '10Y real yield eased -3 bps to 2.88%; DXY pulled back -0.15%; Gold tested and held $4,150 key support with positive delta absorption.',
  what_would_invalidate_this_view:
    'A decisive upside breakout in 10Y real yields above 3.10% accompanied by aggressive DXY push above 104.50, combined with sustained liquidation of CFTC Managed Money longs breaking below $4,080.',
}

/**
 * Default ETF Flow state
 */
export const DEFAULT_ETF_FLOW_STATE: GoldEtfFlowState = {
  globalTonnes: 3180.4,
  weeklyChangeTonnes: 5.8,
  monthlyChangeTonnes: 14.2,
  gldHoldingsTonnes: 878.5,
  iauHoldingsTonnes: 412.1,
  divergenceSignal: 'CONFIRMING',
  notes: 'Western ETF liquidations have reversed into mild inflows; Asian funds continue steady net accumulation.',
}

/**
 * Default CFTC Positioning state
 */
export const DEFAULT_CFTC_POSITIONING_STATE: CftcGoldPositioningState = {
  reportDate: '2026-09-29 (Tuesday print)',
  managedMoneyLong: 285400,
  managedMoneyShort: 40400,
  netManagedMoney: 245000,
  weeklyChangeContracts: 12500,
  longShortRatio: 7.06,
  fourWeekTrend: [195000, 212000, 232500, 245000],
  crowdingIndex: 78,
  liquidationRisk: 'MODERATE',
  openInterest: 512000,
}

/**
 * Default COMEX Inventory state (with explicit disclaimer)
 */
export const DEFAULT_COMEX_INVENTORY_STATE: ComexDepositoryInventoryState = {
  reportDate: '2026-10-02',
  registeredOz: 8852300,
  eligibleOz: 11197700,
  totalOz: 20050000,
  dailyReceivedOz: 48500,
  dailyWithdrawnOz: 22100,
  deliveryNotices: 1420,
  change1dOz: 26400,
  change5dOz: -112000,
  change20dOz: -480000,
  warningDisclaimer:
    'COMEX_STOCK_CHANGE != TRADE_SIGNAL. Registered metal represents warranted warrants, while eligible metal meets all delivery requirements and can be registered anytime. Do not infer physical shortages without cash delivery default.',
}

/**
 * Default Central Bank Demand state
 */
export const DEFAULT_CENTRAL_BANK_STATE: CentralBankDemandState = {
  annualNetPurchasesTonnes: 1080,
  quarterlyRunRateTonnes: 265,
  pbocReportedOunces: 72800000,
  pbocPurchasesStatus: 'Active net buyer for 18 of last 22 months; gold share of China official reserves ~5.1%.',
  reserveDiversificationPace: 'ACCELERATING',
  imfDataTimestamp: '2026-Q2 IMF International Financial Statistics',
}

/**
 * Baseline telemetry for Gold
 */
export const DEFAULT_GOLD_TELEMETRY: GoldTelemetry = {
  goldPrice: 4162.3,
  goldChange: 14.8,
  goldChangePct: 0.36,
  silverPrice: 60.415,
  silverChange: 0.438,
  goldSilverRatio: 68.89,
  us10yNominalYield: 5.28,
  us5yNominalYield: 5.05,
  us2yNominalYield: 4.88,
  us30yNominalYield: 5.45,
  us10yRealYield: 2.88,
  us5yRealYield: 2.65,
  us10yBreakeven: 2.36,
  dxyIndex: 101.92,
  dxyChangePct: -0.15,
  eurUsd: 1.1257,
  usdJpy: 153.4,
  goldCvol: 16.4,
  goldRealizedVol30d: 14.8,
  cvdAggressionStance: 'ABSORPTION',
  timestamp: Math.floor(Date.now() / 1000),
  source: 'COMEX CME Globex / St. Louis Fed FRED / Yahoo Quotes',
  updatedAt: new Date().toISOString(),
}

/**
 * 8-Feed V1 Data Architecture for Gold
 */
export const DEFAULT_GOLD_FEEDS: GoldFeedStatus[] = [
  {
    id: 'cme_globex_gc',
    name: 'CME Globex GC / SI Feed',
    subtitle: 'COMEX Gold (GC) & Silver (SI) Benchmark Pricing & CVOL',
    category: 'CME_GLOBEX',
    status: 'ONLINE',
    latency: '18ms',
    lastSync: 'Live',
    primarySource: 'CME Globex / Databento Real-Time',
  },
  {
    id: 'fred_real_yields',
    name: 'St. Louis Fed FRED Real Yields',
    subtitle: '10Y TIPS (DFII10), 5Y TIPS (DFII5), 10Y Breakeven (T10YIE)',
    category: 'REAL_RATES',
    status: 'ONLINE',
    latency: '85ms',
    lastSync: 'Daily Official',
    primarySource: 'Federal Reserve Bank of St. Louis (FRED)',
  },
  {
    id: 'trading_economics_calendar',
    name: 'Economic Calendar & Consensus',
    subtitle: 'CPI, Core CPI, PCE, NFP, Jobless Claims & Historical Surprises',
    category: 'MACRO_CALENDAR',
    status: 'ONLINE',
    latency: '45ms',
    lastSync: 'Continuous',
    primarySource: 'Trading Economics / BLS / BEA Institutional Calendar',
  },
  {
    id: 'fomc_monetary_feed',
    name: 'Federal Reserve Monetary Policy',
    subtitle: 'FOMC Statements, Rate Decisions, Dot Plot & SEP Projections',
    category: 'CENTRAL_BANK',
    status: 'ONLINE',
    latency: '120ms',
    lastSync: 'Meeting Schedule',
    primarySource: 'Board of Governors of the Federal Reserve System',
  },
  {
    id: 'cftc_cot_gold',
    name: 'CFTC Commitments of Traders (COT)',
    subtitle: 'Disaggregated COMEX Gold Managed Money & Commercial Positioning',
    category: 'CFTC',
    status: 'ONLINE',
    latency: '250ms',
    lastSync: 'Weekly (Tuesday positions released Friday 3:30 PM)',
    primarySource: 'U.S. Commodity Futures Trading Commission (CFTC)',
  },
  {
    id: 'world_gold_council',
    name: 'World Gold Council (WGC)',
    subtitle: 'Global Physical ETF Tonnes & Quarterly Gold Demand Trends',
    category: 'WORLD_GOLD_COUNCIL',
    status: 'ONLINE',
    latency: '410ms',
    lastSync: 'Weekly ETF / Quarterly Trends',
    primarySource: 'World Gold Council GoldHub',
  },
  {
    id: 'comex_depository_stocks',
    name: 'COMEX Depository Inventories',
    subtitle: 'Registered vs Eligible Ounces & Daily Delivery Notices',
    category: 'COMEX_STOCKS',
    status: 'ONLINE',
    latency: '320ms',
    lastSync: 'Daily CME Clearing Notice',
    primarySource: 'CME Group Operations & Deliveries',
  },
  {
    id: 'reuters_finnhub_metals_wire',
    name: 'Institutional Metals News Wire',
    subtitle: 'Real-Time Reuters / Finnhub Central Bank, Geopolitical & Bullion Wire',
    category: 'NEWS_WIRE',
    status: 'ONLINE',
    latency: '65ms',
    lastSync: 'Real-Time Streaming',
    primarySource: 'Finnhub Institutional Wire / Reuters / Bloomberg',
  },
]

/**
 * 5 Pre-calibrated Institutional Test Presets
 */
export interface GoldEvaluationPreset {
  id: string
  title: string
  source: string
  category: string
  description: string
  rawText: string
}

export const GOLD_EVALUATION_PRESETS: GoldEvaluationPreset[] = [
  {
    id: 'preset-hot-cpi-rejection',
    title: 'Hot Core CPI with Immediate Price Rejection (Prompts 4 & 5)',
    source: 'U.S. Bureau of Labor Statistics (BLS) / Market Reaction',
    category: 'INFLATION',
    description:
      'Core CPI prints +0.4% MoM vs +0.2% expected. Real yields and DXY spike, GC initially drops from $4,200 to $4,165, but CVD is massively negative near low and price rapidly reclaims $4,225.',
    rawText: `US Bureau of Labor Statistics CPI Release:
Core CPI for August printed at +0.4% MoM, exceeding consensus estimates of +0.2% (Previous: +0.2%).
Headline CPI rose +0.3% MoM (Consensus: +0.2%).
Market Reaction:
US 10Y real yield jumped +12 bps from 2.76% to 2.88%. DXY rose +0.6% to 102.40.
GC initially plummeted from $4,200 to $4,165 on the headline release.
However, order flow revealed massive negative cumulative volume delta (CVD) absorption at $4,165.
Within 15 minutes, aggressive buyers absorbed the selling and price reclaimed $4,180, $4,200, and pushed to $4,225 (+0.6% on day).`,
  },
  {
    id: 'preset-dovish-fed-failure',
    title: 'Dovish Fed Surprise with Price Failure / Upthrust (Prompts 30 & 31)',
    source: 'FOMC Policy Statement & Press Conference',
    category: 'MONETARY_POLICY',
    description:
      'Fed unexpectedly cuts rates 50 bps vs 25 bps priced. Real yields and DXY drop. GC spikes from $4,200 to $4,250 on huge positive CVD, but rolls over to $4,195, failing at resistance.',
    rawText: `Federal Reserve FOMC Policy Decision:
The FOMC cut the target range for the federal funds rate by 50 bps to 4.25%-4.50%, exceeding market pricing of a 25 bps reduction.
The statement highlighted cooling labor conditions and projected an additional 50 bps of cuts before year-end.
Market Reaction:
US 10Y real yield fell -15 bps to 2.73%. DXY dropped -0.8% to 101.12.
GC spiked aggressively from $4,200 to $4,250 on massive positive CVD.
However, GC stalled directly at 5-day volume profile resistance, failed to hold the breakout, and rolled over rapidly through $4,240, $4,220, down to $4,195, closing below pre-release support.`,
  },
  {
    id: 'preset-pboc-reserve-expansion',
    title: 'PBOC & Sovereign Central Bank Gold Reserve Addition (Item 32)',
    source: 'People’s Bank of China (PBOC) Official Reserve Report',
    category: 'CENTRAL_BANK_DEMAND',
    description:
      'PBOC reports an addition of 60,000 troy ounces to official reserves, extending official gold buying streak to 18 months.',
    rawText: `State Administration of Foreign Exchange (SAFE) / PBOC Official Data:
China’s official gold reserves rose to 72.80 million fine troy ounces at the end of September, up 60,000 ounces from 72.74 million ounces in the prior month.
Total gold holdings value reached $218.4 billion, accounting for 5.1% of total foreign exchange reserves.
This marks the 18th month of net gold accumulation by China as part of sovereign reserve diversification.
Market Context:
GC prompt contract traded flat (+0.1%) intraday on the release. World Gold Council notes Asian central bank accumulation is structural and insensitive to short-term COMEX price fluctuations.`,
  },
  {
    id: 'preset-liquidation-vs-safe-haven',
    title: 'Geopolitical Shock: General Cash Liquidation vs Safe Haven (Item 10)',
    source: 'Global Financial News Wire / Cross-Asset Liquidity Shock',
    category: 'FINANCIAL_STRESS',
    description:
      'Major sovereign credit and banking panic triggers simultaneous drop in equities, credit, and gold as participants scramble for US dollar cash.',
    rawText: `Global Market Liquidity Emergency:
A sudden default in a European sovereign debt fund triggered a broad asset margin liquidation across major exchanges.
S&P 500 futures fell -3.2%, High Yield credit spreads widened +65 bps, and the US Dollar Index (DXY) surged +1.4% to 103.80 as market participants urgently raised cash.
GC Gold dropped -2.4% from $4,220 to $4,118 despite the panic headlines, as levered funds liquidated liquid gold holdings to meet derivative margin calls.
US 10Y real yields spiked +18 bps due to illiquidity.`,
  },
  {
    id: 'preset-cftc-crowding-exhaustion',
    title: 'CFTC Managed Money Extreme Long Crowding & Exhaustion (Item 17)',
    source: 'CFTC Commitments of Traders (COT) Disaggregated Report',
    category: 'SPECULATIVE_POSITIONING',
    description:
      'Speculative Managed Money net longs surge to 310,000 contracts (Crowding Index 94/100). Bullish headlines fail to push price higher.',
    rawText: `CFTC Commitments of Traders Disaggregated Report (COMEX Gold):
For the week ending Tuesday, Managed Money net long positions expanded by 24,800 contracts to 310,200 contracts.
Gross longs stand at 345,000 vs gross shorts of only 34,800 (9.9:1 long/short ratio), reaching the 98th percentile of historical positioning over the past 5 years.
Total open interest rose to 585,000 contracts.
Market Reaction:
Despite the heavily bullish speculative inflow, GC failed to register a new high over the past 3 sessions, forming an upthrust with heavy volume and stalling at $4,260 resistance.`,
  },
]
