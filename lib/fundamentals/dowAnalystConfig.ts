/**
 * Dow Jones Industrial Average Fundamental Analyst Configuration
 * Market: CME E-mini Dow Futures (YM)
 * Multiplier: $5 x DJIA Index level ($5 / point)
 * Index Structure: 30 stocks, Price-Weighted (NOT market-cap weighted)
 */

import type {
  DjiaConstituent,
  DjiaContributionState,
  DowRotationState,
  DowCreditState,
  IndustrialCycleState,
  DowTelemetry,
  TodaysDowFundamentalState,
  DowDriverState,
  DowDriverId,
  DowFeedStatus,
} from '@/types/fundamentals'
import { composeAnalystPrompts } from '@/lib/fundamentals/outputContract'

/**
 * Dow knowledge. Event JSON and chat prose are composed separately.
 */
const dowPrompts = composeAnalystPrompts(
  `You are the Dow Jones Industrial Average Macro, Cyclical, Earnings and Market-Rotation Analyst.
Your primary traded market is CME E-mini Dow futures (YM).
The DJIA is price weighted. Use a supplied Dow-point contribution. Do not divide a stock move by the divisor yourself.
Subjects you may interpret when supplied: Fed policy, yields and curve, inflation, labor, growth, manufacturing, consumer conditions, credit, constituent earnings, sector rotation, energy costs, the dollar, trade policy, breadth, and CFTC positioning as a slow report.
Yield-move labels, when supplied, are GROWTH_DRIVEN, INFLATION_DRIVEN, FED_DRIVEN, RISK_OFF, or UNKNOWN.
Growth-driven yield increases MAY be supportive for cyclical and financial relative performance, subject to magnitude, curve behavior, credit conditions, and actual market confirmation. That is not a law.
Stronger data are not automatically bullish. A stock's percentage move is not important without a supplied point contribution.
CFTC positioning is not real-time order flow.
Do not infer volume-profile support or negative-CVD absorption unless MARKET_REACTION says so.`,
  `estimated Dow-point impact belongs in specialist.dow_point_impact and is number or null.
It is null for a macro release such as ISM unless code has already computed a constituent contribution.
{
  "breadth": null,
  "dow_point_impact": null,
  "yield_move_driver": null
}
breadth is BROAD, NARROW, or null. Do not invent advancer counts.`
)

export const DOW_ANALYST_CORE = dowPrompts.core
export const DOW_ANALYST_EVENT_PROMPT = dowPrompts.event
export const DOW_ANALYST_CHAT_PROMPT = dowPrompts.chat
export const DOW_ANALYST_SYSTEM_PROMPT = DOW_ANALYST_CORE

/**
 * Dow Divisor Constant (Approx 0.151727525)
 * S&P Dow Jones Indices methodology: Sum of 30 prices / Divisor = DJIA Index Level
 * Delta DJIA Points = Delta Share Price / Divisor
 * $1 change in any stock = ~6.5907 Dow points
 */
export const DJIA_DIVISOR = 0.151727525

/**
 * Current 30 DJIA Constituents with prices and price-weights (May 2026 update)
 * Note: High-priced stocks (e.g. UNH, GS, MSFT, HD, CAT) have vastly more point leverage than lower-priced stocks (e.g. CSCO, KO, VZ, NKE).
 */
export const DEFAULT_DJIA_30_CONSTITUENTS: DjiaConstituent[] = [
  { symbol: 'UNH', name: 'UnitedHealth Group Inc', sector: 'Healthcare', price: 585.5, priceWeightPct: 8.24, dayChange: 4.25, dayChangePct: 0.73, pointContribution: 28.01, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc', sector: 'Financials', price: 535.2, priceWeightPct: 7.53, dayChange: 5.8, dayChangePct: 1.09, pointContribution: 38.23, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', price: 448.0, priceWeightPct: 6.30, dayChange: 2.1, dayChangePct: 0.47, pointContribution: 13.84, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'HD', name: 'Home Depot Inc', sector: 'Consumer Discretionary', price: 412.5, priceWeightPct: 5.80, dayChange: 3.4, dayChangePct: 0.83, pointContribution: 22.41, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'CAT', name: 'Caterpillar Inc', sector: 'Industrials', price: 398.0, priceWeightPct: 5.60, dayChange: 6.2, dayChangePct: 1.58, pointContribution: 40.86, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'AMGN', name: 'Amgen Inc', sector: 'Healthcare', price: 332.0, priceWeightPct: 4.67, dayChange: -1.2, dayChangePct: -0.36, pointContribution: -7.91, lastEpsSurprise: 'INLINE', forwardGuidance: 'MAINTAINED' },
  { symbol: 'V', name: 'Visa Inc', sector: 'Financials', price: 295.4, priceWeightPct: 4.15, dayChange: 1.8, dayChangePct: 0.61, pointContribution: 11.86, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'CRM', name: 'Salesforce Inc', sector: 'Technology', price: 292.0, priceWeightPct: 4.11, dayChange: 2.5, dayChangePct: 0.86, pointContribution: 16.48, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'MCD', name: 'McDonald\'s Corp', sector: 'Consumer Discretionary', price: 288.0, priceWeightPct: 4.05, dayChange: 0.9, dayChangePct: 0.31, pointContribution: 5.93, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'BA', name: 'Boeing Co', sector: 'Industrials', price: 215.0, priceWeightPct: 3.02, dayChange: 4.5, dayChangePct: 2.14, pointContribution: 29.66, lastEpsSurprise: 'MISS', forwardGuidance: 'MAINTAINED' },
  { symbol: 'HON', name: 'Honeywell International', sector: 'Industrials', price: 212.5, priceWeightPct: 2.99, dayChange: 1.6, dayChangePct: 0.76, pointContribution: 10.55, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'TRV', name: 'Travelers Companies Inc', sector: 'Financials', price: 242.0, priceWeightPct: 3.40, dayChange: 2.2, dayChangePct: 0.92, pointContribution: 14.50, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'AAPL', name: 'Apple Inc', sector: 'Technology', price: 232.0, priceWeightPct: 3.26, dayChange: 0.8, dayChangePct: 0.35, pointContribution: 5.27, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'AMZN', name: 'Amazon.com Inc', sector: 'Consumer Discretionary', price: 194.0, priceWeightPct: 2.73, dayChange: 1.1, dayChangePct: 0.57, pointContribution: 7.25, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', price: 165.0, priceWeightPct: 2.32, dayChange: -0.4, dayChangePct: -0.24, pointContribution: -2.64, lastEpsSurprise: 'INLINE', forwardGuidance: 'MAINTAINED' },
  { symbol: 'IBM', name: 'International Business Machines', sector: 'Technology', price: 228.0, priceWeightPct: 3.21, dayChange: 3.1, dayChangePct: 1.38, pointContribution: 20.43, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'AXP', name: 'American Express Co', sector: 'Financials', price: 275.0, priceWeightPct: 3.87, dayChange: 3.8, dayChangePct: 1.40, pointContribution: 25.04, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co', sector: 'Financials', price: 226.0, priceWeightPct: 3.18, dayChange: 3.2, dayChangePct: 1.44, pointContribution: 21.09, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'PG', name: 'Procter & Gamble Co', sector: 'Consumer Staples', price: 174.0, priceWeightPct: 2.45, dayChange: 0.5, dayChangePct: 0.29, pointContribution: 3.30, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', price: 128.0, priceWeightPct: 1.80, dayChange: 2.4, dayChangePct: 1.91, pointContribution: 15.82, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'DIS', name: 'Walt Disney Co', sector: 'Communication Services', price: 98.0, priceWeightPct: 1.38, dayChange: 0.6, dayChangePct: 0.62, pointContribution: 3.95, lastEpsSurprise: 'INLINE', forwardGuidance: 'MAINTAINED' },
  { symbol: 'WMT', name: 'Walmart Inc', sector: 'Consumer Staples', price: 82.5, priceWeightPct: 1.16, dayChange: 0.4, dayChangePct: 0.49, pointContribution: 2.64, lastEpsSurprise: 'BEAT', forwardGuidance: 'RAISED' },
  { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy', price: 154.0, priceWeightPct: 2.17, dayChange: 1.8, dayChangePct: 1.18, pointContribution: 11.86, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'MRK', name: 'Merck & Co Inc', sector: 'Healthcare', price: 116.0, priceWeightPct: 1.63, dayChange: -0.2, dayChangePct: -0.17, pointContribution: -1.32, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'SHW', name: 'Sherwin-Williams Co', sector: 'Materials', price: 382.0, priceWeightPct: 5.37, dayChange: 4.1, dayChangePct: 1.09, pointContribution: 27.02, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc', sector: 'Technology', price: 56.5, priceWeightPct: 0.79, dayChange: 0.3, dayChangePct: 0.53, pointContribution: 1.98, lastEpsSurprise: 'INLINE', forwardGuidance: 'MAINTAINED' },
  { symbol: 'NKE', name: 'Nike Inc', sector: 'Consumer Discretionary', price: 86.0, priceWeightPct: 1.21, dayChange: -0.8, dayChangePct: -0.92, pointContribution: -5.27, lastEpsSurprise: 'MISS', forwardGuidance: 'LOWERED' },
  { symbol: 'KO', name: 'Coca-Cola Co', sector: 'Consumer Staples', price: 68.0, priceWeightPct: 0.96, dayChange: 0.2, dayChangePct: 0.29, pointContribution: 1.32, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'MMM', name: '3M Company', sector: 'Industrials', price: 135.0, priceWeightPct: 1.90, dayChange: 1.5, dayChangePct: 1.12, pointContribution: 9.89, lastEpsSurprise: 'BEAT', forwardGuidance: 'MAINTAINED' },
  { symbol: 'VZ', name: 'Verizon Communications', sector: 'Communication Services', price: 44.5, priceWeightPct: 0.63, dayChange: 0.1, dayChangePct: 0.23, pointContribution: 0.66, lastEpsSurprise: 'INLINE', forwardGuidance: 'MAINTAINED' },
]

/**
 * 11 Major Drivers for Dow (Item 3 Hierarchy)
 */
export const DEFAULT_DOW_DRIVERS: Record<DowDriverId, DowDriverState> = {
  us_growth_economic_cycle: {
    id: 'us_growth_economic_cycle',
    name: 'U.S. Growth & Economic Business Cycle',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'GDP, durable goods, retail sales and business investment directly drive revenues for mature cyclical blue-chips.',
    summary: 'US GDP tracking +2.4% annualized. Solid enterprise demand and real wage expansion sustaining cyclical corporate earnings power.',
    metrics: [
      { label: 'Atlanta Fed GDPNow', value: '+2.4%', change: '+0.2%', trend: 'UP', stance: 'BULLISH' },
      { label: 'Core Capital Goods MoM', value: '+0.6%', change: 'Beat cons', trend: 'UP', stance: 'BULLISH' },
      { label: 'Retail Sales MoM', value: '+0.4%', change: '+0.1%', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  fed_rates: {
    id: 'fed_rates',
    name: 'Federal Reserve & Interest Rates',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Fed policy sets borrowing costs. Dovish recalibration with a healthy economy creates the optimal Dow backdrop.',
    summary: 'Fed holding terminal rate at 4.75%-5.00%. Market pricing orderly easing cycle without imminent recession fears.',
    metrics: [
      { label: 'Fed Funds Effective', value: '4.83%', change: 'Stable', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Market 12M Cuts Priced', value: '-50 bps', change: 'Soft landing', trend: 'FLAT', stance: 'BULLISH' },
      { label: 'Yield Move Driver', value: 'GROWTH_DRIVEN', change: 'Constructive', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  industrial_manufacturing: {
    id: 'industrial_manufacturing',
    name: 'Industrial & Manufacturing Conditions',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'ISM Manufacturing new orders and industrial production drive order books for CAT, HON, BA, MMM, and SHW.',
    summary: 'ISM Manufacturing headline recovered to 51.2 with New Orders accelerating to 53.4. Factory orders showing recovery.',
    metrics: [
      { label: 'ISM Manufacturing', value: '51.2', change: '+1.4 pts', trend: 'UP', stance: 'BULLISH' },
      { label: 'ISM New Orders', value: '53.4', change: '+2.8 pts', trend: 'UP', stance: 'BULLISH' },
      { label: 'Industrial Production', value: '+0.3% MoM', change: 'Expanding', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  dow_earnings_guidance: {
    id: 'dow_earnings_guidance',
    name: 'DJIA 30 Company Earnings & Guidance',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Price-weighted constituent earnings move index points by the change in share price divided by the official divisor. That divisor is unavailable.',
    summary: '78% of DJIA components beating EPS consensus. Forward corporate operating margin guidance raised across Financials and Industrials.',
    metrics: [
      { label: 'DJIA Blended EPS Growth', value: '+9.4% YoY', change: '+0.8%', trend: 'UP', stance: 'BULLISH' },
      { label: 'Guidance Raise/Lower Ratio', value: '1.62:1', change: 'Positive', trend: 'UP', stance: 'BULLISH' },
      { label: 'High-Priced Leaders (UNH/GS)', value: 'Constructive', change: 'Above 50d MA', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  financial_conditions: {
    id: 'financial_conditions',
    name: 'Financial Conditions & Bank Health',
    intradayStars: 4,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole: 'Steepening yield curve and active commercial credit demand drive net interest income for JPM, GS, AXP, and TRV.',
    summary: 'Chicago Fed NFCI at -0.55 (loose). 2s10s curve disinverted at +40 bps providing favorable bank lending margin context.',
    metrics: [
      { label: 'Chicago Fed NFCI', value: '-0.55', change: 'Substantially loose', trend: 'DOWN', stance: 'BULLISH' },
      { label: '2s10s Curve Spread', value: '+40 bps', change: 'Disinverted', trend: 'UP', stance: 'BULLISH' },
      { label: 'KBW Bank Index', value: '+1.6% 1W', change: 'Leading', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  consumer_conditions: {
    id: 'consumer_conditions',
    name: 'Consumer Spending & Confidence',
    intradayStars: 4,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Real consumer spending power drives revenues for WMT, HD, MCD, NKE, KO, DIS, and PG.',
    summary: 'U.S. Consumer Sentiment healthy at 74.2; real retail sales expanding without unsustainable revolving credit buildup.',
    metrics: [
      { label: 'U. Mich Consumer Sentiment', value: '74.2', change: '+1.5 pts', trend: 'UP', stance: 'BULLISH' },
      { label: 'Real Personal Spending', value: '+0.3% MoM', change: 'Healthy', trend: 'UP', stance: 'BULLISH' },
      { label: 'Wage Growth YoY', value: '+3.8%', change: 'Above CPI', trend: 'DOWN', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  usd: {
    id: 'usd',
    name: 'U.S. Dollar & International Competitiveness',
    intradayStars: 3,
    longTermStars: 4,
    stance: 'NEUTRAL',
    transmissionRole: 'A surging dollar reduces foreign revenue translation for multinational industrials; a stable DXY supports export competitiveness.',
    summary: 'DXY holding in tight 101-102 range; dollar stability prevents foreign exchange translation drag on global blue-chips.',
    metrics: [
      { label: 'DXY Dollar Index', value: '101.92', change: '-0.15%', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'EUR/USD', value: '1.0920', change: '+0.2%', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  oil_commodity_costs: {
    id: 'oil_commodity_costs',
    name: 'Energy & Commodity Input Costs',
    intradayStars: 3,
    longTermStars: 3,
    stance: 'NEUTRAL',
    transmissionRole: 'Oil prices driven by economic demand support CVX without punishing transport and consumer margins.',
    summary: 'WTI Crude at $74.50 in backwardation; fuel costs manageable for manufacturing operations and consumer budgets.',
    metrics: [
      { label: 'WTI Prompt Crude', value: '$74.50', change: 'Stable', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Diesel / Distillate Index', value: '$2.38/gal', change: 'Moderate', trend: 'FLAT', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  trade_tariff_policy: {
    id: 'trade_tariff_policy',
    name: 'Trade, Tariff & Industrial Policy',
    intradayStars: 3,
    longTermStars: 4,
    stance: 'NEUTRAL',
    transmissionRole: 'Protectionist tariffs or export restrictions alter global supply chains for CAT, BA, and chemical manufacturers.',
    summary: 'Bilateral trade tariffs stable with no immediate new punitive tariffs announced; domestic CHIPS and infrastructure investments continuing.',
    metrics: [
      { label: 'Section 301 Tariff Status', value: 'Active / Factored', change: 'No surprise', trend: 'FLAT', stance: 'NEUTRAL' },
      { label: 'Supply Chain Delivery Lead', value: 'Normalizing', change: 'Stable', trend: 'FLAT', stance: 'NEUTRAL' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  sector_rotation: {
    id: 'sector_rotation',
    name: 'Sector Rotation (Cyclical Value vs Tech Growth)',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Capital flows rotating out of high-multiple growth equities into industrials, financials, and healthcare favor YM over NQ.',
    summary: 'Broad rotation into Industrials (XLI +1.4%) and Financials (XLF +1.2%) driving strong YM relative strength vs NQ.',
    metrics: [
      { label: 'YM vs NQ 1D Spread', value: '+0.85%', change: 'YM outperforming', trend: 'UP', stance: 'BULLISH' },
      { label: 'XLI / XLK Relative Ratio', value: '0.94x', change: '+1.1%', trend: 'UP', stance: 'BULLISH' },
      { label: 'Russell 2000 (RTY) Confirmation', value: '+1.1%', change: 'Broad cyclical bid', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
  credit_conditions: {
    id: 'credit_conditions',
    name: 'Corporate Credit Spreads & Bond Markets',
    intradayStars: 4,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole: 'Tight credit spreads confirm healthy corporate balance sheets and low refinancing friction for mature corporations.',
    summary: 'High-Yield OAS spreads at 315 bps (historically tight); HYG and LQD trading with firm bids, signaling zero institutional credit stress.',
    metrics: [
      { label: 'US High Yield OAS', value: '315 bps', change: '-4 bps', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'Investment Grade OAS', value: '92 bps', change: '-2 bps', trend: 'DOWN', stance: 'BULLISH' },
      { label: 'HYG ETF Price Action', value: '$78.40', change: '+0.3%', trend: 'UP', stance: 'BULLISH' },
    ],
    lastUpdated: '2026-10-04T12:00:00Z',
  },
}

/**
 * Baseline "DOW FUNDAMENTAL STATE" (Item 35: 24 Dimensions)
 */
export const DEFAULT_TODAY_DOW_STATE: TodaysDowFundamentalState = {
  economic_growth: 'Robust: US GDP tracking +2.4% annualized. Solid enterprise capital expenditure and infrastructure spending sustaining cyclical order flow.',
  manufacturing: 'Expanding: ISM Manufacturing printed 51.2 with New Orders jumping to 53.4, signaling accelerating industrial demand into next quarter.',
  consumer: 'Resilient: Consumer confidence at 74.2; real wage growth (+3.8% vs +3.2% CPI) sustaining core retail sales without debt distress.',
  labor: 'Solid: Unemployment rate steady at 4.1% with nonfarm payrolls averaging +185k; initial jobless claims low at 218k.',
  inflation: 'Cooling trend: Core CPI at 3.2% YoY, Core PCE at 2.8%. Shelter disinflation continuing at an orderly pace.',
  fed: 'Data-dependent pause with terminal rate at 4.75%-5.00%. Markets pricing soft-landing rate cuts (~50 bps over 12 months).',
  us2y: '4.88% (+4 bps on week)',
  us10y: '5.28% (+3 bps on week)',
  yield_curve: 'Disinverted: 2s10s spread at +40 bps. Normal yield curve structure supporting financial lending margins.',
  financial_conditions: 'Loose: Chicago Fed NFCI at -0.55. Liquidity friction low across commercial paper and syndicated loans.',
  credit: 'Healthy: High yield credit spreads tight at 315 bps; HYG and LQD confirming zero institutional funding distress.',
  industrial_sector: 'Leading: Strong order backlogs for heavy machinery (CAT), aerospace (BA), and industrial building materials (SHW).',
  financial_sector: 'Strong: Capital markets activity, M&A advisory, and net interest margins propelling GS, JPM, and AXP.',
  energy: 'Stable: WTI prompt crude holding $74.50 in backwardation; CVX upstream cash generation solid.',
  healthcare: 'Defensive anchor: UNH and AMGN trading firmly above 50-day moving averages with steady managed care visibility.',
  consumer_sectors: 'Selective: Value and discount retailers (WMT, HD) outperforming discretionary apparel.',
  djia_earnings: 'Solid: 78% of Dow components beating EPS consensus; blended index EPS growth tracking +9.4% YoY.',
  forward_guidance: 'Constructive: 1.62:1 raise-to-lower forward guidance ratio across Dow industrial and financial members.',
  usd: 'Rangebound: DXY at 101.92; minimal foreign exchange headwind for multinational sales.',
  trade_policy: 'Quiet: Existing tariff schedule active and fully incorporated into corporate margin baselines.',
  breadth: 'Broadly positive: 24 advancing vs 6 declining stocks. 73% of constituents trading above their 50-day moving averages.',
  contribution_concentration: 'Low: Top 3 point contributors (CAT, GS, UNH) account for only 42% of total daily points moved.',
  sector_rotation: 'Cyclical / Value leadership: Industrials, Financials and Energy outperforming duration-heavy tech.',
  cftc_positioning: 'As of Tuesday: CFTC Dow ($5 x DJIA) net spec positioning at +18,400 contracts (58th percentile). Moderate long exposure.',

  intraday_bias: 'BULLISH',
  short_term_bias: 'BULLISH',
  medium_term_bias: 'BULLISH',

  primary_current_driver: 'Accelerating Industrial Cycle (ISM New Orders 53.4) & Cyclical Sector Rotation',
  upcoming_catalysts: 'ISM Services Index (Wed 10:00 AM ET); FOMC Meeting Minutes (Wed 2:00 PM ET); Dow 30 Earnings (Thu AM); Nonfarm Payrolls (Fri 8:30 AM ET).',
  what_changed_since_yesterday: 'ISM New Orders surged to 53.4; Goldman Sachs and Caterpillar upgraded forward revenue targets; YM gained +340 points on positive CVD.',
  what_would_invalidate_the_current_interpretation: 'A sudden widening of high-yield credit spreads above 400 bps accompanied by manufacturing new orders dropping below 48.0 and YM breaking below 5-day volume profile POC ($46,150) on heavy selling volume.',
}

/**
 * Baseline DJIA Contribution State
 */
export const DEFAULT_DJIA_CONTRIBUTION_STATE: DjiaContributionState = {
  divisor: DJIA_DIVISOR,
  sumSharePrices: 7104.1,
  totalDayPointsMove: +340.5,
  top1ContributionPct: 12.0,
  top3ContributionPct: 32.5,
  top5ContributionPct: 48.2,
  contributionConcentration: 'LOW',
  equalWeight30ReturnPct: +0.68,
  priceWeightedDjiaReturnPct: +0.74,
  weightingDivergenceSignal: 'BALANCED',
}

/**
 * Baseline Dow Sector Rotation State
 */
export const DEFAULT_DOW_ROTATION_STATE: DowRotationState = {
  ymChangePct: +0.74,
  esChangePct: +0.42,
  nqChangePct: +0.15,
  rtyChangePct: +0.88,
  rotationRegime: 'CYCLICAL_VALUE_OUTPERFORMANCE',
  leadershipSector: 'Industrials / Financials',
  laggingSector: 'Information Technology',
  ymVsNqSpreadPct: +0.59,
}

/**
 * Baseline Dow Credit State
 */
export const DEFAULT_DOW_CREDIT_STATE: DowCreditState = {
  hygPrice: 78.4,
  hygChangePct: +0.32,
  lqdPrice: 110.2,
  lqdChangePct: +0.18,
  highYieldSpreadBps: 315,
  investmentGradeSpreadBps: 92,
  bankSectorChangePct: +1.45,
  creditStressRegime: 'HEALTHY_EXPANSION',
  creditDivergenceAlert: false,
}

/**
 * Baseline Industrial Cycle State
 */
export const DEFAULT_INDUSTRIAL_CYCLE_STATE: IndustrialCycleState = {
  ismManufacturingHeadline: 51.2,
  ismNewOrders: 53.4,
  ismPricesPaid: 52.0,
  ismProduction: 52.6,
  durableGoodsMomPct: +0.8,
  coreCapitalGoodsOrdersMomPct: +0.6,
  cyclePhase: 'ACCELERATING_DEMAND',
}

/**
 * Baseline Telemetry for Dow
 */
export const DEFAULT_DOW_TELEMETRY: DowTelemetry = {
  ymPrice: 46500.0,
  ymChange: 340.0,
  ymChangePct: 0.74,
  contractMultiplier: 5,
  contractNotionalValue: 46500 * 5, // $232,500
  esPrice: 6420.25,
  esChangePct: 0.42,
  nqPrice: 24850.5,
  nqChangePct: 0.15,
  rtyPrice: 2520.0,
  rtyChangePct: 0.88,
  us2yNominalYield: 4.88,
  us10yNominalYield: 5.28,
  yieldCurve2s10sSpreadBps: 40.0,
  yieldMoveDriver: 'GROWTH_DRIVEN',
  growthInflationQuadrant: 'GROWTH_UP_INFLATION_DOWN',
  dxyIndex: 101.92,
  dxyChangePct: -0.15,
  oilWtiPrice: 74.5,
  oilWtiChangePct: +0.8,
  vixIndex: 15.2,
  advancersCount: 24,
  declinersCount: 6,
  unchangedCount: 0,
  dowDivisor: DJIA_DIVISOR,
  topConstituentsByWeight: [...DEFAULT_DJIA_30_CONSTITUENTS],
  cvdAggressionStance: 'AGGRESSIVE_BUYING',
  timestamp: Math.floor(Date.now() / 1000),
  source: 'CME Globex / S&P Dow Jones / St. Louis Fed FRED',
  updatedAt: new Date().toISOString(),
}

/**
 * 9-Feed V1 Data Architecture for Dow (Prompt 39)
 */
export const DEFAULT_DOW_FEEDS: DowFeedStatus[] = [
  {
    id: 'cme_globex_ym',
    name: 'CME Globex YM / ES / NQ / RTY',
    subtitle: 'E-mini Dow ($5) Futures, S&P, Nasdaq & Russell Cross-Market Pricing',
    category: 'CME_GLOBEX',
    status: 'ONLINE',
    latency: '15ms',
    lastSync: 'Live',
    primarySource: 'CME Globex / Databento Real-Time',
  },
  {
    id: 'djia_weights_divisor_engine',
    name: 'DJIA 30 Price Weights & Divisor Engine',
    subtitle: 'Official share prices and Dow-point contributions. The official divisor is unavailable.',
    category: 'PRICE_WEIGHTS_DIVISOR',
    status: 'ONLINE',
    latency: '30ms',
    lastSync: 'Continuous Tick',
    primarySource: 'S&P Dow Jones Indices / Direct Feed',
  },
  {
    id: 'economic_calendar_ism',
    name: 'Economic Calendar & Manufacturing Wire',
    subtitle: 'ISM Mfg, ISM Services, New Orders, Durable Goods & Cap Goods',
    category: 'MACRO_CALENDAR',
    status: 'ONLINE',
    latency: '45ms',
    lastSync: 'Continuous',
    primarySource: 'Trading Economics / ISM / BLS / Census Bureau',
  },
  {
    id: 'rates_yield_curve_engine',
    name: 'Treasury Rates & Yield Move Classifier',
    subtitle: '2Y, 10Y, 2s10s Spread, Classifying Growth vs Inflation Yield Drivers',
    category: 'RATES_ENGINE',
    status: 'ONLINE',
    latency: '40ms',
    lastSync: 'Live Tick / FRED Daily',
    primarySource: 'CBOE / St. Louis Fed FRED / ALFRED',
  },
  {
    id: 'credit_corporate_bonds',
    name: 'Credit Markets & Bank Health Monitor',
    subtitle: 'High-Yield OAS, Investment Grade OAS, HYG/LQD, Bank Index Spreads',
    category: 'CREDIT_MARKETS',
    status: 'ONLINE',
    latency: '120ms',
    lastSync: 'Continuous',
    primarySource: 'ICE BofA / FINRA TRACE / CBOE',
  },
  {
    id: 'sector_rotation_analyzer',
    name: 'Sector Rotation & Relative Value Engine',
    subtitle: 'Industrials (XLI), Financials (XLF), Health (XLV) vs Tech (XLK)',
    category: 'SECTOR_ROTATION',
    status: 'ONLINE',
    latency: '85ms',
    lastSync: 'Continuous',
    primarySource: 'State Street SPDR / CME Globex',
  },
  {
    id: 'sec_edgar_djia_earnings',
    name: 'SEC EDGAR & Dow Corporate Filings',
    subtitle: '10-Q / 10-K Filings, EPS, Revenue, Margins & Price-Weighted Impacts',
    category: 'SEC_EDGAR_EARNINGS',
    status: 'ONLINE',
    latency: '180ms',
    lastSync: 'Continuous',
    primarySource: 'SEC EDGAR / DJIA Corporate IR',
  },
  {
    id: 'cftc_dow_positioning',
    name: 'CFTC Commitments of Traders (COT)',
    subtitle: 'Dow ($5 x DJIA) Non-Commercial Net Spec Positioning & Commercials',
    category: 'CFTC',
    status: 'ONLINE',
    latency: 'Weekly',
    lastSync: 'Friday 3:30 PM ET (As of Tuesday)',
    primarySource: 'U.S. Commodity Futures Trading Commission',
  },
  {
    id: 'institutional_wire_deduplicator',
    name: 'Institutional News Wire & Deduplicator',
    subtitle: 'Reuters / Finnhub Industrial & Dow Wire with Event Clustering',
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
export interface DowEvaluationPreset {
  id: string
  title: string
  source: string
  category: string
  description: string
  rawText: string
}

export const DOW_EVALUATION_PRESETS: DowEvaluationPreset[] = [
  {
    id: 'preset-strong-ism-cyclical-rotation',
    title: 'Strong ISM & New Orders: Cyclical Rotation (Prompts 5 & 6)',
    source: 'Institute for Supply Management (ISM) / Market Reaction',
    category: 'MANUFACTURING',
    description:
      'ISM Manufacturing surges to 54.0 vs 50.5 consensus; New Orders jump to 56.2. 10Y yield rises +8 bps. YM rallies +380 pts on bank/industrial leadership while NQ stays flat/negative.',
    rawText: `Institute for Supply Management Manufacturing Report:
ISM Manufacturing PMI printed at 54.0 for September, significantly topping consensus estimates of 50.5 (Prior: 49.8).
Crucially, New Orders surged to 56.2 vs 49.0 prior, signaling broad-based business investment recovery.
Prices Paid cooled to 52.0 vs 56.0 prior, easing industrial input inflation fears.
Market Reaction & Cross-Asset Transmission:
US 10Y Treasury yield rose +8 bps to 5.34%, but market classified this yield move as GROWTH_DRIVEN rather than inflation-driven.
Sector rotation shifted heavily toward cyclicals: Industrials (XLI) +1.8%, Financials (XLF) +1.6%, Energy (XLE) +1.4%, while Tech (XLK) dropped -0.3%.
CME Globex Relative Pricing:
YM surged +380 points (+0.82%), ES rose +0.45%, while NQ slipped -0.15%.
Dow Point Contribution was broad-based: Caterpillar (+42 pts), Goldman Sachs (+38 pts), Boeing (+32 pts), and Home Depot (+24 pts) led the index higher.`,
  },
  {
    id: 'preset-dismal-macro-cvd-absorption',
    title: 'Terrible Macro Report with Volume Profile CVD Absorption Reversal (Prompt 28)',
    source: 'Census Bureau / CME Order Flow Tape Reaction',
    category: 'GROWTH',
    description:
      'Durable Goods & ISM collapse; YM plunges 450 points to 5-day volume profile LVN, but massive negative delta is absorbed and price reclaims VWAP.',
    rawText: `U.S. Census Bureau & Manufacturing Report:
Durable Goods Orders dropped -3.2% MoM vs +0.2% expected; Core Capital Goods non-defense ex-aircraft plummeted -1.8%.
ISM Manufacturing fell to 46.8 vs 50.2 expected.
Market Reaction & Tape Reading:
Initial reaction: YM futures dumped 450 points from 46,600 to 46,150 on heavy selling volume.
However, tape reading and CVD at the 5-day volume profile low volume node (LVN) at 46,150 revealed massive aggressive market sell delta (-8,500 contracts) completely absorbed by passive institutional bids.
Price refused to break below 46,140.
Within 30 minutes, buyers stepped in, reclaiming 46,250, 46,400, and pushing back to 46,580 (+0.05% on day).
While NQ and ES remained depressed, YM showed powerful relative absorption and failed seller continuation.`,
  },
  {
    id: 'preset-price-weight-distortion',
    title: 'Price-Weighted Distortions: $550 Stock Drops 8% vs $90 Stock Rises 10% (Prompt 16)',
    source: 'SEC EDGAR 10-Q & DJIA Contribution Engine',
    category: 'EARNINGS',
    description:
      'Demonstrates price weighting: UNH ($580) drops 8% = -$46.40 drag (-305 Dow points), completely overpowering a 10% gain in a $90 constituent (+59 Dow points).',
    rawText: `DJIA Constituent Earnings Reports:
UnitedHealth Group (UNH, Share Price: $585.50, Price Weight: 8.24%):
Reported Q3 EPS miss and lowered Medical Loss Ratio guidance. Stock fell -8.0% in early trading (-$46.84 per share).
Using the Dow Divisor of 0.151727525, this single stock caused an immediate -308.7 Dow point drag on YM futures.
Meanwhile, Nike (NKE, Share Price: $86.00, Price Weight: 1.21%):
Reported strong overseas direct sales and jumped +10.0% (+$8.60 per share).
However, with a price of only $86, this +10% gain contributed only +56.7 Dow points.
Result:
Despite an apparent 1-for-1 earnings split, the price-weighted DJIA dropped -240 points due to high-priced constituent leverage.
Equal-weight Dow returned +0.4%, but official price-weighted DJIA dropped -0.52%, flagging high-priced distortion.`,
  },
  {
    id: 'preset-credit-spreads-widening-stress',
    title: 'Credit Spreads Widening & Bank Deterioration Warning (Prompt 10)',
    source: 'FINRA TRACE / High Yield Credit Spreads & Bank Wire',
    category: 'CREDIT',
    description:
      'HYG plunges -1.2%, high-yield OAS widens +38 bps, and bank stocks breakdown, warning that quiet Dow price action hides systemic credit stress.',
    rawText: `Credit Market & Financial Conditions Flash:
US High Yield OAS spreads widened sharply by +38 bps to 375 bps following distress in corporate commercial real estate debt.
High-Yield Bond ETF (HYG) plunged -1.2% on 3x normal volume; Investment-Grade ETF (LQD) dropped -0.8%.
Financial Sector (XLF) dropped -2.4%, led by Goldman Sachs (-3.8%, -140 Dow pts) and JPMorgan (-2.9%, -45 Dow pts).
Market Reaction:
While headline macro data was quiet, credit spread deterioration signaled tightening liquidity.
E-mini Dow futures (YM) broke through its morning value area low (VAL) with negative delta confirmation, declining -410 points as banking constituents dragged the price-weighted index lower.`,
  },
  {
    id: 'preset-growth-up-inflation-down-sweet-spot',
    title: 'Growth ↑ Inflation ↓: The Goldilocks Sweet Spot for Dow (Prompt 12)',
    source: 'U.S. Bureau of Economic Analysis (BEA) / Retail Sales',
    category: 'GROWTH',
    description:
      'Core PCE cools to +0.1% MoM while Retail Sales expand +0.7% MoM. 4-quadrant matrix identifies Growth ↑ / Inflation ↓ sweet spot for blue-chips.',
    rawText: `BEA Personal Consumption Expenditures & Retail Sales:
Core PCE for August printed at +0.1% MoM vs +0.2% expected (Annualized: 2.6%).
Simultaneously, U.S. Retail Sales advanced +0.7% MoM, beating the +0.3% consensus estimate.
Growth/Inflation Matrix Classification:
QUADRANT: GROWTH_UP_INFLATION_DOWN (The Dow Goldilocks Sweet Spot).
Analysis:
Consumer real purchasing power expanded without reigniting Fed tightening fears.
10Y Treasury yields fell -4 bps to 5.24% on dovish easing expectations.
Market Reaction:
All 30 DJIA constituents traded positive (Advancers: 30, Decliners: 0).
YM futures rallied +420 points (+0.91%) with broad participation: Industrials (+1.2%), Consumer Staples (+0.9%), and Financials (+1.1%) expanding together.
Equal-weight Dow and price-weighted Dow rose in tandem (+0.9%), confirming broad institutional accumulation.`,
  },
]
